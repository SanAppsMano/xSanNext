
// public/monitor/js/monitor.js
async function fetchCurrent() {
  try {
    const res = await fetch('/.netlify/functions/status');
    const { currentCall } = await res.json();
    document.getElementById('current').textContent = currentCall;
  } catch (e) {
    console.error('Erro ao buscar currentCall:', e);
  }
}

// Polling a cada 2 segundos
fetchCurrent();
setInterval(fetchCurrent, 2000);
