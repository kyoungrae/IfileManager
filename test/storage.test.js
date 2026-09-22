import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// config reads encryption environment variables on import; these are test-only values.
process.env.MONGODB_URI = 'mongodb://example.test/ifile_manager';
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.JWT_SECRET = 'test-only-secret-that-is-longer-than-thirty-two-characters';
process.env.DATA_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'ifile-manager-storage-test-'));
const { initializeStorage, normalizeRelativePath, originalDirectory, plainOriginalRoot, validateFolderName } = await import('../src/storage.js');

test('normalizes a managed relative folder path', () => {
  assert.equal(normalizeRelativePath('팀 문서/2026'), '팀 문서/2026');
  assert.equal(normalizeRelativePath(''), '');
});

test('rejects filesystem traversal and invalid folder names', () => {
  assert.throws(() => normalizeRelativePath('../private'));
  assert.throws(() => normalizeRelativePath('/etc'));
  assert.throws(() => validateFolderName('..'));
  assert.throws(() => validateFolderName('slash/name'));
});

test('creates plain-original folders under the hidden managed root', async (t) => {
  t.after(() => fs.rm(process.env.DATA_ROOT, { recursive: true, force: true }));
  await initializeStorage();
  const folder = await originalDirectory('팀 문서/2026', { create: true });
  assert.equal(folder.absolutePath, path.join(plainOriginalRoot, '팀 문서', '2026'));
  await assert.rejects(() => originalDirectory('../private', { create: true }));
});
