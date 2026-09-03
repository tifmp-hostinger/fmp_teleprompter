// Câmera (pré-visualização atrás do texto) e gravação de vídeo com MediaRecorder.
export class CameraRig {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.recording = false;
    this.recordStart = 0;
  }

  static get supported() { return !!navigator.mediaDevices?.getUserMedia; }

  async start({ facingMode = 'user', withAudio = true } = {}) {
    if (this.stream) return this.stream;
    const constraints = {
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: withAudio ? { echoCancellation: true, noiseSuppression: true } : false,
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (withAudio && (err.name === 'NotFoundError' || err.name === 'NotAllowedError')) {
        // Sem microfone permitido: tenta só vídeo.
        this.stream = await navigator.mediaDevices.getUserMedia({ video: constraints.video });
      } else {
        throw err;
      }
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play().catch(() => {});
    return this.stream;
  }

  stop() {
    if (this.recording) this.stopRecording();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  get active() { return !!this.stream; }

  setMirror(on) { this.video.classList.toggle('mirrored', !!on); }

  static get canRecord() { return typeof MediaRecorder !== 'undefined'; }

  startRecording() {
    if (!this.stream || this.recording || !CameraRig.canRecord) return false;
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      .find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(1000);
    this.recording = true;
    this.recordStart = Date.now();
    return true;
  }

  /** Para a gravação e devolve o Blob do vídeo. */
  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recorder || !this.recording) return resolve(null);
      const rec = this.recorder;
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'video/webm' });
        this.chunks = [];
        this.recording = false;
        this.recorder = null;
        resolve(blob);
      };
      rec.stop();
    });
  }

  static download(blob, name = 'gravacao') {
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
