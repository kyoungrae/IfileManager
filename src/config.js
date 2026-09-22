import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function parseKey(name) {
  const value = Buffer.from(required(name), 'base64');
  if (value.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key`);
  return value;
}

const maxUploadMb = Number.parseInt(process.env.MAX_UPLOAD_MB ?? '500', 10);
if (!Number.isSafeInteger(maxUploadMb) || maxUploadMb < 1 || maxUploadMb > 2048) {
  throw new Error('MAX_UPLOAD_MB must be between 1 and 2048');
}

export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  mongoUri: required('MONGODB_URI'),
  dataKey: parseKey('DATA_ENCRYPTION_KEY'),
  jwtSecret: required('JWT_SECRET'),
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  dataRoot: path.resolve(process.env.DATA_ROOT ?? './data'),
  hostStorageStatsPath: process.env.HOST_STORAGE_STATS_PATH ?? '/run/ifile-manager/storage-stats.json',
  maxUploadBytes: maxUploadMb * 1024 * 1024,
  bootstrapUsername: process.env.BOOTSTRAP_ADMIN_USERNAME,
  bootstrapPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD
});

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters');
}
