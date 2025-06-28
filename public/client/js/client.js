// public/client/js/client.js

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
const btnJoin    = document.getElementById("btn-join");
const btnSilence = document.getElementById("btn-silence");
const btnStart   = document.getElementById("btn-start");
const overlay    = document.getElementById("overlay");
const alertSound = document.getElementById("alert-sound");

let clientId, ticketNumber;
let polling, alertInterval;
let lastEventTs = 0;
let wakeLock = null;
let silenced   = false;
let callStartTs = 0;

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
  ticketNumber = null;
  callStartTs = 0;
  lastEventTs = 0;
  releaseWakeLock();
  ticketEl.textContent = "–";
  statusEl.textContent = msg;
  statusEl.classList.remove("blink");
  btnSilence.hidden = true;
  btnCancel.hidden = true;
  btnJoin.hidden = false;
  btnJoin.disabled = false;
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

btnStart.addEventListener("click", () => {
  // som/vibração de teste
  alertSound.play().then(() => alertSound.pause()).catch(()=>{});
  if (navigator.vibrate) navigator.vibrate(1);
  if ("Notification" in window) Notification.requestPermission();
  overlay.remove();
  btnJoin.hidden = true;
  btnCancel.hidden = false;
  btnCancel.disabled = false;
  getTicket();
  polling = setInterval(checkStatus, 2000);
});

async function getTicket() {
  const res = await fetch(`/.netlify/functions/entrar?t=${tenantId}`);
  const data = await res.json();
  clientId     = data.clientId;
  ticketNumber = data.ticketNumber;
  ticketEl.textContent  = ticketNumber;
  statusEl.textContent  = "Aguardando chamada...";
  btnCancel.hidden = false;
  btnCancel.disabled = false;
  btnJoin.hidden = true;
  callStartTs = 0;
  lastEventTs = 0;
  requestWakeLock();
  sendWelcomeNotification();
}

async function checkStatus() {
  if (!ticketNumber) return;
  const res = await fetch(`/.netlify/functions/status?t=${tenantId}`);
  const { currentCall, ticketCounter, timestamp, attendant, missedNumbers = [], attendedNumbers = [], names = {} } = await res.json();
  const myName = names[ticketNumber];

  if (ticketCounter < ticketNumber) {
    handleExit("Fila reiniciada. Entre novamente.");
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

  if (currentCall > ticketNumber) {
    const duration = callStartTs ? Date.now() - callStartTs : 0;
    const res = await fetch(`/.netlify/functions/cancelar?t=${tenantId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, reason: "missed", duration })
    });
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

  await fetch(`/.netlify/functions/cancelar?t=${tenantId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, reason: "client" })
  });

  releaseWakeLock();
  handleExit("Você saiu da fila.");
});

btnJoin.addEventListener("click", () => {
  btnJoin.disabled = true;
  getTicket();
  polling = setInterval(checkStatus, 2000);
});
