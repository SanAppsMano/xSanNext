// public/client/js/client.js
import { withinSchedule, msUntilNextInterval } from "./schedule.js";

// Captura o tenantId da URL
const urlParams = new URL(location).searchParams;
const tenantId  = urlParams.get("t");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(console.error);
}

// pega também o nome da empresa
const empresa = urlParams.get("empresa");
if (empresa) {
  // cria o header se ainda não existir
  const companyEl = document.getElementById("company-name");
  if (companyEl) companyEl.textContent = decodeURIComponent(empresa);
}


// elementos
const ticketEl   = document.getElementById("ticket");
const statusEl   = document.getElementById("status");
const btnCancel  = document.getElementById("btn-cancel");
const btnCheck   = document.getElementById("btn-check");
const btnSilence   = document.getElementById("btn-silence");
const btnNormal      = document.getElementById("btn-normal");
const btnPreferencial = document.getElementById("btn-preferencial");
const overlay        = document.getElementById("overlay");
const alertSound = document.getElementById("alert-sound");

let clientId, ticketNumber;
let selectedPriority = false;
let polling, alertInterval, resumeTimeout, countdownInterval;
let lastEventTs = 0;
let wakeLock = null;
let silenced   = false;
let callStartTs = 0;
let schedule = null;
const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const defaultSchedule = {
  days: [1, 2, 3, 4, 5],
  intervals: [
    { start: '09:00', end: '12:00' },
    { start: '13:00', end: '18:00' }
  ]
};

async function safeFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 404 || res.status === 410) {
    handleExit('Procedimento inválido. Solicite um novo link ou QR.');
    return null;
  }
  return res;
}

async function fetchSchedule() {
  try {
    const res = await safeFetch(`/.netlify/functions/getSchedule?t=${tenantId}`);
    if (!res) {
      schedule = defaultSchedule;
      return;
    }
    if (res.ok) {
      const data = await res.json();
      schedule = data.schedule || defaultSchedule;
    } else {
      schedule = defaultSchedule;
    }
  } catch (e) {
    console.error('schedule', e);
    schedule = defaultSchedule;
  }
}

function schedulePolling() {
  if (polling) {
    clearInterval(polling);
    polling = null;
  }
  clearTimeout(resumeTimeout);
  clearInterval(countdownInterval);
  if (withinSchedule(schedule, userTz)) {
    polling = setInterval(checkStatus, 5000);
    checkStatus();
    btnCheck.hidden = true;
  } else {
    const ms = msUntilNextInterval(schedule, userTz);
    if (ms != null) {
      const target = Date.now() + ms;
      const update = () => {
        const diff = target - Date.now();
        if (diff <= 0) return;
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        statusEl.textContent = `Fora do horário de atendimento. Retorna em ${h}:${m}:${s}`;
      };
      update();
      countdownInterval = setInterval(update, 1000);
      resumeTimeout = setTimeout(() => {
        clearInterval(countdownInterval);
        schedulePolling();
      }, ms);
    } else {
      statusEl.textContent = "Fora do horário de atendimento.";
    }
    btnCheck.hidden = !ticketNumber;
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch (e) {
    console.error('wakeLock', e);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function handleExit(msg) {
  clearInterval(polling);
  clearInterval(alertInterval);
  clearTimeout(resumeTimeout);
  clearInterval(countdownInterval);
  ticketNumber = null;
  callStartTs = 0;
  lastEventTs = 0;
  releaseWakeLock();
  ticketEl.textContent = "–";
  statusEl.textContent = msg;
  statusEl.classList.remove("blink");
  btnSilence.hidden = true;
  btnCancel.hidden = true;
  btnCheck.hidden = true;
  overlay.style.display = "flex";
}

// AVISO AO RECARREGAR/FECHAR A PÁGINA
window.addEventListener('beforeunload', function (e) {
  // só perguntar se tiver um ticket válido e sem ter saído
  if (ticketNumber && statusEl.textContent !== "Você saiu da fila.") {
    const confirmationMessage = "Ao atualizar ou fechar a página você perderá seu número na fila. Deseja continuar?";
    e.preventDefault();
    e.returnValue = confirmationMessage;
    return confirmationMessage;
  }
});

// ao voltar para a aba, tenta reativar o wake lock se ainda estiver com ticket
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ticketNumber) requestWakeLock();
});

async function start(priority) {
  selectedPriority = priority;
  alertSound.play().then(() => alertSound.pause()).catch(()=>{});
  if (navigator.vibrate) navigator.vibrate(1);
  if ("Notification" in window) Notification.requestPermission();
  overlay.style.display = "none";
  btnCancel.hidden = false;
  btnCancel.disabled = false;
  await fetchSchedule();
  await getTicket(priority);
  schedulePolling();
}

btnNormal.addEventListener("click", () => start(false));
btnPreferencial.addEventListener("click", () => start(true));

async function getTicket(priority = false) {
  const res = await safeFetch(`/.netlify/functions/entrar?t=${tenantId}${priority ? '&priority=true' : ''}`);
  if (!res) return;
  const data = await res.json();
  clientId     = data.clientId;
  ticketNumber = data.ticketNumber;
  ticketEl.textContent  = priority ? `P${ticketNumber}` : ticketNumber;
  statusEl.textContent  = "Aguardando chamada...";
  if (priority) statusEl.textContent += " (Preferencial)";
  btnCancel.hidden = false;
  btnCancel.disabled = false;
  callStartTs = 0;
  lastEventTs = 0;
  requestWakeLock();
  sendWelcomeNotification();
}

function renderAheadCount(value, label) {
  const el = document.getElementById('aheadCount');
  if (!el) { throw new Error('#aheadCount não encontrado'); }
  const n = Math.max(0, Number(value) || 0);
  el.textContent = String(n);
  const textEl = document.getElementById('aheadText');
  if (textEl) textEl.textContent = label;
  const pill = document.getElementById('aheadPill');
  if (pill) { pill.title = label; pill.setAttribute('aria-label', label); }
}

async function checkStatus() {
  if (!ticketNumber) return;
  if (!withinSchedule(schedule, userTz)) {
    statusEl.textContent = "Fora do horário de atendimento.";
    clearInterval(polling);
    schedulePolling();
    return;
  }
  const res = await safeFetch(`/.netlify/functions/status?t=${tenantId}`);
  if (!res) return;
  const status = await res.json();
  const {
    currentCall,
    callCounter = 0,
    ticketCounter,
    timestamp,
    attendant,
    cancelledNumbers = [],
    missedNumbers = [],
    attendedNumbers = [],
    skippedNumbers = [],
    offHoursNumbers = [],
    names = {},
    priorityNumbers = [],
  } = status;
  const myName = names[ticketNumber];
  const removed = new Set([
    ...cancelledNumbers,
    ...missedNumbers,
    ...attendedNumbers,
    ...skippedNumbers,
    ...offHoursNumbers,
  ].map(Number));
  const priNums = priorityNumbers.map(Number);
  const isPriority = priNums.includes(ticketNumber);
  let ahead = 0;
  let label = 'À sua frente:';
  if (status.preferentialDesk !== false) {
    if (isPriority) {
      label = 'Preferenciais à sua frente:';
      for (let n = callCounter + 1; n < ticketNumber; n++) {
        if (priNums.includes(n) && !removed.has(n)) ahead++;
      }
    } else {
      label = 'Normais à sua frente:';
      for (let n = callCounter + 1; n < ticketNumber; n++) {
        if (!priNums.includes(n) && !removed.has(n)) ahead++;
      }
    }
  } else {
    label = 'À sua frente:';
    for (let n = callCounter + 1; n < ticketNumber; n++) {
      if (n !== currentCall && !removed.has(n)) ahead++;
    }
  }
  renderAheadCount(ahead, label);

  if (ticketCounter < ticketNumber) {
    handleExit("Fila reiniciada. Entre novamente.");
    return;
  }

  if (cancelledNumbers.includes(ticketNumber)) {
    handleExit("Seu atendimento foi cancelado.");
    return;
  }

  if (missedNumbers.includes(ticketNumber)) {
    handleExit("Você perdeu a vez.");
    return;
  }

  if (attendedNumbers.includes(ticketNumber)) {
    handleExit("Atendimento concluído.");
    return;
  }

  if (
    !priorityNumbers.includes(ticketNumber) &&
    callCounter >= ticketNumber &&
    currentCall !== ticketNumber
  ) {
    const duration = callStartTs ? Date.now() - callStartTs : 0;
    const res = await safeFetch(`/.netlify/functions/cancelar?t=${tenantId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, reason: "missed", duration })
    });
    if (!res) return;
    let msg = "Você perdeu a vez.";
    try {
      const data = await res.json();
      if (data.alreadyAttended) msg = "Atendimento concluído.";
    } catch {}
    handleExit(msg);
    return;
  }

  if (currentCall !== ticketNumber) {
    const cname = names[currentCall];
    statusEl.textContent = cname ? `Chamando: ${currentCall} - ${cname} (${attendant})` : `Chamando: ${currentCall} (${attendant})`;
    btnCancel.disabled = false;
    statusEl.classList.remove("blink");
    return;
  }

  statusEl.textContent = `É a sua vez${myName ? ' - ' + myName : ''}! (Atendente: ${attendant})`;
  statusEl.classList.add("blink");
  btnCancel.disabled = true;

  if (timestamp > lastEventTs) {
    silenced    = false;
    lastEventTs = timestamp;
    if (!callStartTs) callStartTs = timestamp;
    alertUser(myName);
  }
}

async function verifyTicket() {
  if (!ticketNumber) return;
  await fetchSchedule();
  const res = await safeFetch(`/.netlify/functions/status?t=${tenantId}&tk=${ticketNumber}`);
  if (!res) {
    schedulePolling();
    return;
  }
  const { ticketCounter, missedNumbers = [], attendedNumbers = [] } = await res.json();
  if (ticketCounter < ticketNumber) {
    handleExit("Fila reiniciada. Entre novamente.");
    schedulePolling();
    return;
  }
  if (missedNumbers.includes(ticketNumber)) {
    handleExit("Você perdeu a vez.");
    schedulePolling();
    return;
  }
  if (attendedNumbers.includes(ticketNumber)) {
    handleExit("Atendimento concluído.");
    schedulePolling();
    return;
  }
  statusEl.textContent = "Sua senha permanece válida.";
  schedulePolling();
}

function alertUser(name) {
  btnSilence.hidden = false;
  requestWakeLock();
  const doAlert = () => {
    if (silenced) return;
    alertSound.currentTime = 0;
    alertSound.play().catch(()=>{});
    if (navigator.vibrate) navigator.vibrate([200,100,200]);
  };
  doAlert();
  sendNotification(name);
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(`É a sua vez: ${ticketNumber} ${name || ''}`);
    utter.lang = 'pt-BR';
    speechSynthesis.speak(utter);
  }
  alertInterval = setInterval(doAlert, 5000);
}

async function sendNotification(name) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('sw.js');
    const opts = {
      body: `Ticket ${ticketNumber}${name ? ' - ' + name : ''} - dirija-se ao atendimento`,
      vibrate: [200,100,200],
      tag: 'sannext-call',
      renotify: true,
      requireInteraction: true,
    };
    if (reg) {
      const prior = await reg.getNotifications({ tag: 'sannext-call' });
      prior.forEach(n => n.close());
      reg.showNotification('É a sua vez!', opts);
    } else {
      new Notification('É a sua vez!', opts);
    }
  } catch (e) {
    console.error('sendNotification', e);
  }
}

async function sendWelcomeNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('sw.js');
    const opts = {
      body: 'Mantenha a tela ativa para receber o chamado.',
      tag: 'sannext-welcome',
      renotify: false
    };
    if (reg) {
      const prior = await reg.getNotifications({ tag: 'sannext-welcome' });
      prior.forEach(n => n.close());
      reg.showNotification('Bem-vindo!', opts);
    } else {
      new Notification('Bem-vindo!', opts);
    }
  } catch (e) {
    console.error('sendWelcome', e);
  }
}

btnSilence.addEventListener("click", () => {
  silenced = true;
  clearInterval(alertInterval);
  alertSound.pause();
  alertSound.currentTime = 0;
  if (navigator.vibrate) navigator.vibrate(0);
  releaseWakeLock();
  btnSilence.hidden = true;
});

btnCancel.addEventListener("click", async () => {
  const confirmExit = confirm("Tem certeza que deseja sair da fila?");
  if (!confirmExit) return;

  btnCancel.disabled = true;
  statusEl.textContent = "Cancelando...";
  clearInterval(alertInterval);

  const res = await safeFetch(`/.netlify/functions/cancelar?t=${tenantId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, reason: "client" })
  });
  if (!res) return;

  releaseWakeLock();
  handleExit("Você saiu da fila.");
});
btnCheck.addEventListener("click", async () => {
  const originalText = btnCheck.textContent;
  btnCheck.disabled = true;
  btnCheck.classList.add("loading");
  btnCheck.textContent = "";
  await verifyTicket();
  setTimeout(() => {
    btnCheck.textContent = originalText;
    btnCheck.classList.remove("loading");
    btnCheck.disabled = false;
  }, 2000);
});
