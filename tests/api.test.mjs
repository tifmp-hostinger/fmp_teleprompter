// Teste de integração da API: sobe o servidor de verdade, num arquivo de dados
// temporário, e exercita login, contas e a sincronização dos roteiros.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'admin@fmp.com.br', password: 'senha-do-admin' };

let dir;
let child;
let dataFile;

function start() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server/index.mjs'], {
      env: {
        ...process.env,
        API_PORT: String(PORT),
        DATA_FILE: dataFile,
        ADMIN_EMAIL: ADMIN.email,
        ADMIN_PASSWORD: ADMIN.password,
        ADMIN_NAME: 'Admin FMP',
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (b) => { out += b; if (out.includes('escutando')) resolve(proc); });
    proc.stderr.on('data', (b) => { out += b; });
    proc.on('exit', (code) => reject(new Error(`servidor saiu (${code}): ${out}`)));
    setTimeout(() => reject(new Error(`servidor não subiu: ${out}`)), 8000);
  });
}

async function stop(proc) {
  if (!proc) return;
  const done = new Promise((r) => proc.on('exit', r));
  proc.kill('SIGTERM');
  await done;
}

/** fetch que guarda o cookie de sessão, como faria um navegador. */
function makeClient() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* resposta em texto */ }
    return { status: res.status, json, text };
  };
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'barzi-test-'));
  dataFile = join(dir, 'dados.json');
  child = await start();
});

after(async () => {
  await stop(child);
  await rm(dir, { recursive: true, force: true });
});

test('o estado da plataforma diz que as contas estão ativadas', async () => {
  const api = makeClient();
  const r = await api('/api/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.json.authEnabled, true);
  assert.equal(r.json.user, null);
});

test('login recusa senha errada e aceita a correta', async () => {
  const api = makeClient();
  const bad = await api('/api/auth/login', { method: 'POST', body: { email: ADMIN.email, password: 'errada' } });
  assert.equal(bad.status, 401);

  const ok = await api('/api/auth/login', { method: 'POST', body: ADMIN });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, 'admin');
  assert.equal(ok.json.user.name, 'Admin FMP');
  assert.equal(ok.json.user.passwordHash, undefined, 'o hash da senha não pode ir para o navegador');

  const me = await api('/api/auth/me');
  assert.equal(me.json.user.email, ADMIN.email);
});

test('rota protegida exige login', async () => {
  const anon = makeClient();
  const r = await anon('/api/scripts');
  assert.equal(r.status, 401);
});

test('o administrador cria contas e o novo usuário consegue entrar', async () => {
  const admin = makeClient();
  await admin('/api/auth/login', { method: 'POST', body: ADMIN });

  const criada = await admin('/api/users', {
    method: 'POST',
    body: { email: 'Locutor@FMP.com.br', name: 'Locutor', password: 'senha-do-locutor' },
  });
  assert.equal(criada.status, 201);
  assert.equal(criada.json.user.email, 'locutor@fmp.com.br', 'email é normalizado em minúsculas');
  assert.equal(criada.json.user.role, 'user');

  const repetida = await admin('/api/users', {
    method: 'POST',
    body: { email: 'locutor@fmp.com.br', name: 'Outro', password: 'outra-senha-boa' },
  });
  assert.equal(repetida.status, 409);

  const curta = await admin('/api/users', {
    method: 'POST', body: { email: 'x@fmp.com.br', name: 'X', password: '123' },
  });
  assert.equal(curta.status, 400);

  const locutor = makeClient();
  const login = await locutor('/api/auth/login', { method: 'POST', body: { email: 'locutor@fmp.com.br', password: 'senha-do-locutor' } });
  assert.equal(login.status, 200);

  const lista = await locutor('/api/users');
  assert.equal(lista.status, 403, 'usuário comum não administra contas');
});

test('a biblioteca de roteiros é compartilhada entre as pessoas', async () => {
  const admin = makeClient();
  await admin('/api/auth/login', { method: 'POST', body: ADMIN });
  const locutor = makeClient();
  await locutor('/api/auth/login', { method: 'POST', body: { email: 'locutor@fmp.com.br', password: 'senha-do-locutor' } });

  const enviado = await admin('/api/scripts/sync', {
    method: 'POST',
    body: {
      since: 0,
      scripts: [{ id: 'r1', title: 'Abertura', body: 'Olá a todos', updatedAt: 1000, createdAt: 1000 }],
    },
  });
  assert.equal(enviado.status, 200);
  assert.equal(enviado.json.applied.created, 1);

  // A outra pessoa enxerga o mesmo roteiro.
  const visto = await locutor('/api/scripts');
  assert.equal(visto.json.scripts.length, 1);
  assert.equal(visto.json.scripts[0].title, 'Abertura');

  // Edição mais nova vence.
  await locutor('/api/scripts/sync', {
    method: 'POST',
    body: { since: 0, scripts: [{ id: 'r1', title: 'Abertura v2', body: 'Olá pessoal', updatedAt: 2000 }] },
  });
  const depois = await admin('/api/scripts');
  assert.equal(depois.json.scripts[0].title, 'Abertura v2');
  assert.equal(depois.json.scripts[0].updatedBy.length > 0, true);

  // Edição mais antiga é ignorada.
  const antiga = await admin('/api/scripts/sync', {
    method: 'POST',
    body: { since: 0, scripts: [{ id: 'r1', title: 'versão velha', body: 'x', updatedAt: 1500 }] },
  });
  assert.equal(antiga.json.applied.ignored, 1);
  const conferindo = await admin('/api/scripts');
  assert.equal(conferindo.json.scripts[0].title, 'Abertura v2');
});

test('sincronização incremental traz só o que mudou', async () => {
  const api = makeClient();
  await api('/api/auth/login', { method: 'POST', body: ADMIN });
  const marco = Date.now();
  await api('/api/scripts/sync', {
    method: 'POST',
    body: { since: 0, scripts: [{ id: 'r2', title: 'Novo', body: 'texto', updatedAt: marco + 5000 }] },
  });
  const parcial = await api(`/api/scripts?since=${marco}`);
  assert.deepEqual(parcial.json.scripts.map((s) => s.id), ['r2']);
});

test('exclusão sincroniza para os outros aparelhos', async () => {
  const api = makeClient();
  await api('/api/auth/login', { method: 'POST', body: ADMIN });
  const agora = Date.now() + 10_000;
  await api('/api/scripts/sync', {
    method: 'POST',
    body: { since: 0, scripts: [{ id: 'r2', title: 'Novo', body: 'texto', updatedAt: agora, deletedAt: agora }] },
  });
  const todos = await api('/api/scripts');
  const r2 = todos.json.scripts.find((s) => s.id === 'r2');
  assert.ok(r2.deletedAt, 'o roteiro fica marcado como apagado para propagar a exclusão');
});

test('logout encerra a sessão', async () => {
  const api = makeClient();
  await api('/api/auth/login', { method: 'POST', body: ADMIN });
  await api('/api/auth/logout', { method: 'POST', body: {} });
  const me = await api('/api/auth/me');
  assert.equal(me.json.user, null);
});

test('requisição sem content-type JSON é recusada (proteção contra CSRF)', async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=a@b.c&password=x',
  });
  assert.equal(res.status, 415);
});

test('os dados sobrevivem ao reinício do servidor', async () => {
  await stop(child);
  const salvo = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.ok(salvo.users.length >= 2);
  assert.ok(salvo.users.every((u) => u.passwordHash.startsWith('scrypt$')), 'senhas ficam com hash no arquivo');
  assert.ok(!JSON.stringify(salvo).includes(ADMIN.password), 'a senha em texto puro nunca é gravada');

  child = await start();
  const api = makeClient();
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 'locutor@fmp.com.br', password: 'senha-do-locutor' } });
  assert.equal(login.status, 200);
  const scripts = await api('/api/scripts');
  assert.ok(scripts.json.scripts.some((s) => s.id === 'r1'));
});
