// Servidor do FMP Barzi Prompter.
//
// Roda ao lado do nginx dentro do contêiner e responde apenas em /api:
//   /api/auth/*     login e sessão
//   /api/users/*    contas (administrador)
//   /api/scripts/*  biblioteca de roteiros compartilhada
//   /api/ai/*       gerador de roteiro com IA
//
// Tudo é opcional: sem ADMIN_EMAIL/ADMIN_PASSWORD as contas ficam desligadas e
// o app funciona 100% local, como antes. Sem chave de IA, o gerador pede a
// chave no navegador de quem usa.
//
// Variáveis de ambiente:
//   ADMIN_EMAIL / ADMIN_PASSWORD  cria (ou atualiza) o administrador na subida
//   ADMIN_NAME                    nome exibido do administrador
//   DATA_FILE                     caminho do arquivo de dados (padrão /data/barzi.json)
//   API_PORT                      porta interna (padrão 8787)
import { createServer } from 'node:http';
import { Store } from './db.mjs';
import { ensureAdmin, parseCookies, userFromToken, COOKIE } from './auth.mjs';
import { createApi, json } from './api.mjs';
import { createAiRoutes, aiEnabled, aiProvider } from './ai.mjs';

const PORT = Number(process.env.API_PORT || process.env.AI_PROXY_PORT || 8787);
const DATA_FILE = process.env.DATA_FILE || '/data/barzi.json';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const authEnabled = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

const store = new Store(DATA_FILE);
await store.load();

if (authEnabled) {
  await ensureAdmin(store, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: process.env.ADMIN_NAME });
  await store.housekeeping();
  setInterval(() => store.housekeeping().catch(() => {}), 6 * 60 * 60 * 1000).unref();
} else {
  console.log('[app] contas desligadas (defina ADMIN_EMAIL e ADMIN_PASSWORD para ativar)');
}

if (!authEnabled && !aiEnabled) {
  console.log('[app] nada a servir em /api; encerrando');
  process.exit(0);
}

const handleApi = createApi({ store, authEnabled });
const handleAi = createAiRoutes({
  requireUser: authEnabled
    ? (req) => {
      const user = userFromToken(store.read(), parseCookies(req.headers.cookie)[COOKIE]);
      if (!user) throw Object.assign(new Error('Faça login para continuar.'), { status: 401 });
      return user;
    }
    : null,
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (await handleAi(req, res, url)) return;
    if (await handleApi(req, res, url)) return;
    json(res, 404, { error: 'Rota não encontrada.' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[app] erro:', err);
    if (!res.headersSent) json(res, status, { error: err.message || 'Erro interno.' });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const partes = [];
  if (authEnabled) partes.push(`contas em ${DATA_FILE}`);
  if (aiEnabled) partes.push(`IA via ${aiProvider}`);
  console.log(`[app] escutando em 127.0.0.1:${PORT} — ${partes.join(', ')}`);
});
