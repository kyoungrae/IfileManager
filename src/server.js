import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import multer from 'multer';
import { config } from './config.js';
import { decryptFile, encryptFile, indexFor, open, seal } from './crypto.js';
import { AuditLog, ManagedFile, ManagedFolder } from './models.js';
import {
  authenticate, bootstrapAdmin, clearSession, createUser, issueReauthentication,
  requireAdmin, requireAppRequest, requireAuth, setSession, verifyReauthentication
} from './auth.js';
import {
  ROOT_PATH_KEY, collectDirectoryPaths, existingDirectory, fileRoot, initializeStorage,
  normalizeRelativePath, relativeChild, storageRoot, storageUsage, tempRoot, trashRoot, validateFolderName
} from './storage.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const contentSecurityPolicy = {
  defaultSrc: ["'self'"],
  styleSrc: ["'self'"],
  scriptSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  // Direct Tailscale-IP mode is HTTP. Do not rewrite its relative static assets to HTTPS.
  ...(config.cookieSecure ? {} : { upgradeInsecureRequests: null })
};
app.use(helmet({
  strictTransportSecurity: config.cookieSecure ? undefined : false,
  contentSecurityPolicy: { directives: contentSecurityPolicy }
}));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const upload = multer({
  storage: multer.diskStorage({ destination: tempRoot, filename: (_request, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`) }),
  limits: { fileSize: config.maxUploadBytes, files: config.maxUploadFiles, fields: 5 },
  fileFilter: (_request, file, callback) => callback(null, Boolean(file.originalname))
});

const keyForPath = (relativePath) => relativePath ? indexFor('folder-path', relativePath) : ROOT_PATH_KEY;
const filePathFor = (storageId) => path.join(fileRoot, `${storageId}.ifm`);

function apiUser(user) {
  return { id: user.id, username: user.username ?? open(user.usernameEncrypted), role: user.role };
}

function clientFilename(name) {
  const result = path.basename(String(name)).replace(/[\u0000-\u001f\u007f]/g, '_').slice(0, 240);
  if (!result) throw new Error('Invalid file name');
  return result;
}

function managedFilename(name) {
  const source = String(name);
  if (!/[\u0080-\u009f\u00c0-\u00ff]/.test(source)) return clientFilename(source);
  const decoded = Buffer.from(source, 'latin1').toString('utf8');
  return clientFilename(decoded.includes('\uFFFD') ? source : decoded);
}

function parentRelativePath(relativePath) {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.join('/');
}

function replacePathPrefix(relativePath, oldPrefix, newPrefix) {
  return relativePath === oldPrefix ? newPrefix : `${newPrefix}${relativePath.slice(oldPrefix.length)}`;
}

function normalizeV4LogPath(input) {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string' || input.includes('\u0000') || path.isAbsolute(input)) throw new Error('Invalid V4 log path');
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'));
  if (normalized === '.' || normalized === '') return '';
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('V4 log path escapes its root');
  return normalized;
}

async function existingV4LogEntry(relativePath, { directoryOnly = false } = {}) {
  const normalized = normalizeV4LogPath(relativePath);
  let absolutePath = config.v4LogRoot;
  let stat = await fs.lstat(absolutePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('V4 log root is unavailable');
  for (const segment of normalized ? normalized.split('/') : []) {
    absolutePath = path.join(absolutePath, segment);
    stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) throw new Error('V4 log symbolic links are not allowed');
  }
  if (directoryOnly && !stat.isDirectory()) throw new Error('V4 log directory does not exist');
  return { absolutePath, normalized, stat };
}

async function listV4LogEntries(relativePath) {
  const current = await existingV4LogEntry(relativePath, { directoryOnly: true });
  const directoryEntries = await fs.readdir(current.absolutePath, { withFileTypes: true });
  const entries = await Promise.all(directoryEntries
    .filter((entry) => (entry.isDirectory() || entry.isFile()) && !entry.isSymbolicLink())
    .map(async (entry) => {
      const entryPath = relativeChild(current.normalized, entry.name);
      const stat = await fs.lstat(path.join(current.absolutePath, entry.name));
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) return null;
      return {
        name: entry.name,
        path: entryPath,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.isFile() ? stat.size : 0,
        modifiedAt: stat.mtime.toISOString()
      };
    }));
  return { path: current.normalized, entries: entries.filter(Boolean).sort((left, right) => (left.type === right.type ? left.name.localeCompare(right.name, 'ko') : left.type === 'directory' ? -1 : 1)) };
}

async function readFolderTree() {
  const folders = await ManagedFolder.find({}).lean();
  const namesByPath = new Map();
  for (const folder of folders) {
    try { namesByPath.set(open(folder.pathEncrypted), open(folder.nameEncrypted)); } catch { /* Tampered metadata is omitted. */ }
  }

  async function readChildren(relativePath, absolutePath) {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const children = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(async (entry) => {
        const folderPath = relativeChild(relativePath, entry.name);
        return {
          name: namesByPath.get(folderPath) ?? entry.name,
          path: folderPath,
          children: await readChildren(folderPath, path.join(absolutePath, entry.name))
        };
      }));
    return children.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  return readChildren('', storageRoot);
}

async function audit(actor, action, target, details) {
  await AuditLog.create({ actor, action, targetEncrypted: seal(target), detailsEncrypted: details ? seal(JSON.stringify(details)) : undefined });
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

app.get('/health', (_request, response) => {
  const ready = mongoose.connection.readyState === 1;
  response.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'starting' });
});

app.post('/api/auth/login', requireAppRequest, loginLimiter, asyncRoute(async (request, response) => {
  const user = await authenticate(request.body?.username, request.body?.password);
  if (!user) return response.status(401).json({ error: 'Invalid username or password' });
  setSession(response, user);
  await audit(user.id, 'login', 'session');
  response.json({ user: apiUser(user) });
}));

app.post('/api/auth/logout', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  await audit(request.user.id, 'logout', 'session');
  clearSession(response);
  response.status(204).end();
}));

app.get('/api/auth/me', requireAuth, (request, response) => response.json({ user: apiUser(request.user) }));

app.get('/api/storage', requireAuth, asyncRoute(async (_request, response) => {
  response.json(await storageUsage());
}));

app.get('/api/v4-logs', requireAuth, asyncRoute(async (request, response) => {
  response.json(await listV4LogEntries(request.query.path));
}));

app.get('/api/v4-logs/download', requireAuth, asyncRoute(async (request, response, next) => {
  const target = await existingV4LogEntry(request.query.path);
  if (!target.stat.isFile()) return response.status(400).json({ error: 'V4 log path is not a file' });
  const name = clientFilename(path.basename(target.absolutePath));
  response.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(target.stat.size), 'Cache-Control': 'no-store' });
  response.attachment(name);
  await audit(request.user.id, 'v4-log.download', target.normalized, { bytes: target.stat.size });
  createReadStream(target.absolutePath).on('error', next).pipe(response);
}));

app.get('/api/folders/tree', requireAuth, asyncRoute(async (_request, response) => {
  response.json({ folders: await readFolderTree() });
}));

app.post('/api/users', requireAppRequest, requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  const user = await createUser(request.body ?? {});
  await audit(request.user.id, 'user.create', user.id, { role: user.role });
  response.status(201).json({ user: { id: user.id, username: open(user.usernameEncrypted), role: user.role } });
}));

app.post('/api/auth/reauthenticate', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  const user = await authenticate(request.user.username, request.body?.password);
  if (!user || user.id !== request.user.id) return response.status(401).json({ error: 'Password confirmation failed' });
  response.json({ token: issueReauthentication(request.user.id), expiresInSeconds: 300 });
}));

app.get('/api/folders', requireAuth, asyncRoute(async (request, response) => {
  const current = await existingDirectory(request.query.path);
  const [directoryEntries, folders, files] = await Promise.all([
    fs.readdir(current.absolutePath, { withFileTypes: true }),
    ManagedFolder.find({ parentPathKey: keyForPath(current.normalized) }).lean(),
    ManagedFile.find({ folderPathKey: keyForPath(current.normalized) }).sort({ createdAt: -1 }).lean()
  ]);
  const namesByPath = new Map();
  for (const folder of folders) {
    try { namesByPath.set(open(folder.pathEncrypted), open(folder.nameEncrypted)); } catch { /* tampered metadata is intentionally omitted */ }
  }
  const childFolders = directoryEntries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => {
      const folderPath = relativeChild(current.normalized, entry.name);
      return { name: namesByPath.get(folderPath) ?? entry.name, path: folderPath };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const visibleFiles = files.map((file) => ({
    id: file.fileId,
    name: managedFilename(open(file.nameEncrypted)),
    mime: open(file.mimeEncrypted),
    size: file.size,
    createdAt: file.createdAt
  }));
  response.json({ path: current.normalized, folders: childFolders, files: visibleFiles });
}));

app.post('/api/folders', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  const parent = await existingDirectory(request.body?.parentPath);
  const name = validateFolderName(request.body?.name);
  const folderPath = relativeChild(parent.normalized, name);
  const absolutePath = path.join(parent.absolutePath, name);
  await fs.mkdir(absolutePath, { mode: 0o700 });
  try {
    await ManagedFolder.create({
      pathKey: keyForPath(folderPath), parentPathKey: keyForPath(parent.normalized),
      nameEncrypted: seal(name), pathEncrypted: seal(folderPath), createdBy: request.user.id
    });
    await audit(request.user.id, 'folder.create', folderPath);
  } catch (error) {
    await fs.rmdir(absolutePath).catch(() => undefined);
    throw error;
  }
  response.status(201).json({ name, path: folderPath });
}));

app.patch('/api/folders', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  const target = await existingDirectory(request.body?.path);
  if (!target.normalized) return response.status(400).json({ error: 'The managed storage root cannot be renamed' });
  const name = validateFolderName(request.body?.name);
  const parent = await existingDirectory(parentRelativePath(target.normalized));
  const renamedPath = relativeChild(parent.normalized, name);
  if (renamedPath === target.normalized) return response.json({ name, path: renamedPath });

  const renamedAbsolutePath = path.join(parent.absolutePath, name);
  try {
    await fs.lstat(renamedAbsolutePath);
    const error = new Error('A folder with that name already exists'); error.code = 'EEXIST'; throw error;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const paths = await collectDirectoryPaths(target.normalized);
  const pathKeys = paths.map(keyForPath);
  const pathByKey = new Map(paths.map((folderPath) => [keyForPath(folderPath), folderPath]));
  const [folders, files] = await Promise.all([
    ManagedFolder.find({ pathKey: { $in: pathKeys } }).lean(),
    ManagedFile.find({ folderPathKey: { $in: pathKeys } }).lean()
  ]);
  const folderUpdates = folders.flatMap((folder) => {
    const oldPath = pathByKey.get(folder.pathKey);
    if (!oldPath) return [];
    const newPath = replacePathPrefix(oldPath, target.normalized, renamedPath);
    const update = {
      pathKey: keyForPath(newPath),
      parentPathKey: keyForPath(parentRelativePath(newPath)),
      pathEncrypted: seal(newPath)
    };
    if (oldPath === target.normalized) update.nameEncrypted = seal(name);
    return [{ updateOne: { filter: { _id: folder._id }, update: { $set: update } } }];
  });
  const fileUpdates = files.flatMap((file) => {
    const oldFolderPath = pathByKey.get(file.folderPathKey);
    if (!oldFolderPath) return [];
    const newFolderPath = replacePathPrefix(oldFolderPath, target.normalized, renamedPath);
    return [{ updateOne: { filter: { _id: file._id }, update: { $set: { folderPathKey: keyForPath(newFolderPath) } } } }];
  });

  await fs.rename(target.absolutePath, renamedAbsolutePath);
  try {
    await audit(request.user.id, 'folder.rename', target.normalized, { renamedPath, foldersUpdated: folderUpdates.length, filesUpdated: fileUpdates.length });
    if (folderUpdates.length) await ManagedFolder.bulkWrite(folderUpdates);
    if (fileUpdates.length) await ManagedFile.bulkWrite(fileUpdates);
  } catch (error) {
    await fs.rename(renamedAbsolutePath, target.absolutePath).catch(() => undefined);
    throw error;
  }
  response.json({ name, path: renamedPath });
}));

app.delete('/api/folders', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  const relativePath = normalizeRelativePath(request.body?.path);
  if (!relativePath) return response.status(400).json({ error: 'The managed storage root cannot be deleted' });
  if (!verifyReauthentication(request.body?.reauthenticationToken, request.user.id)) return response.status(401).json({ error: 'Password confirmation has expired or is invalid' });

  const target = await existingDirectory(relativePath);
  const paths = await collectDirectoryPaths(target.normalized);
  const pathKeys = paths.map(keyForPath);
  const files = await ManagedFile.find({ folderPathKey: { $in: pathKeys } }).lean();
  const trashPath = path.join(trashRoot, `${crypto.randomUUID()}-deleted-folder`);

  // Move first. This makes the folder immediately inaccessible and lets us restore it if metadata deletion fails.
  await fs.rename(target.absolutePath, trashPath);
  try {
    // Audit first: a failure leaves both the data and metadata untouched after the rename is restored.
    await audit(request.user.id, 'folder.delete', target.normalized, { filesDeleted: files.length });
    await ManagedFolder.deleteMany({ pathKey: { $in: pathKeys } });
    await ManagedFile.deleteMany({ folderPathKey: { $in: pathKeys } });
  } catch (error) {
    await fs.rename(trashPath, target.absolutePath).catch(() => undefined);
    throw error;
  }
  await Promise.all(files.map((file) => fs.unlink(filePathFor(file.storageId)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  })));
  await fs.rm(trashPath, { recursive: true, force: true });
  response.status(204).end();
}));

app.post('/api/files', requireAppRequest, requireAuth, upload.array('files', config.maxUploadFiles), asyncRoute(async (request, response) => {
  const uploadedFiles = request.files ?? [];
  if (!uploadedFiles.length) return response.status(400).json({ error: 'At least one file is required' });
  const folder = await existingDirectory(request.body?.folderPath);
  const encryptedPaths = [];
  const records = [];
  const totalBytes = uploadedFiles.reduce((total, file) => total + file.size, 0);
  try {
    for (const file of uploadedFiles) {
      const originalName = managedFilename(file.originalname);
      const storageId = crypto.randomUUID();
      const encryptedPath = filePathFor(storageId);
      await encryptFile(file.path, encryptedPath);
      encryptedPaths.push(encryptedPath);
      const record = await ManagedFile.create({
        fileId: crypto.randomUUID(), storageId, folderPathKey: keyForPath(folder.normalized),
        nameEncrypted: seal(originalName), mimeEncrypted: seal(file.mimetype || 'application/octet-stream'),
        size: file.size, uploadedBy: request.user.id
      });
      records.push({ id: record.fileId, name: originalName, size: file.size });
    }
    await audit(request.user.id, 'file.upload', folder.normalized, { files: records.length, bytes: totalBytes });
    response.status(201).json({ files: records });
  } catch (error) {
    await Promise.all(encryptedPaths.map((encryptedPath) => fs.unlink(encryptedPath).catch(() => undefined)));
    if (records.length) await ManagedFile.deleteMany({ fileId: { $in: records.map((record) => record.id) } });
    throw error;
  } finally {
    await Promise.all(uploadedFiles.map((file) => fs.unlink(file.path).catch(() => undefined)));
  }
}));

app.delete('/api/files/:fileId', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  if (!verifyReauthentication(request.body?.reauthenticationToken, request.user.id)) return response.status(401).json({ error: 'Password confirmation has expired or is invalid' });
  const file = await ManagedFile.findOne({ fileId: request.params.fileId }).lean();
  if (!file) return response.status(404).json({ error: 'File not found' });

  const encryptedPath = filePathFor(file.storageId);
  const trashPath = path.join(trashRoot, `${crypto.randomUUID()}-deleted-file`);
  await fs.rename(encryptedPath, trashPath);
  try {
    await audit(request.user.id, 'file.delete', open(file.nameEncrypted), { fileId: file.fileId, bytes: file.size });
    const deletion = await ManagedFile.deleteOne({ _id: file._id });
    if (deletion.deletedCount !== 1) throw new Error('File metadata could not be deleted');
  } catch (error) {
    await fs.rename(trashPath, encryptedPath).catch(() => undefined);
    throw error;
  }
  await fs.unlink(trashPath);
  response.status(204).end();
}));

app.get('/api/files/:fileId/download', requireAuth, asyncRoute(async (request, response) => {
  const file = await ManagedFile.findOne({ fileId: request.params.fileId }).lean();
  if (!file) return response.status(404).json({ error: 'File not found' });
  const name = managedFilename(open(file.nameEncrypted));
  response.set({ 'Content-Type': open(file.mimeEncrypted), 'Content-Length': String(file.size), 'Cache-Control': 'no-store' });
  response.attachment(name);
  await audit(request.user.id, 'file.download', name, { fileId: file.fileId });
  await decryptFile(filePathFor(file.storageId), response);
}));

app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }));
app.use(express.static(new URL('../public', import.meta.url).pathname, { index: 'index.html', etag: false, maxAge: 0 }));
app.use(async (error, request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const temporaryFiles = Array.isArray(request.files) ? request.files : request.file ? [request.file] : [];
    await Promise.all(temporaryFiles.map((file) => fs.unlink(file.path).catch(() => undefined)));
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Files must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller`
      : error.code === 'LIMIT_FILE_COUNT'
        ? `Upload no more than ${config.maxUploadFiles} files at once`
        : 'Invalid upload';
    return response.status(400).json({ error: message });
  }
  if (error?.code === 'EEXIST') return response.status(409).json({ error: 'A folder with that name already exists' });
  if (error?.code === 'ENOENT') return response.status(404).json({ error: 'Folder or file not found' });
  if (error?.code === 11000) return response.status(409).json({ error: 'That record already exists' });
  console.error(error);
  response.status(400).json({ error: error?.message?.startsWith('Folder') || error?.message?.startsWith('Invalid') ? error.message : 'The request could not be completed' });
});

async function start() {
  await initializeStorage();
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  await bootstrapAdmin();
  app.listen(config.port, () => console.log(`IFile Manager listening on port ${config.port}`));
}

start().catch((error) => {
  console.error('Startup failed:', error.message);
  process.exit(1);
});
