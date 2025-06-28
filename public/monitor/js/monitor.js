
// public/monitor/js/monitor.js
// Captura o tenantId a partir da URL para poder consultar o status correto
const urlParams = new URL(window.location.href).searchParams;
const tenantId  = urlParams.get('t');
const empresa   = urlParams.get('empresa');

if (empresa) {
  const el = document.getElementById('company-name');
  if (el) el.textContent = decodeURIComponent(empresa);
}

let lastCall = 0;
const alertSound   = document.getElementById('alert-sound');
const unlockOverlay = document.getElementById('unlock-overlay');
let wakeLock = null;

// Desbloqueia o audio na primeira interação do usuário para evitar
// que o navegador bloqueie a execução do som de alerta
if (alertSound) {
  const unlock = () => {
    alertSound.volume = 0;
    const p = alertSound.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        alertSound.pause();
        alertSound.currentTime = 0;
      }).catch(() => {});
    }
    alertSound.volume = 1;
    requestWakeLock();
    if (unlockOverlay) unlockOverlay.classList.add('hidden');
    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    if (unlockOverlay) unlockOverlay.removeEventListener('click', unlock);
  };
  document.addEventListener('click', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  if (unlockOverlay) unlockOverlay.addEventListener('click', unlock);
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

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) requestWakeLock();
});

window.addEventListener('beforeunload', () => {
  releaseWakeLock();
});

function alertUser(num, name) {
  if (alertSound) {
    alertSound.currentTime = 0;
    alertSound.play().catch(() => {});
  }
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(`É a sua vez: ${num} ${name || ''}`);
    utter.lang = 'pt-BR';
    speechSynthesis.speak(utter);
  }
}

async function fetchCurrent() {
  try {
    const url = '/.netlify/functions/status' + (tenantId ? `?t=${tenantId}` : '');
    const res = await fetch(url);
    const { currentCall, names = {} } = await res.json();
    const currentEl = document.getElementById('current');
    const nameEl = document.getElementById('current-name');
    const container = document.querySelector('.container');
    const name = names[currentCall];
    currentEl.textContent = currentCall;
    if (name) {
      currentEl.classList.add('manual');
      nameEl.textContent = name;
    } else {
      currentEl.classList.remove('manual');
      nameEl.textContent = '';
    }
    if (currentCall && currentCall !== lastCall) {
      alertUser(currentCall, name);
      container.classList.add('blink');
      setTimeout(() => container.classList.remove('blink'), 5000);
      lastCall = currentCall;
    }
  } catch (e) {
    console.error('Erro ao buscar currentCall:', e);
  }
}

// Polling a cada 2 segundos
fetchCurrent();
setInterval(fetchCurrent, 2000);

requestWakeLock();
