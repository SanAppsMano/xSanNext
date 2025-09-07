(() => {
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || localStorage.getItem('monitor:view') || 'tv';
  localStorage.setItem('monitor:view', view);
  document.body.classList.add(view === 'mobile' ? 'view-mobile' : 'view-tv');
  if (view === 'tv') document.getElementById('app').classList.add('view-tv-root');

  const tenantId = params.get('t') || '';
  const state = {
    empresa: document.querySelector('#app').dataset.company || params.get('empresa') || 'Casa de Saúde',
    dados: null,
    estado: 'loading'
  };
  const alertAudio = document.getElementById('alert-audio');
  alertAudio.src = '/sounds/alert.mp3';
  alertAudio.preload = 'auto';

  let lastCallId = null;
  let wakeLock = null;
  let noSleep = null;

  function unlockAudioAndTTS() {
    alertAudio.volume = 0.01;
    alertAudio.play().then(() => {
      setTimeout(() => {
        alertAudio.pause();
        alertAudio.currentTime = 0;
      }, 50);
    }).catch(() => {});
    try {
      if (speechSynthesis.paused) speechSynthesis.resume();
    } catch (e) {}
    removeUnlockListeners();
  }

  function addUnlockListeners() {
    window.addEventListener('pointerdown', unlockAudioAndTTS);
    window.addEventListener('keydown', unlockAudioAndTTS);
  }

  function removeUnlockListeners() {
    window.removeEventListener('pointerdown', unlockAudioAndTTS);
    window.removeEventListener('keydown', unlockAudioAndTTS);
    const btn = document.getElementById('btn-ativar-som');
    if (btn) btn.remove();
  }

  addUnlockListeners();
  document.getElementById('btn-ativar-som')?.addEventListener('click', unlockAudioAndTTS);

  async function requestWakeLock() {
    if (view !== 'mobile') return;
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible' && !wakeLock) {
            try {
              wakeLock = await navigator.wakeLock.request('screen');
            } catch (e) {}
          }
        });
      } else if (window.NoSleep) {
        if (!noSleep) noSleep = new NoSleep();
        noSleep.enable();
      }
    } catch (e) {
      console.error('wakeLock', e);
    }
  }
  if (view === 'mobile') requestWakeLock();

  function speakText(text, lang = 'pt-BR', rate = 1, pitch = 1) {
    try { speechSynthesis.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = rate; u.pitch = pitch;
    return new Promise(resolve => {
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }

  function waitForAudioEnd(audio) {
    return new Promise(res => {
      if (audio.ended || audio.paused) return res();
      audio.onended = () => res();
    });
  }

  async function playAlertThenSpeak(text) {
    try {
      alertAudio.pause();
      alertAudio.currentTime = 0;
      alertAudio.volume = 1;
      await alertAudio.play();
    } catch (err) {
      try { speechSynthesis.resume(); } catch (e) {}
      try { await alertAudio.play(); } catch (e2) {}
    }
    await waitForAudioEnd(alertAudio);
    await speakText(text);
  }

  function montarFrase(payload) {
    const num = payload?.numero ?? payload?.ticket ?? payload?.senha ?? '';
    const guiche = payload?.guiche ?? payload?.counter ?? payload?.desk ?? '';
    return `Senha ${num}. Guichê ${guiche}.`;
  }

  async function onCallReceived(payload) {
    if (!payload?.numero || !payload?.guiche) return;
    const texto = montarFrase(payload);
    await playAlertThenSpeak(texto);
  }

  async function fetchEstado() {
    try {
      const res = await fetch(`/.netlify/functions/status${tenantId ? `?t=${tenantId}` : ''}`);
      const data = await res.json();
      state.dados = transformStatus(data);
      state.estado = (state.dados.contadores.fila > 0 || state.dados.ticketAtual.numero)
        ? 'active'
        : 'empty';
      const current = state.dados.ticketAtual;
      if (current.numero) {
        const id = `${current.numero}|${current.guiche}`;
        if (id !== lastCallId) {
          lastCallId = id;
          onCallReceived(current);
        }
      }
    } catch (e) {
      console.error(e);
      state.estado = 'error';
    }
    render();
  }

  function transformStatus(data) {
    const cancel = new Set(data.cancelledNumbers || []);
    const missed = new Set(data.missedNumbers || []);
    const attended = new Set(data.attendedNumbers || []);
    const skipped = new Set(data.skippedNumbers || []);
    const offHours = new Set(data.offHoursNumbers || []);
    const priority = new Set(data.priorityNumbers || []);
    const names = data.names || {};

    const waiting = [];
    for (let i = data.callCounter + 1; i <= data.ticketCounter; i++) {
      if (
        i !== data.currentCall &&
        !cancel.has(i) &&
        !missed.has(i) &&
        !attended.has(i) &&
        !skipped.has(i) &&
        !offHours.has(i)
      ) {
        waiting.push(i);
      }
    }
    const waitingPriority = waiting.filter(n => priority.has(n)).length;
    const waitingNormal = waiting.length - waitingPriority;

    return {
      ticketAtual: {
        numero: data.currentCall || 0,
        tipo: priority.has(data.currentCall) ? 'Preferencial' : 'Normal',
        guiche: data.attendant || '',
        nome: names[data.currentCall] || '',
        setor: ''
      },
      proximos: waiting.slice(0,5).map(n => ({
        numero: n,
        tipo: priority.has(n) ? 'Preferencial' : 'Normal'
      })),
      contadores: {
        fila: waiting.length,
        normal: waitingNormal,
        preferencial: waitingPriority
      }
    };
  }

  function render() {
    if (view === 'mobile') renderMobile();
    else renderTv();
  }

  function renderMobile() {
    const app = document.getElementById('app');
    const d = state.dados;
    if (!d) {
      app.innerHTML = '<div class="state-overlay">Carregando...</div>';
      return;
    }
    app.innerHTML = `
      <div class="mobile-card">
        <div class="empresa">${state.empresa}</div>
        <div class="label">Chamando</div>
        <div class="numero ${d.ticketAtual.tipo === 'Preferencial' ? 'preferencial' : 'normal'}">${d.ticketAtual.numero || '–'}</div>
        ${d.ticketAtual.tipo === 'Preferencial' ? '<div class="badge">Preferencial</div>' : ''}
        ${d.ticketAtual.nome ? `<div class="nome">${d.ticketAtual.nome}</div>` : ''}
        ${d.ticketAtual.setor ? `<div class="setor">${d.ticketAtual.setor}</div>` : ''}
      </div>
    `;
    if (state.estado !== 'active') {
      const msg = state.estado === 'empty' ? 'Sem tickets na fila' : 'Erro ao carregar';
      const overlay = document.createElement('div');
      overlay.className = 'state-overlay';
      overlay.textContent = msg;
      app.appendChild(overlay);
    }
  }

  let clockInterval = null;
  function startClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    clearInterval(clockInterval);
    const update = () => {
      el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };
    update();
    clockInterval = setInterval(update, 1000);
  }

  function renderTv() {
    const app = document.getElementById('app');
    const d = state.dados;
    if (!d) {
      app.innerHTML = '<div class="state-overlay">Carregando...</div>';
      return;
    }
    app.innerHTML = `
      <header class="tv-header">
        <div class="logo"><img src="/img/icon-sannext.png" alt="SanNext"></div>
        <div class="company-name">${state.empresa}</div>
      </header>
      <div class="tv-main">
        <section class="tv-chamando">
          <div class="guiche">${d.ticketAtual.guiche}</div>
          <div class="numero ${d.ticketAtual.tipo === 'Preferencial' ? 'preferencial' : 'normal'}">${d.ticketAtual.numero || '–'}</div>
          <div class="pill">${d.ticketAtual.tipo}</div>
          ${d.ticketAtual.nome ? `<div class="nome">${d.ticketAtual.nome}</div>` : ''}
          ${d.ticketAtual.setor ? `<div class="setor">${d.ticketAtual.setor}</div>` : ''}
        </section>
        <aside class="tv-proximos">
          <h2>Próximos</h2>
          <ul>
            ${d.proximos.map(p => `<li><span class="num ${p.tipo === 'Preferencial' ? 'preferencial' : 'normal'}">${p.numero}</span><span>${p.tipo === 'Preferencial' ? 'P' : 'N'}</span></li>`).join('')}
          </ul>
        </aside>
      </div>
      <footer class="tv-footer">
        <div>Na fila: ${d.contadores.fila}</div>
        <div>Normais: ${d.contadores.normal}</div>
        <div>Preferenciais: ${d.contadores.preferencial}</div>
        <div class="clock" id="clock"></div>
      </footer>
    `;
    startClock();
    if (state.estado !== 'active') {
      const msg = state.estado === 'empty' ? 'Sem tickets na fila' : 'Erro ao carregar';
      const overlay = document.createElement('div');
      overlay.className = 'state-overlay';
      overlay.textContent = msg;
      app.appendChild(overlay);
    }
  }

  fetchEstado();
  let interval = setInterval(fetchEstado, view === 'mobile' ? 15000 : 4000);
  document.addEventListener('visibilitychange', () => {
    if (view === 'tv') {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        fetchEstado();
        clearInterval(interval);
        interval = setInterval(fetchEstado, 4000);
      }
    } else if (view === 'mobile' && !document.hidden) {
      requestWakeLock();
    }
  });
})();
