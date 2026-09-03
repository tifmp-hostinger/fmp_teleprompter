// Rotas da API: contas, login e a biblioteca de roteiros compartilhada.
import {
  newId, publicUser, findUserByEmail, findUserById, mergeScript, scriptsSince,
} from './db.mjs';
import {
  COOKIE, hashPassword, verifyPassword, createSession, destroySession, destroyUserSessions,
  userFromToken, parseCookies, sessionCookie, validateEmail, validatePassword,
} from './auth.mjs';

const MAX_BODY = 2 * 1024 * 1024; // roteiros longos cabem com folga
const LOGIN_ATTEMPTS = 8;         // por IP, por janela
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

const loginHits = new Map();

export function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Conteúdo grande demais.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'anon';
}

function isSecure(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/**
 * Bloqueia POST/PATCH/DELETE que não venham de código nosso.
 * O SameSite=Lax do cookie já barra a maior parte; exigir JSON fecha o resto,
 * porque um formulário de outro site não consegue mandar este content-type.
 */
function checkContentType(req) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) throw Object.assign(new Error('Requisição inválida.'), { status: 415 });
}

function tooManyLogins(ip) {
  const now = Date.now();
  const list = (loginHits.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginHits.set(ip, list);
  if (loginHits.size > 2000) loginHits.clear();
  return list.length >= LOGIN_ATTEMPTS;
}

function noteLoginFailure(ip) {
  const list = loginHits.get(ip) || [];
  list.push(Date.now());
  loginHits.set(ip, list);
}

/**
 * Cria o roteador da API.
 * @param {{store: import('./db.mjs').Store, authEnabled: boolean}} deps
 */
export function createApi({ store, authEnabled }) {
  const currentUser = (req) => {
    if (!authEnabled) return null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    return userFromToken(store.read(), token);
  };

  const requireUser = (req) => {
    const user = currentUser(req);
    if (!user) throw Object.assign(new Error('Faça login para continuar.'), { status: 401 });
    return user;
  };

  const requireAdmin = (req) => {
    const user = requireUser(req);
    if (user.role !== 'admin') throw Object.assign(new Error('Só o administrador pode fazer isso.'), { status: 403 });
    return user;
  };

  /** @returns {boolean} true se a rota foi tratada aqui. */
  return async function handleApi(req, res, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/auth') && !path.startsWith('/api/users') && !path.startsWith('/api/scripts')) {
      return false;
    }

    // Estado da plataforma: o app usa isto para saber se mostra a tela de login.
    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = currentUser(req);
      json(res, 200, { authEnabled, user: publicUser(user) });
      return true;
    }

    if (!authEnabled) {
      json(res, 404, { error: 'Contas não estão ativadas neste servidor.' });
      return true;
    }

    if (req.method !== 'GET') checkContentType(req);

    // ---- Login e sessão ----------------------------------------------------
    if (path === '/api/auth/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (tooManyLogins(ip)) {
        json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos.' });
        return true;
      }
      const body = await readJson(req);
      const email = String(body.email || '').trim().toLowerCase();
      const user = findUserByEmail(store.read(), email);
      const ok = user && await verifyPassword(String(body.password || ''), user.passwordHash);
      if (!ok) {
        noteLoginFailure(ip);
        json(res, 401, { error: 'Email ou senha incorretos.' });
        return true;
      }
      const token = await store.update((db) => createSession(db, user.id));
      json(res, 200, { user: publicUser(user) }, { 'set-cookie': sessionCookie(token, { secure: isSecure(req) }) });
      return true;
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      await store.update((db) => destroySession(db, token));
      json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', { secure: isSecure(req) }) });
      return true;
    }

    if (path === '/api/auth/password' && req.method === 'POST') {
      const user = requireUser(req);
      const body = await readJson(req);
      if (!await verifyPassword(String(body.current || ''), user.passwordHash)) {
        json(res, 400, { error: 'Senha atual incorreta.' });
        return true;
      }
      const next = validatePassword(body.next);
      const hash = await hashPassword(next);
      await store.update((db) => {
        const u = findUserById(db, user.id);
        u.passwordHash = hash;
      });
      json(res, 200, { ok: true });
      return true;
    }

    // ---- Contas (só administrador) -----------------------------------------
    if (path === '/api/users' && req.method === 'GET') {
      requireAdmin(req);
      json(res, 200, { users: store.read().users.map(publicUser) });
      return true;
    }

    if (path === '/api/users' && req.method === 'POST') {
      requireAdmin(req);
      const body = await readJson(req);
      const email = validateEmail(body.email);
      const password = validatePassword(body.password);
      if (findUserByEmail(store.read(), email)) {
        json(res, 409, { error: 'Já existe uma conta com este email.' });
        return true;
      }
      const hash = await hashPassword(password);
      const user = await store.update((db) => {
        const u = {
          id: newId(),
          email,
          name: String(body.name || '').trim().slice(0, 120) || email.split('@')[0],
          role: body.role === 'admin' ? 'admin' : 'user',
          passwordHash: hash,
          createdAt: Date.now(),
        };
        db.users.push(u);
        return publicUser(u);
      });
      json(res, 201, { user });
      return true;
    }

    const userMatch = path.match(/^\/api\/users\/([\w-]+)$/);
    if (userMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const admin = requireAdmin(req);
      const id = userMatch[1];
      const target = findUserById(store.read(), id);
      if (!target) { json(res, 404, { error: 'Conta não encontrada.' }); return true; }

      if (req.method === 'DELETE') {
        if (target.id === admin.id) { json(res, 400, { error: 'Você não pode excluir a própria conta.' }); return true; }
        await store.update((db) => {
          db.users = db.users.filter((u) => u.id !== id);
          destroyUserSessions(db, id);
        });
        json(res, 200, { ok: true });
        return true;
      }

      const body = await readJson(req);
      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 120);
      if (body.role !== undefined) patch.role = body.role === 'admin' ? 'admin' : 'user';
      if (body.password) patch.passwordHash = await hashPassword(validatePassword(body.password));
      // Não deixa a plataforma ficar sem nenhum administrador.
      if (patch.role === 'user' && target.role === 'admin') {
        const admins = store.read().users.filter((u) => u.role === 'admin');
        if (admins.length <= 1) { json(res, 400, { error: 'É preciso ter pelo menos um administrador.' }); return true; }
      }
      const updated = await store.update((db) => {
        const u = findUserById(db, id);
        Object.assign(u, patch);
        if (patch.passwordHash) destroyUserSessions(db, id);
        return publicUser(u);
      });
      json(res, 200, { user: updated });
      return true;
    }

    // ---- Biblioteca de roteiros (compartilhada por toda a equipe) ----------
    if (path === '/api/scripts' && req.method === 'GET') {
      requireUser(req);
      const since = Number(url.searchParams.get('since')) || 0;
      json(res, 200, { now: Date.now(), scripts: scriptsSince(store.read(), since) });
      return true;
    }

    if (path === '/api/scripts/sync' && req.method === 'POST') {
      const user = requireUser(req);
      const body = await readJson(req);
      const incoming = Array.isArray(body.scripts) ? body.scripts.slice(0, 2000) : [];
      const since = Number(body.since) || 0;
      const result = await store.update((db) => {
        const counts = { created: 0, updated: 0, ignored: 0 };
        for (const s of incoming) {
          if (!s || typeof s !== 'object') continue;
          counts[mergeScript(db, s, user.id)]++;
        }
        return counts;
      });
      // Devolve tudo que mudou no servidor desde a última sincronização,
      // já incluindo o que acabou de ser enviado (com os campos do servidor).
      json(res, 200, {
        now: Date.now(),
        applied: result,
        scripts: scriptsSince(store.read(), since),
        users: store.read().users.map((u) => ({ id: u.id, name: u.name })),
      });
      return true;
    }

    json(res, 404, { error: 'Rota não encontrada.' });
    return true;
  };
}
