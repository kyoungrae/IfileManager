import crypto from 'node:crypto';
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
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
import { AuditLog, ManagedFile, ManagedFolder, TrashedFile } from './models.js';
import { writeStoredZip } from './zip.js';
import {
  authenticate, bootstrapAdmin, clearSession, createUser, issueReauthentication,
  requireAdmin, requireAppRequest, requireAuth, setSession, verifyReauthentication
} from './auth.js';
import {
  ROOT_PATH_KEY, collectDirectoryPaths, existingDirectory, fileRoot, initializeStorage,
  normalizeRelativePath, originalDirectory, relativeChild, storageRoot, storageUsage, tempRoot, trashRoot, validateFolderName
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
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
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

function forceDownload(response, name, size) {
  // Set attachment first: Express infers a previewable MIME type from the name.
  // Override it afterwards so browsers cannot render the downloaded file inline.
  response.attachment(name);
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff'
  };
  if (Number.isSafeInteger(size) && size >= 0) headers['Content-Length'] = String(size);
  response.set(headers);
}

function selectedFileIds(input) {
  const values = Array.isArray(input) ? input : [input];
  const ids = [...new Set(values)];
  if (!ids.length || ids.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error('Select at least one valid file');
  }
  return ids;
}

function selectedTrashIds(input) {
  const values = Array.isArray(input) ? input : [input];
  const ids = [...new Set(values)];
  if (!ids.length || ids.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error('Select at least one valid trash file');
  }
  return ids;
}

function filenameVariant(name, suffix) {
  if (suffix === 1) return name;
  const extensionAt = name.lastIndexOf('.');
  const base = extensionAt > 0 ? name.slice(0, extensionAt) : name;
  const extension = extensionAt > 0 ? name.slice(extensionAt) : '';
  return `${base} (${suffix})${extension}`;
}

async function copyPlainOriginal(sourcePath, folderPath, originalName) {
  const { absolutePath: directory } = await originalDirectory(folderPath, { create: true });
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const name = filenameVariant(originalName, suffix);
    const destination = path.join(directory, name);
    try {
      await fs.copyFile(sourcePath, destination, fsConstants.COPYFILE_EXCL);
      await fs.chmod(destination, 0o600);
      return { name, absolutePath: destination };
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      await fs.unlink(destination).catch(() => undefined);
      throw error;
    }
  }
  throw new Error('Too many duplicate file names in the plain original folder');
}

function plainOriginalName(file) {
  return file.plainOriginalNameEncrypted ? clientFilename(open(file.plainOriginalNameEncrypted)) : managedFilename(open(file.nameEncrypted));
}

async function folderPathForFile(file) {
  if (file.folderPathKey === ROOT_PATH_KEY) return '';
  const folder = await ManagedFolder.findOne({ pathKey: file.folderPathKey }).lean();
  if (!folder) throw new Error('The original folder metadata is unavailable');
  return normalizeRelativePath(open(folder.pathEncrypted));
}

async function movePlainOriginalFileToTrash(file, folderPath = undefined, destinationPath = undefined) {
  const relativePath = folderPath ?? await folderPathForFile(file);
  let directory;
  try { directory = await originalDirectory(relativePath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const originalPath = path.join(directory.absolutePath, plainOriginalName(file));
  let stat;
  try { stat = await fs.lstat(originalPath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Plain original file is unsafe');
  const trashPath = destinationPath ?? path.join(trashRoot, `${crypto.randomUUID()}-plain-file`);
  await fs.rename(originalPath, trashPath);
  return { originalPath, trashPath };
}

async function movePlainOriginalFolderToTrash(relativePath) {
  let source;
  try { source = await originalDirectory(relativePath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const trashPath = path.join(trashRoot, `${crypto.randomUUID()}-plain-folder`);
  await fs.rename(source.absolutePath, trashPath);
  return { originalPath: source.absolutePath, trashPath };
}

async function renamePlainOriginalFolder(oldPath, newPath) {
  let source;
  try { source = await originalDirectory(oldPath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const parent = await originalDirectory(parentRelativePath(newPath), { create: true });
  const destination = path.join(parent.absolutePath, path.basename(newPath));
  try {
    await fs.lstat(destination);
    const error = new Error('A plain original folder with that name already exists'); error.code = 'EEXIST'; throw error;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rename(source.absolutePath, destination);
  return { originalPath: source.absolutePath, destination };
}

async function materializePlainOriginal(file, folderPath) {
  const { absolutePath: directory } = await originalDirectory(folderPath, { create: true });
  const configuredName = file.plainOriginalNameEncrypted ? plainOriginalName(file) : null;
  const originalName = configuredName ?? managedFilename(open(file.nameEncrypted));
  let name = originalName;
  let destination = path.join(directory, name);

  if (configuredName) {
    try {
      const stat = await fs.lstat(destination);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Plain original file is unsafe');
      return false;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  } else {
    for (let suffix = 1; suffix <= 10_000; suffix += 1) {
      name = filenameVariant(originalName, suffix);
      destination = path.join(directory, name);
      try { await fs.lstat(destination); } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
      if (suffix === 10_000) throw new Error('Too many duplicate file names in the plain original folder');
    }
  }

  const temporaryPath = path.join(directory, `.${crypto.randomUUID()}.partial`);
  try {
    await decryptFile(filePathFor(file.storageId), createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
    await fs.rename(temporaryPath, destination);
    await ManagedFile.updateOne({ _id: file._id }, { $set: { plainOriginalNameEncrypted: seal(name) } });
    return true;
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function trashDirectoryFor(trashId) {
  return path.join(trashRoot, `file-${trashId}`);
}

async function regularFileOrNull(absolutePath) {
  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Trash file is unsafe');
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function availablePlainOriginalPath(folderPath, desiredName) {
  const { absolutePath: directory } = await originalDirectory(folderPath, { create: true });
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const name = filenameVariant(desiredName, suffix);
    const absolutePath = path.join(directory, name);
    try {
      await fs.lstat(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') return { name, absolutePath };
      throw error;
    }
  }
  throw new Error('Too many duplicate file names in the plain original folder');
}

async function restoreDirectoryForTrashedFile(file) {
  if (file.originalFolderId) {
    const folder = await ManagedFolder.findById(file.originalFolderId).lean();
    if (folder) {
      try { return await existingDirectory(normalizeRelativePath(open(folder.pathEncrypted))); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const originalPath = normalizeRelativePath(open(file.originalFolderPathEncrypted));
  try { return await existingDirectory(originalPath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return existingDirectory('');
  }
}

function apiTrashedFile(file) {
  return {
    id: file.trashId,
    name: managedFilename(open(file.nameEncrypted)),
    originalPath: normalizeRelativePath(open(file.originalFolderPathEncrypted)),
    size: file.size,
    trashedAt: file.createdAt
  };
}

async function restoreTrashedFile(file, actor) {
  const sourceDirectory = trashDirectoryFor(file.trashId);
  const sourceDirectoryStat = await fs.lstat(sourceDirectory);
  if (!sourceDirectoryStat.isDirectory() || sourceDirectoryStat.isSymbolicLink()) throw new Error('Trash directory is unsafe');
  const sourceEncryptedPath = path.join(sourceDirectory, `${file.storageId}.ifm`);
  if (!await regularFileOrNull(sourceEncryptedPath)) throw new Error('The encrypted trash file is unavailable');
  const destination = await restoreDirectoryForTrashedFile(file);
  const destinationEncryptedPath = filePathFor(file.storageId);
  try {
    await fs.lstat(destinationEncryptedPath);
    const error = new Error('A stored file with this identifier already exists'); error.code = 'EEXIST'; throw error;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const sourcePlainName = plainOriginalName(file);
  const sourcePlainPath = path.join(sourceDirectory, sourcePlainName);
  const plainSourceExists = Boolean(await regularFileOrNull(sourcePlainPath));
  const plainDestination = plainSourceExists ? await availablePlainOriginalPath(destination.normalized, sourcePlainName) : null;
  const restoredFile = {
    fileId: file.originalFileId,
    storageId: file.storageId,
    folderPathKey: keyForPath(destination.normalized),
    nameEncrypted: file.nameEncrypted,
    ...(plainDestination ? { plainOriginalNameEncrypted: seal(plainDestination.name) } : {}),
    mimeEncrypted: file.mimeEncrypted,
    size: file.size,
    uploadedBy: file.uploadedBy
  };
  let created = false;
  let plainMoved = false;
  await fs.rename(sourceEncryptedPath, destinationEncryptedPath);
  try {
    if (plainDestination) {
      await fs.rename(sourcePlainPath, plainDestination.absolutePath);
      plainMoved = true;
    }
    await ManagedFile.create(restoredFile);
    created = true;
    await audit(actor, 'file.restore', managedFilename(open(file.nameEncrypted)), { trashId: file.trashId, restoredPath: destination.normalized });
    const deletion = await TrashedFile.deleteOne({ _id: file._id });
    if (deletion.deletedCount !== 1) throw new Error('Trash metadata could not be deleted');
  } catch (error) {
    if (created) await ManagedFile.deleteOne({ fileId: file.originalFileId }).catch(() => undefined);
    if (plainMoved) await fs.rename(plainDestination.absolutePath, sourcePlainPath).catch(() => undefined);
    await fs.rename(destinationEncryptedPath, sourceEncryptedPath).catch(() => undefined);
    throw error;
  }
  await fs.rmdir(sourceDirectory).catch(() => undefined);
  return { path: destination.normalized, name: managedFilename(open(file.nameEncrypted)) };
}

async function permanentlyDeleteTrashedFiles(files, actor) {
  for (const file of files) {
    const directory = trashDirectoryFor(file.trashId);
    await audit(actor, 'trash.delete_permanent', managedFilename(open(file.nameEncrypted)), { trashId: file.trashId, bytes: file.size });
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Trash directory is unsafe');
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const deletion = await TrashedFile.deleteOne({ _id: file._id });
    if (deletion.deletedCount !== 1) throw new Error('Trash metadata could not be deleted');
  }
}

async function synchronizePlainOriginals() {
  const [folders, files] = await Promise.all([ManagedFolder.find({}).lean(), ManagedFile.find({}).lean()]);
  const folderPathByKey = new Map([[ROOT_PATH_KEY, '']]);
  for (const folder of folders) {
    try { folderPathByKey.set(folder.pathKey, normalizeRelativePath(open(folder.pathEncrypted))); } catch { /* Skip tampered metadata. */ }
  }

  let copied = 0;
  for (const file of files) {
    const folderPath = folderPathByKey.get(file.folderPathKey);
    if (folderPath === undefined) {
      console.warn(`Skipping plain original backup for ${file.fileId}: folder metadata is unavailable`);
      continue;
    }
    try {
      if (await materializePlainOriginal(file, folderPath)) copied += 1;
    } catch (error) {
      console.warn(`Could not create plain original backup for ${file.fileId}: ${error.message}`);
    }
  }
  if (copied) console.log(`Created ${copied} plain original backup${copied === 1 ? '' : 's'}`);
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

async function moveManagedFolder(target, destination, actor) {
  const movedPath = relativeChild(destination.normalized, path.basename(target.normalized));
  const movedAbsolutePath = path.join(destination.absolutePath, path.basename(target.normalized));
  try {
    await fs.lstat(movedAbsolutePath);
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
    const newPath = replacePathPrefix(oldPath, target.normalized, movedPath);
    return [{ updateOne: { filter: { _id: folder._id }, update: { $set: {
      pathKey: keyForPath(newPath),
      parentPathKey: keyForPath(parentRelativePath(newPath)),
      pathEncrypted: seal(newPath)
    } } } }];
  });
  const fileUpdates = files.flatMap((file) => {
    const oldFolderPath = pathByKey.get(file.folderPathKey);
    if (!oldFolderPath) return [];
    const newFolderPath = replacePathPrefix(oldFolderPath, target.normalized, movedPath);
    return [{ updateOne: { filter: { _id: file._id }, update: { $set: { folderPathKey: keyForPath(newFolderPath) } } } }];
  });

  // Move both filesystem copies first; restore either if the metadata write fails.
  await fs.rename(target.absolutePath, movedAbsolutePath);
  let plainOriginalRename;
  try {
    plainOriginalRename = await renamePlainOriginalFolder(target.normalized, movedPath);
    await audit(actor, 'folder.move', target.normalized, {
      destinationPath: destination.normalized,
      movedPath,
      foldersUpdated: folderUpdates.length,
      filesUpdated: fileUpdates.length
    });
    if (folderUpdates.length) await ManagedFolder.bulkWrite(folderUpdates);
    if (fileUpdates.length) await ManagedFile.bulkWrite(fileUpdates);
  } catch (error) {
    if (plainOriginalRename) await fs.rename(plainOriginalRename.destination, plainOriginalRename.originalPath).catch(() => undefined);
    await fs.rename(movedAbsolutePath, target.absolutePath).catch(() => undefined);
    throw error;
  }
  return { path: movedPath, name: path.basename(movedPath) };
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

app.get('/api/trash', requireAuth, asyncRoute(async (_request, response) => {
  const records = await TrashedFile.find({}).sort({ createdAt: -1 }).lean();
  const files = records.flatMap((file) => {
    try { return [apiTrashedFile(file)]; } catch { return []; }
  });
  response.json({ files });
}));

app.get('/api/v4-logs', requireAuth, asyncRoute(async (request, response) => {
  response.json(await listV4LogEntries(request.query.path));
}));

app.get('/api/v4-logs/download', requireAuth, asyncRoute(async (request, response, next) => {
  const target = await existingV4LogEntry(request.query.path);
  if (!target.stat.isFile()) return response.status(400).json({ error: 'V4 log path is not a file' });
  const name = clientFilename(path.basename(target.absolutePath));
  forceDownload(response, name, target.stat.size);
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
  let plainOriginalPath;
  try {
    const plainOriginalParent = await originalDirectory(parent.normalized, { create: true });
    plainOriginalPath = path.join(plainOriginalParent.absolutePath, name);
    await fs.mkdir(plainOriginalPath, { mode: 0o700 });
    await ManagedFolder.create({
      pathKey: keyForPath(folderPath), parentPathKey: keyForPath(parent.normalized),
      nameEncrypted: seal(name), pathEncrypted: seal(folderPath), createdBy: request.user.id
    });
    await audit(request.user.id, 'folder.create', folderPath);
  } catch (error) {
    if (plainOriginalPath) await fs.rmdir(plainOriginalPath).catch(() => undefined);
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
  let plainOriginalRename;
  try {
    plainOriginalRename = await renamePlainOriginalFolder(target.normalized, renamedPath);
    await audit(request.user.id, 'folder.rename', target.normalized, { renamedPath, foldersUpdated: folderUpdates.length, filesUpdated: fileUpdates.length });
    if (folderUpdates.length) await ManagedFolder.bulkWrite(folderUpdates);
    if (fileUpdates.length) await ManagedFile.bulkWrite(fileUpdates);
  } catch (error) {
    if (plainOriginalRename) await fs.rename(plainOriginalRename.destination, plainOriginalRename.originalPath).catch(() => undefined);
    await fs.rename(renamedAbsolutePath, target.absolutePath).catch(() => undefined);
    throw error;
  }
  response.json({ name, path: renamedPath });
}));

app.post('/api/folders/move', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  const target = await existingDirectory(request.body?.path);
  if (!target.normalized) return response.status(400).json({ error: 'The managed storage root cannot be moved' });
  const destination = await existingDirectory(request.body?.destinationPath);
  if (destination.normalized === target.normalized) return response.status(400).json({ error: 'A folder cannot be moved into itself' });
  if (destination.normalized.startsWith(`${target.normalized}/`)) return response.status(400).json({ error: 'A folder cannot be moved into one of its subfolders' });
  if (parentRelativePath(target.normalized) === destination.normalized) {
    return response.json({ name: path.basename(target.normalized), path: target.normalized });
  }
  response.json(await moveManagedFolder(target, destination, request.user.id));
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
  let plainOriginalTrash;

  // Move first. This makes both copies immediately inaccessible and lets us restore them if metadata deletion fails.
  plainOriginalTrash = await movePlainOriginalFolderToTrash(relativePath);
  try { await fs.rename(target.absolutePath, trashPath); } catch (error) {
    if (plainOriginalTrash) await fs.rename(plainOriginalTrash.trashPath, plainOriginalTrash.originalPath).catch(() => undefined);
    throw error;
  }
  try {
    // Audit first: a failure leaves both the data and metadata untouched after the rename is restored.
    await audit(request.user.id, 'folder.delete', target.normalized, { filesDeleted: files.length });
    await ManagedFolder.deleteMany({ pathKey: { $in: pathKeys } });
    await ManagedFile.deleteMany({ folderPathKey: { $in: pathKeys } });
  } catch (error) {
    if (plainOriginalTrash) await fs.rename(plainOriginalTrash.trashPath, plainOriginalTrash.originalPath).catch(() => undefined);
    await fs.rename(trashPath, target.absolutePath).catch(() => undefined);
    throw error;
  }
  await Promise.all(files.map((file) => fs.unlink(filePathFor(file.storageId)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  })));
  await fs.rm(trashPath, { recursive: true, force: true });
  if (plainOriginalTrash) await fs.rm(plainOriginalTrash.trashPath, { recursive: true, force: true });
  response.status(204).end();
}));

app.post('/api/files', requireAppRequest, requireAuth, upload.array('files', config.maxUploadFiles), asyncRoute(async (request, response) => {
  const uploadedFiles = request.files ?? [];
  if (!uploadedFiles.length) return response.status(400).json({ error: 'At least one file is required' });
  const folder = await existingDirectory(request.body?.folderPath);
  const encryptedPaths = [];
  const plainOriginalPaths = [];
  const records = [];
  const totalBytes = uploadedFiles.reduce((total, file) => total + file.size, 0);
  try {
    for (const file of uploadedFiles) {
      const originalName = managedFilename(file.originalname);
      const storageId = crypto.randomUUID();
      const encryptedPath = filePathFor(storageId);
      await encryptFile(file.path, encryptedPath);
      encryptedPaths.push(encryptedPath);
      const plainOriginal = await copyPlainOriginal(file.path, folder.normalized, originalName);
      plainOriginalPaths.push(plainOriginal.absolutePath);
      const record = await ManagedFile.create({
        fileId: crypto.randomUUID(), storageId, folderPathKey: keyForPath(folder.normalized),
        nameEncrypted: seal(originalName), plainOriginalNameEncrypted: seal(plainOriginal.name), mimeEncrypted: seal(file.mimetype || 'application/octet-stream'),
        size: file.size, uploadedBy: request.user.id
      });
      records.push({ id: record.fileId, name: originalName, size: file.size });
    }
    await audit(request.user.id, 'file.upload', folder.normalized, { files: records.length, bytes: totalBytes });
    response.status(201).json({ files: records });
  } catch (error) {
    await Promise.all(encryptedPaths.map((encryptedPath) => fs.unlink(encryptedPath).catch(() => undefined)));
    await Promise.all(plainOriginalPaths.map((plainOriginalPath) => fs.unlink(plainOriginalPath).catch(() => undefined)));
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

  const originalFolderPath = await folderPathForFile(file);
  const originalFolder = file.folderPathKey === ROOT_PATH_KEY ? null : await ManagedFolder.findOne({ pathKey: file.folderPathKey }).lean();
  const trashId = crypto.randomUUID();
  const encryptedPath = filePathFor(file.storageId);
  const deletionDirectory = trashDirectoryFor(trashId);
  const trashPath = path.join(deletionDirectory, `${file.storageId}.ifm`);
  await fs.mkdir(deletionDirectory, { mode: 0o700 });
  let plainOriginalTrash;
  try {
    await fs.rename(encryptedPath, trashPath);
    plainOriginalTrash = await movePlainOriginalFileToTrash(file, undefined, path.join(deletionDirectory, plainOriginalName(file)));
    await TrashedFile.create({
      trashId,
      originalFileId: file.fileId,
      storageId: file.storageId,
      ...(originalFolder ? { originalFolderId: originalFolder._id } : {}),
      originalFolderPathEncrypted: seal(originalFolderPath),
      nameEncrypted: file.nameEncrypted,
      ...(file.plainOriginalNameEncrypted ? { plainOriginalNameEncrypted: file.plainOriginalNameEncrypted } : {}),
      mimeEncrypted: file.mimeEncrypted,
      size: file.size,
      uploadedBy: file.uploadedBy,
      trashedBy: request.user.id
    });
    await audit(request.user.id, 'file.trash', open(file.nameEncrypted), { fileId: file.fileId, bytes: file.size });
    const deletion = await ManagedFile.deleteOne({ _id: file._id });
    if (deletion.deletedCount !== 1) throw new Error('File metadata could not be deleted');
  } catch (error) {
    await TrashedFile.deleteOne({ trashId }).catch(() => undefined);
    if (plainOriginalTrash) await fs.rename(plainOriginalTrash.trashPath, plainOriginalTrash.originalPath).catch(() => undefined);
    await fs.rename(trashPath, encryptedPath).catch(() => undefined);
    await fs.rmdir(deletionDirectory).catch(() => undefined);
    throw error;
  }
  response.status(204).end();
}));

app.post('/api/trash/:trashId/restore', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  const [trashId] = selectedTrashIds(request.params.trashId);
  const file = await TrashedFile.findOne({ trashId }).lean();
  if (!file) return response.status(404).json({ error: 'Trash file not found' });
  response.json(await restoreTrashedFile(file, request.user.id));
}));

app.delete('/api/trash/:trashId', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  if (!verifyReauthentication(request.body?.reauthenticationToken, request.user.id)) return response.status(401).json({ error: 'Password confirmation has expired or is invalid' });
  const [trashId] = selectedTrashIds(request.params.trashId);
  const file = await TrashedFile.findOne({ trashId }).lean();
  if (!file) return response.status(404).json({ error: 'Trash file not found' });
  await permanentlyDeleteTrashedFiles([file], request.user.id);
  response.status(204).end();
}));

app.delete('/api/trash', requireAppRequest, requireAuth, asyncRoute(async (request, response) => {
  if (!verifyReauthentication(request.body?.reauthenticationToken, request.user.id)) return response.status(401).json({ error: 'Password confirmation has expired or is invalid' });
  const trashIds = selectedTrashIds(request.body?.trashIds);
  const files = await TrashedFile.find({ trashId: { $in: trashIds } }).lean();
  if (files.length !== trashIds.length) return response.status(404).json({ error: 'One or more selected trash files no longer exist' });
  const byId = new Map(files.map((file) => [file.trashId, file]));
  await permanentlyDeleteTrashedFiles(trashIds.map((id) => byId.get(id)), request.user.id);
  response.status(204).end();
}));

app.get('/api/files/:fileId/download', requireAuth, asyncRoute(async (request, response) => {
  const file = await ManagedFile.findOne({ fileId: request.params.fileId }).lean();
  if (!file) return response.status(404).json({ error: 'File not found' });
  const name = managedFilename(open(file.nameEncrypted));
  forceDownload(response, name, file.size);
  await audit(request.user.id, 'file.download', name, { fileId: file.fileId });
  await decryptFile(filePathFor(file.storageId), response);
}));

// Native form submission lets the browser stream a large ZIP directly to its
// download manager. The session cookie is SameSite=Strict, so this endpoint
// cannot be submitted by a third-party site with the user's session.
app.post('/api/files/archive', requireAuth, asyncRoute(async (request, response) => {
  const requestedIds = selectedFileIds(request.body?.fileIds);
  const records = await ManagedFile.find({ fileId: { $in: requestedIds } }).lean();
  if (records.length !== requestedIds.length) return response.status(404).json({ error: 'One or more selected files no longer exist' });
  const byId = new Map(records.map((file) => [file.fileId, file]));
  const files = requestedIds.map((id) => byId.get(id));
  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  await audit(request.user.id, 'file.download_zip', `${files.length} files`, { fileIds: requestedIds, bytes: totalBytes });
  forceDownload(response, 'ifile-manager-files.zip');
  try {
    await writeStoredZip(response, files.map((file) => ({
      name: managedFilename(open(file.nameEncrypted)),
      size: file.size,
      modifiedAt: file.createdAt,
      writeContents: (destination) => decryptFile(filePathFor(file.storageId), destination)
    })));
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    throw error;
  }
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
  await synchronizePlainOriginals();
  app.listen(config.port, () => console.log(`IFile Manager listening on port ${config.port}`));
}

start().catch((error) => {
  console.error('Startup failed:', error.message);
  process.exit(1);
});
