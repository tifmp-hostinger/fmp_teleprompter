// Controle deslizante por arrasto (dedo, mouse ou caneta).
// Usado no teleprompter e no controle remoto para ajustar a velocidade.
// Sem dependências: constrói o próprio DOM dentro do elemento recebido.

export class DragDial {
  /**
   * @param {HTMLElement} el elemento container (ganha a classe .dial)
   * @param {{min:number,max:number,step:number,value:number,
   *          format?:(v:number)=>string, label?:string,
   *          onInput?:(v:number)=>void, onChange?:(v:number)=>void}} opts
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 100;
    this.step = opts.step ?? 1;
    this.format = opts.format || ((v) => String(v));
    this.onInput = opts.onInput || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.value = this.clamp(opts.value ?? this.min);
    this.dragging = false;

    el.classList.add('dial');
    el.innerHTML = `
      <button class="dial-step" data-dir="-1" type="button" aria-hidden="true" tabindex="-1">−</button>
      <div class="dial-track" role="slider" tabindex="0">
        <div class="dial-fill"></div>
        <div class="dial-thumb"><span class="dial-value"></span></div>
      </div>
      <button class="dial-step" data-dir="1" type="button" aria-hidden="true" tabindex="-1">+</button>`;

    this.track = el.querySelector('.dial-track');
    this.fill = el.querySelector('.dial-fill');
    this.thumb = el.querySelector('.dial-thumb');
    this.valueEl = el.querySelector('.dial-value');
    if (opts.label) this.track.setAttribute('aria-label', opts.label);

    // Arrasto: o valor acompanha o dedo em qualquer ponto da trilha.
    const toValue = (clientX) => {
      const r = this.track.getBoundingClientRect();
      const pad = this.thumb.offsetWidth / 2;
      const usable = Math.max(1, r.width - this.thumb.offsetWidth);
      const p = (clientX - r.left - pad) / usable;
      return this.min + p * (this.max - this.min);
    };

    this.track.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.dragging = true;
      this.track.setPointerCapture(e.pointerId);
      this.el.classList.add('dragging');
      this.set(toValue(e.clientX));
      e.preventDefault();
      e.stopPropagation();
    });
    this.track.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.set(toValue(e.clientX));
      e.preventDefault();
      e.stopPropagation();
    });
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.el.classList.remove('dragging');
      this.onChange(this.value);
      e.stopPropagation();
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
    // Impede que o gesto vire rolagem/zoom da página no celular.
    this.track.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    this.track.addEventListener('keydown', (e) => {
      const big = this.step * 5;
      const map = {
        ArrowLeft: -this.step, ArrowDown: -this.step,
        ArrowRight: this.step, ArrowUp: this.step,
        PageDown: -big, PageUp: big,
        Home: this.min - this.value, End: this.max - this.value,
      };
      if (map[e.key] === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      this.set(this.value + map[e.key]);
      this.onChange(this.value);
    });

    el.querySelectorAll('.dial-step').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.set(this.value + this.step * Number(b.dataset.dir));
        this.onChange(this.value);
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    });

    this.render();
  }

  clamp(v) {
    const stepped = Math.round(v / this.step) * this.step;
    const fixed = Number(stepped.toFixed(6));
    return Math.max(this.min, Math.min(this.max, fixed));
  }

  /** Define o valor e dispara onInput se mudou. */
  set(v, silent = false) {
    const next = this.clamp(v);
    if (next === this.value) { this.render(); return; }
    this.value = next;
    this.render();
    if (!silent) this.onInput(next);
  }

  /** Reconfigura a faixa (ex.: ao trocar de modo). */
  configure({ min, max, step, value, format, label }) {
    if (min !== undefined) this.min = min;
    if (max !== undefined) this.max = max;
    if (step !== undefined) this.step = step;
    if (format) this.format = format;
    if (label) this.track.setAttribute('aria-label', label);
    this.value = this.clamp(value ?? this.value);
    this.render();
  }

  render() {
    const p = (this.value - this.min) / Math.max(1e-9, this.max - this.min);
    const pct = `${(p * 100).toFixed(2)}%`;
    this.fill.style.width = pct;
    this.thumb.style.left = pct;
    const text = this.format(this.value);
    this.valueEl.textContent = text;
    this.track.setAttribute('aria-valuemin', String(this.min));
    this.track.setAttribute('aria-valuemax', String(this.max));
    this.track.setAttribute('aria-valuenow', String(this.value));
    this.track.setAttribute('aria-valuetext', text);
  }
}
