import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { writeStoredZip } from '../src/zip.js';

test('creates a streamed UTF-8 ZIP with each selected file once', async () => {
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (chunk) => chunks.push(chunk));
  const ended = once(output, 'end');
  const first = Buffer.from('first file');
  const second = Buffer.from('두 번째 파일');

  await writeStoredZip(output, [
    { name: 'same.txt', size: first.length, modifiedAt: '2026-09-22T00:00:00.000Z', writeContents: (destination) => pipeline(Readable.from([first]), destination) },
    { name: 'same.txt', size: second.length, modifiedAt: '2026-09-22T00:00:00.000Z', writeContents: (destination) => pipeline(Readable.from([second]), destination) }
  ]);
  await ended;

  const archive = Buffer.concat(chunks);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.ok(archive.includes(Buffer.from('same.txt')));
  assert.ok(archive.includes(Buffer.from('same (2).txt')));
  assert.ok(archive.includes(second));
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
