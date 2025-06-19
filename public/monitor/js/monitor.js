
// public/monitor/js/monitor.js
const currentEl = document.getElementById('current');
const nameEl    = document.getElementById('current-name');
const btnSilence= document.getElementById('btn-silence');
const alertSound= document.getElementById('alert-sound');

let lastCall = 0;
let lastName = '';
let silenced = false;

btnSilence.addEventListener('click', () => {
  silenced = true;
  alertSound.pause();
  alertSound.currentTime = 0;
  speechSynthesis.cancel();
  btnSilence.hidden = true;
  nameEl.classList.remove('blink');
});

async function fetchCurrent() {
  try {
    const res = await fetch('/.netlify/functions/status');
    const { currentCall, currentName = '', names = {} } = await res.json();
    currentEl.textContent = currentCall;
    const name = currentName || names[currentCall] || '';
    nameEl.textContent = name;
    if (name) {
      nameEl.classList.toggle('manual-name', true);
    } else {
      nameEl.classList.remove('manual-name');
    }
    if (currentCall !== lastCall || name !== lastName) {
      lastCall = currentCall;
      lastName = name;
      if (currentCall) {
        silenced = false;
        btnSilence.hidden = false;
        nameEl.classList.add('blink');
        alertSound.currentTime = 0;
        alertSound.play().catch(()=>{});
        const utter = new SpeechSynthesisUtterance(`É a sua vez: ${currentCall} ${name}`);
        speechSynthesis.speak(utter);
      }
    }
  } catch (e) {
    console.error('Erro ao buscar currentCall:', e);
  }
}

fetchCurrent();
setInterval(fetchCurrent, 2000);
