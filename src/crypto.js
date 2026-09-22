import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';

const MAGIC = Buffer.from('IFM1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

export function seal(plainText) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function open(sealed) {
  const [version, ivEncoded, ciphertextEncoded, tagEncoded] = String(sealed).split('.');
  if (version !== 'v1' || !ivEncoded || !ciphertextEncoded || !tagEncoded) throw new Error('Invalid encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.dataKey, Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
}

// Deterministic HMAC indexes allow exact MongoDB lookups without storing paths/usernames in plaintext.
export function indexFor(kind, value) {
  return crypto.createHmac('sha256', config.dataKey).update(`${kind}:${value}`).digest('hex');
}

export async function encryptFile(sourcePath, destinationPath) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.dataKey, iv);
  await fs.writeFile(destinationPath, Buffer.concat([MAGIC, iv]), { flag: 'wx', mode: 0o600 });
  await pipeline(createReadStream(sourcePath), cipher, createWriteStream(destinationPath, { flags: 'a', mode: 0o600 }));
  await fs.appendFile(destinationPath, cipher.getAuthTag());
}

export async function decryptFile(sourcePath, destination) {
  const stat = await fs.stat(sourcePath);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) throw new Error('Encrypted file is too small');
  const handle = await fs.open(sourcePath, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unrecognized encrypted file');
    const decipher = crypto.createDecipheriv('aes-256-gcm', config.dataKey, header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(sourcePath, { start: HEADER_BYTES, end: stat.size - TAG_BYTES - 1 }),
      decipher,
      destination
    );
  } finally {
    await handle.close();
  }
}
