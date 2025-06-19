// public/monitor/js/monitor.js
const currentEl = document.getElementById('current');
const nameEl    = document.getElementById('current-name');
const waitingEl = document.getElementById('waiting-list');
const btnSilence= document.getElementById('btn-silence');
const alertSound= document.getElementById('alert-sound');

let lastCall = 0;
let alertInterval;
let silenced = false;

function speak(text) {
  if ('speechSynthesis' in window && text) {
    const utter = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utter);
  }
}

function doAlert(name) {
  if (silenced) return;
  alertSound.currentTime = 0;
  alertSound.play().catch(()=>{});
  speak(`${name}, é a sua vez`);
}

async function fetchStatus() {
  try {
    const res = await fetch('/.netlify/functions/status');
    const { currentCall, currentName, names } = await res.json();

    currentEl.textContent = currentCall || '–';
    if (currentName) {
      nameEl.textContent = currentName;
      nameEl.hidden = false;
    } else {
      nameEl.hidden = true;
    }

    waitingEl.innerHTML = '';
    for (const num in names) {
      const li = document.createElement('li');
      li.textContent = `${num} - ${names[num]}`;
      waitingEl.appendChild(li);
    }

    if (currentCall && currentCall !== lastCall) {
      silenced = false;
      btnSilence.hidden = false;
      doAlert(currentName || '');
      clearInterval(alertInterval);
      alertInterval = setInterval(() => doAlert(currentName || ''), 5000);
      lastCall = currentCall;
    }
  } catch (e) {
    console.error('Erro ao buscar status:', e);
  }
}

btnSilence.addEventListener('click', () => {
  silenced = true;
  alertSound.pause();
  alertSound.currentTime = 0;
  speechSynthesis.cancel();
  clearInterval(alertInterval);
  btnSilence.hidden = true;
});

fetchStatus();
setInterval(fetchStatus, 3000);
