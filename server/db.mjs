// Armazenamento do FMP Barzi Prompter.
//
// Um arquivo JSON com escrita atômica (grava num temporário e renomeia), que
// é o suficiente para a escala desta plataforma: uma equipe pequena, quase
// nunca escrevendo ao mesmo tempo. Todas as escritas passam por uma fila, então
// não existe corrida entre requisições dentro do processo.
//
// Toda a leitura e escrita do banco passa por aqui. Trocar para SQLite ou
// Postgres no futuro significa reescrever só este arquivo.
import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = { version: 1, users: [], sessions: [], scripts: [] };

/** Quanto tempo um roteiro apagado continua registrado, para a exclusão sincronizar. */
const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

export class Store {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY);
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...structuredClone(EMPTY), ...parsed };
      for (const key of ['users', 'sessions', 'scripts']) {
        if (!Array.isArray(this.data[key])) this.data[key] = [];
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Arquivo corrompido: guarda uma cópia antes de começar do zero.
        console.error('[db] não foi possível ler o banco:', err.message);
        await copyFile(this.file, `${this.file}.corrompido-${Date.now()}`).catch(() => {});
      }
      this.data = structuredClone(EMPTY);
      await this.flush();
    }
    return this.data;
  }

  async flush() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await rename(tmp, this.file); // atômico no mesmo sistema de arquivos
  }

  /**
   * Executa uma alteração em série e grava o resultado.
   * @param {(data: object) => any} fn recebe os dados e devolve o retorno da operação
   */
  update(fn) {
    const run = this.queue.then(async () => {
      const result = await fn(this.data);
      await this.flush();
      return result;
    });
    // A fila segue viva mesmo se uma operação falhar.
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  /** Leitura direta, sem passar pela fila (o processo é único). */
  read() { return this.data; }

  /** Limpa sessões vencidas e exclusões antigas. */
  async housekeeping() {
    const now = Date.now();
    await this.update((db) => {
      const sessionsBefore = db.sessions.length;
      db.sessions = db.sessions.filter((s) => s.expiresAt > now);
      const scriptsBefore = db.scripts.length;
      db.scripts = db.scripts.filter((s) => !s.deletedAt || now - s.deletedAt < TOMBSTONE_MS);
      const removed = (sessionsBefore - db.sessions.length) + (scriptsBefore - db.scripts.length);
      if (removed) console.log(`[db] limpeza: ${removed} registro(s) antigo(s) removido(s)`);
    });
  }
}

export function newId() { return randomUUID(); }

// ---- Usuários ---------------------------------------------------------------

/** Versão do usuário que pode ir para o navegador (sem hash de senha). */
export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt };
}

export function findUserByEmail(db, email) {
  const needle = String(email || '').trim().toLowerCase();
  return db.users.find((u) => u.email === needle) || null;
}

export function findUserById(db, id) {
  return db.users.find((u) => u.id === id) || null;
}

// ---- Roteiros ---------------------------------------------------------------

/**
 * Aplica um roteiro vindo do cliente sobre o que está no banco.
 * Regra de conflito: vence a edição mais recente (updatedAt).
 * @returns {'created'|'updated'|'ignored'}
 */
export function mergeScript(db, incoming, userId) {
  const now = Date.now();
  const id = String(incoming.id || '').slice(0, 64) || newId();
  const updatedAt = Number(incoming.updatedAt) || now;
  const existing = db.scripts.find((s) => s.id === id);

  const clean = {
    id,
    title: String(incoming.title || '').slice(0, 300),
    body: String(incoming.body || '').slice(0, 500_000),
    wpm: incoming.wpm == null ? null : Number(incoming.wpm) || null,
    fontSize: incoming.fontSize == null ? null : Number(incoming.fontSize) || null,
    deletedAt: incoming.deletedAt ? Number(incoming.deletedAt) : null,
    updatedAt,
    updatedBy: userId,
  };

  if (!existing) {
    db.scripts.push({
      ...clean,
      createdAt: Number(incoming.createdAt) || now,
      createdBy: incoming.createdBy || userId,
    });
    return 'created';
  }
  if (existing.updatedAt >= updatedAt) return 'ignored';
  Object.assign(existing, clean);
  return 'updated';
}

/** Roteiros alterados depois de `since` (inclui exclusões, para propagá-las). */
export function scriptsSince(db, since) {
  const from = Number(since) || 0;
  return db.scripts.filter((s) => s.updatedAt > from);
}
