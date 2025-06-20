
// public/monitor/js/monitor.js
let lastCall = 0;
const alertSound = document.getElementById('alert-sound');

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
    const res = await fetch('/.netlify/functions/status');
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
