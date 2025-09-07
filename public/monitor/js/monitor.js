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

  // --- UI helpers para o "tipo" ---
  const typeBox  = document.querySelector('[data-role="ticket-type-box"]');
  const typeText = document.querySelector('[data-role="ticket-type-text"]');

  function hideTicketType() {
    if (typeText) typeText.textContent = '';
    if (typeBox) typeBox.classList.add('hidden');
  }

  function showTicketType(label) {
    if (!typeBox || !typeText) return;
    typeText.textContent = (label || '').trim();
    if (!typeText.textContent) return hideTicketType();
    typeBox.classList.remove('hidden');
  }

  function renderTicketTypeFromPayload(payload) {
    const num = (payload?.numero ?? payload?.ticket ?? payload?.senha ?? '').toString().trim();
    if (!num) return hideTicketType();
    const isPref = !!(payload?.preferencial ?? payload?.preferential ?? payload?.isPreferential ?? payload?.priority);
    const label  = isPref ? 'Preferencial' : 'Normal';
    showTicketType(label);
  }


  function onIdleOrEmpty() {
    hideTicketType();
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
        renderTicketTypeFromPayload(current);
        se.onCall({
          numero: current.numero,
          guiche: current.guiche,
          guicheLabel: current.guiche,
          name: current.nome,
          preferencial: current.tipo === 'Preferencial'
        });
      } else {
        onIdleOrEmpty();
      }
    } catch (e) {
      console.error(e);
      state.estado = 'error';
      onIdleOrEmpty();
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

  if (window.channel && typeof window.channel.subscribe === 'function') {
    window.channel.subscribe('call', (payload) => {
      renderTicketTypeFromPayload?.(payload);
      se.onCall(payload);
    });
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
    }
  });
})();
