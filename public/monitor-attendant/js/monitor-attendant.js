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
  const queueListEl    = document.getElementById('queue-list');
  const btnNext        = document.getElementById('btn-next');
  const btnRepeat      = document.getElementById('btn-repeat');
  const btnAttended    = document.getElementById('btn-attended');
  const btnNewManual   = document.getElementById('btn-new-manual');
  const btnReset       = document.getElementById('btn-reset');
  const btnReport      = document.getElementById('btn-report');
  const btnShare       = document.getElementById('btn-share-monitor');
  const btnView        = document.getElementById('btn-view-monitor');
  const reportModal    = document.getElementById('report-modal');
  const reportClose    = document.getElementById('report-close');
  const reportTitle    = document.getElementById('report-title');
  const reportSummary  = document.getElementById('report-summary');
  const reportChartEl  = document.getElementById('report-chart');
  const shareModal     = document.getElementById('share-modal');
  const shareClose     = document.getElementById('share-close');
  const shareQrEl      = document.getElementById('share-qrcode');
  const viewModal      = document.getElementById('view-modal');
  const viewClose      = document.getElementById('view-close');
  const viewQrEl       = document.getElementById('view-qrcode');

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

  let currentCallNum = 0; // último número chamado exibido
  let ticketNames    = {};
  let ticketCounter  = 0;
  let callCounter    = 0;
  let cancelledNums  = [];
  let missedNums     = [];
  let cancelledCount = 0;
  let missedCount    = 0;
  let attendedNums   = [];
  let attendedCount  = 0;
  const fmtTime     = ts => new Date(ts).toLocaleString('pt-BR');
  const msToHms = (ms) => {
    if (!ms) return '-';
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2,'0');
    const m = String(Math.floor((s % 3600)/60)).padStart(2,'0');
    const sec = String(s % 60).padStart(2,'0');
    return `${h}:${m}:${sec}`;
  };

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

  function updateQueueList() {
    if (!queueListEl) return;
    queueListEl.innerHTML = '';
    const pending = [];
    for (let i = callCounter + 1; i <= ticketCounter; i++) {
      if (i === currentCallNum) continue;
      if (cancelledNums.includes(i) || missedNums.includes(i) || attendedNums.includes(i)) continue;
      pending.push(i);
    }
    pending.forEach(n => {
      const li = document.createElement('li');
      const nm = ticketNames[n];
      li.textContent = nm ? `${n} - ${nm}` : String(n);
      queueListEl.appendChild(li);
    });
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
        cancelledCount: cc = 0,
        missedCount: mc = 0,
        attendedCount: ac = 0,
        waiting = 0,
        names = {}
      } = await res.json();

      currentCallNum  = currentCall;
      ticketCounter   = tc;
      callCounter     = cCtr;
      ticketNames     = names || {};
      cancelledNums   = cancelledNumbers.map(Number);
      missedNums      = missedNumbers.map(Number);
      attendedNums    = attendedNumbers.map(Number);
      cancelledCount  = cc || cancelledNums.length;
      missedCount     = mc || missedNums.length;
      attendedCount   = ac;

      const cName = ticketNames[currentCall];
      currentCallEl.textContent = currentCall > 0 ? currentCall : '–';
      if (cName) currentCallEl.textContent += ` - ${cName}`;
      currentIdEl.textContent   = attendantId || '';
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

      updateQueueList();

      // Exibe o botão de relatório apenas se houver tickets registrados
      btnReport.hidden = ticketCounter === 0;
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

  function refreshAll(t) {
    fetchStatus(t).then(() => { fetchCancelled(t); fetchAttended(t); });
  }

  async function openReport(t) {
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
      totalTickets = 0,
      attendedCount = 0,
      cancelledCount = 0,
      missedCount = 0,
      waitingCount = 0,
      avgWait = 0,
      avgDur = 0,
      avgWaitHms = '00:00:00',
      avgDurHms = '00:00:00'
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
        <p>Tempo médio de espera: ${avgWaitHms}</p>
        <p>Tempo médio de atendimento: ${avgDurHms}</p>
        <p>Cancelados: ${cancelledCount}</p>
        <p>Perderam a vez: ${missedCount}</p>
        <p>Em espera: ${waitingCount}</p>`;
    }

    // Monta tabela
    const table = document.getElementById('report-table');
    table.innerHTML = '<thead><tr><th>Ticket</th><th>Nome</th><th>Status</th><th>Entrada</th><th>Chamada</th><th>Atendido</th><th>Cancelado</th><th>Espera</th><th>Duração</th></tr></thead>';
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
        <td>${tk.name || ''}</td>
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

      const headers = ['Ticket','Nome','Status','Entrada','Chamada','Atendido','Cancelado','Espera','Duração'];
      const rows = [];
      rows.push('<row r="1">' + headers.map((h,i)=>`<c r="${col(i)}1" t="inlineStr"><is><t>${esc(h)}</t></is></c>`).join('') + '</row>');
      tickets.forEach((tk,idx)=>{
        const vals=[tk.ticket,tk.name||'',label(tk.status),tk.enteredBr||fmt(tk.entered)||'',tk.calledBr||fmt(tk.called)||'',tk.attendedBr||fmt(tk.attended)||'',tk.cancelledBr||fmt(tk.cancelled)||'',tk.waitHms||msToHms(tk.wait)||'',tk.durationHms||msToHms(tk.duration)||''];
        const r=idx+2;
        rows.push('<row r="'+r+'">'+vals.map((v,i)=>`<c r="${col(i)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')+'</row>');
      });
      let r = tickets.length + 3;
      rows.push(`<row r="${r}"><c t="inlineStr"><is><t>Total tickets</t></is></c><c t="inlineStr"><is><t>${totalTickets}</t></is></c></row>`); r++;
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
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF('l', 'mm', 'a4');
      const nowStr = new Date().toLocaleString('pt-BR');

      doc.setFontSize(16);
      doc.text(`Relatório - ${cfg?.empresa || ''}`, 105, 15, { align: 'center' });
      doc.setFontSize(10);
      doc.text(`Gerado em: ${nowStr}`, 105, 22, { align: 'center' });

      let y = 30;
      doc.setFontSize(12);
      const summaryLines = [
        `Total de tickets: ${totalTickets}`,
        `Atendidos: ${attendedCount}`,
        `Cancelados: ${cancelledCount}`,
        `Perderam a vez: ${missedCount}`,
        `Em espera: ${waitingCount}`,
        `Tempo médio de espera: ${avgWaitHms}`,
        `Tempo médio de atendimento: ${avgDurHms}`
      ];
      summaryLines.forEach(line => { doc.text(line, 20, y); y += 7; });

      const headers = ['Ticket','Nome','Status','Entrada','Chamada','Atendido','Cancelado','Espera','Duração'];
      const colW = [15, 40, 25, 30, 30, 30, 30, 25, 25];
      const startX = 20;
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
        if (y > 190) {
          doc.addPage('l');
          y = 20;
          drawRow(headers, y, true); y += rowH;
        }
        drawRow([
          tk.ticket,
          tk.name || '',
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
      doc.addImage(img, 'PNG', 20, 20, 170, 80);

      doc.save('relatorio.pdf');
    };

    reportClose.onclick = () => { reportModal.hidden = true; };
  }

  /** Exibe QR Code para duplicar monitor */
  function openShareModal(t) {
    if (!t || !cfg) return;
    shareQrEl.innerHTML = '';
    const url = `${location.origin}/monitor-attendant/?t=${t}&empresa=${encodeURIComponent(cfg.empresa)}&senha=${encodeURIComponent(cfg.senha)}`;
    new QRCode(shareQrEl, { text: url, width: 256, height: 256 });
    shareModal.hidden = false;
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
    btnNewManual.onclick = async () => {
      const name = prompt('Nome do cliente:');
      if (!name) return;
      await fetch(`/.netlify/functions/manualTicket?t=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      refreshAll(t);
    };
    btnReset.onclick = async () => {
      if (!confirm('Confirma resetar todos os tickets para 1?')) return;
      await fetch(`/.netlify/functions/reset?t=${t}`, { method: 'POST' });
      updateCall(0, '');
      refreshAll(t);
    };
    btnReport.onclick = () => openReport(t);
    btnShare.onclick  = () => openShareModal(t);
    btnView.onclick   = () => openViewModal(t);
    shareClose.onclick = () => { shareModal.hidden = true; };
    viewClose.onclick  = () => {
      viewModal.hidden = true;
      const info = document.getElementById('view-copy-info');
      if (info) info.hidden = true;
    };
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

    // 2) Se vier ?t e ?empresa na URL, solicita senha (ou usa ?senha)
    if (token && empresaParam) {
      loginOverlay.hidden   = true;
      onboardOverlay.hidden = true;
      try {
        const senhaPrompt = senhaParam || prompt(`Digite a senha de acesso para a empresa ${empresaParam}:`);
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
        cfg = { token, empresa, senha: pw };
        localStorage.setItem('monitorConfig', JSON.stringify(cfg));
        history.replaceState(null, '', `/monitor-attendant/?empresa=${encodeURIComponent(empresa)}`);
        showApp(empresa, token);
      } catch (e) {
        console.error(e);
        loginError.textContent = 'Empresa ou senha inválida.';
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
