import crypto from 'node:crypto';
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
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
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
    name: open(file.nameEncrypted),
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

app.post('/api/files', requireAppRequest, requireAuth, upload.single('file'), asyncRoute(async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'A file is required' });
  const folder = await existingDirectory(request.body?.folderPath);
  const originalName = clientFilename(request.file.originalname);
  const storageId = crypto.randomUUID();
  const encryptedPath = filePathFor(storageId);
  try {
    await encryptFile(request.file.path, encryptedPath);
    const record = await ManagedFile.create({
      fileId: crypto.randomUUID(), storageId, folderPathKey: keyForPath(folder.normalized),
      nameEncrypted: seal(originalName), mimeEncrypted: seal(request.file.mimetype || 'application/octet-stream'),
      size: request.file.size, uploadedBy: request.user.id
    });
    await audit(request.user.id, 'file.upload', `${folder.normalized}/${originalName}`, { bytes: request.file.size });
    response.status(201).json({ id: record.fileId, name: originalName, size: request.file.size });
  } catch (error) {
    await fs.unlink(encryptedPath).catch(() => undefined);
    throw error;
  } finally {
    await fs.unlink(request.file.path).catch(() => undefined);
  }
}));

app.get('/api/files/:fileId/download', requireAuth, asyncRoute(async (request, response) => {
  const file = await ManagedFile.findOne({ fileId: request.params.fileId }).lean();
  if (!file) return response.status(404).json({ error: 'File not found' });
  const name = clientFilename(open(file.nameEncrypted));
  response.set({ 'Content-Type': open(file.mimeEncrypted), 'Content-Length': String(file.size), 'Cache-Control': 'no-store' });
  response.attachment(name);
  await audit(request.user.id, 'file.download', name, { fileId: file.fileId });
  await decryptFile(filePathFor(file.storageId), response);
}));

app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }));
app.use(express.static(new URL('../public', import.meta.url).pathname, { index: 'index.html', etag: false, maxAge: 0 }));
app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? `Files must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller` : 'Invalid upload' });
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
