// Sincronização da biblioteca de roteiros entre os aparelhos da equipe.
//
// O app continua guardando tudo no navegador (funciona offline, como antes).
// Quando há servidor e login, este módulo envia o que foi alterado aqui e traz
// o que foi alterado por outras pessoas.
//
// Regra de conflito: vence a edição mais recente (updatedAt). Empate resolve
// pelo servidor, que já mesclou o envio antes de responder.
//
// A marca `pendingSync` decide o que enviar, em vez do relógio local: se o
// aparelho estiver com a hora errada, nada deixa de ser enviado por isso.
import { syncScripts } from './api.js';
import {
  loadScriptsRaw, saveScripts, getLastSync, setLastSync, setKnownUsers,
} from './storage.js';

let running = null;

/**
 * Faz uma rodada de sincronização.
 * @param {{onStatus?: (s: 'syncing'|'synced'|'error'|'offline') => void}} opts
 * @returns {Promise<{pushed:number, pulled:number}|null>} null se não houve o que fazer
 */
export function syncNow(opts = {}) {
  // Uma rodada por vez; chamadas simultâneas esperam a que está em andamento.
  if (running) return running;
  running = doSync(opts).finally(() => { running = null; });
  return running;
}

async function doSync({ onStatus } = {}) {
  if (!navigator.onLine) { onStatus?.('offline'); return null; }
  onStatus?.('syncing');
  try {
    const since = getLastSync();
    const local = loadScriptsRaw();
    const pending = local.filter((s) => s.pendingSync);

    const res = await syncScripts({ since, scripts: pending.map(toWire) });
    const pulled = applyServerScripts(res.scripts || [], pending);
    setLastSync(res.now);
    setKnownUsers(res.users || []);
    onStatus?.('synced');
    return { pushed: pending.length, pulled };
  } catch (err) {
    onStatus?.(err.status === 401 ? 'error' : 'offline');
    throw err;
  }
}

/** Só os campos que o servidor guarda. */
function toWire(s) {
  return {
    id: s.id,
    title: s.title,
    body: s.body,
    wpm: s.wpm ?? null,
    fontSize: s.fontSize ?? null,
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt ?? null,
  };
}

/**
 * Mescla no armazenamento local o que veio do servidor.
 * @returns {number} quantos roteiros foram alterados aqui
 */
function applyServerScripts(remote, pushed) {
  const local = loadScriptsRaw();
  const byId = new Map(local.map((s) => [s.id, s]));
  const pushedIds = new Set(pushed.map((s) => s.id));
  let changed = 0;

  for (const r of remote) {
    const mine = byId.get(r.id);
    if (mine && (mine.updatedAt || 0) > (r.updatedAt || 0)) continue; // o local é mais novo
    byId.set(r.id, {
      ...mine,
      ...r,
      // O que acabou de ser enviado já está no servidor; o resto também não
      // precisa ser reenviado, porque veio de lá.
      pendingSync: false,
    });
    changed++;
  }

  // O que foi enviado e o servidor aceitou (ou ignorou por ser mais antigo)
  // deixa de estar pendente.
  for (const id of pushedIds) {
    const s = byId.get(id);
    if (s && s.pendingSync) byId.set(id, { ...s, pendingSync: false });
  }

  saveScripts([...byId.values()]);
  return changed;
}
