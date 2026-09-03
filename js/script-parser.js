// Parser de roteiro: transforma o texto do editor em blocos renderizáveis,
// lista de palavras faladas (para o rastreamento por voz) e estatísticas.
// Módulo puro (sem DOM) — reutilizado pelo app e pelos testes em Node.
//
// Sintaxe suportada no roteiro:
//   [instrução]      marcação de palco (ex.: [pausa], [olhar câmera 2]) — exibida, não lida
//   **texto**        negrito
//   ==texto==        destaque (fundo colorido)
//   # Título         marcador de seção (aparece na linha do tempo, não é lido)
//   ---              divisor / ponto de pausa
//   linha em branco  novo parágrafo

export const CUE_COLORS = {
  pausa: 'cue-pause', pause: 'cue-pause', pausar: 'cue-pause',
  respire: 'cue-pause', breathe: 'cue-pause', respira: 'cue-pause',
  sorria: 'cue-smile', smile: 'cue-smile', sonrie: 'cue-smile', sonría: 'cue-smile',
  camera: 'cue-camera', câmera: 'cue-camera', cámara: 'cue-camera', olhar: 'cue-camera', look: 'cue-camera',
  ênfase: 'cue-emph', enfase: 'cue-emph', emphasis: 'cue-emph', énfasis: 'cue-emph',
  lento: 'cue-slow', slow: 'cue-slow', devagar: 'cue-slow', despacio: 'cue-slow',
  rápido: 'cue-fast', rapido: 'cue-fast', fast: 'cue-fast',
};

/** Normaliza uma palavra para comparação fonética simples (voz). */
export function normalizeWord(word) {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Classe CSS de uma marcação de palco a partir do seu texto. */
export function cueClass(cueText) {
  const first = normalizeWord(cueText.trim().split(/\s+/)[0] || '');
  for (const [key, cls] of Object.entries(CUE_COLORS)) {
    if (normalizeWord(key) === first) return cls;
  }
  return 'cue-default';
}

/**
 * Divide o texto de um parágrafo em "inlines": texto simples, negrito,
 * destaque e marcações de palco.
 */
export function parseInlines(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|==[^=]+==|\[[^\]\n]+\])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ type: 'bold', text: tok.slice(2, -2) });
    else if (tok.startsWith('==')) out.push({ type: 'highlight', text: tok.slice(2, -2) });
    else out.push({ type: 'cue', text: tok.slice(1, -1), cls: cueClass(tok.slice(1, -1)) });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/**
 * Faz o parse completo do roteiro.
 * @returns {{blocks: Array, words: Array<{text:string,norm:string,index:number,block:number}>, markers: Array, wordCount:number, charCount:number}}
 */
export function parseScript(source) {
  const text = (source || '').replace(/\r\n?/g, '\n');
  const paragraphs = text.split(/\n{2,}/);
  const blocks = [];
  const words = [];
  const markers = [];

  for (const rawPara of paragraphs) {
    const para = rawPara.replace(/^\n+|\n+$/g, '');
    if (!para.trim()) continue;

    // Um parágrafo pode conter várias linhas separadas por quebra simples;
    // cada uma vira um bloco (para que # e --- funcionem em qualquer linha).
    for (const line of para.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^-{3,}$/.test(trimmed)) {
        blocks.push({ type: 'divider' });
        markers.push({ type: 'divider', label: '—', wordIndex: words.length, block: blocks.length - 1 });
        continue;
      }
      if (/^#{1,3}\s+/.test(trimmed)) {
        const label = trimmed.replace(/^#{1,3}\s+/, '');
        blocks.push({ type: 'heading', text: label });
        markers.push({ type: 'heading', label, wordIndex: words.length, block: blocks.length - 1 });
        continue;
      }

      const inlines = parseInlines(line);
      const blockIndex = blocks.length;
      for (const inline of inlines) {
        if (inline.type === 'cue') {
          markers.push({ type: 'cue', label: inline.text, wordIndex: words.length, block: blockIndex, cls: inline.cls });
          continue;
        }
        // Divide preservando espaços: tokens alternam palavra/espaço.
        inline.tokens = inline.text.split(/(\s+)/).map((tok) => {
          if (!tok) return null;
          if (/^\s+$/.test(tok)) return { type: 'space', text: tok };
          const norm = normalizeWord(tok);
          if (!norm) return { type: 'punct', text: tok };
          const word = { text: tok, norm, index: words.length, block: blockIndex };
          words.push(word);
          return { type: 'word', text: tok, index: word.index };
        }).filter(Boolean);
      }
      blocks.push({ type: 'paragraph', inlines });
    }
  }

  return {
    blocks,
    words,
    markers,
    wordCount: words.length,
    charCount: text.length,
  };
}

/** Segundos estimados para ler `wordCount` palavras a `wpm` palavras/minuto. */
export function estimateSeconds(wordCount, wpm) {
  const rate = Math.max(1, Number(wpm) || 0);
  return (wordCount / rate) * 60;
}

/** WPM necessário para caber `wordCount` palavras em `seconds` segundos. */
export function wpmForDuration(wordCount, seconds) {
  const s = Math.max(1, Number(seconds) || 0);
  return Math.round((wordCount / s) * 60);
}

/** Formata segundos como m:ss ou h:mm:ss. */
export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Distância de Levenshtein limitada (para comparar palavras reconhecidas). */
export function levenshtein(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Duas palavras normalizadas "soam" iguais o bastante? */
export function wordsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;
  // Mesmo radical longo (ex.: "apresentacao" / "apresentacoes").
  let prefix = 0;
  while (prefix < len && a[prefix] === b[prefix]) prefix++;
  if (len >= 8 && prefix >= Math.max(6, Math.ceil(len * 0.75))) return true;
  if (len >= 4 && levenshtein(a, b, 1) <= 1) return true;
  if (len >= 7 && levenshtein(a, b, 2) <= 2) return true;
  return false;
}

/**
 * Rastreamento por voz: dado o índice atual e as últimas palavras
 * reconhecidas, encontra o próximo índice esperado no roteiro.
 * Procura numa janela à frente (e um pouco atrás) e devolve o índice da
 * palavra seguinte à última palavra casada, ou -1 se nada casou.
 */
export function findVoicePosition(words, fromIndex, spokenNorms, options = {}) {
  const { window = 40, back = 3, minMatch = 1 } = options;
  const spoken = spokenNorms.filter(Boolean).slice(-6);
  if (!spoken.length || !words.length) return -1;

  const start = Math.max(0, fromIndex - back);
  const end = Math.min(words.length - 1, fromIndex + window);
  let best = { score: 0, next: -1, distance: Infinity };

  // Tenta casar sufixos da fala (mais longos primeiro) em cada posição.
  for (let p = start; p <= end; p++) {
    for (let len = Math.min(spoken.length, 4); len >= minMatch; len--) {
      const seq = spoken.slice(spoken.length - len);
      let ok = true;
      for (let k = 0; k < len; k++) {
        const w = words[p + k];
        if (!w || !wordsMatch(w.norm, seq[k])) { ok = false; break; }
      }
      if (!ok) continue;
      const next = p + len;
      const distance = Math.abs(p - fromIndex);
      // Casamentos de 1 palavra só valem se forem "fortes" (palavra longa e perto).
      const score = len * 10 - Math.min(distance, 9) * 0.5;
      if (len === 1 && (seq[0].length < 4 || distance > 12)) continue;
      if (score > best.score || (score === best.score && distance < best.distance)) {
        best = { score, next, distance };
      }
      break; // maior len já casou nesta posição
    }
  }
  return best.next;
}

/** Texto puro do roteiro sem marcações (para exportar/compartilhar). */
export function stripMarkup(source) {
  return (source || '')
    .replace(/\[[^\]\n]+\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^-{3,}$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
