// Autenticação: senhas com scrypt, sessões em cookie httpOnly.
// Sem dependências externas — tudo vem do node:crypto.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { newId, findUserByEmail, findUserById, publicUser } from './db.mjs';

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;
export const COOKIE = 'fmp_session';

/** Gera "salt:hash" para guardar no banco. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, saltB64, keyB64] = String(stored || '').split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(password, salt, expected.length, SCRYPT_PARAMS);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** O banco guarda só o hash do token: um vazamento do arquivo não dá acesso. */
function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const session = {
    id: newId(),
    tokenHash: tokenHash(token),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
  db.sessions.push(session);
  return token;
}

export function destroySession(db, token) {
  if (!token) return;
  const h = tokenHash(token);
  db.sessions = db.sessions.filter((s) => s.tokenHash !== h);
}

export function destroyUserSessions(db, userId) {
  db.sessions = db.sessions.filter((s) => s.userId !== userId);
}

/** Usuário dono do token, ou null se não existir/estiver vencido. */
export function userFromToken(db, token) {
  if (!token) return null;
  const h = tokenHash(token);
  const session = db.sessions.find((s) => s.tokenHash === h);
  if (!session || session.expiresAt < Date.now()) return null;
  return findUserById(db, session.userId);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeDays = SESSION_DAYS } = {}) {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? maxAgeDays * 24 * 60 * 60 : 0}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Cria (ou atualiza a senha do) administrador definido no ambiente. */
export async function ensureAdmin(store, { email, password, name }) {
  if (!email || !password) return null;
  const normalized = String(email).trim().toLowerCase();
  const hash = await hashPassword(password);
  return store.update(async (db) => {
    const existing = findUserByEmail(db, normalized);
    if (existing) {
      existing.passwordHash = hash;
      existing.role = 'admin';
      if (name) existing.name = name;
      console.log(`[auth] administrador atualizado: ${normalized}`);
      return publicUser(existing);
    }
    const user = {
      id: newId(),
      email: normalized,
      name: name || normalized.split('@')[0],
      role: 'admin',
      passwordHash: hash,
      createdAt: Date.now(),
    };
    db.users.push(user);
    console.log(`[auth] administrador criado: ${normalized}`);
    return publicUser(user);
  });
}

/** Erro de entrada do usuário: vira 400 na resposta, não 500. */
function invalido(mensagem) {
  return Object.assign(new Error(mensagem), { status: 400 });
}

/** Regras mínimas de senha, aplicadas na criação e na troca. */
export function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 8) throw invalido('A senha precisa de pelo menos 8 caracteres.');
  if (p.length > 200) throw invalido('Senha longa demais.');
  return p;
}

export function validateEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw invalido('Email inválido.');
  return e;
}
