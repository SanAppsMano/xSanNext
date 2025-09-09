// public/monitor-attendant/js/monitor-attendant.js

/**
 * Script multi-tenant para a tela do atendente:
 * - Onboarding de tenant (empresa + senha) via Redis/Upstash
 * - Autenticação posterior (senha protegida)
 * - Reset de configuração (empresa+senha) no Redis e local
 * - Renderização de QR Code para a fila do cliente
 * - Chamadas, repetição, reset de tickets, polling de cancelados
 * - Interação QR: expandir e copiar link
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams     = new URL(location).searchParams;
  let token           = urlParams.get('t');
  let empresaParam    = urlParams.get('empresa');
  let senhaParam      = urlParams.get('senha');
  let attParam        = urlParams.get('a');
  let cloneId         = sessionStorage.getItem('cloneId');
  if (!cloneId) {
    cloneId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + Math.random());
    sessionStorage.setItem('cloneId', cloneId);
  }
  const cloneSeqKey   = `cloneSeq_${cloneId}`;
  const isCloneParam  = urlParams.get('clone') === '1';
  let cloneSeq        = null;
  if (isCloneParam) {
    cloneSeq = urlParams.get('n') || localStorage.getItem(cloneSeqKey);
    if (cloneSeq) localStorage.setItem(cloneSeqKey, cloneSeq);
  }
  const isClone       = isCloneParam;
  const storedConfig  = localStorage.getItem('monitorConfig');
  let cfg             = storedConfig ? JSON.parse(storedConfig) : null;
  if (cfg && typeof cfg.preferentialDesk === 'undefined') {
    cfg.preferentialDesk = true;
    localStorage.setItem('monitorConfig', JSON.stringify(cfg));
  }
  let logoutVersion   = localStorage.getItem('logoutVersion');
  logoutVersion       = logoutVersion !== null ? Number(logoutVersion) : null;

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
  const onboardLogin    = document.getElementById('onboard-login');
  const onboardError    = document.getElementById('onboard-error');
  const scheduleDays    = document.querySelectorAll('input[name="work-day"]');
  const use1Checkbox    = document.getElementById('use1');
  const start1Input     = document.getElementById('start1');
  const end1Input       = document.getElementById('end1');
  const use2Checkbox    = document.getElementById('use2');
  const start2Input     = document.getElementById('start2');
  const end2Input       = document.getElementById('end2');

  function toggleInterval(cb, start, end) {
    const sync = () => {
      const enabled = cb.checked;
      start.disabled = end.disabled = !enabled;
    };
    cb.addEventListener('change', sync);
    sync();
  }

  toggleInterval(use1Checkbox, start1Input, end1Input);
  toggleInterval(use2Checkbox, start2Input, end2Input);

  const loginCompany  = document.getElementById('login-company');
  const loginPassword = document.getElementById('login-password');
  const loginSubmit   = document.getElementById('login-submit');
  const loginError    = document.getElementById('login-error');

  // Botão Redefinir Cadastro
  const btnDeleteConfig = document.getElementById('btn-delete-config');
  btnDeleteConfig.onclick = async () => {
    if (!token) {
      alert('Nenhum monitor ativo para resetar.');
      return;
    }
    if (!confirm('Deseja realmente apagar empresa e senha do servidor? Todos os links e dados da fila serão invalidados.')) return;
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

  // Pré-preenche campos de empresa e cabeçalho quando "empresa" vier na URL
  if (empresaParam) {
    loginCompany.value   = empresaParam;
    onboardLabel.value   = empresaParam;
    headerLabel.textContent = empresaParam;
  }

  const attendantInput = document.getElementById('attendant-id');
  if (attParam) {
    attendantInput.value = attParam;
  }
  const callingEl      = document.getElementById('calling');
  const currentIdEl    = document.getElementById('current-id');
  const qTotalEl       = document.getElementById('qTotal');
  const qNormEl        = document.getElementById('qNorm');
  const qPrefEl        = document.getElementById('qPref');
  const cancelListEl   = document.getElementById('cancel-list');
  const cancelThumbsEl = document.getElementById('cancel-thumbs');
  const cancelCountEl  = document.getElementById('cancel-count');
  const missedListEl   = document.getElementById('missed-list');
  const missedThumbsEl = document.getElementById('missed-thumbs');
  const missedCountEl  = document.getElementById('missed-count');
  const attendedListEl = document.getElementById('attended-list');
  const attendedThumbsEl = document.getElementById('attended-thumbs');
  const attendedCountEl  = document.getElementById('attended-count');
  const cancelPanel   = cancelListEl.closest('section');
  const missedPanel   = missedListEl.closest('section');
  const attendedPanel = attendedListEl.closest('section');
  const queueListEl    = document.getElementById('queue-list');
  const btnNext        = document.getElementById('btn-next');
  const btnNextPref    = document.getElementById('btn-next-pref');
  const btnRepeat      = document.getElementById('btn-repeat');
  const btnDone        = document.getElementById('btn-done');
  const btnTicket      = document.getElementById('btn-ticket');
  const btnTicketPref  = document.getElementById('btn-ticket-pref');
  const btnReset       = document.getElementById('btn-reset');
  const btnReport      = document.getElementById('btn-report');
  const btnView        = document.getElementById('btn-view-monitor');
  const btnEditSchedule= document.getElementById('btn-edit-schedule');
  const btnClone       = document.getElementById('btn-clone');
  const btnChangePw    = document.getElementById('btn-change-password');
  const adminToggle    = document.getElementById('admin-toggle');
  const adminPanel     = document.getElementById('admin-panel');
  const cloneListEl    = document.getElementById('clone-list');
  const nextTicketInput= document.getElementById('next-ticket');
  const lastTicketSpan = document.getElementById('last-ticket');
  const setTicketBtn   = document.getElementById('set-ticket');
  const ticketError    = document.getElementById('ticket-error');
  const prefDeskToggle = document.getElementById('pref-desk-toggle');
  if (prefDeskToggle) {
    prefDeskToggle.checked = cfg ? cfg.preferentialDesk !== false : true;
    prefDeskToggle.addEventListener('change', async () => {
      if (isClone) {
        prefDeskToggle.checked = cfg.preferentialDesk !== false;
        return;
      }
      const preferentialDesk = prefDeskToggle.checked;
      try {
        const res = await fetch(`${location.origin}/.netlify/functions/saveMonitorConfig`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, empresa: cfg.empresa, senha: cfg.senha, schedule: cfg.schedule, preferentialDesk })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error();
        cfg.preferentialDesk = preferentialDesk;
        localStorage.setItem('monitorConfig', JSON.stringify(cfg));
      } catch (e) {
        alert('Erro ao salvar configuração.');
        console.error(e);
        prefDeskToggle.checked = !preferentialDesk;
      }
    });
  }
  adminToggle?.addEventListener('click', () => {
    adminPanel.hidden = !adminPanel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!adminPanel.hidden && !adminPanel.contains(e.target) && e.target !== adminToggle) {
      adminPanel.hidden = true;
    }
  });
  const reportModal    = document.getElementById('report-modal');
  const reportClose    = document.getElementById('report-close');
  const reportTitle    = document.getElementById('report-title');
  const reportSummary  = document.getElementById('report-summary');
  const reportChartEl  = document.getElementById('report-chart');
  const viewModal      = document.getElementById('view-modal');
  const viewClose      = document.getElementById('view-close');
  const viewQrEl       = document.getElementById('view-qrcode');
  const cloneModal     = document.getElementById('clone-modal');
  const cloneClose     = document.getElementById('clone-close');
  const cloneQrEl      = document.getElementById('clone-qrcode');
  const scheduleModal  = document.getElementById('schedule-modal');
  const scheduleClose  = document.getElementById('schedule-close');
  const scheduleSave   = document.getElementById('schedule-save');
  const editDays       = scheduleModal.querySelectorAll('input[name="work-day"]');
  const editUse1       = document.getElementById('edit-use1');
  const editStart1     = document.getElementById('edit-start1');
  const editEnd1       = document.getElementById('edit-end1');
  const editUse2       = document.getElementById('edit-use2');
  const editStart2     = document.getElementById('edit-start2');
  const editEnd2       = document.getElementById('edit-end2');
  const passwordModal  = document.getElementById('password-modal');
  const passwordClose  = document.getElementById('password-close');
  const passwordSave   = document.getElementById('password-save');
  const passwordCurrent= document.getElementById('password-current');
  const passwordNew    = document.getElementById('password-new');
  const passwordError  = document.getElementById('password-error');
  const btnImport      = document.getElementById('btn-import-clients');
  const importModal    = document.getElementById('import-modal');
  const importClose    = document.getElementById('import-close');
  const importFile     = document.getElementById('import-file');
  const importText     = document.getElementById('import-text');
  const importLoad     = document.getElementById('import-load');
  const importSource   = document.getElementById('import-step-source');
  const importPreview  = document.getElementById('import-step-preview');
  const importTable    = document.getElementById('import-preview-table');
  const importTotal    = document.getElementById('import-count-total');
  const importPref     = document.getElementById('import-count-pref');
  const importNormal   = document.getElementById('import-count-normal');
  const importConfirm  = document.getElementById('import-confirm');
  const importClear    = document.getElementById('import-clear');
  const importCancel   = document.getElementById('import-cancel');
  const importDupBox   = document.getElementById('import-dup-box');
  const importSrcError = document.getElementById('import-src-error');
  const importProgress = document.getElementById('import-progress');
  const importProgressBar = document.getElementById('import-progress-bar');
  const togglePwCurrent= document.getElementById('toggle-password-current');
  const clonesPanel = document.querySelector('.clones-panel');
  if (clonesPanel) clonesPanel.hidden = true;

  toggleInterval(editUse1, editStart1, editEnd1);
  toggleInterval(editUse2, editStart2, editEnd2);

  if (isClone) {
    if (btnDeleteConfig) { btnDeleteConfig.hidden = true; btnDeleteConfig.onclick = null; }
    if (btnView)         { btnView.hidden = true; btnView.onclick = null; }
    if (btnEditSchedule) { btnEditSchedule.hidden = true; btnEditSchedule.onclick = null; }
    if (btnClone)        btnClone.hidden = true;
    if (btnChangePw)     btnChangePw.hidden = true;
    if (adminToggle)     { adminToggle.remove(); }
    if (adminPanel)      { adminPanel.remove(); }
    const qrWrapper = document.querySelector('.qrcode-wrapper');
    if (qrWrapper) qrWrapper.style.display = 'none';
  }

  btnEditSchedule.onclick = () => {
    if (isClone || !cfg || !cfg.schedule) return;
    const s = cfg.schedule;
    editDays.forEach(d => {
      d.checked = s.days.includes(Number(d.value));
    });
    const i1 = s.intervals[0];
    const i2 = s.intervals[1];
    if (i1) {
      editUse1.checked = true;
      editStart1.value = i1.start;
      editEnd1.value   = i1.end;
    } else {
      editUse1.checked = false;
    }
    if (i2) {
      editUse2.checked = true;
      editStart2.value = i2.start;
      editEnd2.value   = i2.end;
    } else {
      editUse2.checked = false;
    }
    editUse1.dispatchEvent(new Event('change'));
    editUse2.dispatchEvent(new Event('change'));
    scheduleModal.hidden = false;
  };

  scheduleClose.onclick = () => {
    scheduleModal.hidden = true;
  };

  scheduleSave.onclick = async () => {
    if (isClone) return;
    const days = Array.from(editDays).filter(d => d.checked).map(d => Number(d.value));
    const intervals = [];
    if (editUse1.checked) intervals.push({ start: editStart1.value, end: editEnd1.value });
    if (editUse2.checked) intervals.push({ start: editStart2.value, end: editEnd2.value });
    const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const schedule = { days, intervals, tz };
    try {
      const res = await fetch(`${location.origin}/.netlify/functions/saveMonitorConfig`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, empresa: cfg.empresa, senha: cfg.senha, schedule, preferentialDesk: prefDeskToggle.checked })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error();
      cfg.schedule = schedule;
      cfg.preferentialDesk = prefDeskToggle.checked;
      localStorage.setItem('monitorConfig', JSON.stringify(cfg));
      scheduleModal.hidden = true;
    } catch (e) {
      alert('Erro ao salvar horário.');
      console.error(e);
    }
  };

  btnClone.onclick = () => openCloneModal(token);
  cloneClose.onclick = () => {
    cloneModal.hidden = true;
    const info = document.getElementById('clone-copy-info');
    if (info) info.hidden = true;
  };

  btnChangePw.onclick = () => {
    passwordError.textContent = '';
    passwordCurrent.value = cfg?.senha || '';
    passwordCurrent.type = 'password';
    togglePwCurrent.textContent = '👁️';
    passwordNew.value = '';
    passwordNew.type = 'text';
    passwordModal.hidden = false;
  };
  togglePwCurrent.onclick = () => {
    const isPassword = passwordCurrent.type === 'password';
    passwordCurrent.type = isPassword ? 'text' : 'password';
    togglePwCurrent.textContent = isPassword ? '🙈' : '👁️';
  };
  passwordClose.onclick = () => { passwordModal.hidden = true; };
  passwordSave.onclick = async () => {
    const senhaAtual = passwordCurrent.value.trim();
    const novaSenha  = passwordNew.value.trim();
    if (!senhaAtual || !novaSenha) {
      passwordError.textContent = 'Preencha todos os campos';
      return;
    }
    try {
      const res = await fetch(`${location.origin}/.netlify/functions/changePassword`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, senhaAtual, novaSenha })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        passwordModal.hidden = true;
        alert('Senha alterada. Faça login novamente.');
      } else {
        passwordError.textContent = data.error || 'Erro ao alterar senha';
      }
    } catch (e) {
      passwordError.textContent = 'Erro de conexão';
    }
  };

  // Importação de lista de clientes
  let importItems = [];
  const importDupIdx = new Set();
  function resetImport() {
    importItems = [];
    importDupIdx.clear();
    importSource.hidden = false;
    importPreview.hidden = true;
    importFile.value = '';
    importText.value = '';
    importSrcError.textContent = '';
    importConfirm.disabled = true;
    importDupBox.hidden = true;
    importDupBox.textContent = '';
    importProgress.hidden = true;
    importProgressBar.style.width = '0%';
    importClear.disabled = false;
    importCancel.disabled = false;
    importClose.hidden = false;
  }
  function normalizeName(str) {
    return str
      .replace(/\*/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
  function parseInput(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    lines.forEach((line, idx) => {
      let raw = line.trim();
      if (!raw) return;
      let priority = false;
      if (raw.endsWith('*')) {
        priority = true;
        raw = raw.slice(0, -1).trim();
      }
      out.push({ name: raw, priority, line: idx + 1 });
    });
    return out;
  }
  function detectDuplicates(list) {
    const map = new Map();
    importDupIdx.clear();
    list.forEach((c, i) => {
      const key = normalizeName(c.name || '');
      if (!key) return;
      const arr = map.get(key) || [];
      arr.push(i);
      map.set(key, arr);
    });
    for (const arr of map.values()) {
      if (arr.length > 1) arr.forEach((i) => importDupIdx.add(i));
    }
  }
  function atualizarUIEstado() {
    const qtd = importDupIdx.size;
    importDupBox.hidden = false;
    importDupBox.textContent =
      qtd > 0
        ? `Há nomes idênticos (ignorando *). Corrija os destacados. Restantes: ${qtd}`
        : 'Sem duplicados.';
  }

  function atualizarBotaoImportar() {
    importConfirm.disabled = importDupIdx.size > 0;
  }

  function createRow(item, idx) {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;
    if (importDupIdx.has(idx)) tr.classList.add('dup-row');
    const tdIdx = document.createElement('td');
    tdIdx.textContent = idx + 1;
    const tdName = document.createElement('td');
    if (importDupIdx.has(idx)) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.name;
      input.className = 'dup-input';
      input.setAttribute('aria-label', 'Corrigir nome duplicado');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      });
      input.addEventListener('blur', (e) => {
        const novo = (e.currentTarget.value || '').trim();
        if (importItems[idx].name !== novo) {
          importItems[idx].name = novo;
        }
        detectDuplicates(importItems);
        importTable.replaceChild(createRow(importItems[idx], idx), tr);
        atualizarUIEstado();
        atualizarBotaoImportar();
      });
      tdName.appendChild(input);
      const warn = document.createElement('span');
      warn.className = 'dup-badge';
      warn.title = 'Nome idêntico encontrado. Edite para diferenciar.';
      warn.textContent = '⚠';
      tdName.appendChild(warn);
    } else {
      tdName.textContent = item.name;
    }
    const tdPref = document.createElement('td');
    if (item.priority) {
      tdPref.textContent = '★';
      tdPref.className = 'pref-badge';
    }
    tr.append(tdIdx, tdName, tdPref);
    return tr;
  }

  function renderPreview() {
    importSource.hidden = true;
    importPreview.hidden = false;
    detectDuplicates(importItems);
    importTable.innerHTML = '';
    importItems.forEach((item, idx) => {
      importTable.appendChild(createRow(item, idx));
    });
    const total = importItems.length;
    const pref = importItems.filter((i) => i.priority).length;
    const norm = total - pref;
    importTotal.textContent = total;
    importPref.textContent = pref;
    importNormal.textContent = norm;
    atualizarUIEstado();
    atualizarBotaoImportar();
    const first = importTable.querySelector('input.dup-input');
    if (first) first.focus();
  }
  if (btnImport) {
    const profile = cfg?.profile || cfg?.role || 'admin';
    btnImport.hidden = !['admin', 'supervisor'].includes(profile);
    btnImport.addEventListener('click', () => {
      resetImport();
      importModal.hidden = false;
    });
  }
  importClose?.addEventListener('click', () => {
    importModal.hidden = true;
    resetImport();
  });
  importLoad?.addEventListener('click', async () => {
    importSrcError.textContent = '';
    let text = importText.value || '';
    if (importFile.files && importFile.files[0]) {
      const file = importFile.files[0];
      const ext = file.name.split('.').pop().toLowerCase();
      try {
        if (ext === 'txt' || ext === 'csv') {
          text = await file.text();
        } else if (ext === 'xlsx') {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          text = rows.map((r) => r[0]).join('\n');
        } else {
          importSrcError.textContent = 'Formato não reconhecido. Envie CSV/TXT/XLSX ou cole os nomes.';
          return;
        }
      } catch {
        importSrcError.textContent = 'Formato não reconhecido. Envie CSV/TXT/XLSX ou cole os nomes.';
        return;
      }
    }
    importItems = parseInput(text);
    if (importItems.length === 0) {
      importSrcError.textContent = 'Nenhum nome válido encontrado.';
      return;
    }
    if (importItems.length > 5000) {
      importSrcError.textContent = 'Arquivo acima do limite permitido.';
      return;
    }
    renderPreview();
  });
  importClear?.addEventListener('click', () => {
    resetImport();
  });
  importCancel?.addEventListener('click', () => {
    importModal.hidden = true;
    resetImport();
  });
  importConfirm?.addEventListener('click', async () => {
    const t = token;
    const items = importItems.map((i) => ({ name: i.name, preferential: i.priority }));
    const total = items.length;
    const batchSize = 100;
    let processed = 0;
    let prefCount = 0;
    let normCount = 0;
    importProgress.hidden = false;
    importProgressBar.style.width = '0%';
    importConfirm.disabled = true;
    importClear.disabled = true;
    importCancel.disabled = true;
    importClose.hidden = true;
    // ensure progress bar renders before heavy work
    await new Promise((r) => requestAnimationFrame(r));
    try {
      while (processed < total) {
        const batch = items.slice(processed, processed + batchSize);
        const res = await fetch(`/.netlify/functions/enqueueBatch?t=${encodeURIComponent(t)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch })
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || 'Request failed');
        }
        const data = await res.json();
        prefCount += data.preferential || 0;
        normCount += data.normal || 0;
        processed += batch.length;
        importProgressBar.style.width = `${(processed / total) * 100}%`;
      }
      alert(`Importados: ${total} (${prefCount} preferenciais, ${normCount} normais)`);
      importModal.hidden = true;
      resetImport();
      refreshAll(t);
    } catch (e) {
      alert('Erro ao importar lista');
      console.error(e);
    } finally {
      importProgress.hidden = true;
      importProgressBar.style.width = '0%';
      importConfirm.disabled = false;
      importClear.disabled = false;
      importCancel.disabled = false;
      importClose.hidden = false;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey && !importModal.hidden && !importConfirm.disabled) {
      importConfirm.click();
    }
  });

  // Botão de relatório oculto até haver dados
  btnReport.hidden = true;

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

  const btnQrPdf      = document.getElementById('btn-qr-pdf');
  let currentClientUrl = '';

  btnQrPdf.addEventListener('click', generateQrPdf);

  let currentCallNum = 0; // último número chamado exibido
  let ticketNames    = {};
  let ticketCounter  = 0;
  let callCounter    = 0;
  let cancelledNums  = [];
  let missedNums     = [];
  let skippedNums    = [];
  let offHoursNums   = [];
  let offHoursSet    = new Set();
  let cancelledCount = 0;
  let missedCount    = 0;
  let attendedNums   = [];
  let attendedCount  = 0;
  let priorityNums   = [];
  let prioritySet    = new Set();
  let pollingId;
  const fmtTime     = ts => new Date(ts).toLocaleString('pt-BR');
  const msToHms = (ms) => {
    if (!ms) return '-';
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2,'0');
    const m = String(Math.floor((s % 3600)/60)).padStart(2,'0');
    const sec = String(s % 60).padStart(2,'0');
    return `${h}:${m}:${sec}`;
  };
  updateTicketSetter();

 /** Renderiza o QR Code e configura interação */
function renderQRCode(tId) {
    qrContainer.innerHTML = '';
    qrOverlayContent.innerHTML = '';

    const urlCliente = `${location.origin}/client/?t=${tId}&empresa=${encodeURIComponent(cfg.empresa)}`;
    new QRCode(qrContainer,     { text: urlCliente, width: 128, height: 128 });
    new QRCode(qrOverlayContent, { text: urlCliente, width: 256, height: 256 });

    currentClientUrl = urlCliente;
    btnQrPdf.hidden = false;

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

function sanitizeFileName(name) {
  return (name || 'empresa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9 ]+/g, '') // remove caracteres inválidos
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

function isMobile() {
  return /Mobi|Android|iP(ad|hone|od)/i.test(navigator.userAgent) || window.innerWidth <= 768;
}

function getQrCodeDataUrl() {
  const img = qrContainer.querySelector('img');
  if (img && img.src) return img.src;
  const canvas = qrContainer.querySelector('canvas');
  return canvas ? canvas.toDataURL('image/png') : null;
}

function generateQrPdf() {
  const qrDataUrl = getQrCodeDataUrl();
  if (!qrDataUrl) return;
  if (isMobile()) {
    if (!confirm('Deseja abrir o PDF?')) return;
    const html = `\
      <html>
      <head>
        <meta charset="utf-8">
        <title>${cfg.empresa || ''}</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; }
          img { max-width: 100%; }
        </style>
      </head>
      <body>
        <img src="/img/icon-sannext.png" alt="Logo" style="width:80px;margin-bottom:10px;" />
        <h1>${cfg.empresa || ''}</h1>
        <h2>Entre na fila</h2>
        <img src="${qrDataUrl}" alt="QR Code" style="width:200px;height:200px;" />
        <p>1. Abra a câmera do seu celular.<br>2. Siga o link para pegar sua senha.</p>
        <p>${currentClientUrl}</p>
      </body>
      </html>`;
    const win = window.open('', '_blank');
    if (!win) {
      alert('Não foi possível abrir a nova janela. Verifique o bloqueador de pop-ups.');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFontSize(18);
  doc.text(cfg.empresa || '', pageWidth / 2, y, { align: 'center' });
  y += 10;
  doc.setFontSize(14);
  doc.text('Entre na fila', pageWidth / 2, y, { align: 'center' });
  y += 10;
  doc.addImage(qrDataUrl, 'PNG', pageWidth / 2 - 35, y, 70, 70);
    y += 80;
    doc.setFontSize(12);
    doc.text('1. Abra a câmera do seu celular.', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.text('2. Siga o link para pegar sua senha.', pageWidth / 2, y, { align: 'center' });
    y += 10;
    doc.setFontSize(10);
    doc.text(currentClientUrl, pageWidth / 2, y, { align: 'center' });
  const empresaSlug = sanitizeFileName(cfg.empresa);
  doc.save(`${empresaSlug}-instrucoes-fila.pdf`);
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
    let text = num > 0 ? num : '–';
    const nm = ticketNames[num];
    if (nm) text += ` - ${nm}`;
    if (prioritySet.has(num)) text += ' (Preferencial)';
    callingEl.textContent = text;
    currentIdEl.textContent   = attendantId || '';
  }

  async function cancelTicket(n) {
    if (!confirm(`Deseja cancelar o ticket ${n}?`)) return;
    const t = token;
    try {
      await fetch(`/.netlify/functions/cancelar?t=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: n, reason: 'desk' })
      });
      await refreshAll(t);
    } catch (e) {
      console.error('Erro ao cancelar ticket:', e);
    }
  }

  function updateQueueList() {
    if (!queueListEl) return;
    queueListEl.innerHTML = '';
    const pending = [];
    for (let i = 1; i <= ticketCounter; i++) {
      if (i === currentCallNum) continue;
      if (
        cancelledNums.includes(i) ||
        missedNums.includes(i) ||
        attendedNums.includes(i) ||
        skippedNums.includes(i)
      ) continue;
      if (i <= callCounter && !prioritySet.has(i)) continue;
      pending.push(i);
    }
    pending.forEach(n => {
      const li = document.createElement('li');
      const nm = ticketNames[n];
      let text = nm ? `${n} - ${nm}` : String(n);
      text += prioritySet.has(n) ? ' - Preferencial' : ' - Normal';
      if (offHoursSet.has(n)) text += ' - Fora do horário';

      const span = document.createElement('span');
      span.textContent = text;
      li.appendChild(span);

      const btn = document.createElement('button');
      btn.className = 'cancel-btn';
      btn.textContent = '×';
      btn.title = 'Cancelar ticket';
      btn.setAttribute('aria-label', `Cancelar ticket ${n}`);
      btn.onclick = () => cancelTicket(n);
      li.appendChild(btn);

      queueListEl.appendChild(li);
    });
  }

  function updateTicketSetter() {
    if (!nextTicketInput || !lastTicketSpan) return;
    const min = ticketCounter > 0 ? ticketCounter + 1 : 1;
    nextTicketInput.min = String(min);
    if (!nextTicketInput.value || Number(nextTicketInput.value) < min) {
      nextTicketInput.value = String(min);
    }
    lastTicketSpan.textContent = String(ticketCounter);
  }

  /** Busca status e atualiza UI */
  async function fetchStatus(t) {
    try {
      const res = await fetch(`/.netlify/functions/status?t=${t}`);
      const {
        currentCall,
        ticketCounter: tc,
        callCounter: cCtr = 0,
        attendant: attendantId = '',
        cancelledNumbers = [],
        missedNumbers = [],
        attendedNumbers = [],
        skippedNumbers = [],
        offHoursNumbers = [],
        cancelledCount: cc = 0,
        missedCount: mc = 0,
        attendedCount: ac = 0,
        waiting = 0,
        names = {},
        logoutVersion: srvLogoutVersion = 0,
        priorityNumbers = []
      } = await res.json();

      if (logoutVersion !== null && srvLogoutVersion !== logoutVersion) {
        localStorage.clear();
        history.replaceState(null, '', '/');
        location.href = '/';
        return;
      }
      logoutVersion = srvLogoutVersion;
      localStorage.setItem('logoutVersion', String(logoutVersion));

      currentCallNum  = currentCall;
      ticketCounter   = tc;
      callCounter     = cCtr;
      ticketNames     = names || {};
      cancelledNums   = cancelledNumbers.map(Number);
      missedNums      = missedNumbers.map(Number);
      attendedNums    = attendedNumbers.map(Number);
      skippedNums     = skippedNumbers.map(Number);
      offHoursNums    = offHoursNumbers.map(Number);
      offHoursSet     = new Set(offHoursNums);
      priorityNums    = priorityNumbers.map(Number);
      prioritySet     = new Set(priorityNums);
      const priorityWaiting = priorityNums.filter(n =>
        n !== currentCallNum &&
        !cancelledNums.includes(n) &&
        !missedNums.includes(n) &&
        !attendedNums.includes(n) &&
        !skippedNums.includes(n) &&
        !offHoursNums.includes(n)
      );
      const waitingPriority = priorityWaiting.length;
      const waitingNormal = Math.max(0, waiting - waitingPriority);
      const hasPriorityTicket = waitingPriority > 0 || prioritySet.has(currentCallNum);
      const hasNormalTicket = waitingNormal > 0 || (currentCallNum > 0 && !prioritySet.has(currentCallNum));
      const hasWaitingTicket = hasPriorityTicket || hasNormalTicket;
      const hasCallingTicket = currentCallNum > 0;
      const hasFinishedTicket = cancelledNums.length > 0 || missedNums.length > 0 || attendedNums.length > 0;
      const hasAnyTicket = hasWaitingTicket || hasFinishedTicket;
      if (btnNextPref) {
        btnNextPref.disabled = !hasPriorityTicket;
        btnNextPref.title = hasPriorityTicket
          ? ''
          : (hasWaitingTicket ? 'Sem tickets preferenciais na fila' : 'Sem tickets na fila');
      }
      if (btnNext) {
        btnNext.disabled = !hasNormalTicket;
        btnNext.title = hasNormalTicket
          ? ''
          : (hasWaitingTicket ? 'Sem tickets normais na fila' : 'Sem tickets na fila');
      }
      if (btnRepeat) {
        btnRepeat.disabled = !hasCallingTicket;
        btnRepeat.title = hasCallingTicket ? '' : 'Sem ticket em chamada';
      }
      if (btnDone) {
        btnDone.disabled = !hasCallingTicket;
        btnDone.title = hasCallingTicket ? '' : 'Sem ticket em chamada';
      }
      if (btnReport) {
        btnReport.disabled = !hasAnyTicket;
        btnReport.title = hasAnyTicket ? '' : 'Sem tickets na fila';
      }
      if (btnReset) {
        btnReset.disabled = !hasAnyTicket;
        btnReset.title = hasAnyTicket ? '' : 'Sem tickets na fila';
      }
      qPrefEl.textContent = waitingPriority;
      qNormEl.textContent = waitingNormal;
      cancelledCount  = cc || cancelledNums.length;
      missedCount     = mc || missedNums.length;
      attendedCount   = ac;

      const cName = ticketNames[currentCall];
      let cText = currentCall > 0 ? currentCall : '–';
      if (cName) cText += ` - ${cName}`;
      if (prioritySet.has(currentCall)) cText += ' (Preferencial)';
      callingEl.textContent = cText;
      currentIdEl.textContent   = attendantId || '';
      qTotalEl.textContent     = waiting;

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

      cancelPanel.hidden = cancelledCount === 0;
      missedPanel.hidden = missedCount === 0;
      attendedPanel.hidden = attendedCount === 0;

      updateQueueList();

      // Exibe o botão de relatório apenas se houver tickets registrados
      btnReport.hidden = ticketCounter === 0;
      updateTicketSetter();
    } catch (e) {
      console.error(e);
    }
  }

  /** Busca cancelados e popula lista */
  async function fetchCancelled(t) {
    try {
      const res = await fetch(`/.netlify/functions/cancelados?t=${t}`);
      const { cancelled = [], missed = [], missedNumbers = [] } = await res.json();

      cancelListEl.innerHTML = '';
      cancelled.forEach(({ ticket, ts, reason, duration, wait }) => {
        const li = document.createElement('li');
        const durTxt = duration ? ` (${msToHms(duration)})` : '';
        const waitTxt = wait ? ` [${msToHms(wait)}]` : '';
        li.innerHTML = `<span>${ticket}</span><span class="ts">${fmtTime(ts)}${durTxt}${waitTxt}</span>`;
        cancelListEl.appendChild(li);
      });

      missedListEl.innerHTML = '';
      missed.forEach(({ ticket, ts, duration, wait }) => {
        const li = document.createElement('li');
        li.classList.add('missed');
        const durTxt = duration ? ` (${msToHms(duration)})` : '';
        const waitTxt = wait ? ` [${msToHms(wait)}]` : '';
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
        const durTxt = duration ? ` (${msToHms(duration)})` : '';
        const waitTxt = wait ? ` [${msToHms(wait)}]` : '';
        li.innerHTML = `<span>${ticket}</span><span class="ts">${fmtTime(ts)}${durTxt}${waitTxt}</span>`;
        attendedListEl.appendChild(li);
      });
    } catch (e) {
      console.error('Erro ao buscar atendidos:', e);
    }
  }

  async function refreshAll(t) {
    await fetchStatus(`${t}&_=${Date.now()}`);
    await Promise.all([fetchCancelled(t), fetchAttended(t), loadCloneList(t)]);
  }

  async function openReport(t) {
    await refreshAll(t);
    reportModal.hidden = false;
    if (cfg && cfg.empresa) {
      reportTitle.textContent = `Relatório - ${cfg.empresa}`;
    } else {
      reportTitle.textContent = 'Relatório';
    }
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
      calledCount = 0,
      avgWait = 0,
      avgDur = 0,
      avgWaitHms = '00:00:00',
      avgDurHms = '00:00:00',
      offHoursCount: offHoursReport = 0,
      totalTickets = 0,
      priorityCount = 0,
      normalCount = 0
    } = summary;

    const attendedCount  = Number(attendedCountEl.textContent) || 0;
    const cancelledCount = Number(cancelCountEl.textContent) || 0;
    const missedCount    = Number(missedCountEl.textContent) || 0;
    const waitingCount   = Number(qTotalEl.textContent) || 0;

    if (!tickets.length &&
        !totalTickets &&
        !attendedCount &&
        !cancelledCount &&
        !missedCount &&
        !waitingCount &&
        !calledCount) {
      reportSummary.innerHTML = '<p>Nenhum dado encontrado.</p>';
    } else {
      reportSummary.innerHTML = `
        <p>Total de tickets: ${totalTickets}</p>
        <p>Normais: ${normalCount}</p>
        <p>Preferenciais: ${priorityCount}</p>
        <p>Atendidos: ${attendedCount}</p>
        <p>Tempo médio de espera: ${avgWaitHms}</p>
        <p>Tempo médio de atendimento: ${avgDurHms}</p>
        <p>Cancelados: ${cancelledCount}</p>
        <p>Perderam a vez: ${missedCount}</p>
        <p>Chamados: ${calledCount}</p>
        <p>Em espera: ${waitingCount}</p>
        <p>Fora do horário: ${offHoursReport}</p>`;
    }

    // Monta tabela
    const table = document.getElementById('report-table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Ticket</th>
          <th>Nome</th>
          <th>Identificador</th>
          <th>Tipo</th>
          <th>Status</th>
          <th>Entrada</th>
          <th>Chamada</th>
          <th>Atendido</th>
          <th>Cancelado</th>
          <th>Espera</th>
          <th>Duração</th>
        </tr>
      </thead>`;
    const tbody = document.createElement('tbody');
    const fmt = ts => ts ? new Date(ts).toLocaleString('pt-BR') : '-';
    const label = (st) => ({
      attended: 'Atendido',
      cancelled: 'Cancelado',
      missed: 'Perdeu a vez',
      called: 'Chamado',
      waiting: 'Em espera',
      offhours: 'Fora do horário'
    })[st] || '';
    tickets.forEach(tk => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${tk.ticket}</td>
        <td>${tk.name || ''}</td>
        <td>${tk.identifier || tk.attendant || ''}</td>
        <td>${tk.type || ''}</td>
        <td>${label(tk.status)}</td>
        <td>${tk.enteredBr || fmt(tk.entered)}</td>
        <td>${tk.calledBr || fmt(tk.called)}</td>
        <td>${tk.attendedBr || fmt(tk.attended)}</td>
        <td>${tk.cancelledBr || fmt(tk.cancelled)}</td>
        <td>${tk.waitHms || msToHms(tk.wait)}</td>
        <td>${tk.durationHms || msToHms(tk.duration)}</td>`;
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

    document.getElementById('export-excel').onclick = () => {
      const encoder = new TextEncoder();
      const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const col = (i) => String.fromCharCode(65 + i);

      const headers = ['Ticket','Nome','Identificador','Tipo','Status','Entrada','Chamada','Atendido','Cancelado','Espera','Duração'];
      const rows = [];
      rows.push('<row r="1">' + headers.map((h,i)=>`<c r="${col(i)}1" t="inlineStr"><is><t>${esc(h)}</t></is></c>`).join('') + '</row>');
      tickets.forEach((tk,idx)=>{
        const vals=[tk.ticket,tk.name||'',tk.identifier||tk.attendant||'',tk.type||'',label(tk.status),tk.enteredBr||fmt(tk.entered)||'',tk.calledBr||fmt(tk.called)||'',tk.attendedBr||fmt(tk.attended)||'',tk.cancelledBr||fmt(tk.cancelled)||'',tk.waitHms||msToHms(tk.wait)||'',tk.durationHms||msToHms(tk.duration)||''];
        const r=idx+2;
        rows.push('<row r="'+r+'">'+vals.map((v,i)=>`<c r="${col(i)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')+'</row>');
      });
      let r = tickets.length + 3;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Total tickets</t></is></c><c t="inlineStr"><is><t>${totalTickets}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Normais</t></is></c><c t="inlineStr"><is><t>${normalCount}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Preferenciais</t></is></c><c t="inlineStr"><is><t>${priorityCount}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Atendidos</t></is></c><c t="inlineStr"><is><t>${attendedCount}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Cancelados</t></is></c><c t="inlineStr"><is><t>${cancelledCount}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Perderam a vez</t></is></c><c t="inlineStr"><is><t>${missedCount}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Em espera</t></is></c><c t="inlineStr"><is><t>${waitingCount}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Tempo médio de espera</t></is></c><c t="inlineStr"><is><t>${avgWaitHms}</t></is></c></row>`); r++;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Tempo médio de atendimento</t></is></c><c t="inlineStr"><is><t>${avgDurHms}</t></is></c></row>`);

      const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`;
      const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
      const wbRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
      const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
      const types = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

      function crcTable(){
        const c=[];for(let n=0;n<256;n++){let r=n;for(let k=0;k<8;k++)r=(r&1)?0xedb88320^(r>>>1):r>>>1;c[n]=r>>>0;}return c;
      }
      const crcTab = crcTable();
      const crc32 = (arr)=>{
        let crc=-1;for(let i=0;i<arr.length;i++)crc=crcTab[(crc^arr[i])&0xff]^(crc>>>8);return (crc^ -1)>>>0;
      };
      const toUint8 = (s)=>encoder.encode(s);
      function hdr(name,data,off){
        const nameBytes=toUint8(name);const h=new Uint8Array(30+nameBytes.length);
        const crc=crc32(data);const size=data.length;
        h.set([0x50,0x4b,0x03,0x04,20,0,0,0,0,0,0,0]);
        h[14]=crc&0xff;h[15]=(crc>>>8)&0xff;h[16]=(crc>>>16)&0xff;h[17]=(crc>>>24)&0xff;
        h[18]=size&0xff;h[19]=(size>>>8)&0xff;h[20]=(size>>>16)&0xff;h[21]=(size>>>24)&0xff;
        h[22]=size&0xff;h[23]=(size>>>8)&0xff;h[24]=(size>>>16)&0xff;h[25]=(size>>>24)&0xff;
        h[26]=nameBytes.length&0xff;h[27]=(nameBytes.length>>>8)&0xff;h.set(nameBytes,30);
        return {header:h,crc,size,nameBytes,offset:off};
      }
      function central(f){
        const c=new Uint8Array(46+f.nameBytes.length);
        c.set([0x50,0x4b,0x01,0x02,20,0,20,0,0,0,0,0,0,0]);
        const {crc,size,nameBytes,offset}=f;
        c[16]=crc&0xff;c[17]=(crc>>>8)&0xff;c[18]=(crc>>>16)&0xff;c[19]=(crc>>>24)&0xff;
        c[20]=size&0xff;c[21]=(size>>>8)&0xff;c[22]=(size>>>16)&0xff;c[23]=(size>>>24)&0xff;
        c[24]=size&0xff;c[25]=(size>>>8)&0xff;c[26]=(size>>>16)&0xff;c[27]=(size>>>24)&0xff;
        c[28]=nameBytes.length&0xff;c[29]=(nameBytes.length>>>8)&0xff;
        c[42]=offset&0xff;c[43]=(offset>>>8)&0xff;c[44]=(offset>>>16)&0xff;c[45]=(offset>>>24)&0xff;
        c.set(nameBytes,46);return c;
      }
      const files=[
        {name:"[Content_Types].xml",data:toUint8(types)},
        {name:"_rels/.rels",data:toUint8(rels)},
        {name:"xl/workbook.xml",data:toUint8(workbook)},
        {name:"xl/_rels/workbook.xml.rels",data:toUint8(wbRels)},
        {name:"xl/worksheets/sheet1.xml",data:toUint8(sheet)}
      ];
      let localParts=[];let centralParts=[];let offset=0;
      files.forEach(f=>{const lf=hdr(f.name,f.data,offset);offset+=lf.header.length+f.data.length;localParts.push(lf.header,f.data);centralParts.push(central(lf));});
      let cdSize=centralParts.reduce((s,a)=>s+a.length,0);
      const end=new Uint8Array(22);end.set([0x50,0x4b,0x05,0x06,0,0,0,0]);
      end[8]=files.length&0xff;end[9]=(files.length>>>8)&0xff;end[10]=files.length&0xff;end[11]=(files.length>>>8)&0xff;
      end[12]=cdSize&0xff;end[13]=(cdSize>>>8)&0xff;end[14]=(cdSize>>>16)&0xff;end[15]=(cdSize>>>24)&0xff;
      end[16]=offset&0xff;end[17]=(offset>>>8)&0xff;end[18]=(offset>>>16)&0xff;end[19]=(offset>>>24)&0xff;
      const totalLen=offset+cdSize+22;const out=new Uint8Array(totalLen);let p=0;
      localParts.forEach(part=>{out.set(part,p);p+=part.length;});
      centralParts.forEach(part=>{out.set(part,p);p+=part.length;});
      out.set(end,p);
      const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='relatorio.xlsx';link.click();
    };

    document.getElementById('export-pdf').onclick = () => {
      const nowStr = new Date().toLocaleString('pt-BR');
      const summaryLines = [
        `Total de tickets: ${totalTickets}`,
        `Normais: ${normalCount}`,
        `Preferenciais: ${priorityCount}`,
        `Atendidos: ${attendedCount}`,
        `Cancelados: ${cancelledCount}`,
        `Perderam a vez: ${missedCount}`,
        `Em espera: ${waitingCount}`,
        `Tempo médio de espera: ${avgWaitHms}`,
        `Tempo médio de atendimento: ${avgDurHms}`
      ];

      if (isMobile()) {
        if (!confirm('Deseja abrir o PDF?')) return;
        const win = window.open('', '_blank');
        if (!win) {
          alert('Não foi possível abrir a nova janela. Verifique o bloqueador de pop-ups.');
          return;
        }
        const summaryHtml = summaryLines.map(line => `<p>${line}</p>`).join('');
        const tableHtml = table.outerHTML;
        const chartImg = reportChartEl.toDataURL('image/png');
        const html = `
          <html>
          <head>
            <meta charset="utf-8">
            <title>Relatório - ${cfg?.empresa || ''}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 1rem; }
              h1 { text-align: center; }
              table { border-collapse: collapse; width: 100%; font-size: 12px; }
              th, td { border: 1px solid #000; padding: 4px; }
              img { max-width: 100%; }
              .summary p { margin: 0; }
            </style>
          </head>
          <body>
            <img src="/img/icon-sannext.png" alt="Logo" style="width:80px;display:block;margin:0 auto 10px;" />
            <h1>Relatório - ${cfg?.empresa || ''}</h1>
            <p style="text-align:center;">Gerado em: ${nowStr} - by SanNext</p>
            <div class="summary">${summaryHtml}</div>
            ${tableHtml}
            <img src="${chartImg}" alt="Gráfico" />
          </body>
          </html>`;
        win.document.write(html);
        win.document.close();
        win.onload = () => win.print();
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF('l', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      doc.setFontSize(16);
      doc.text(`Relatório - ${cfg?.empresa || ''}`, pageWidth / 2, 15, { align: 'center' });
      doc.setFontSize(10);
      doc.text(`Gerado em: ${nowStr} - by SanNext`, pageWidth / 2, 22, { align: 'center' });

      let y = 30;
      const marginX = 10;
      doc.setFontSize(12);
      summaryLines.forEach(line => { doc.text(line, marginX, y); y += 7; });

      const headers = ['Ticket','Nome','Identificador','Tipo','Status','Entrada','Chamada','Atendido','Cancelado','Espera','Duração'];
      const colW = [14,35,27,20,25,27,27,27,25,25,24];
      const startX = marginX;
      const rowH = 9;
      const drawRow = (vals, yPos, bold = false) => {
        let x = startX;
        if (bold) doc.setFont(undefined, 'bold'); else doc.setFont(undefined, 'normal');
        vals.forEach((v, i) => {
          doc.text(String(v ?? ''), x + colW[i] / 2, yPos, { maxWidth: colW[i] - 1, align: 'center' });
          x += colW[i];
        });
      };

      drawRow(headers, y, true); y += rowH;
      tickets.forEach(tk => {
        if (y > pageHeight - 20) {
          doc.addPage('l');
          y = 20;
          drawRow(headers, y, true); y += rowH;
        }
        drawRow([
          tk.ticket,
          tk.name || '',
          tk.identifier || tk.attendant || '',
          tk.type || '',
          label(tk.status),
          tk.enteredBr || fmt(tk.entered) || '',
          tk.calledBr || fmt(tk.called) || '',
          tk.attendedBr || fmt(tk.attended) || '',
          tk.cancelledBr || fmt(tk.cancelled) || '',
          tk.waitHms || msToHms(tk.wait) || '',
          tk.durationHms || msToHms(tk.duration) || ''
        ], y);
        y += rowH;
      });

      doc.addPage('l');
      const img = reportChartEl.toDataURL('image/png');
      doc.addImage(img, 'PNG', marginX, 20, 170, 80);

      doc.save('relatorio.pdf');
    };

    reportClose.onclick = () => { reportModal.hidden = true; };
  }


  /** Exibe QR Code para espelhar monitor */
  function openViewModal(t) {
    if (!t) return;
    viewQrEl.innerHTML = '';
    const url = `${location.origin}/monitor/?t=${t}&empresa=${encodeURIComponent(cfg.empresa)}`;
    new QRCode(viewQrEl, { text: url, width: 256, height: 256 });
    navigator.clipboard.writeText(url).then(() => {
      const info = document.getElementById('view-copy-info');
      if (info) info.hidden = false;
    }).catch(() => {});
    viewModal.hidden = false;
  }

  async function openCloneModal(t) {
    if (!t) return;
    cloneQrEl.innerHTML = '';
    let seq = 1;
    try {
      const res = await fetch(`/.netlify/functions/listClones?t=${t}`);
      const { clones = [] } = await res.json();
      seq = clones.filter(c => c !== cloneId).length + 1;
    } catch (e) { console.error('listClones', e); }
    const url = `${location.origin}/monitor-attendant/?t=${t}&empresa=${encodeURIComponent(cfg.empresa)}&clone=1&n=${seq}`;
    new QRCode(cloneQrEl, { text: url, width: 256, height: 256 });
    navigator.clipboard.writeText(url).then(() => {
      const info = document.getElementById('clone-copy-info');
      if (info) info.hidden = false;
    }).catch(() => {});
    cloneModal.hidden = false;
  }

  async function registerClone(t) {
    try {
      await fetch(`${location.origin}/.netlify/functions/registerClone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t, cloneId })
      });
    } catch (e) { console.error('registerClone', e); }
  }

  async function revokeClone(t, id) {
    if (!confirm('Revogar clone?')) return;
    try {
      await fetch(`${location.origin}/.netlify/functions/cancelClone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t, cloneId: id })
      });
    } catch (e) { console.error('cancelClone', e); }
    localStorage.removeItem(`cloneSeq_${id}`);
    loadCloneList(t);
  }

  async function loadCloneList(t) {
    if (!t) return;
    try {
      const res = await fetch(`/.netlify/functions/listClones?t=${t}`);
      const { clones = [] } = await res.json();
      if (isClone) {
        if (!clones.includes(cloneId)) {
          localStorage.clear();
          history.replaceState(null, '', '/');
          location.href = '/';
        }
      } else if (clonesPanel && cloneListEl) {
        const others = clones.filter(c => c !== cloneId);
        cloneListEl.innerHTML = '';
        clonesPanel.hidden = others.length === 0;
        others.forEach((id, idx) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.className = 'btn btn-secondary';
          btn.textContent = `Revogar ${idx + 1}`;
          btn.onclick = () => revokeClone(t, id);
          li.appendChild(btn);
          cloneListEl.appendChild(li);
        });
      }
    } catch (e) {
      console.error('listClones', e);
    }
  }

  /** Inicializa botões e polling */
  function initApp(t) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(pollingId);
      } else {
        refreshAll(t);
        pollingId = setInterval(() => refreshAll(t), 8000);
      }
    });

    btnNext.onclick = async () => {
      if (currentCallNum > 0) {
        if (prioritySet.has(currentCallNum)) {
          alert('Finalize o ticket preferencial antes de chamar o próximo normal.');
          return;
        }
        if (!confirm('Ainda há um ticket normal sendo chamado. Avançar fará com que ele perca a vez. Continuar?')) {
          return;
        }
      }
      const id = attendantInput.value.trim();
      let url = `/.netlify/functions/chamar?t=${t}`;
      if (id) url += `&id=${encodeURIComponent(id)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const msg = await res.text();
        if (currentCallNum > 0 && msg.startsWith('Sem tickets')) {
          updateCall(0, '');
        }
        alert(msg);
        refreshAll(t);
        return;
      }
      const { called, attendant } = await res.json();
      updateCall(called, attendant);
      refreshAll(t);
    };
    btnNextPref.onclick = async () => {
      if (currentCallNum > 0) {
        if (!prioritySet.has(currentCallNum)) {
          alert('Finalize o ticket normal antes de chamar o próximo preferencial.');
          return;
        }
        if (!confirm('Ainda há um ticket preferencial sendo chamado. Avançar fará com que ele perca a vez. Continuar?')) {
          return;
        }
      }
      const id = attendantInput.value.trim();
      let url = `/.netlify/functions/chamar?t=${t}&priority=1`;
      if (id) url += `&id=${encodeURIComponent(id)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const msg = await res.text();
        if (currentCallNum > 0 && msg.startsWith('Sem tickets')) {
          updateCall(0, '');
        }
        alert(msg);
        refreshAll(t);
        return;
      }
      const { called, attendant } = await res.json();
      updateCall(called, attendant);
      refreshAll(t);
    };
    btnRepeat.onclick = async () => {
      if (!currentCallNum) return;
      const id = attendantInput.value.trim();
      let url = `/.netlify/functions/chamar?t=${t}&num=${currentCallNum}`;
      if (id) url += `&id=${encodeURIComponent(id)}`;
      const { called, attendant } = await (await fetch(url)).json();
      updateCall(called, attendant);
      refreshAll(t);
    };
    btnDone.onclick = async () => {
      if (!currentCallNum) return;
      await fetch(`/.netlify/functions/atendido?t=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: currentCallNum })
      });
      refreshAll(t);
    };
    btnTicket.onclick = async () => {
      const name = prompt('Nome do cliente:');
      if (!name) return;
      await fetch(`/.netlify/functions/manualTicket?t=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      refreshAll(t);
    };
    btnTicketPref.onclick = async () => {
      const name = prompt('Nome do cliente:');
      if (!name) return;
      await fetch(`/.netlify/functions/manualTicket?t=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, priority: true })
      });
      refreshAll(t);
    };
    setTicketBtn.onclick = async () => {
      const desired = Number(nextTicketInput.value);
      const min = Number(nextTicketInput.min);
      if (isNaN(desired) || desired < min) {
        ticketError.textContent = `Número deve ser >= ${min}`;
        return;
      }
      ticketError.textContent = '';
      try {
        const res = await fetch(`/.netlify/functions/setTicketCounter?t=${t}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket: desired })
        });
        if (!res.ok) {
          const txt = await res.text();
          ticketError.textContent = txt || 'Erro ao definir ticket';
          return;
        }
        refreshAll(t);
      } catch (e) {
        ticketError.textContent = 'Erro de conexão';
      }
    };
    btnReset.onclick = async () => {
      if (!confirm('Confirma resetar todos os tickets para 1?')) return;
      await fetch(`/.netlify/functions/reset?t=${t}`, { method: 'POST' });
      updateCall(0, '');
      ticketCounter = 0;
      if (nextTicketInput) {
        nextTicketInput.value = '1';
        nextTicketInput.min   = '1';
      }
      if (lastTicketSpan) lastTicketSpan.textContent = '0';
      updateTicketSetter();
      refreshAll(t);
    };
    btnReport.onclick = () => openReport(t);
    btnView.onclick   = () => openViewModal(t);
    viewClose.onclick  = () => {
      viewModal.hidden = true;
      const info = document.getElementById('view-copy-info');
      if (info) info.hidden = true;
    };
    renderQRCode(t);
    registerClone(t);
    refreshAll(t);
    clearInterval(pollingId);
    pollingId = setInterval(() => refreshAll(t), 8000);
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
      if (empresaParam && cfg.empresa !== empresaParam) {
        // Nome de empresa na URL difere do salvo, descartar configuração
        localStorage.removeItem('monitorConfig');
        cfg = null;
        token = urlParams.get('t');
      } else {
        if (prefDeskToggle) prefDeskToggle.checked = cfg.preferentialDesk !== false;
        showApp(cfg.empresa, token);
        return;
      }
    }

    // 2) Se vier ?t e ?empresa na URL, solicita senha (ou usa ?senha)
    if (token && empresaParam) {
      loginOverlay.hidden   = true;
      onboardOverlay.hidden = true;
      const senhaPrompt = senhaParam || prompt(`Digite a senha de acesso para a empresa ${empresaParam}:`);
      try {
        const res = await fetch(`${location.origin}/.netlify/functions/getMonitorConfig`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token, senha: senhaPrompt })
        });
        if (!res.ok) throw new Error();
        const { empresa, schedule, preferentialDesk } = await res.json();
        cfg = { token, empresa, senha: senhaPrompt, schedule, preferentialDesk };
        localStorage.setItem('monitorConfig', JSON.stringify(cfg));
        if (prefDeskToggle) prefDeskToggle.checked = cfg.preferentialDesk !== false;
        history.replaceState(null, '', `/monitor-attendant/?empresa=${encodeURIComponent(empresaParam)}`);
        showApp(empresa, token);
        return;
      } catch {
        try {
          const dbgRes = await fetch(`${location.origin}/.netlify/functions/debugMonitorData`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, senha: senhaPrompt })
          });
          const dbgData = await dbgRes.json();
          console.log('debugMonitorData', dbgData);
        } catch (e) {
          console.error('debugMonitorData falhou:', e);
        }
        alert('Token ou senha inválidos.');
        history.replaceState(null, '', '/monitor-attendant/');
      }
    }

    // 3) Senão, exibir onboarding para trial
    onboardOverlay.hidden = false;
    loginOverlay.hidden   = true;


    loginSubmit.onclick = async () => {
      const empresa = loginCompany.value.trim();
      const pw      = loginPassword.value;
      if (!empresa || !pw) {
        loginError.textContent = 'Preencha empresa e senha.';
        return;
      }
      loginError.textContent = '';
      try {
        const res = await fetch('/.netlify/functions/getMonitorToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empresa, senha: pw })
        });
        let data;
        let text;
        try {
          text = await res.text();
          data = JSON.parse(text);
        } catch (parseErr) {
          console.error('JSON parse error:', parseErr, text);
          loginError.textContent = 'Erro inesperado no servidor.';
          return;
        }
        if (!res.ok || !data.token) {
          const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        token = data.token;
        const cfgRes = await fetch('/.netlify/functions/getMonitorConfig', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, senha: pw })
        });
        const cfgData = await cfgRes.json();
        cfg = { token, empresa: cfgData.empresa, senha: pw, schedule: cfgData.schedule, preferentialDesk: cfgData.preferentialDesk };
        localStorage.setItem('monitorConfig', JSON.stringify(cfg));
        if (prefDeskToggle) prefDeskToggle.checked = cfg.preferentialDesk !== false;
        history.replaceState(null, '', `/monitor-attendant/?empresa=${encodeURIComponent(cfgData.empresa)}`);
        showApp(cfgData.empresa, token);
      } catch (e) {
        console.error(e);
        loginError.textContent = 'Empresa ou senha inválida.';
      }
    };

    onboardLogin.onclick = async () => {
      const label = onboardLabel.value.trim();
      const pw    = onboardPassword.value;
      if (!label || !pw) {
        onboardError.textContent = 'Preencha nome e senha.';
        return;
      }
      onboardError.textContent = '';
      try {
        const res = await fetch('/.netlify/functions/getMonitorToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empresa: label, senha: pw })
        });
        const data = await res.json();
        if (!res.ok || !data.token) throw new Error();
        token = data.token;
        const cfgRes = await fetch('/.netlify/functions/getMonitorConfig', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, senha: pw })
        });
        const cfgData = await cfgRes.json();
        cfg = { token, empresa: cfgData.empresa, senha: pw, schedule: cfgData.schedule, preferentialDesk: cfgData.preferentialDesk };
        localStorage.setItem('monitorConfig', JSON.stringify(cfg));
        if (prefDeskToggle) prefDeskToggle.checked = cfg.preferentialDesk !== false;
        history.replaceState(null, '', `/monitor-attendant/?empresa=${encodeURIComponent(cfgData.empresa)}`);
        showApp(cfgData.empresa, token);
      } catch (e) {
        console.error(e);
        onboardError.textContent = 'Empresa ou senha inválida.';
      }
    };

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
        const days = Array.from(scheduleDays).filter(d => d.checked).map(d => Number(d.value));
        const intervals = [];
        if (use1Checkbox.checked) intervals.push({ start: start1Input.value, end: end1Input.value });
        if (use2Checkbox.checked) intervals.push({ start: start2Input.value, end: end2Input.value });
        const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const schedule = { days, intervals, tz };
        const res = await fetch(`${location.origin}/.netlify/functions/saveMonitorConfig`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ token, empresa: label, senha: pw, trialDays, schedule, preferentialDesk: true })
        });
        const { ok } = await res.json();
        if (!ok) throw new Error();
        cfg = { token, empresa: label, senha: pw, schedule, preferentialDesk: true };
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

const $btnNext     = document.querySelector('[data-action="next"]');
const $btnPriority = document.querySelector('[data-action="priority"]');
const $btnAttended = document.querySelector('[data-action="attended"]');
const $btnRepeat   = document.querySelector('[data-action="repeat"]');
const $btnTicketNormal = document.querySelector('[data-action="ticket-normal"]');
const $btnTicketPref   = document.querySelector('[data-action="ticket-preferential"]');

function isTyping(el){
  if(!el) return false;
  const tag = el.tagName?.toLowerCase();
  return el.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

function flash(btn){
  if(!btn) return;
  btn.classList.add('kbd-flash');
  setTimeout(()=>btn.classList.remove('kbd-flash'),150);
}

function clickIfEnabled(btn){ if(btn && !btn.disabled) btn.click(); }

document.addEventListener('keydown', (ev)=>{
  if(ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if(isTyping(document.activeElement)) return;

  const k = ev.key?.toLowerCase();
  if(['n','p','a','r','t'].includes(k)) ev.preventDefault();

  if(k === 'n'){ clickIfEnabled($btnNext);     flash($btnNext); }
  if(k === 'p'){ clickIfEnabled($btnPriority); flash($btnPriority); }
  if(k === 'a'){ clickIfEnabled($btnAttended); flash($btnAttended); }
  if(k === 'r'){ clickIfEnabled($btnRepeat);   flash($btnRepeat); }
  if(k === 't'){
    if(ev.shiftKey){ clickIfEnabled($btnTicketPref); flash($btnTicketPref); }
    else{            clickIfEnabled($btnTicketNormal); flash($btnTicketNormal); }
  }
});
