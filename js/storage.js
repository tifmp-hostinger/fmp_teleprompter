// Persistência local (localStorage): roteiros, configurações e histórico de sessões.
const KEYS = {
  scripts: 'fmp.tp.scripts',
  settings: 'fmp.tp.settings',
  sessions: 'fmp.tp.sessions',
  aiKey: 'fmp.tp.aiKey',
  lastSync: 'fmp.tp.lastSync',
  users: 'fmp.tp.users',
};

/** Um roteiro apagado fica registrado por um tempo, para a exclusão sincronizar. */
const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'fixed',            // fixed | timed | voice | manual
  wpm: 150,
  targetMinutes: 3,
  fontSize: 56,
  lineHeight: 1.45,
  fontFamily: 'system',     // system | serif | mono | rounded | condensed
  textWidth: 88,            // % da largura da tela
  align: 'left',            // left | center
  textColor: '#ffffff',
  bgColor: '#000000',
  readingLine: 35,          // % a partir do topo
  showReadingLine: true,
  dim: 55,                  // % de escurecimento fora da linha
  mirrorH: false,
  mirrorV: false,
  countdown: 3,
  showTimer: true,
  showProgress: true,
  uppercase: false,
  boldAll: false,
  cameraEnabled: false,
  cameraOpacity: 85,        // opacidade do texto sobre a câmera (%)
  cameraMirror: true,
  voiceLang: 'pt-BR',
  voiceFallback: true,
  theme: 'dark',
});

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
}

// ---- Roteiros ---------------------------------------------------------------

/** Todos os roteiros, inclusive os apagados (usado pela sincronização). */
export function loadScriptsRaw() {
  const list = read(KEYS.scripts, []);
  if (!Array.isArray(list)) return [];
  const limite = Date.now() - TOMBSTONE_MS;
  return list.filter((s) => s && (!s.deletedAt || s.deletedAt > limite));
}

/** Os roteiros que a pessoa vê na biblioteca. */
export function loadScripts() {
  return loadScriptsRaw()
    .filter((s) => !s.deletedAt)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function saveScripts(list) {
  return write(KEYS.scripts, list);
}

export function createScript({ title = '', body = '' } = {}) {
  const now = Date.now();
  const script = {
    id: uid(), title, body, createdAt: now, updatedAt: now,
    wpm: null, fontSize: null, deletedAt: null, pendingSync: true,
  };
  const list = loadScriptsRaw();
  list.unshift(script);
  saveScripts(list);
  return script;
}

export function updateScript(id, patch) {
  const list = loadScriptsRaw();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now(), pendingSync: true };
  saveScripts(list);
  return list[idx];
}

/**
 * Exclusão é marcada, não removida na hora: é assim que ela chega aos outros
 * aparelhos. O registro some sozinho depois de 30 dias.
 */
export function deleteScript(id) {
  const list = loadScriptsRaw();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const now = Date.now();
  list[idx] = { ...list[idx], deletedAt: now, updatedAt: now, pendingSync: true };
  saveScripts(list);
}

export function duplicateScript(id) {
  const src = loadScripts().find((s) => s.id === id);
  if (!src) return null;
  return createScript({ title: `${src.title || ''} (cópia)`.trim(), body: src.body });
}

export function getScript(id) {
  return loadScripts().find((s) => s.id === id) || null;
}

// ---- Sincronização ----------------------------------------------------------

/** Marca de tempo do servidor na última sincronização bem-sucedida. */
export function getLastSync() {
  return Number(read(KEYS.lastSync, 0)) || 0;
}

export function setLastSync(when) {
  write(KEYS.lastSync, Number(when) || 0);
}

/** Nomes das pessoas da equipe, para mostrar quem criou cada roteiro. */
export function setKnownUsers(users) {
  write(KEYS.users, Array.isArray(users) ? users : []);
}

export function getKnownUsers() {
  const list = read(KEYS.users, []);
  return Array.isArray(list) ? list : [];
}

export function userName(id) {
  if (!id) return '';
  return getKnownUsers().find((u) => u.id === id)?.name || '';
}

/** Zera o estado de sincronização (usado ao sair da conta). */
export function resetSyncState() {
  write(KEYS.lastSync, 0);
  write(KEYS.users, []);
}

// ---- Configurações ----------------------------------------------------------

/** Já existem configurações salvas neste navegador? */
export function hasSavedSettings() {
  try { return localStorage.getItem(KEYS.settings) !== null; } catch { return false; }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(settings) {
  return write(KEYS.settings, settings);
}

// ---- Sessões (relatórios) ---------------------------------------------------

export function loadSessions() {
  return read(KEYS.sessions, []);
}

export function addSession(stats) {
  const list = loadSessions();
  list.unshift({ ...stats, at: Date.now() });
  write(KEYS.sessions, list.slice(0, 50));
}

// ---- Chave de IA ------------------------------------------------------------

export function loadAiKey() {
  try { return localStorage.getItem(KEYS.aiKey) || ''; } catch { return ''; }
}

export function saveAiKey(key) {
  try {
    if (key) localStorage.setItem(KEYS.aiKey, key);
    else localStorage.removeItem(KEYS.aiKey);
  } catch { /* ignore */ }
}

// ---- Backup -----------------------------------------------------------------

export function exportBackup() {
  return JSON.stringify({
    app: 'fmp-barzi-prompter',
    version: 1,
    exportedAt: new Date().toISOString(),
    scripts: loadScripts(),
    settings: loadSettings(),
  }, null, 2);
}

/** Importa um backup JSON; mescla roteiros por id. Devolve quantos foram importados. */
export function importBackup(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.scripts)) throw new Error('Arquivo de backup inválido');
  const current = loadScriptsRaw();
  const byId = new Map(current.map((s) => [s.id, s]));
  let count = 0;
  for (const s of data.scripts) {
    if (!s || typeof s.body !== 'string') continue;
    const id = s.id && !byId.has(s.id) ? s.id : (byId.has(s.id) ? s.id : uid());
    byId.set(id, {
      ...s, id, pendingSync: true,
      updatedAt: s.updatedAt || Date.now(),
      createdAt: s.createdAt || Date.now(),
    });
    count++;
  }
  saveScripts([...byId.values()]);
  if (data.settings && typeof data.settings === 'object') {
    saveSettings({ ...loadSettings(), ...data.settings });
  }
  return count;
}
