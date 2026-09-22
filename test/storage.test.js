import assert from 'node:assert/strict';
import test from 'node:test';

// config reads encryption environment variables on import; these are test-only values.
process.env.MONGODB_URI = 'mongodb://example.test/ifile_manager';
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.JWT_SECRET = 'test-only-secret-that-is-longer-than-thirty-two-characters';
const { normalizeRelativePath, validateFolderName } = await import('../src/storage.js');

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
