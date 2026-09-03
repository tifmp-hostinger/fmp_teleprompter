// Controle remoto: outro dispositivo (celular) controla o teleprompter.
// Transporte 1: PeerJS (WebRTC) quando `window.Peer` estiver carregado e houver internet.
// Transporte 2: BroadcastChannel (outra aba/janela do mesmo navegador) — sempre ativo.
const CHANNEL = 'fmp-tp-remote';
const PEER_PREFIX = 'fmp-tp-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 6) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export class RemoteHost {
  /** @param {{onCommand: (cmd: object) => void, onClients?: (n:number)=>void}} opts */
  constructor(opts) {
    this.opts = opts;
    this.code = randomCode();
    this.conns = new Set();
    this.peer = null;
    this.bc = null;
    this.online = false;
  }

  async start() {
    // BroadcastChannel (mesmo navegador)
    if (typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel(CHANNEL);
      this.bc.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.code !== this.code) return;
        if (msg.type === 'cmd') this.opts.onCommand(msg.cmd);
        if (msg.type === 'hello') this.bc.postMessage({ type: 'welcome', code: this.code });
      };
    }
    // PeerJS (outro dispositivo)
    if (typeof window.Peer === 'function' && navigator.onLine) {
      await new Promise((resolve) => {
        try {
          this.peer = new window.Peer(PEER_PREFIX + this.code, { debug: 0 });
        } catch { return resolve(); }
        const done = () => resolve();
        this.peer.on('open', () => { this.online = true; done(); });
        this.peer.on('error', (err) => {
          if (err?.type === 'unavailable-id') {
            this.code = randomCode();
            this.peer.destroy();
            this.peer = null;
            this.start().then(done);
            return;
          }
          this.online = false;
          done();
        });
        this.peer.on('connection', (conn) => {
          conn.on('open', () => {
            this.conns.add(conn);
            this.opts.onClients?.(this.conns.size);
            if (this._lastState) conn.send({ type: 'state', state: this._lastState });
          });
          conn.on('data', (msg) => { if (msg?.type === 'cmd') this.opts.onCommand(msg.cmd); });
          const drop = () => { this.conns.delete(conn); this.opts.onClients?.(this.conns.size); };
          conn.on('close', drop);
          conn.on('error', drop);
        });
        setTimeout(done, 6000);
      });
    }
    return { code: this.code, online: this.online, url: this.remoteUrl() };
  }

  remoteUrl() {
    const u = new URL('remote.html', location.href);
    u.searchParams.set('code', this.code);
    return u.toString();
  }

  sendState(state) {
    this._lastState = state;
    const msg = { type: 'state', code: this.code, state };
    this.bc?.postMessage(msg);
    for (const c of this.conns) { try { c.send(msg); } catch { /* ignore */ } }
  }

  stop() {
    this.bc?.close();
    this.bc = null;
    for (const c of this.conns) { try { c.close(); } catch { /* ignore */ } }
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

export class RemoteClient {
  /** @param {string} code @param {{onState: Function, onOpen: Function, onClose: Function, onError?: Function}} opts */
  constructor(code, opts) {
    this.code = normalizeCode(code);
    this.opts = opts;
    this.conn = null;
    this.peer = null;
    this.bc = null;
    this.viaBc = false;
    this.opened = false;
  }

  connect() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel(CHANNEL);
      this.bc.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.code !== this.code) return;
        if (msg.type === 'welcome' && !this.opened) { this.viaBc = true; this._open(); }
        if (msg.type === 'state') { if (!this.opened) { this.viaBc = true; this._open(); } this.opts.onState(msg.state); }
      };
      this.bc.postMessage({ type: 'hello', code: this.code });
    }
    if (typeof window.Peer === 'function' && navigator.onLine) {
      this.peer = new window.Peer({ debug: 0 });
      this.peer.on('open', () => {
        this.conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
        this.conn.on('open', () => this._open());
        this.conn.on('data', (msg) => { if (msg?.type === 'state') this.opts.onState(msg.state); });
        this.conn.on('close', () => { this.opened = false; this.opts.onClose(); });
        this.conn.on('error', (e) => this.opts.onError?.(e));
      });
      this.peer.on('error', (err) => {
        if (err?.type === 'peer-unavailable') {
          // Dá tempo ao BroadcastChannel responder antes de reportar erro.
          setTimeout(() => { if (!this.opened) this.opts.onError?.(err); }, 800);
        } else this.opts.onError?.(err);
      });
    } else {
      setTimeout(() => { if (!this.opened) this.opts.onError?.({ type: 'peer-unavailable' }); }, 1500);
    }
  }

  _open() {
    if (this.opened) return;
    this.opened = true;
    this.opts.onOpen();
  }

  send(cmd) {
    const msg = { type: 'cmd', code: this.code, cmd };
    this.bc?.postMessage(msg);
    if (this.conn?.open) this.conn.send(msg);
  }

  close() {
    this.bc?.close();
    this.conn?.close();
    this.peer?.destroy();
  }
}
