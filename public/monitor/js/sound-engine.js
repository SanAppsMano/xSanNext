class SoundEngine {
  constructor({ ttsLang = 'pt-BR' } = {}) {
    this.ttsLang = ttsLang;
    this.ctx = null;              // AudioContext (WebAudio)
    this.wakeLock = null;
    this.queue = Promise.resolve(); // fila para serializar ALERTA->FALA
    this.lastNormalKey = null;   // dedupe apenas para chamadas normais
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

  _phraseForSpeak(p) {
    const parts = [];

    // 1) Senha
    const num = (p?.numero ?? p?.ticket ?? p?.senha ?? '').toString().trim();
    if (num) parts.push(`Senha ${num}.`);

    // 2) Preferencial (se for)
    const isPref = !!(p?.preferencial ?? p?.preferential ?? p?.isPreferential ?? p?.priority);
    if (isPref) parts.push('Preferencial.');

    // 3) Identificador (texto cru, sem prefixo “Guichê”)
    const ident =
      (p?.guicheLabel ?? p?.identificador ?? p?.identifier ?? p?.counterLabel ?? '')
      .toString().trim();
    if (ident) parts.push(`${ident}.`);

    // 4) Nome (se houver)
    const name = (p?.name ?? p?.nome ?? '').toString().trim();
    if (name) parts.push(`${name}.`);

    return parts.join(' ');
  }

  _normalKey(p) {
    // chave de identidade para chamadas normais (ignora identificador/nome)
    const num = (p?.numero ?? p?.ticket ?? p?.senha ?? '').toString().trim();
    const g   = (p?.guiche ?? '').toString().trim();
    const pref= !!(p?.preferencial ?? p?.preferential ?? p?.isPreferential ?? p?.priority);
    return `${num}|${g}|${pref}`;
  }

  async onCall(payload) {
    const key = this._normalKey(payload);
    if (key && key === this.lastNormalKey) return;
    this.lastNormalKey = key;
    const phrase = this._phraseForSpeak(payload);
    this.queue = this.queue.then(async () => {
      await this._playAlertPattern();
      if (phrase) await this._speak(phrase);
    });
    return this.queue;
  }

  async onRepeat(payload) {
    const phrase = this._phraseForSpeak(payload);
    this.queue = this.queue.then(async () => {
      await this._playAlertPattern();
      if (phrase) await this._speak(phrase);
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
