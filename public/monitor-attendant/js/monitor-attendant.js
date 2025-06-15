// public/monitor-attendant/js/monitor-attendant.js

/**
 * Script multi-tenant para a tela do atendente:
 * - Onboarding de tenant (empresa + senha) via Redis/Upstash
 * - Autenticação posterior (senha protegida)
 * - Reset de configuração (empresa+senha) no Redis e local
 * - Renderização de QR Code para a fila do cliente
 * - Dropdown manual com tickets disponíveis
 * - Chamadas, repetição, reset de tickets, polling de cancelados
 * - Interação QR: expandir e copiar link
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams     = new URL(location).searchParams;
  let token           = urlParams.get('t');
  let empresaParam    = urlParams.get('empresa');
  const storedConfig  = localStorage.getItem('monitorConfig');
  let cfg             = storedConfig ? JSON.parse(storedConfig) : null;

  // Se token não veio na URL mas existe em localStorage, usar
  if (!token && cfg && cfg.token) {
    token = cfg.token;
  }

  // Overlays e seções
  const onboardOverlay = document.getElementById('onboard-overlay');
  const loginOverlay   = document.getElementById('login-overlay');
  const headerEl       = document.querySelector('.header');
  const mainEl         = document.querySelector('.main');
  const bodyEl         = document.body;

  // Onboarding
  const onboardLabel    = document.getElementById('onboard-label');
  const onboardPassword = document.getElementById('onboard-password');
  const onboardSubmit   = document.getElementById('onboard-submit');
  const onboardError    = document.getElementById('onboard-error');

  // Botão Redefinir Cadastro
  const btnDeleteConfig = document.getElementById('btn-delete-config');
  btnDeleteConfig.onclick = async () => {
    if (!token) {
      alert('Nenhum monitor ativo para resetar.');
      return;
    }
    if (!confirm('Deseja realmente apagar empresa e senha do servidor?')) return;
    try {
      const res = await fetch(`${location.origin}/.netlify/functions/deleteMonitorConfig`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        localStorage.removeItem('monitorConfig');
        history.replaceState(null, '', '/monitor-attendant/');
        location.reload();
      } else {
        alert('Erro ao resetar no servidor: ' + (data.error || 'desconhecido'));
      }
    } catch (e) {
      console.error('deleteMonitorConfig falhou:', e);
      alert('Erro de conexão ao servidor.');
    }
  };

  // Elementos de UI principal
  const headerLabel    = document.getElementById('header-label');
  const attendantInput = document.getElementById('attendant-id');
  const currentCallEl  = document.getElementById('current-call');
  const currentIdEl    = document.getElementById('current-id');
  const waitingEl      = document.getElementById('waiting-count');
  const cancelListEl   = document.getElementById('cancel-list');
  const cancelThumbsEl = document.getElementById('cancel-thumbs');
  const cancelCountEl  = document.getElementById('cancel-count');
  const missedListEl   = document.getElementById('missed-list');
  const missedThumbsEl = document.getElementById('missed-thumbs');
  const missedCountEl  = document.getElementById('missed-count');
  const attendedListEl = document.getElementById('attended-list');
  const attendedThumbsEl = document.getElementById('attended-thumbs');
  const attendedCountEl  = document.getElementById('attended-count');
  const btnNext        = document.getElementById('btn-next');
  const btnRepeat      = document.getElementById('btn-repeat');
  const btnAttended    = document.getElementById('btn-attended');
  const selectManual   = document.getElementById('manual-select');
  const btnManual      = document.getElementById('btn-manual');
  const btnReset       = document.getElementById('btn-reset');
  const btnReport      = document.getElementById('btn-report');
  const reportModal    = document.getElementById('report-modal');
  const reportClose    = document.getElementById('report-close');
  const reportSummary  = document.getElementById('report-summary');
  const reportChartEl  = document.getElementById('report-chart');

  // QR Interaction setup
  const qrContainer    = document.getElementById('qrcode');
  const qrOverlay      = document.createElement('div');
  qrOverlay.id = 'qrcode-overlay';
  Object.assign(qrOverlay.style, {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.8)', display: 'none',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    padding: '1rem'
  });
  const qrOverlayContent = document.createElement('div');
  qrOverlayContent.id = 'qrcode-overlay-content';
  Object.assign(qrOverlayContent.style, {
    background: '#fff', padding: '1rem', borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)', maxWidth: '90%', maxHeight: '90%'
  });
  qrOverlay.appendChild(qrOverlayContent);
  document.body.appendChild(qrOverlay);

  let currentCallNum = 0; // último número chamado
  let ticketCounter  = 0;
  let cancelledNums  = [];
  let missedNums     = [];
  let cancelledCount = 0;
  let missedCount    = 0;
  let attendedNums   = [];
  let attendedCount  = 0;
  const fmtTime     = ts => new Date(ts).toLocaleString('pt-BR');

 /** Renderiza o QR Code e configura interação */
function renderQRCode(tId) {
  qrContainer.innerHTML = '';
  qrOverlayContent.innerHTML = '';

  const urlCliente = `${location.origin}/client/?t=${tId}&empresa=${encodeURIComponent(cfg.empresa)}`;
  new QRCode(qrContainer,     { text: urlCliente, width: 128, height: 128 });
  new QRCode(qrOverlayContent, { text: urlCliente, width: 256, height: 256 });

  qrContainer.style.cursor = 'pointer';
  qrContainer.onclick = () =>
    navigator.clipboard.writeText(urlCliente).then(() => {
      // exibe overlay do QR
      qrOverlay.style.display = 'flex';
      // inicia animação do nome da empresa quicando
      startBouncingCompanyName(cfg.empresa);
    });

  qrOverlay.onclick = e => {
    if (e.target === qrOverlay) {
      qrOverlay.style.display = 'none';
      // opcional: remover o elemento bouncing para limpar tela
      const bounceEl = document.querySelector('.bouncing-name');
      if (bounceEl) bounceEl.remove();
    }
  };
}

  
  /**
 * Inicia o texto quicando com o nome da empresa
 */
function startBouncingCompanyName(text) {
  const el = document.createElement('div');
  el.className = 'bouncing-name';
  el.textContent = text;
  document.body.appendChild(el);

  let vx = 2 + Math.random() * 3;
  let vy = 2 + Math.random() * 3;
  let x = 0, y = 0;

  function step() {
    const maxX = window.innerWidth  - el.clientWidth;
    const maxY = window.innerHeight - el.clientHeight;
    x += vx; y += vy;
    if (x < 0 || x > maxX) { vx = -vx; x = Math.max(0, Math.min(x, maxX)); }
    if (y < 0 || y > maxY) { vy = -vy; y = Math.max(0, Math.min(y, maxY)); }
    el.style.transform = `translate(${x}px, ${y}px)`;
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

  /** Atualiza chamada */
  function updateCall(num, attendantId) {
    currentCallNum = num;
    currentCallEl.textContent = num > 0 ? num : '–';
    currentIdEl.textContent   = attendantId || '';
  }

  /** Busca status e atualiza UI */
  async function fetchStatus(t) {
    try {
      const res = await fetch(`/.netlify/functions/status?t=${t}`);
      const {
        currentCall,
        ticketCounter: tc,
        cancelledNumbers = [],
        missedNumbers = [],
        attendedNumbers = [],
        cancelledCount: cc = 0,
        missedCount: mc = 0,
        attendedCount: ac = 0,
        waiting = 0,
      } = await res.json();

      currentCallNum  = currentCall;
      ticketCounter   = tc;
      cancelledNums   = cancelledNumbers.map(Number);
      missedNums      = missedNumbers.map(Number);
      attendedNums    = attendedNumbers.map(Number);
      cancelledCount  = cc || cancelledNums.length;
      missedCount     = mc || missedNums.length;
      attendedCount   = ac;

      currentCallEl.textContent = currentCall > 0 ? currentCall : '–';
      waitingEl.textContent     = waiting;

      cancelCountEl.textContent = cancelledCount;
      cancelThumbsEl.innerHTML  = '';
      cancelledNums.forEach(n => {
        const div = document.createElement('div');
        div.className = 'cancel-thumb';
        div.textContent = n;
        cancelThumbsEl.appendChild(div);
      });

      missedCountEl.textContent = missedCount;
      missedThumbsEl.innerHTML = '';
      missedNums.forEach(n => {
        const div = document.createElement('div');
        div.className = 'missed-thumb';
        div.textContent = n;
        missedThumbsEl.appendChild(div);
      });

      attendedCountEl.textContent = attendedCount;
      attendedThumbsEl.innerHTML  = '';
      attendedNums.forEach(n => {
        const div = document.createElement('div');
        div.className = 'attended-thumb';
        div.textContent = n;
        attendedThumbsEl.appendChild(div);
      });

      updateManualOptions();
    } catch (e) {
      console.error(e);
    }
  }

  /** Atualiza opções manuais */
  function updateManualOptions() {
    selectManual.innerHTML = '<option value="">Selecione...</option>';
    for (let i = currentCallNum + 1; i <= ticketCounter; i++) {
      if (cancelledNums.includes(i) || missedNums.includes(i) || attendedNums.includes(i)) continue;
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      selectManual.appendChild(opt);
    }
    selectManual.disabled = selectManual.options.length === 1;
  }

  /** Busca cancelados e popula lista */
  async function fetchCancelled(t) {
    try {
      const res = await fetch(`/.netlify/functions/cancelados?t=${t}`);
      const { cancelled = [], missed = [], missedNumbers = [] } = await res.json();

      cancelListEl.innerHTML = '';
      cancelled.forEach(({ ticket, ts, reason, duration, wait }) => {
        const li = document.createElement('li');
        const durTxt = duration ? ` (${Math.round(duration/1000)}s)` : '';
        const waitTxt = wait ? ` [${Math.round(wait/1000)}s]` : '';
        li.innerHTML = `<span>${ticket}</span><span class="ts">${fmtTime(ts)}${durTxt}${waitTxt}</span>`;
        cancelListEl.appendChild(li);
      });

      missedListEl.innerHTML = '';
      missed.forEach(({ ticket, ts, duration, wait }) => {
        const li = document.createElement('li');
        li.classList.add('missed');
        const durTxt = duration ? ` (${Math.round(duration/1000)}s)` : '';
        const waitTxt = wait ? ` [${Math.round(wait/1000)}s]` : '';
        li.innerHTML = `<span>${ticket}</span><span class="ts">${fmtTime(ts)}${durTxt}${waitTxt}</span>`;
        missedListEl.appendChild(li);
      });
    } catch (e) {
      console.error('Erro ao buscar cancelados:', e);
    }
  }

  /** Busca atendidos e popula lista */
  async function fetchAttended(t) {
    try {
      const res = await fetch(`/.netlify/functions/atendidos?t=${t}`);
      const { attended = [] } = await res.json();

      attendedListEl.innerHTML = '';
      attended.forEach(({ ticket, ts, duration, wait }) => {
        const li = document.createElement('li');
        li.classList.add('attended');
        const durTxt = duration ? ` (${Math.round(duration/1000)}s)` : '';
        const waitTxt = wait ? ` [${Math.round(wait/1000)}s]` : '';
        li.innerHTML = `<span>${ticket}</span><span class="ts">${fmtTime(ts)}${durTxt}${waitTxt}</span>`;
        attendedListEl.appendChild(li);
      });
    } catch (e) {
      console.error('Erro ao buscar atendidos:', e);
    }
  }

  function refreshAll(t) {
    fetchStatus(t).then(() => { fetchCancelled(t); fetchAttended(t); });
  }

  async function openReport(t) {
    reportModal.hidden = false;
    reportSummary.innerHTML = '';
    if (!t) {
      reportSummary.innerHTML = '<p>Token inválido ou ausente.</p>';
      return;
    }
    let tickets = [];
    let summary = {};
    try {
      const res = await fetch(`/.netlify/functions/report?t=${t}`);
      if (!res.ok) {
        const text = await res.text();
        reportSummary.innerHTML = `<p>Erro ao gerar relatório: ${text}</p>`;
        return;
      }
      ({ tickets = [], summary = {} } = await res.json());
    } catch (err) {
      console.error('fetch report error', err);
      reportSummary.innerHTML = '<p>Erro de conexão ao gerar relatório.</p>';
      return;
    }

    const {
      totalTickets = 0,
      attendedCount = 0,
      cancelledCount = 0,
      missedCount = 0,
      waitingCount = 0,
      avgWait = 0,
      avgDur = 0
    } = summary;

    if (!tickets.length &&
        !totalTickets &&
        !attendedCount &&
        !cancelledCount &&
        !missedCount &&
        !waitingCount) {
      reportSummary.innerHTML = '<p>Nenhum dado encontrado.</p>';
    } else {
      reportSummary.innerHTML = `
        <p>Total de tickets: ${totalTickets}</p>
        <p>Atendidos: ${attendedCount}</p>
        <p>Tempo médio de espera: ${Math.round(avgWait/1000)}s</p>
        <p>Tempo médio de atendimento: ${Math.round(avgDur/1000)}s</p>
        <p>Cancelados: ${cancelledCount}</p>
        <p>Perderam a vez: ${missedCount}</p>
        <p>Em espera: ${waitingCount}</p>`;
    }

    // Monta tabela
    const table = document.getElementById('report-table');
    table.innerHTML = '<thead><tr><th>Ticket</th><th>Status</th><th>Entrada</th><th>Chamada</th><th>Atendido</th><th>Cancelado</th><th>Espera(s)</th><th>Duração(s)</th></tr></thead>';
    const tbody = document.createElement('tbody');
    const fmt = ts => ts ? new Date(ts).toLocaleString('pt-BR') : '-';
    const label = (st) => ({
      attended: 'Atendido',
      cancelled: 'Cancelado',
      missed: 'Perdeu a vez',
      called: 'Chamado',
      waiting: 'Em espera'
    })[st] || '';
    tickets.forEach(tk => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${tk.ticket}</td>
        <td>${label(tk.status)}</td>
        <td>${tk.enteredBr || fmt(tk.entered)}</td>
        <td>${tk.calledBr || fmt(tk.called)}</td>
        <td>${tk.attendedBr || fmt(tk.attended)}</td>
        <td>${tk.cancelledBr || fmt(tk.cancelled)}</td>
        <td>${tk.wait ? Math.round(tk.wait/1000) : '-'}</td>
        <td>${tk.duration ? Math.round(tk.duration/1000) : '-'}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const byHour = {};
    tickets.forEach(c => { if (c.called) { const h = new Date(c.called).getHours(); byHour[h] = (byHour[h] || 0) + 1; }});
    const labels = Object.keys(byHour).sort((a,b)=>a-b);
    const data = labels.map(h => byHour[h]);
    const ctx = reportChartEl.getContext('2d');
    if (window.reportChart) window.reportChart.destroy();
    window.reportChart = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{ label:'Chamadas/hora', data, backgroundColor:'#0077cc'}] } });

    document.getElementById('export-csv').onclick = () => {
      const rows = [['ticket','status','entered','called','attended','cancelled','wait_ms','duration_ms']];
      if (tickets.length) {
        tickets.forEach(tk => rows.push([
          tk.ticket,
          tk.status,
          tk.enteredBr || fmt(tk.entered) || '',
          tk.calledBr || fmt(tk.called) || '',
          tk.attendedBr || fmt(tk.attended) || '',
          tk.cancelledBr || fmt(tk.cancelled) || '',
          tk.wait || '',
          tk.duration || ''
        ]));
      } else {
        rows.push(['', '', '', attendedCount, cancelledCount, 'missed:'+missedCount, '', '']);
        rows.push(['', '', '', '', '', 'waiting:'+waitingCount, '', '']);
      }
      const csv = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type:'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'relatorio.csv'; link.click();
    };

    document.getElementById('export-pdf').onclick = () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.text('Relatório', 10, 10);
      doc.text(`Total de tickets: ${totalTickets}`, 10, 20);
      doc.text(`Atendidos: ${attendedCount}`, 10, 30);
      doc.text(`Tempo médio de espera: ${Math.round(avgWait/1000)}s`, 10, 40);
      doc.text(`Tempo médio de atendimento: ${Math.round(avgDur/1000)}s`, 10, 50);
      doc.text(`Cancelados: ${cancelledCount}`, 10, 60);
      doc.text(`Perderam a vez: ${missedCount}`, 10, 70);
      doc.text(`Em espera: ${waitingCount}`, 10, 80);
      if (tickets.length) doc.text('Detalhes em anexo', 10, 90);
      doc.save('relatorio.pdf');
    };

    reportClose.onclick = () => { reportModal.hidden = true; };
  }

  /** Inicializa botões e polling */
  function initApp(t) {
    btnNext.onclick = async () => {
      const id = attendantInput.value.trim();
      let url = `/.netlify/functions/chamar?t=${t}`;
      if (id) url += `&id=${encodeURIComponent(id)}`;
      const { called, attendant } = await (await fetch(url)).json();
      updateCall(called, attendant);
      refreshAll(t);
    };
    btnRepeat.onclick = async () => {
      const { called, attendant } = await (await fetch(`/.netlify/functions/chamar?t=${t}&num=${currentCallNum}`)).json();
      updateCall(called, attendant);
      refreshAll(t);
    };
    btnAttended.onclick = async () => {
      if (!currentCallNum) return;
      await fetch(`/.netlify/functions/atendido?t=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: currentCallNum })
      });
      refreshAll(t);
    };
    btnManual.onclick = async () => {
      const num = Number(selectManual.value);
      if (!num) return;
      const { called, attendant } = await (await fetch(`/.netlify/functions/chamar?t=${t}&num=${num}`)).json();
      updateCall(called, attendant);
      refreshAll(t);
    };
    btnReset.onclick = async () => {
      if (!confirm('Confirma resetar todos os tickets para 1?')) return;
      await fetch(`/.netlify/functions/reset?t=${t}`, { method: 'POST' });
      updateCall(0, '');
      refreshAll(t);
    };
    btnReport.onclick = () => openReport(t);
    renderQRCode(t);
    refreshAll(t);
    setInterval(() => refreshAll(t), 5000);
  }

  /** Exibe a interface principal após autenticação */
  function showApp(label, tId) {
    onboardOverlay.hidden = true;
    loginOverlay.hidden   = true;
    headerEl.hidden       = false;
    mainEl.hidden         = false;
    bodyEl.classList.add('authenticated');
    headerLabel.textContent = label;
    initApp(tId);
  }

  // ■■■ Fluxo de Autenticação / Trial ■■■
  (async () => {
    // 1) Se já temos cfg em localStorage, pular direto
    if (cfg && cfg.empresa && cfg.senha && token) {
      showApp(cfg.empresa, token);
      return;
    }

    // 2) Se vier ?t e ?empresa na URL, pede só senha
    if (token && empresaParam) {
      loginOverlay.hidden   = true;
      onboardOverlay.hidden = true;
      try {
        const senhaPrompt = prompt(`Digite a senha de acesso para a empresa ${empresaParam}:`);
        const res = await fetch(`${location.origin}/.netlify/functions/getMonitorConfig`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token, senha: senhaPrompt })
        });
        if (!res.ok) throw new Error();
        const { empresa } = await res.json();
        cfg = { token, empresa, senha: senhaPrompt };
        localStorage.setItem('monitorConfig', JSON.stringify(cfg));
        history.replaceState(null, '', `/monitor-attendant/?empresa=${encodeURIComponent(empresaParam)}`);
        showApp(empresa, token);
        return;
      } catch {
        alert('Token ou senha inválidos.');
        history.replaceState(null, '', '/monitor-attendant/');
      }
    }

    // 3) Senão, exibir onboarding para trial
    onboardOverlay.hidden = false;
    loginOverlay.hidden   = true;

    onboardSubmit.onclick = async () => {
      const label = onboardLabel.value.trim();
      const pw    = onboardPassword.value;
      if (!label || !pw) {
        onboardError.textContent = 'Preencha nome e senha.';
        return;
      }
      onboardError.textContent = '';
      try {
        token = crypto.randomUUID().split('-')[0];
        const trialDays = 7;
        const res = await fetch(`${location.origin}/.netlify/functions/saveMonitorConfig`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token, empresa: label, senha: pw, trialDays })
        });
        const { ok } = await res.json();
        if (!ok) throw new Error();
        cfg = { token, empresa: label, senha: pw };
        localStorage.setItem('monitorConfig', JSON.stringify(cfg));
        history.replaceState(null, '', `/monitor-attendant/?t=${token}&empresa=${encodeURIComponent(label)}`);
        showApp(label, token);
      } catch (e) {
        console.error(e);
        onboardError.textContent = 'Erro ao criar monitor.';
      }
    };
  })();
});
// ================================
  // Feedback de clique: ripple effect
  // ================================
  document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const ripple = document.createElement('span');
      ripple.classList.add('ripple');
      this.appendChild(ripple);

      const size = Math.max(this.clientWidth, this.clientHeight);
      ripple.style.width = ripple.style.height = size + 'px';

      const rect = this.getBoundingClientRect();
      ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
      ripple.style.top  = (e.clientY - rect.top  - size/2) + 'px';

      setTimeout(() => ripple.remove(), 600);
    });
  });
