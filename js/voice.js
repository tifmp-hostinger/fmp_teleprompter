// Rastreamento por voz com a Web Speech API (Chrome/Edge/Safari).
import { normalizeWord } from './script-parser.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export class VoiceTracker {
  static get supported() { return !!SR; }

  /**
   * @param {{lang?: string, onWords: (norms: string[], isFinal: boolean) => void,
   *   onStatus?: (status: 'listening'|'stopped'|'error') => void, onRate?: (wpm:number)=>void, onError?: Function}} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.lang = opts.lang || 'pt-BR';
    this.active = false;
    this.rec = null;
    this.finalWordTimes = []; // timestamps das palavras finais (para ppm ao vivo)
    this.pauses = 0;
    this._lastSpeech = 0;
    this._silenceTimer = 0;
    this.lastInterimCount = 0;
  }

  setLang(lang) {
    this.lang = lang;
    if (this.active) { this.stop(); this.start(); }
  }

  start() {
    if (!SR || this.active) return false;
    this.active = true;
    this._spawn();
    return true;
  }

  _spawn() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      const now = performance.now();
      const res = ev.results[ev.results.length - 1];
      if (!res) return;
      const transcript = res[0]?.transcript || '';
      const norms = transcript.trim().split(/\s+/).map(normalizeWord).filter(Boolean);
      if (!norms.length) return;

      if (this._lastSpeech && now - this._lastSpeech > 1800) this.pauses++;
      this._lastSpeech = now;

      if (res.isFinal) {
        for (let i = 0; i < norms.length; i++) this.finalWordTimes.push(now);
        this.lastInterimCount = 0;
        this._emitRate();
      } else {
        // Conta só as palavras novas do resultado provisório para o ritmo.
        const fresh = norms.length - this.lastInterimCount;
        if (fresh > 0) for (let i = 0; i < fresh; i++) this.finalWordTimes.push(now);
        this.lastInterimCount = norms.length;
        this._emitRate();
      }
      this.opts.onWords(norms, res.isFinal);
    };
    rec.onstart = () => this.opts.onStatus?.('listening');
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        this.active = false;
        this.opts.onStatus?.('error');
        this.opts.onError?.(ev.error);
      }
      // 'no-speech' e 'network' são recuperados pelo reinício em onend.
    };
    rec.onend = () => {
      if (this.active) {
        // Chrome encerra sessões longas; reinicia para manter contínuo.
        setTimeout(() => { if (this.active) this._spawn(); }, 120);
      } else {
        this.opts.onStatus?.('stopped');
      }
    };
    this.rec = rec;
    try { rec.start(); } catch { /* já iniciado */ }
  }

  stop() {
    this.active = false;
    try { this.rec?.stop(); } catch { /* ignore */ }
    this.rec = null;
  }

  /** ppm dos últimos 15 s. */
  _emitRate() {
    const now = performance.now();
    const windowMs = 15000;
    this.finalWordTimes = this.finalWordTimes.filter((t) => now - t <= windowMs);
    const n = this.finalWordTimes.length;
    if (n < 3) return;
    const span = Math.max(3000, now - this.finalWordTimes[0]);
    this.opts.onRate?.(Math.round((n / span) * 60000));
  }

  resetStats() { this.finalWordTimes = []; this.pauses = 0; this._lastSpeech = 0; }
}

export const VOICE_LANGS = {
  'pt-BR': 'Português (Brasil)',
  'pt-PT': 'Português (Portugal)',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'es-ES': 'Español (España)',
  'es-MX': 'Español (México)',
  'fr-FR': 'Français',
  'it-IT': 'Italiano',
  'de-DE': 'Deutsch',
};
