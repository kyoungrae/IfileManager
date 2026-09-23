import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const ROOT_PATH_KEY = 'root';
export const storageRoot = path.join(config.dataRoot, 'storage');
export const fileRoot = path.join(config.dataRoot, 'files');
// This folder is intentionally hidden, but not encrypted. It is an explicit
// user-requested fallback for opening files directly on another computer.
export const plainOriginalRoot = path.join(config.dataRoot, '.ifile-manager-originals');
export const tempRoot = path.join(config.dataRoot, '.ifile-manager-tmp');
export const trashRoot = path.join(config.dataRoot, '.ifile-manager-trash');
// Derived previews remain encrypted too. They are intentionally separate from
// managed files because they can always be regenerated from the original.
export const thumbnailRoot = path.join(config.dataRoot, '.ifile-manager-thumbnails');
export const hostStorageStatsPath = config.hostStorageStatsPath;

const folderName = /^[\p{L}\p{N}][\p{L}\p{N} ._()\-]{0,119}$/u;

export async function initializeStorage() {
  await Promise.all([storageRoot, fileRoot, plainOriginalRoot, tempRoot, trashRoot, thumbnailRoot].map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
}

function isByteCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validHostStorageStats(stats) {
  const updatedAt = Date.parse(stats?.updatedAt);
  return isByteCount(stats?.totalBytes)
    && isByteCount(stats?.usedBytes)
    && isByteCount(stats?.freeBytes)
    && stats.usedBytes + stats.freeBytes === stats.totalBytes
    && Number.isFinite(updatedAt)
    && updatedAt <= Date.now() + 60_000;
}

// Docker Desktop reports its virtual disk for statfs() on macOS bind mounts. A tiny host
// LaunchAgent writes the real removable-volume values at startup and after watched changes.
export async function storageUsage() {
  try {
    const hostStats = JSON.parse(await fs.readFile(hostStorageStatsPath, 'utf8'));
    if (validHostStorageStats(hostStats)) return { ...hostStats, source: 'host-volume' };
  } catch { /* The host agent may not be installed yet. */ }

  // Never expose Docker Desktop's virtual filesystem capacity as removable-drive capacity.
  return { totalBytes: 0, freeBytes: 0, usedBytes: 0, source: 'unavailable' };
}

export function validateFolderName(name) {
  if (typeof name !== 'string' || !folderName.test(name) || name === '.' || name === '..') {
    throw new Error('Folder names must be 1–120 letters, numbers, spaces, dots, _, (), or -');
  }
  return name;
}

export function normalizeRelativePath(input) {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string' || input.includes('\u0000') || path.isAbsolute(input)) throw new Error('Invalid folder path');
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'));
  if (normalized === '.' || normalized === '') return '';
  if (normalized.startsWith('../') || normalized === '..') throw new Error('Folder path escapes the managed disk');
  for (const segment of normalized.split('/')) validateFolderName(segment);
  return normalized;
}

export function pathWithin(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Path escapes managed storage');
  return target;
}

// Refuse symlinks in every component so app users cannot make the container touch host paths outside /data.
export async function existingDirectory(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  let current = storageRoot;
  const rootStat = await fs.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Managed storage root is invalid');
  for (const segment of normalized ? normalized.split('/') : []) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Folder does not exist or is unsafe');
  }
  return { normalized, absolutePath: current };
}

export async function originalDirectory(relativePath, { create = false } = {}) {
  const normalized = normalizeRelativePath(relativePath);
  let current = plainOriginalRoot;
  const rootStat = await fs.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Plain original storage root is invalid');
  for (const segment of normalized ? normalized.split('/') : []) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Plain original folder is unsafe');
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await fs.mkdir(current, { mode: 0o700 });
    }
  }
  return { normalized, absolutePath: current };
}

export function relativeChild(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

export async function collectDirectoryPaths(relativePath) {
  const { normalized, absolutePath } = await existingDirectory(relativePath);
  const result = [normalized];
  async function walk(currentRelative, currentAbsolute) {
    for (const entry of await fs.readdir(currentAbsolute, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Refusing to delete a tree containing a symbolic link');
      if (entry.isDirectory()) {
        const child = relativeChild(currentRelative, entry.name);
        result.push(child);
        await walk(child, path.join(currentAbsolute, entry.name));
      }
    }
  }
  await walk(normalized, absolutePath);
  return result;
}
