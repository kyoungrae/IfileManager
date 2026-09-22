import { once } from 'node:events';
import { Writable } from 'node:stream';

const ZIP_UINT16_MAX = 0xffff;
const ZIP_UINT32_MAX = 0xffffffff;
const ZIP_FLAGS = 0x0808; // UTF-8 file names + data descriptor follows file contents.

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc, chunk) {
  let next = crc;
  for (let index = 0; index < chunk.length; index += 1) next = crc32Table[(next ^ chunk[index]) & 0xff] ^ (next >>> 8);
  return next >>> 0;
}

function zipTimestamp(value) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.min(2107, Math.max(1980, safeDate.getFullYear()));
  return {
    time: (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate()
  };
}

function prepareEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('At least one file is required for a ZIP download');
  if (entries.length > ZIP_UINT16_MAX) throw new Error('Too many files for a ZIP download');
  const names = new Set();
  const prepared = entries.map((entry) => {
    if (!entry || typeof entry.name !== 'string' || typeof entry.writeContents !== 'function') throw new Error('Invalid ZIP entry');
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > ZIP_UINT32_MAX) throw new Error('A selected file is too large for a ZIP download');
    const name = uniqueName(entry.name, names);
    const nameBytes = Buffer.from(name, 'utf8');
    if (!nameBytes.length || nameBytes.length > ZIP_UINT16_MAX) throw new Error('Invalid ZIP file name');
    return { ...entry, name, nameBytes, timestamp: zipTimestamp(entry.modifiedAt) };
  });

  const estimatedBytes = prepared.reduce((total, entry) => total + 30 + entry.nameBytes.length + entry.size + 16 + 46 + entry.nameBytes.length, 22);
  if (estimatedBytes > ZIP_UINT32_MAX) throw new Error('Selected files exceed the 4 GB ZIP download limit');
  return prepared;
}

function uniqueName(originalName, names) {
  if (!names.has(originalName)) {
    names.add(originalName);
    return originalName;
  }
  const extensionAt = originalName.lastIndexOf('.');
  const base = extensionAt > 0 ? originalName.slice(0, extensionAt) : originalName;
  const extension = extensionAt > 0 ? originalName.slice(extensionAt) : '';
  for (let suffix = 2; suffix <= ZIP_UINT16_MAX; suffix += 1) {
    const candidate = `${base} (${suffix})${extension}`;
    if (!names.has(candidate)) {
      names.add(candidate);
      return candidate;
    }
  }
  throw new Error('Too many files with the same name');
}

function localFileHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(ZIP_FLAGS, 6);
  header.writeUInt16LE(0, 8); // Store files as-is; encryption is already handled by IFile Manager.
  header.writeUInt16LE(entry.timestamp.time, 10);
  header.writeUInt16LE(entry.timestamp.date, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.nameBytes]);
}

function dataDescriptor(crc32, size) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc32, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function centralDirectoryHeader(entry, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4); // Unix host, ZIP version 2.0
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(ZIP_FLAGS, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.timestamp.time, 12);
  header.writeUInt16LE(entry.timestamp.date, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, entry.nameBytes]);
}

function endOfCentralDirectory(entryCount, size, offset) {
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(size, 12);
  footer.writeUInt32LE(offset, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

async function writeChunk(destination, chunk) {
  if (destination.destroyed || destination.writableEnded) throw new Error('ZIP download was canceled');
  if (destination.write(chunk)) return;
  await once(destination, 'drain');
}

function zipEntryWriter(destination) {
  let crc32 = 0xffffffff;
  let size = 0;
  const writer = new Writable({
    write(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc32 = updateCrc32(crc32, buffer);
      size += buffer.length;
      writeChunk(destination, buffer).then(() => callback(), callback);
    }
  });
  return { writer, result: () => ({ crc32: (crc32 ^ 0xffffffff) >>> 0, size }) };
}

// Each entry supplies a writeContents(Writable) callback. This keeps every
// decrypted file streamed directly into the archive without a temporary copy.
export async function writeStoredZip(destination, entries) {
  const prepared = prepareEntries(entries);
  const centralDirectory = [];
  let offset = 0;

  for (const entry of prepared) {
    const localHeader = localFileHeader(entry);
    const localHeaderOffset = offset;
    await writeChunk(destination, localHeader);
    offset += localHeader.length;

    const payload = zipEntryWriter(destination);
    await entry.writeContents(payload.writer);
    const result = payload.result();
    if (result.size !== entry.size) throw new Error('The selected file changed during ZIP creation');
    const descriptor = dataDescriptor(result.crc32, result.size);
    await writeChunk(destination, descriptor);
    offset += result.size + descriptor.length;
    centralDirectory.push(centralDirectoryHeader({ ...entry, ...result }, localHeaderOffset));
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBytes = Buffer.concat(centralDirectory);
  await writeChunk(destination, centralDirectoryBytes);
  offset += centralDirectoryBytes.length;
  await writeChunk(destination, endOfCentralDirectory(prepared.length, centralDirectoryBytes.length, centralDirectoryOffset));
  destination.end();
}
