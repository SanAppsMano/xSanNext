class SoundEngine {
  constructor({ ttsLang = 'pt-BR' } = {}) {
    this.ttsLang = ttsLang;
    this.ctx = null;              // AudioContext (WebAudio)
    this.wakeLock = null;
    this.queue = Promise.resolve(); // fila para serializar ALERTA->FALA
    this.lastCallId = null;
    this._wireVoices();
    this._visWakeLock();
  }

  // Cria/retoma o AudioContext e dá um ping curto para “desbloquear”
  async unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      // ping curto inaudível/baixo para liberar autoplay
      await this._beep({ duration: 0.05, gain: 0.001, freq: 440 });
    } catch(e) {}
    try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch(e) {}
  }

  _wireVoices() {
    const load = () => speechSynthesis.getVoices();
    load();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.onvoiceschanged = load;
    }
  }

  // Gera um beep por WebAudio (sem arquivos)
  async _beep({ duration = 0.15, freq = 880, type = 'sine', gain = 0.2 } = {}) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    // Envelope simples (fade in/out) para evitar “click”
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.linearRampToValueAtTime(0.0001, now + duration);

    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);

    return new Promise(res => osc.onended = res);
  }

  // Alerta composto (ex.: dois bipes curtos + um agudo)
  async _playAlertPattern() {
    // padrão: beep-beep (700Hz, 100ms) e um agudo rápido (1200Hz, 90ms)
    await this._beep({ duration: 0.10, freq: 700, type: 'sine', gain: 0.2 });
    await this._sleep(60);
    await this._beep({ duration: 0.10, freq: 700, type: 'sine', gain: 0.2 });
    await this._sleep(60);
    await this._beep({ duration: 0.09, freq: 1200, type: 'triangle', gain: 0.18 });
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _speak(text) {
    try { speechSynthesis.cancel(); } catch(e) {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.ttsLang;
    u.rate = 1;
    u.pitch = 1;
    return new Promise(resolve => {
      u.onerror = resolve;
      u.onend = resolve;
      try { speechSynthesis.speak(u); } catch(e) { resolve(); }
    });
  }

  _phraseFromPayload(p) {
    const num = p?.numero ?? p?.ticket ?? p?.senha ?? '';
    const g   = p?.guiche ?? p?.counter ?? p?.desk  ?? '';
    return `Senha ${num}. Guichê ${g}.`;
  }

  async onCall(payload) {
    // debounçar duplicados
    const id = payload?.id ?? `${payload?.numero}|${payload?.guiche}|${payload?.ts||''}`;
    if (id && id === this.lastCallId) return;
    this.lastCallId = id;

    const phrase = this._phraseFromPayload(payload);

    // Enfileira: ALERTA -> FALA (sem sobreposição)
    this.queue = this.queue.then(async () => {
      await this._playAlertPattern();
      await this._speak(phrase);
    });
    return this.queue;
  }

  async enableWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {});
      } else {
        // Fallback sem binários: manter atividade mínima periódica
        this._keepAwakeFallback();
      }
    } catch(e) {}
  }

  _keepAwakeFallback() {
    // Estratégia: a cada 30s, se a aba estiver visível, faz um no-op de áudio curto
    if (this._awakeTimer) return;
    this._awakeTimer = setInterval(async () => {
      if (document.visibilityState === 'visible') {
        try {
          await this._beep({ duration: 0.02, freq: 40, gain: 0.0005 }); // inaudível na prática
        } catch(e) {}
      }
    }, 30000);
  }

  _visWakeLock() {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        try {
          if (this.wakeLock && 'wakeLock' in navigator) {
            this.wakeLock = await navigator.wakeLock.request('screen');
          }
        } catch(e) {}
        try { if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume(); } catch(e) {}
        try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch(e) {}
      }
    });
  }
}
