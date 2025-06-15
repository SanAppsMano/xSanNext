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

async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      const res = await fetch('/.netlify/functions/sendPush');
      const { publicKey } = await res.json();
      const uintKey = Uint8Array.from(atob(publicKey.replace(/_/g, '/').replace(/-/g, '+')), c => c.charCodeAt(0));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: uintKey });
      localStorage.setItem('pushSub', JSON.stringify(sub));
    } catch (e) {
      console.error('push subscribe', e);
      return;
    }
  }
  try {
    await fetch('/.netlify/functions/sendPush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, subscription: sub })
    });
  } catch (e) {
    console.error('register push', e);
  }
}

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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ticketNumber) {
    requestWakeLock();
  }
});

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

btnStart.addEventListener("click", () => {
  // som/vibração de teste
  alertSound.play().then(() => alertSound.pause()).catch(()=>{});
  if (navigator.vibrate) navigator.vibrate(1);
  if ("Notification" in window) Notification.requestPermission();
  overlay.remove();
  requestWakeLock();
  btnJoin.hidden = true;
  btnCancel.hidden = false;
  btnCancel.disabled = false;
  getTicket();
  subscribePush();
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
  subscribePush();
}

async function checkStatus() {
  if (!ticketNumber) return;
  const res = await fetch(`/.netlify/functions/status?t=${tenantId}`);
  const { currentCall, ticketCounter, timestamp, attendant, missedNumbers = [], attendedNumbers = [] } = await res.json();

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
    statusEl.textContent = `Chamando: ${currentCall} (${attendant})`;
    btnCancel.disabled = false;
    statusEl.classList.remove("blink");
    return;
  }

  statusEl.textContent = `É a sua vez! (Atendente: ${attendant})`;
  statusEl.classList.add("blink");
  btnCancel.disabled = true;

  if (timestamp > lastEventTs) {
    silenced    = false;
    lastEventTs = timestamp;
    if (!callStartTs) callStartTs = timestamp;
    alertUser();
  }
}

function alertUser() {
  btnSilence.hidden = false;
  requestWakeLock();
  const doAlert = () => {
    if (silenced) return;
    alertSound.currentTime = 0;
    alertSound.play().catch(()=>{});
    if (navigator.vibrate) navigator.vibrate([200,100,200]);
  };
  doAlert();
  sendNotification();
  alertInterval = setInterval(doAlert, 5000);
}

async function sendNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('sw.js');
    const opts = {
      body: `Ticket ${ticketNumber} - dirija-se ao atendimento`,
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
  requestWakeLock();
  getTicket();
  subscribePush();
  polling = setInterval(checkStatus, 2000);
});
