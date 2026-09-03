// FMP Teleprompter — aplicação principal (editor + apresentação).
import { parseScript, estimateSeconds, wpmForDuration, formatTime, findVoicePosition, stripMarkup } from './script-parser.js';
import { t, setLang, getLang, applyTranslations, LANGS, sampleScript } from './i18n.js';
import {
  loadScripts, createScript, updateScript, deleteScript, duplicateScript, getScript,
  loadSettings, saveSettings, addSession, exportBackup, importBackup, loadAiKey, saveAiKey,
} from './storage.js';
import { Prompter } from './prompter.js';
import { VoiceTracker, VOICE_LANGS } from './voice.js';
import { CameraRig } from './camera.js';
import { RemoteHost } from './remote.js';
import { openPip, pipSupported } from './pip.js';
import { generateScript } from './ai.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let settings = loadSettings();
let scripts = loadScripts();
let currentId = null;
let parsed = parseScript('');
let saveTimer = 0;

const els = {
  viewEditor: $('#view-editor'),
  viewPrompter: $('#view-prompter'),
  scriptList: $('#scriptList'),
  search: $('#searchScripts'),
  editorEmpty: $('#editorEmpty'),
  editorPane: $('#editorPane'),
  title: $('#scriptTitle'),
  body: $('#scriptBody'),
  saveStatus: $('#saveStatus'),
  statWords: $('#statWords'),
  statChars: $('#statChars'),
  statTime: $('#statTime'),
  statWpm: $('#statWpm'),
  fitMinutes: $('#fitMinutes'),
  fitWpm: $('#fitWpm'),
  cueSelect: $('#cueSelect'),
  stage: $('#stage'),
  viewport: $('#viewport'),
  content: $('#content'),
  camera: $('#cameraPreview'),
  countdown: $('#countdown'),
  countdownNum: $('#countdownNum'),
  hud: $('#hud'),
  hudTitle: $('#hudTitle'),
  hudMode: $('#hudMode'),
  hudVoice: $('#hudVoice'),
  hudRec: $('#hudRec'),
  hudRemote: $('#hudRemote'),
  hudLiveWpm: $('#hudLiveWpm'),
  hudTimer: $('#hudTimer'),
  hudElapsed: $('#hudElapsed'),
  hudRemaining: $('#hudRemaining'),
  hudSpeed: $('#hudSpeed'),
  progress: $('#progress'),
  progressFill: $('#progressFill'),
  progressMarkers: $('#progressMarkers'),
  btnPlay: $('#btnPlay'),
  settingsPanel: $('#settingsPanel'),
  toast: $('#toast'),
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
let toastTimer = 0;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

function download(name, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function safeName(s) { return (s || t('untitled')).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80); }

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  $('meta[name="theme-color"]').content = settings.theme === 'light' ? '#f4f5f9' : '#0b0d12';
}

function persistSettings() { saveSettings(settings); }

// Diálogos
$$('dialog').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close()));
});

// ---------------------------------------------------------------------------
// Biblioteca / Editor
// ---------------------------------------------------------------------------
function renderList() {
  const q = els.search.value.trim().toLowerCase();
  scripts = loadScripts();
  const items = scripts.filter((s) => !q || (s.title || '').toLowerCase().includes(q) || (s.body || '').toLowerCase().includes(q));
  els.scriptList.replaceChildren(...items.map((s) => {
    const li = document.createElement('li');
    li.className = 'script-item' + (s.id === currentId ? ' active' : '');
    const p = parseScript(s.body);
    const wpm = s.wpm || settings.wpm;
    li.innerHTML = `<div class="title"></div><div class="meta"><span>${p.wordCount} ${t('words')}</span><span>≈ ${formatTime(estimateSeconds(p.wordCount, wpm))}</span><span>${new Date(s.updatedAt).toLocaleDateString(getLang())}</span></div>`;
    $('.title', li).textContent = s.title || t('untitled');
    li.addEventListener('click', () => selectScript(s.id));
    return li;
  }));
}

function selectScript(id) {
  const s = getScript(id);
  currentId = s ? s.id : null;
  els.editorEmpty.hidden = !!s;
  els.editorPane.hidden = !s;
  if (s) {
    els.title.value = s.title || '';
    els.body.value = s.body || '';
    els.statWpm.value = s.wpm || settings.wpm;
    if (!els.fitMinutes.value) els.fitMinutes.value = settings.targetMinutes;
    updateStats();
  }
  renderList();
}

function updateStats() {
  parsed = parseScript(els.body.value);
  const wpm = Number(els.statWpm.value) || settings.wpm;
  els.statWords.textContent = parsed.wordCount;
  els.statChars.textContent = parsed.charCount;
  els.statTime.textContent = formatTime(estimateSeconds(parsed.wordCount, wpm));
  const min = Number(els.fitMinutes.value);
  els.fitWpm.textContent = min > 0 && parsed.wordCount ? t('requiredWpm', { wpm: wpmForDuration(parsed.wordCount, min * 60) }) : '—';
}

function scheduleSave() {
  if (!currentId) return;
  els.saveStatus.textContent = t('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    updateScript(currentId, { title: els.title.value, body: els.body.value, wpm: Number(els.statWpm.value) || null });
    els.saveStatus.textContent = t('saved');
    renderList();
  }, 400);
}

els.title.addEventListener('input', scheduleSave);
els.body.addEventListener('input', () => { updateStats(); scheduleSave(); });
els.statWpm.addEventListener('input', () => { updateStats(); scheduleSave(); });
els.fitMinutes.addEventListener('input', updateStats);
els.search.addEventListener('input', renderList);

$('#btnNewScript').addEventListener('click', () => {
  const s = createScript({ title: '', body: '' });
  selectScript(s.id);
  els.title.focus();
});

$('#btnDuplicate').addEventListener('click', () => {
  if (!currentId) return;
  const s = duplicateScript(currentId);
  if (s) selectScript(s.id);
});

$('#btnDelete').addEventListener('click', () => {
  if (!currentId || !confirm(t('confirmDelete'))) return;
  deleteScript(currentId);
  scripts = loadScripts();
  selectScript(scripts[0]?.id || null);
});

$('#btnExport').addEventListener('click', () => {
  if (!currentId) return;
  download(`${safeName(els.title.value)}.txt`, stripMarkup(els.body.value));
});

$('#btnBackup').addEventListener('click', () => {
  download(`fmp-teleprompter-backup-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(), 'application/json');
});
$('#btnRestore').addEventListener('click', () => $('#fileImport').click());
$('#btnImport').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', async (e) => {
  await importFiles(e.target.files);
  e.target.value = '';
});

async function importFiles(files) {
  let last = null;
  for (const file of files) {
    const text = await file.text();
    if (file.name.endsWith('.json')) {
      try { toast(`${importBackup(text)} ${t('scripts').toLowerCase()} ✓`); } catch (err) { toast(err.message); }
      continue;
    }
    last = createScript({ title: file.name.replace(/\.[^.]+$/, ''), body: text });
  }
  scripts = loadScripts();
  selectScript(last ? last.id : (currentId || scripts[0]?.id));
}

// Arrastar e soltar arquivos
const dropOverlay = $('#dropOverlay');
document.addEventListener('dragover', (e) => { if (els.viewEditor.hidden) return; e.preventDefault(); dropOverlay.hidden = false; });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropOverlay.hidden = true; });
document.addEventListener('drop', (e) => {
  if (els.viewEditor.hidden) return;
  e.preventDefault(); dropOverlay.hidden = true;
  if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
});

// Barra de ferramentas do editor
function wrapSelection(mark) {
  const ta = els.body;
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b) || (mark === '**' ? 'texto' : 'texto');
  ta.setRangeText(`${mark}${sel}${mark}`, a, b, 'select');
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function insertLine(text) {
  const ta = els.body;
  const { selectionStart: a, value } = ta;
  const atLineStart = a === 0 || value[a - 1] === '\n';
  const prefix = atLineStart ? '' : '\n';
  const suffix = text === '---' ? '\n' : '';
  ta.setRangeText(`${prefix}${text}${suffix}`, a, a, 'end');
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function insertCue(label) {
  const ta = els.body;
  const { selectionStart: a } = ta;
  const before = ta.value[a - 1];
  ta.setRangeText(`${before && before !== ' ' && before !== '\n' ? ' ' : ''}[${label}] `, a, a, 'end');
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
$$('[data-wrap]').forEach((b) => b.addEventListener('click', () => wrapSelection(b.dataset.wrap)));
$$('[data-insert-line]').forEach((b) => b.addEventListener('click', () => insertLine(b.dataset.insertLine)));

const CUES = {
  'pt-BR': ['pausa', 'sorria', 'olhar câmera', 'ênfase', 'lento', 'rápido', 'respire'],
  en: ['pause', 'smile', 'look camera', 'emphasis', 'slow', 'fast', 'breathe'],
  es: ['pausa', 'sonríe', 'mira cámara', 'énfasis', 'lento', 'rápido', 'respira'],
};
function fillCueSelect() {
  const opts = [`<option value="">[ ${t('cue')} ]</option>`, ...(CUES[getLang()] || CUES.en).map((c) => `<option value="${c}">[${c}]</option>`)];
  els.cueSelect.innerHTML = opts.join('');
}
els.cueSelect.addEventListener('change', () => { if (els.cueSelect.value) insertCue(els.cueSelect.value); els.cueSelect.value = ''; });

// Atalhos no editor
els.body.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSelection('**'); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); wrapSelection('=='); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); startPresentation(); }
});

// ---------------------------------------------------------------------------
// Preferências / atalhos / instalação
// ---------------------------------------------------------------------------
const dlgPrefs = $('#dlgPrefs');
$('#prefLang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#btnPrefs').addEventListener('click', () => {
  $('#prefLang').value = getLang();
  $('#prefTheme').value = settings.theme;
  $('#prefAiKey').value = loadAiKey();
  dlgPrefs.showModal();
});
$('#prefLang').addEventListener('change', (e) => { setLang(e.target.value); refreshTexts(); });
$('#prefTheme').addEventListener('change', (e) => { settings.theme = e.target.value; persistSettings(); applyTheme(); });
$('#prefAiKey').addEventListener('change', (e) => saveAiKey(e.target.value.trim()));
$('#btnShortcuts').addEventListener('click', () => $('#dlgShortcuts').showModal());

function refreshTexts() {
  applyTranslations(document);
  fillCueSelect();
  renderList();
  updateStats();
  if (!els.viewPrompter.hidden) updateHud(prompter.getState());
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#btnInstall').hidden = false; });
$('#btnInstall').addEventListener('click', async () => { await installPrompt?.prompt(); installPrompt = null; $('#btnInstall').hidden = true; });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------------------------------------------------------------------------
// Gerador de roteiro com IA
// ---------------------------------------------------------------------------
const dlgAi = $('#dlgAi');
let aiAbort = null;
$('#btnAi').addEventListener('click', () => {
  $('#aiKey').value = loadAiKey();
  $('#aiPreview').hidden = true; $('#aiPreview').textContent = '';
  $('#aiStatus').textContent = '';
  dlgAi.showModal();
});
dlgAi.addEventListener('close', () => aiAbort?.abort());
$('#btnAiGenerate').addEventListener('click', async () => {
  const apiKey = $('#aiKey').value.trim();
  const topic = $('#aiTopic').value.trim();
  if (!topic || !apiKey) { $('#aiStatus').textContent = t('aiError', { msg: !apiKey ? t('aiKey') : t('aiTopic') }); return; }
  saveAiKey(apiKey);
  const toneKey = { casual: 'toneCasual', professional: 'toneProfessional', inspiring: 'toneInspiring', educational: 'toneEducational', sales: 'toneSales' }[$('#aiTone').value];
  const btn = $('#btnAiGenerate');
  btn.disabled = true;
  $('#aiStatus').className = 'status'; $('#aiStatus').textContent = t('aiGenerating');
  const preview = $('#aiPreview'); preview.hidden = false; preview.textContent = '';
  aiAbort = new AbortController();
  let text = '';
  try {
    for await (const chunk of generateScript({
      apiKey, topic, minutes: Number($('#aiMinutes').value), tone: t(toneKey), language: getLang(), signal: aiAbort.signal,
    })) {
      text += chunk;
      preview.textContent = text;
      preview.scrollTop = preview.scrollHeight;
    }
    $('#aiStatus').className = 'status ok'; $('#aiStatus').textContent = '✓';
    if (!currentId) selectScript(createScript({ title: topic.slice(0, 60), body: '' }).id);
    if (!els.body.value.trim() || confirm(t('aiReplace'))) {
      els.body.value = text.trim();
      if (!els.title.value.trim()) els.title.value = topic.slice(0, 60);
      els.body.dispatchEvent(new Event('input'));
      els.title.dispatchEvent(new Event('input'));
      dlgAi.close();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      $('#aiStatus').className = 'status err';
      $('#aiStatus').textContent = t('aiError', { msg: err.message });
    }
  } finally {
    btn.disabled = false;
    aiAbort = null;
  }
});

// ---------------------------------------------------------------------------
// Apresentação (prompter)
// ---------------------------------------------------------------------------
const prompter = new Prompter({ stage: els.stage, viewport: els.viewport, content: els.content }, {
  onTick: (state) => { updateHud(state); broadcastProgress(state); remoteState(state); },
  onEnd: () => { setTimeout(showReport, 400); },
});

// Sessão atual (para o relatório)
const session = { pauses: 0, startedAt: 0, voiceWpmSamples: [] };
let voiceIndex = 0;
let liveWpm = 0;

function currentSettingsForScript() {
  const s = getScript(currentId);
  const merged = { ...settings };
  if (s?.wpm) merged.wpm = s.wpm;
  if (s?.fontSize) merged.fontSize = s.fontSize;
  return merged;
}

function startPresentation() {
  if (!currentId) return;
  clearTimeout(saveTimer);
  updateScript(currentId, { title: els.title.value, body: els.body.value, wpm: Number(els.statWpm.value) || null });
  parsed = parseScript(els.body.value);
  settings = currentSettingsForScript();
  els.viewEditor.hidden = true;
  els.viewPrompter.hidden = false;
  els.hudTitle.textContent = els.title.value || t('untitled');
  prompter.setSettings(settings);
  prompter.setScript(parsed);
  renderMarkers();
  bindSettingsPanel();
  session.pauses = 0; session.startedAt = 0; session.voiceWpmSamples = [];
  voiceIndex = 0; liveWpm = 0;
  els.hudLiveWpm.hidden = true;
  updateHud(prompter.getState());
  broadcastScript();
  showHud();
  if (settings.mode === 'voice') startVoice();
  if (settings.cameraEnabled) startCamera().catch(() => {});
  history.pushState({ prompter: true }, '');
}

async function exitPresentation({ skipReport = false } = {}) {
  const state = prompter.getState();
  prompter.pause();
  stopVoice();
  if (recording) await stopRecording();
  camera.stop();
  els.hudRec.hidden = true;
  $('#btnRecord').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  els.settingsPanel.hidden = true;
  els.viewPrompter.hidden = true;
  els.viewEditor.hidden = false;
  if (!skipReport && state.elapsed > 3) showReport();
  renderList();
}
window.addEventListener('popstate', () => { if (!els.viewPrompter.hidden) exitPresentation(); });

$('#btnPresent').addEventListener('click', startPresentation);
$('#btnBack').addEventListener('click', () => { if (history.state?.prompter) history.back(); else exitPresentation(); });

function renderMarkers() {
  const total = Math.max(1, parsed.wordCount);
  els.progressMarkers.replaceChildren(...parsed.markers.map((m) => {
    const el = document.createElement('div');
    el.className = `marker ${m.type}`;
    el.style.left = `${(m.wordIndex / total) * 100}%`;
    el.dataset.label = m.label;
    el.addEventListener('click', (e) => { e.stopPropagation(); prompter.jumpToWord(m.wordIndex); voiceIndex = m.wordIndex; });
    return el;
  }));
}

els.progress.addEventListener('click', (e) => {
  const r = els.progress.getBoundingClientRect();
  prompter.jumpToProgress((e.clientX - r.left) / r.width);
  voiceIndex = prompter.currentWord;
});

function updateHud(state) {
  els.btnPlay.textContent = state.playing ? '❚❚' : '▶';
  els.btnPlay.title = t(state.playing ? 'pause' : 'play');
  els.hudSpeed.textContent = state.mode === 'timed'
    ? formatTime(state.totalSeconds)
    : `${state.wpm} ${t('wpm')}`;
  els.hudMode.textContent = t({ fixed: 'modeFixed', timed: 'modeTimed', voice: 'modeVoice', manual: 'modeManual' }[state.mode]);
  els.progressFill.style.width = `${state.progress * 100}%`;
  els.hudElapsed.textContent = formatTime(state.elapsed);
  els.hudRemaining.textContent = formatTime(state.remaining);
  els.hudTimer.hidden = !settings.showTimer;
  els.progress.style.visibility = settings.showProgress ? 'visible' : 'hidden';
  if (state.finished) toast(t('finished'), 1500);
}

// Transporte
function playWithCountdown() {
  if (prompter.playing) { prompter.pause(); session.pauses++; return; }
  const n = Number(settings.countdown) || 0;
  if (n <= 0 || prompter.y > 0) { prompter.play(); return; }
  let left = n;
  els.countdown.hidden = false;
  const tick = () => {
    els.countdownNum.textContent = left;
    els.countdownNum.style.animation = 'none';
    requestAnimationFrame(() => { els.countdownNum.style.animation = ''; });
    if (left-- <= 0) { els.countdown.hidden = true; prompter.play(); return; }
    countdownTimer = setTimeout(tick, 1000);
  };
  tick();
}
let countdownTimer = 0;
function cancelCountdown() { clearTimeout(countdownTimer); els.countdown.hidden = true; }

els.btnPlay.addEventListener('click', playWithCountdown);
$('#btnRestart').addEventListener('click', () => { cancelCountdown(); prompter.restart(); voiceIndex = 0; });
$('#btnSlower').addEventListener('click', () => changeSpeed(-10));
$('#btnFaster').addEventListener('click', () => changeSpeed(10));

function changeSpeed(delta) {
  if (settings.mode === 'timed') {
    settings.targetMinutes = Math.max(0.5, Math.round((settings.targetMinutes + (delta < 0 ? 0.5 : -0.5)) * 2) / 2);
    prompter.setSettings(settings);
    prompter.emit();
  } else {
    settings.wpm = prompter.adjustWpm(delta);
    if (currentId) updateScript(currentId, { wpm: settings.wpm });
  }
  persistSettings();
  syncPanelInputs();
  broadcastScript();
}

function changeFont(delta) {
  settings.fontSize = Math.max(20, Math.min(160, Number(settings.fontSize) + delta));
  if (currentId) updateScript(currentId, { fontSize: settings.fontSize });
  persistSettings(); prompter.setSettings(settings); syncPanelInputs(); broadcastScript();
}

// Gestos: toque = play/pause, arrastar = navegar, roda do mouse = navegar
let drag = null;
els.stage.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { y: e.clientY, moved: false, startY: prompter.y }; });
els.stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 6) drag.moved = true;
  if (drag.moved) { prompter.setY(drag.startY - dy * (settings.mirrorV ? -1 : 1)); voiceIndex = prompter.currentWord; }
});
els.stage.addEventListener('pointerup', () => { if (drag && !drag.moved) playWithCountdown(); drag = null; });
els.stage.addEventListener('pointercancel', () => { drag = null; });
els.stage.addEventListener('wheel', (e) => { e.preventDefault(); prompter.seekPixels(e.deltaY); voiceIndex = prompter.currentWord; }, { passive: false });

// Ocultar HUD automaticamente durante a reprodução
let hudTimer = 0;
function showHud() {
  els.hud.classList.remove('hidden');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => { if (prompter.playing && els.settingsPanel.hidden) els.hud.classList.add('hidden'); }, 2800);
}
['pointermove', 'pointerdown', 'keydown'].forEach((ev) => els.viewPrompter.addEventListener(ev, showHud));

// Teclado
function handleKey(e) {
  if (els.viewPrompter.hidden) return;
  if (e.target.matches?.('input, select, textarea')) return;
  if (document.querySelector('dialog[open]')) return; // Esc fecha o diálogo, não a apresentação
  const k = e.key;
  const map = {
    ' ': () => playWithCountdown(),
    'ArrowUp': () => changeSpeed(5),
    'ArrowDown': () => changeSpeed(-5),
    'ArrowLeft': () => { prompter.seekLines(-2); voiceIndex = prompter.currentWord; },
    'ArrowRight': () => { prompter.seekLines(2); voiceIndex = prompter.currentWord; },
    'PageUp': () => { prompter.seekLines(-6); voiceIndex = prompter.currentWord; },
    'PageDown': () => { prompter.seekLines(6); voiceIndex = prompter.currentWord; },
    'Home': () => { cancelCountdown(); prompter.restart(); voiceIndex = 0; },
    'End': () => prompter.jumpToProgress(1),
    '+': () => changeFont(4), '=': () => changeFont(4),
    '-': () => changeFont(-4), '_': () => changeFont(-4),
    'f': toggleFullscreen, 'F': toggleFullscreen,
    'm': () => toggleSetting('mirrorH'), 'M': () => toggleSetting('mirrorH'),
    'r': () => { cancelCountdown(); prompter.restart(); voiceIndex = 0; }, 'R': () => { cancelCountdown(); prompter.restart(); voiceIndex = 0; },
    'v': toggleVoice, 'V': toggleVoice,
    'c': toggleCamera, 'C': toggleCamera,
    'Escape': () => {
      if (!els.settingsPanel.hidden) { els.settingsPanel.hidden = true; return; }
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      $('#btnBack').click();
    },
  };
  if (map[k]) { e.preventDefault(); map[k](); }
}
document.addEventListener('keydown', handleKey);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('#btnFullscreen').addEventListener('click', toggleFullscreen);

function toggleSetting(key) {
  settings[key] = !settings[key];
  persistSettings(); prompter.setSettings(settings); syncPanelInputs(); broadcastScript();
}
$('#btnMirror').addEventListener('click', () => toggleSetting('mirrorH'));

// ---------------------------------------------------------------------------
// Painel de configurações (ligação genérica por data-setting)
// ---------------------------------------------------------------------------
let panelBound = false;
function bindSettingsPanel() {
  if (panelBound) { syncPanelInputs(); return; }
  panelBound = true;
  $('#voiceLangSelect').innerHTML = Object.entries(VOICE_LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $$('[data-setting]', els.settingsPanel).forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.setting;
      let val;
      if (input.type === 'checkbox') val = input.checked;
      else if (input.type === 'range' || input.type === 'number') val = Number(input.value);
      else val = input.value;
      settings[key] = val;
      if (key === 'wpm' && currentId) updateScript(currentId, { wpm: val });
      if (key === 'fontSize' && currentId) updateScript(currentId, { fontSize: val });
      if (key === 'voiceLang') voice?.setLang(val);
      if (key === 'cameraMirror') camera.setMirror(val);
      persistSettings();
      prompter.setSettings(settings);
      prompter.emit();
      syncOutputs();
      broadcastScript();
    });
  });
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  syncPanelInputs();
}

function setMode(mode) {
  settings.mode = mode;
  persistSettings();
  prompter.setSettings(settings);
  prompter.emit();
  if (mode === 'voice') startVoice(); else stopVoice();
  syncPanelInputs();
  broadcastScript();
}

function syncPanelInputs() {
  $$('[data-setting]', els.settingsPanel).forEach((input) => {
    const v = settings[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = !!v; else input.value = v;
  });
  $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
  $('#fieldWpm').hidden = settings.mode === 'timed' || settings.mode === 'manual';
  $('#fieldTimed').hidden = settings.mode !== 'timed';
  $('#fieldVoice').hidden = settings.mode !== 'voice';
  syncOutputs();
}

function syncOutputs() {
  $('#outWpm').textContent = `${settings.wpm} ${t('wpm')}`;
  $('#outTimed').textContent = formatTime(settings.targetMinutes * 60);
  $('#outFontSize').textContent = `${settings.fontSize}px`;
  $('#outLineHeight').textContent = Number(settings.lineHeight).toFixed(2);
  $('#outTextWidth').textContent = `${settings.textWidth}%`;
  $('#outReadingLine').textContent = `${settings.readingLine}%`;
  $('#outDim').textContent = `${settings.dim}%`;
  $('#outCameraOpacity').textContent = `${settings.cameraOpacity}%`;
  $('#outCountdown').textContent = `${settings.countdown} ${t('seconds')}`;
}

$('#btnSettings').addEventListener('click', () => { els.settingsPanel.hidden = !els.settingsPanel.hidden; });
$('#btnCloseSettings').addEventListener('click', () => { els.settingsPanel.hidden = true; });

// ---------------------------------------------------------------------------
// Voz
// ---------------------------------------------------------------------------
let voice = null;
function startVoice() {
  if (!VoiceTracker.supported) { toast(t('voiceUnsupported'), 4000); return; }
  if (voice?.active) return;
  voiceIndex = Math.max(0, prompter.currentWord);
  voice = voice || new VoiceTracker({
    lang: settings.voiceLang,
    onWords: (norms) => {
      prompter.voiceHeard();
      const next = findVoicePosition(parsed.words, voiceIndex, norms);
      if (next >= 0) {
        voiceIndex = next;
        prompter.voiceAdvanceTo(next);
        if (!prompter.playing && !prompter.finished && els.countdown.hidden) prompter.play();
      }
    },
    onRate: (wpm) => {
      liveWpm = wpm;
      session.voiceWpmSamples.push(wpm);
      els.hudLiveWpm.hidden = false;
      els.hudLiveWpm.innerHTML = `${wpm}<small>${t('liveWpm')}</small>`;
    },
    onStatus: (st) => {
      els.hudVoice.hidden = st !== 'listening';
      els.hudVoice.textContent = t('voiceListening');
      $('#btnVoice').setAttribute('aria-pressed', String(st === 'listening'));
    },
    onError: () => toast(t('voiceUnsupported'), 4000),
  });
  voice.setLang(settings.voiceLang);
  voice.resetStats();
  voice.start();
  if (settings.mode !== 'voice') { settings.mode = 'voice'; persistSettings(); prompter.setSettings(settings); prompter.emit(); syncPanelInputs(); }
}
function stopVoice() {
  voice?.stop();
  els.hudVoice.hidden = true;
  $('#btnVoice').setAttribute('aria-pressed', 'false');
}
function toggleVoice() {
  if (voice?.active) { stopVoice(); setModeSilently('fixed'); } else startVoice();
}
function setModeSilently(mode) { settings.mode = mode; persistSettings(); prompter.setSettings(settings); prompter.emit(); syncPanelInputs(); }
$('#btnVoice').addEventListener('click', toggleVoice);

// ---------------------------------------------------------------------------
// Câmera e gravação
// ---------------------------------------------------------------------------
const camera = new CameraRig(els.camera);
let recording = false;
async function startCamera() {
  if (!CameraRig.supported) return;
  try {
    await camera.start();
    camera.setMirror(settings.cameraMirror);
    settings.cameraEnabled = true;
    prompter.setSettings(settings);
    $('#btnCamera').setAttribute('aria-pressed', 'true');
    $('#btnRecord').hidden = !CameraRig.canRecord;
  } catch (err) {
    settings.cameraEnabled = false;
    prompter.setSettings(settings);
    toast(`${t('camera')}: ${err.message}`);
  }
  persistSettings();
}
async function stopCamera() {
  if (recording) await stopRecording();
  camera.stop();
  settings.cameraEnabled = false;
  persistSettings();
  prompter.setSettings(settings);
  $('#btnCamera').setAttribute('aria-pressed', 'false');
  $('#btnRecord').hidden = true;
}
function toggleCamera() { camera.active ? stopCamera() : startCamera(); }
$('#btnCamera').addEventListener('click', toggleCamera);

async function stopRecording() {
  const blob = await camera.stopRecording();
  recording = false;
  els.hudRec.hidden = true;
  $('#btnRecord').textContent = '⏺';
  $('#btnRecord').setAttribute('aria-pressed', 'false');
  if (blob) { CameraRig.download(blob, safeName(els.title.value)); toast(t('recordingSaved')); }
}
$('#btnRecord').addEventListener('click', async () => {
  if (recording) return stopRecording();
  if (camera.startRecording()) {
    recording = true;
    els.hudRec.hidden = false;
    els.hudRec.textContent = `● ${t('recording')}`;
    $('#btnRecord').textContent = '■';
    $('#btnRecord').setAttribute('aria-pressed', 'true');
  }
});

// ---------------------------------------------------------------------------
// Janela flutuante (PiP)
// ---------------------------------------------------------------------------
let pipWin = null;
$('#btnPip').addEventListener('click', async () => {
  if (pipWin) { pipWin.close(); return; }
  if (!pipSupported()) { toast(t('pipUnsupported'), 5000); return; }
  try {
    pipWin = await openPip(els.stage, {
      width: Math.round(window.innerWidth * 0.45),
      height: Math.round(window.innerHeight * 0.4),
      onKey: handleKey,
      onClose: () => { pipWin = null; $('#btnPip').setAttribute('aria-pressed', 'false'); prompter.layout(); },
    });
    $('#btnPip').setAttribute('aria-pressed', 'true');
    setTimeout(() => prompter.layout(), 50);
  } catch { toast(t('pipUnsupported'), 5000); }
});

// ---------------------------------------------------------------------------
// Saída para segundo monitor (BroadcastChannel)
// ---------------------------------------------------------------------------
const outputChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fmp-tp-output') : null;
let lastProgressSent = 0;
function broadcastScript() {
  if (!outputChannel || els.viewPrompter.hidden) return;
  outputChannel.postMessage({ type: 'script', source: els.body.value, settings, title: els.title.value });
}
function broadcastProgress(state) {
  if (!outputChannel) return;
  const now = performance.now();
  if (now - lastProgressSent < 33 && state.playing) return;
  lastProgressSent = now;
  outputChannel.postMessage({ type: 'progress', p: state.progress, playing: state.playing });
}
outputChannel?.addEventListener('message', (e) => { if (e.data?.type === 'hello') { broadcastScript(); broadcastProgress(prompter.getState()); } });
$('#btnOutput').addEventListener('click', () => $('#dlgOutput').showModal());
$('#btnOpenOutput').addEventListener('click', () => {
  window.open('output.html', 'fmp-tp-output', 'popup=yes,width=1280,height=720');
  $('#dlgOutput').close();
  setTimeout(broadcastScript, 500);
});

// ---------------------------------------------------------------------------
// Controle remoto
// ---------------------------------------------------------------------------
let remote = null;
let lastRemoteSent = 0;
const dlgRemote = $('#dlgRemote');
function handleRemoteCommand(cmd) {
  if (els.viewPrompter.hidden) return;
  switch (cmd?.a) {
    case 'toggle': playWithCountdown(); break;
    case 'play': if (!prompter.playing) playWithCountdown(); break;
    case 'pause': prompter.pause(); break;
    case 'restart': cancelCountdown(); prompter.restart(); voiceIndex = 0; break;
    case 'speed': changeSpeed(Number(cmd.d) || 0); break;
    case 'seek': prompter.seekLines(Number(cmd.lines) || 0); voiceIndex = prompter.currentWord; break;
    case 'font': changeFont(Number(cmd.d) || 0); break;
    case 'mode': setMode(cmd.v); break;
    case 'progress': prompter.jumpToProgress(Number(cmd.p) || 0); voiceIndex = prompter.currentWord; break;
    default: break;
  }
  showHud();
}
function remoteState(state) {
  if (!remote) return;
  const now = performance.now();
  if (now - lastRemoteSent < 200 && state.playing) return;
  lastRemoteSent = now;
  remote.sendState({
    playing: state.playing, progress: state.progress, elapsed: state.elapsed, remaining: state.remaining,
    wpm: state.wpm, mode: state.mode, context: prompter.currentContext(), title: els.title.value,
  });
}
$('#btnRemote').addEventListener('click', async () => {
  dlgRemote.showModal();
  if (!remote) {
    remote = new RemoteHost({
      onCommand: handleRemoteCommand,
      onClients: (n) => { els.hudRemote.hidden = n === 0; toast(t(n ? 'remoteConnected' : 'remoteDisconnected')); },
    });
    $('#remoteStatus').textContent = '…';
    const info = await remote.start();
    $('#remoteCode').textContent = info.code.split('').join(' ');
    $('#remoteLink').value = info.url;
    $('#remoteStatus').className = 'status' + (info.online ? '' : ' err');
    $('#remoteStatus').textContent = info.online ? '' : t('remoteOffline');
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M'); qr.addData(info.url); qr.make();
      $('#remoteQr').innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
    } else {
      $('#remoteQr').textContent = info.code;
    }
    remoteState(prompter.getState());
  }
});
$('#btnCopyLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#remoteLink').value); toast('✓'); } catch { $('#remoteLink').select(); }
});

// ---------------------------------------------------------------------------
// Relatório da sessão
// ---------------------------------------------------------------------------
const dlgReport = $('#dlgReport');
function showReport() {
  const state = prompter.getState();
  if (dlgReport.open || state.elapsed < 3) return;
  const wordsRead = Math.max(0, Math.min(parsed.wordCount, state.finished ? parsed.wordCount : state.currentWord));
  const avg = session.voiceWpmSamples.length
    ? Math.round(session.voiceWpmSamples.reduce((a, b) => a + b, 0) / session.voiceWpmSamples.length)
    : Math.round((wordsRead / Math.max(1, state.elapsed)) * 60);
  const pauses = session.pauses + (voice?.pauses || 0);
  $('#repDuration').textContent = formatTime(state.elapsed);
  $('#repWords').textContent = wordsRead;
  $('#repWpm').textContent = `${avg} ${t('wpm')}`;
  $('#repPauses').textContent = pauses;
  $('#repTip').textContent = t(avg > 175 ? 'tipFast' : avg < 115 ? 'tipSlow' : 'tipGood');
  addSession({ scriptId: currentId, duration: state.elapsed, words: wordsRead, wpm: avg, pauses });
  dlgReport.showModal();
}
$('#btnReportAgain').addEventListener('click', () => { dlgReport.close(); if (els.viewPrompter.hidden) startPresentation(); else { prompter.restart(); voiceIndex = 0; } });
$('#btnReportEditor').addEventListener('click', () => { dlgReport.close(); if (!els.viewPrompter.hidden) exitPresentation({ skipReport: true }); });

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
function init() {
  applyTheme();
  setLang(getLang());
  fillCueSelect();
  scripts = loadScripts();
  if (!scripts.length) {
    createScript({ title: t('sample'), body: sampleScript() });
    scripts = loadScripts();
  }
  els.fitMinutes.value = settings.targetMinutes;
  selectScript(scripts[0].id);
  applyTranslations(document);
}
init();
