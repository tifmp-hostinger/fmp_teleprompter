// Cliente da API da plataforma (contas e biblioteca compartilhada).
// Quando o servidor não tem contas ativadas, tudo aqui devolve authEnabled:false
// e o app continua funcionando 100% local, como antes.

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* resposta sem corpo */ }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let stateCache;
/** Contas estão ativadas neste servidor? Quem está logado? */
export async function authState({ fresh = false } = {}) {
  if (!fresh && stateCache) return stateCache;
  try {
    stateCache = await request('api/auth/me');
  } catch {
    // Sem servidor (hospedagem estática ou offline): modo local.
    stateCache = { authEnabled: false, user: null };
  }
  return stateCache;
}

export function clearAuthCache() { stateCache = null; }

export async function login(email, password) {
  const data = await request('api/auth/login', { method: 'POST', body: { email, password } });
  stateCache = { authEnabled: true, user: data.user };
  return data.user;
}

export async function logout() {
  await request('api/auth/logout', { method: 'POST', body: {} });
  stateCache = { authEnabled: true, user: null };
}

export function changePassword(current, next) {
  return request('api/auth/password', { method: 'POST', body: { current, next } });
}

export async function listUsers() {
  return (await request('api/users')).users;
}

export async function createUser(user) {
  return (await request('api/users', { method: 'POST', body: user })).user;
}

export async function updateUser(id, patch) {
  return (await request(`api/users/${id}`, { method: 'PATCH', body: patch })).user;
}

export function deleteUser(id) {
  return request(`api/users/${id}`, { method: 'DELETE', body: {} });
}

/** Envia o que mudou aqui e recebe o que mudou no servidor. */
export function syncScripts({ since, scripts }) {
  return request('api/scripts/sync', { method: 'POST', body: { since, scripts } });
}
