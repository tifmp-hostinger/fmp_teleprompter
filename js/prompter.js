// Motor do teleprompter: renderiza o roteiro e controla a rolagem
// (velocidade fixa, cronometrada, por voz ou manual) com requestAnimationFrame.
import { estimateSeconds } from './script-parser.js';

const FONT_STACKS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  rounded: '"Nunito", "Varela Round", "Segoe UI", system-ui, sans-serif',
  condensed: '"Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif',
};

export class Prompter {
  /**
   * @param {{stage: HTMLElement, viewport: HTMLElement, content: HTMLElement}} els
   * @param {{onTick?: Function, onEnd?: Function, onWord?: Function}} hooks
   */
  constructor(els, hooks = {}) {
    this.els = els;
    this.hooks = hooks;
    this.parsed = { blocks: [], words: [], markers: [], wordCount: 0 };
    this.settings = {};
    this.y = 0;
    this.maxY = 0;
    this.playing = false;
    this.mode = 'fixed';
    this.wpm = 150;
    this.targetSeconds = 180;
    this.voiceTargetY = null;
    this.voiceIdleSince = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.elapsed = 0;          // segundos em reprodução
    this.wordEls = [];
    this.wordTops = [];
    this.currentWord = -1;
    this.finished = false;
    this._pxPerWord = 1;
    this._resize = () => this.layout();
    window.addEventListener('resize', this._resize);
    this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(this._resize) : null;
    this._ro?.observe(els.stage);
  }

  destroy() {
    this.pause();
    window.removeEventListener('resize', this._resize);
    this._ro?.disconnect();
  }

  // ---- Conteúdo -------------------------------------------------------------

  setScript(parsed) {
    this.parsed = parsed;
    this.render();
    this.restart(false);
  }

  render() {
    const { content } = this.els;
    const frag = document.createDocumentFragment();
    for (const block of this.parsed.blocks) {
      if (block.type === 'divider') {
        const hr = document.createElement('div');
        hr.className = 'tp-divider';
        frag.appendChild(hr);
        continue;
      }
      if (block.type === 'heading') {
        const h = document.createElement('div');
        h.className = 'tp-heading';
        h.textContent = block.text;
        frag.appendChild(h);
        continue;
      }
      const p = document.createElement('p');
      p.className = 'tp-p';
      for (const inline of block.inlines) {
        if (inline.type === 'cue') {
          const cue = document.createElement('span');
          cue.className = `tp-cue ${inline.cls}`;
          cue.textContent = inline.text;
          p.appendChild(cue);
          continue;
        }
        let wrap = p;
        if (inline.type === 'bold' || inline.type === 'highlight') {
          wrap = document.createElement(inline.type === 'bold' ? 'strong' : 'mark');
          wrap.className = inline.type === 'bold' ? 'tp-bold' : 'tp-highlight';
          p.appendChild(wrap);
        }
        for (const tok of inline.tokens || []) {
          if (tok.type === 'word') {
            const w = document.createElement('span');
            w.className = 'tp-w';
            w.dataset.i = tok.index;
            w.textContent = tok.text;
            wrap.appendChild(w);
          } else {
            wrap.appendChild(document.createTextNode(tok.text));
          }
        }
      }
      frag.appendChild(p);
    }
    content.replaceChildren(frag);
    this.wordEls = Array.from(content.querySelectorAll('.tp-w'));
    this.layout();
  }

  // ---- Configurações --------------------------------------------------------

  setSettings(s) {
    this.settings = s;
    const { stage, viewport, content } = this.els;
    this.mode = s.mode || 'fixed';
    this.wpm = Number(s.wpm) || 150;
    this.targetSeconds = Math.max(10, (Number(s.targetMinutes) || 3) * 60);

    content.style.fontSize = `${s.fontSize}px`;
    content.style.lineHeight = String(s.lineHeight);
    content.style.fontFamily = FONT_STACKS[s.fontFamily] || FONT_STACKS.system;
    content.style.width = `${s.textWidth}%`;
    content.style.textAlign = s.align === 'center' ? 'center' : 'left';
    content.style.color = s.textColor;
    content.style.textTransform = s.uppercase ? 'uppercase' : 'none';
    content.style.fontWeight = s.boldAll ? '700' : '400';
    stage.style.setProperty('--tp-bg', s.bgColor);
    stage.style.setProperty('--tp-text', s.textColor);
    stage.style.setProperty('--tp-reading-line', `${s.readingLine}%`);
    stage.style.setProperty('--tp-dim', String((Number(s.dim) || 0) / 100));
    stage.style.setProperty('--tp-text-opacity', s.cameraEnabled ? String((Number(s.cameraOpacity) || 100) / 100) : '1');
    stage.classList.toggle('mirror-h', !!s.mirrorH);
    stage.classList.toggle('mirror-v', !!s.mirrorV);
    stage.classList.toggle('hide-reading-line', !s.showReadingLine);
    stage.classList.toggle('camera-on', !!s.cameraEnabled);
    viewport.classList.toggle('mode-voice', this.mode === 'voice');
    this.layout();
  }

  /** Recalcula medidas após mudança de fonte, tamanho de janela etc. */
  layout() {
    const { viewport, content } = this.els;
    const vh = viewport.clientHeight || 1;
    const readY = vh * ((Number(this.settings.readingLine) || 35) / 100);
    // Espaço para a 1ª linha começar na linha de leitura e a última chegar até ela.
    content.style.paddingTop = `${readY}px`;
    content.style.paddingBottom = `${Math.max(0, vh - readY)}px`;
    const total = content.scrollHeight;
    this.maxY = Math.max(0, total - vh);
    const textHeight = Math.max(1, total - vh);
    this._pxPerWord = textHeight / Math.max(1, this.parsed.wordCount);
    this.wordTops = this.wordEls.map((el) => el.offsetTop - readY);
    this.y = Math.min(this.y, this.maxY);
    this.apply();
  }

  // ---- Transporte -----------------------------------------------------------

  play() {
    if (this.playing) return;
    if (this.finished) this.restart(false);
    this.playing = true;
    this.lastFrame = performance.now();
    this.voiceIdleSince = this.lastFrame;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    this.emit();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  restart(emit = true) {
    this.y = 0;
    this.elapsed = 0;
    this.finished = false;
    this.voiceTargetY = null;
    this.currentWord = -1;
    this.apply();
    if (emit) this.emit();
  }

  /** Velocidade atual em px/s conforme o modo. */
  speedPxPerSec() {
    if (this.mode === 'timed') return this.maxY / this.targetSeconds;
    return (this.wpm / 60) * this._pxPerWord;
  }

  frame(now) {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.elapsed += dt;

    if (this.mode === 'voice') {
      if (this.voiceTargetY != null) {
        // Aproxima suavemente do alvo ditado pela voz.
        const diff = this.voiceTargetY - this.y;
        const step = diff * Math.min(1, dt * 6);
        this.y += Math.abs(diff) < 0.5 ? diff : step;
        if (Math.abs(diff) < 1) this.voiceTargetY = null;
      } else if (this.settings.voiceFallback && now - this.voiceIdleSince > 2500) {
        // Sem fala reconhecida há um tempo: segue devagar para não travar.
        this.y += this.speedPxPerSec() * 0.35 * dt;
      }
    } else if (this.mode !== 'manual') {
      this.y += this.speedPxPerSec() * dt;
    }

    if (this.y >= this.maxY) {
      this.y = this.maxY;
      this.apply();
      this.finish();
      return;
    }
    this.apply();
    this.emit();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  finish() {
    this.playing = false;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.emit();
    this.hooks.onEnd?.(this.getState());
  }

  apply() {
    this.els.content.style.transform = `translate3d(0, ${-this.y}px, 0)`;
    this.updateCurrentWord();
  }

  updateCurrentWord() {
    // Palavra cuja posição está mais próxima (abaixo) da linha de leitura.
    const tops = this.wordTops;
    if (!tops.length) return;
    let lo = 0, hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] < this.y) lo = mid + 1; else hi = mid;
    }
    const idx = Math.max(0, tops[lo] > this.y + 1 ? lo - 1 : lo);
    if (idx !== this.currentWord) {
      const prev = this.wordEls[this.currentWord];
      prev?.classList.remove('tp-current');
      this.currentWord = idx;
      this.wordEls[idx]?.classList.add('tp-current');
      this.hooks.onWord?.(idx);
    }
  }

  // ---- Navegação ------------------------------------------------------------

  setY(y, emit = true) {
    this.y = Math.max(0, Math.min(this.maxY, y));
    this.finished = false;
    this.apply();
    if (emit) this.emit();
  }

  seekPixels(delta) { this.setY(this.y + delta); }

  seekLines(lines) {
    const lh = (Number(this.settings.fontSize) || 56) * (Number(this.settings.lineHeight) || 1.45);
    this.seekPixels(lines * lh);
  }

  jumpToWord(index) {
    const top = this.wordTops[Math.max(0, Math.min(this.wordTops.length - 1, index))];
    if (top == null) return;
    this.voiceTargetY = null;
    this.setY(top);
  }

  jumpToProgress(p) { this.setY(this.maxY * Math.max(0, Math.min(1, p))); }

  /** Chamado pelo rastreador de voz com o índice da próxima palavra esperada. */
  voiceAdvanceTo(nextWordIndex) {
    const idx = Math.max(0, Math.min(this.wordTops.length - 1, nextWordIndex));
    const top = this.wordTops[idx];
    if (top == null) return;
    this.voiceIdleSince = performance.now();
    // Só avança (ou volta pouco) — evita saltos para trás por falso positivo.
    if (top < this.y - this._pxPerWord * 15) return;
    this.voiceTargetY = Math.min(this.maxY, top);
  }

  voiceHeard() { this.voiceIdleSince = performance.now(); }

  adjustWpm(delta) {
    this.wpm = Math.max(40, Math.min(400, this.wpm + delta));
    this.emit();
    return this.wpm;
  }

  setWpm(wpm) { this.wpm = Math.max(40, Math.min(400, Number(wpm) || 150)); this.emit(); }

  setMode(mode) {
    this.mode = mode;
    this.els.viewport.classList.toggle('mode-voice', mode === 'voice');
    this.emit();
  }

  // ---- Estado ---------------------------------------------------------------

  getState() {
    const progress = this.maxY ? this.y / this.maxY : 0;
    const speed = this.speedPxPerSec();
    const remainingWords = Math.max(0, this.parsed.wordCount - Math.max(0, this.currentWord));
    let remaining;
    if (this.mode === 'timed') remaining = Math.max(0, (this.maxY - this.y) / (speed || 1));
    else remaining = estimateSeconds(remainingWords, this.wpm);
    return {
      playing: this.playing,
      finished: this.finished,
      progress,
      elapsed: this.elapsed,
      remaining,
      wpm: this.wpm,
      mode: this.mode,
      currentWord: this.currentWord,
      wordCount: this.parsed.wordCount,
      totalSeconds: this.mode === 'timed' ? this.targetSeconds : estimateSeconds(this.parsed.wordCount, this.wpm),
    };
  }

  /** Texto ao redor da linha de leitura (para o controle remoto). */
  currentContext(before = 4, after = 10) {
    const words = this.parsed.words;
    if (!words.length) return '';
    const i = Math.max(0, this.currentWord);
    return words.slice(Math.max(0, i - before), i + after).map((w) => w.text).join(' ');
  }

  emit() { this.hooks.onTick?.(this.getState()); }
}
