import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { open, seal, indexFor } from './crypto.js';
import { User } from './models.js';

const SESSION_COOKIE = 'ifm_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const usernamePattern = /^[a-zA-Z0-9._-]{3,64}$/;

export function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!usernamePattern.test(username)) throw new Error('Username must be 3–64 characters: letters, numbers, dot, underscore, or hyphen');
  return username;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) {
    throw new Error('Password must be between 16 and 256 characters');
  }
  return value;
}

function sessionPayload(user) {
  return { sub: user.id, role: user.role, purpose: 'session' };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MS
  };
}

export function setSession(response, user) {
  response.cookie(SESSION_COOKIE, jwt.sign(sessionPayload(user), config.jwtSecret, { expiresIn: '8h', algorithm: 'HS256' }), cookieOptions());
}

export function clearSession(response) {
  response.clearCookie(SESSION_COOKIE, cookieOptions());
}

export async function requireAuth(request, response, next) {
  try {
    const token = request.cookies[SESSION_COOKIE];
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.purpose !== 'session' || typeof payload.sub !== 'string') throw new Error('Invalid session');
    const user = await User.findById(payload.sub);
    if (!user || user.disabled) throw new Error('Session user is unavailable');
    request.user = { id: user.id, role: user.role, username: open(user.usernameEncrypted) };
    next();
  } catch {
    clearSession(response);
    response.status(401).json({ error: 'Login is required' });
  }
}

export function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') return response.status(403).json({ error: 'Administrator permission is required' });
  next();
}

// The browser must send this header; cookie-authenticated mutations cannot be submitted by a cross-site HTML form.
export function requireAppRequest(request, response, next) {
  if (request.get('X-IFile-Manager') !== '1') return response.status(403).json({ error: 'Invalid application request' });
  next();
}

export function issueReauthentication(userId) {
  return jwt.sign({ sub: userId, purpose: 'folder-delete' }, config.jwtSecret, { expiresIn: '5m', algorithm: 'HS256' });
}

export function verifyReauthentication(token, userId) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return payload.purpose === 'folder-delete' && payload.sub === userId;
  } catch {
    return false;
  }
}

export async function authenticate(usernameInput, password) {
  const username = normalizeUsername(usernameInput);
  const user = await User.findOne({ usernameKey: indexFor('username', username) });
  if (!user || user.disabled || !(await bcrypt.compare(String(password ?? ''), user.passwordHash))) return null;
  return user;
}

// Re-authentication must verify the already-authenticated account directly.
// This avoids a secondary encrypted-username lookup when confirming a delete.
export async function authenticateUserId(userId, password) {
  const user = await User.findById(userId);
  if (!user || user.disabled || !(await bcrypt.compare(String(password ?? ''), user.passwordHash))) return null;
  return user;
}

export async function createUser({ username: usernameInput, password, role = 'user' }) {
  const username = normalizeUsername(usernameInput);
  validatePassword(password);
  if (!['admin', 'user'].includes(role)) throw new Error('Invalid role');
  return User.create({
    usernameKey: indexFor('username', username),
    usernameEncrypted: seal(username),
    passwordHash: await bcrypt.hash(password, 12),
    role
  });
}

export async function bootstrapAdmin() {
  if (await User.exists({})) return;
  if (!config.bootstrapUsername || !config.bootstrapPassword) {
    throw new Error('No users exist. Set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD for the first startup.');
  }
  await createUser({ username: config.bootstrapUsername, password: config.bootstrapPassword, role: 'admin' });
}
