// public/monitor/js/monitor.js
const currentEl   = document.getElementById('current');
const nameEl      = document.getElementById('name');
const btnSilence  = document.getElementById('btn-silence');
const alertSound  = document.getElementById('alert-sound');
let lastTs        = 0;
let alertInterval = null;
let silenced      = false;

function doAlert() {
  if (silenced) return;
  alertSound.currentTime = 0;
  alertSound.play().catch(()=>{});
}

async function fetchCurrent() {
  try {
    const res = await fetch('/.netlify/functions/status');
    const { currentCall, currentName = '', timestamp } = await res.json();
    currentEl.textContent = currentCall;
    nameEl.textContent    = currentName;
    document.body.classList.toggle('manual-ticket', !!currentName);
    if (currentCall && timestamp > lastTs) {
      silenced = false;
      btnSilence.hidden = false;
      nameEl.classList.add('blink');
      doAlert();
      clearInterval(alertInterval);
      alertInterval = setInterval(doAlert, 5000);
      lastTs = timestamp;
    }
  } catch (e) {
    console.error('Erro ao buscar currentCall:', e);
  }
}

btnSilence.addEventListener('click', () => {
  silenced = true;
  clearInterval(alertInterval);
  alertSound.pause();
  alertSound.currentTime = 0;
  btnSilence.hidden = true;
  nameEl.classList.remove('blink');
});

fetchCurrent();
setInterval(fetchCurrent, 2000);
