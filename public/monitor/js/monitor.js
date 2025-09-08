import { speak, buildSpeechText } from './utils/speech.js';
import { initWakeLock, requestWakeLock, releaseWakeLock } from './utils/wakeLock.js';

const params = new URLSearchParams(window.location.search);
const tenantId = params.get('t');
const empresa = params.get('empresa');

const state = {
  queuesCollapsed: JSON.parse(localStorage.getItem('queuesCollapsed') ?? 'true'),
  configCollapsed: JSON.parse(localStorage.getItem('configCollapsed') ?? 'true'),
  audioEnabled: JSON.parse(localStorage.getItem('audioEnabled') ?? 'true'),
  ttsEnabled: JSON.parse(localStorage.getItem('ttsEnabled') ?? 'true'),
  sayGuiche: JSON.parse(localStorage.getItem('sayGuiche') ?? 'true'),
  selectedSound: localStorage.getItem('selectedSound') || 'alert.mp3',
  rate: parseFloat(localStorage.getItem('rate') || '1'),
  pitch: parseFloat(localStorage.getItem('pitch') || '1'),
  viewMode: localStorage.getItem('viewMode') || 'auto'
};

let lastCall = 0;
let lastTs = 0;
let lastId = '';
let lastPriority = 0;
let intervalId = null;
let nextListMax = 4;
let lastNormals = [];
let lastPrios = [];

function normalize(num) {
  return String(num).padStart(3, '0');
}

const unlockOverlay = document.getElementById('unlock-overlay');
const unlockAudio = document.getElementById('unlock-audio');
const currentEl = document.getElementById('current');
const nameEl = document.getElementById('current-name');
const idEl = document.getElementById('current-id');
const priorityEl = document.getElementById('priority-label');
const companyEl = document.getElementById('company-name');
if (empresa && companyEl) companyEl.textContent = decodeURIComponent(empresa);

const configPanel = document.getElementById('config-panel');
const configHeader = document.getElementById('config-header');
const configChevron = document.getElementById('config-chevron');
const queuesPanel = document.getElementById('queues-panel');
const queuesHeader = document.getElementById('queues-header');
const queuesChevron = document.getElementById('queues-chevron');

function saveSetting(key, value) {
  localStorage.setItem(key, value);
}

function applyPanelState() {
  configPanel.classList.toggle('collapsed', state.configCollapsed);
  configChevron.textContent = state.configCollapsed ? '▸' : '▾';
  queuesPanel.classList.toggle('collapsed', state.queuesCollapsed);
  queuesChevron.textContent = state.queuesCollapsed ? '▸' : '▾';
}

function initPanels() {
  applyPanelState();

  configHeader.addEventListener('click', () => {
    state.configCollapsed = !state.configCollapsed;
    saveSetting('configCollapsed', state.configCollapsed);
    applyPanelState();
  });

  queuesHeader.addEventListener('click', () => {
    state.queuesCollapsed = !state.queuesCollapsed;
    saveSetting('queuesCollapsed', state.queuesCollapsed);
    applyPanelState();
    renderQueues(lastNormals, lastPrios);
  });
}

function initControls() {
  const audioToggle = document.getElementById('audio-toggle');
  const ttsToggle = document.getElementById('tts-toggle');
  const guicheToggle = document.getElementById('guiche-toggle');
  const soundSelect = document.getElementById('sound-select');
  const testBtn = document.getElementById('test-sound');

  audioToggle.checked = state.audioEnabled;
  ttsToggle.checked = state.ttsEnabled;
  guicheToggle.checked = state.sayGuiche;

  audioToggle.addEventListener('change', e => {
    state.audioEnabled = e.target.checked;
    saveSetting('audioEnabled', state.audioEnabled);
  });
  ttsToggle.addEventListener('change', e => {
    state.ttsEnabled = e.target.checked;
    saveSetting('ttsEnabled', state.ttsEnabled);
  });
  guicheToggle.addEventListener('change', e => {
    state.sayGuiche = e.target.checked;
    saveSetting('sayGuiche', state.sayGuiche);
  });

  const sounds = ['alert.mp3'];
  sounds.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    soundSelect.appendChild(opt);
  });
  soundSelect.value = state.selectedSound;
  soundSelect.addEventListener('change', e => {
    state.selectedSound = e.target.value;
    saveSetting('selectedSound', state.selectedSound);
  });

  testBtn.addEventListener('click', () => {
    new Audio('/sounds/' + state.selectedSound).play().catch(() => {});
  });
}

function applyViewMode() {
  let mode = state.viewMode;
  if (params.get('view')) {
    mode = params.get('view');
    state.viewMode = mode;
    saveSetting('viewMode', mode);
  } else if (mode === 'auto') {
    mode = window.innerWidth >= 1280 ? 'tv' : 'mobile';
  }
  document.body.classList.remove('view-tv', 'view-mobile', 'view-auto');
  document.body.classList.add('view-' + mode);
  nextListMax = mode === 'mobile' ? 2 : 4;
}

window.addEventListener('resize', () => {
  if (state.viewMode === 'auto') applyViewMode();
});

function unlock() {
  unlockAudio.volume = 0;
  const p = unlockAudio.play();
  if (p && typeof p.then === 'function') {
    p.then(() => {
      unlockAudio.pause();
      unlockAudio.currentTime = 0;
    }).catch(() => {});
  }
  unlockAudio.volume = 1;
  initWakeLock();
  if (unlockOverlay) unlockOverlay.classList.add('hidden');
  document.removeEventListener('click', unlock);
  document.removeEventListener('touchstart', unlock);
  if (unlockOverlay) unlockOverlay.removeEventListener('click', unlock);
}

document.addEventListener('click', unlock, { once: true });
document.addEventListener('touchstart', unlock, { once: true });
if (unlockOverlay) unlockOverlay.addEventListener('click', unlock);

function alertUser(num, attendant, isPriority, name) {
  if (state.audioEnabled) {
    new Audio('/sounds/' + state.selectedSound).play().catch(() => {});
  }
  if (state.ttsEnabled) {
    const text = buildSpeechText(
      {
        number: String(num),
        tipo: isPriority ? 'Preferencial' : 'Normal',
        guiche: attendant || undefined,
        name: name
      },
      { sayGuiche: state.sayGuiche }
    );
    speak(text, state.rate, state.pitch);
  }
}

function updateCounts({ normal, preferencial, total }) {
  const normalCount = document.getElementById('normal-count');
  const priorityCount = document.getElementById('priority-count');
  const totalCount = document.getElementById('total-count');
  if (normalCount) normalCount.textContent = normal;
  if (priorityCount) priorityCount.textContent = preferencial;
  if (totalCount) totalCount.textContent = total;
}

function openFullscreen() {
  const elem = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    if (document.msExitFullscreen) return document.msExitFullscreen();
    return Promise.resolve();
  }
  if (elem.requestFullscreen) return elem.requestFullscreen();
  if (elem.webkitRequestFullscreen) return elem.webkitRequestFullscreen();
  if (elem.msRequestFullscreen) return elem.msRequestFullscreen();
  return Promise.reject(new Error('Fullscreen API not supported'));
}

function initFullscreen() {
  const tryOpen = () => openFullscreen().catch(err => console.warn('Fullscreen failed:', err));
  window.addEventListener('load', tryOpen);
  window.addEventListener('keydown', e => {
    if (e.key === 'F11') {
      e.preventDefault();
      tryOpen();
    }
  });
  const handler = () => {
    tryOpen();
    document.body.removeEventListener('click', handler);
    document.body.removeEventListener('touchstart', handler);
  };
  document.body.addEventListener('click', handler, { once: true });
  document.body.addEventListener('touchstart', handler, { once: true });
}

function computeQueues(data) {
  const cancelled = new Set(data.cancelledNumbers || []);
  const missed = new Set(data.missedNumbers || []);
  const attended = new Set(data.attendedNumbers || []);
  const skipped = new Set(data.skippedNumbers || []);
  const offHours = new Set(data.offHoursNumbers || []);
  const priority = new Set(data.priorityNumbers || []);
  const normals = [];
  const prios = [];
  for (let i = data.callCounter + 1; i <= data.ticketCounter; i++) {
    if (i === data.currentCall) continue;
    if (cancelled.has(i) || missed.has(i) || attended.has(i) || skipped.has(i) || offHours.has(i)) continue;
    if (priority.has(i)) prios.push(i);
    else normals.push(i);
  }
  return { normals, prios };
}

function renderQueues(normals, prios) {
  const normalUl = document.getElementById('normal-queue');
  const priorityUl = document.getElementById('priority-queue');
  if (state.queuesCollapsed) {
    normalUl.innerHTML = '';
    priorityUl.innerHTML = '';
    return;
  }
  normalUl.innerHTML = '';
  priorityUl.innerHTML = '';
  normals.forEach(n => {
    const li = document.createElement('li');
    li.textContent = n;
    normalUl.appendChild(li);
  });
  prios.forEach(n => {
    const li = document.createElement('li');
    li.textContent = n;
    li.classList.add('priority');
    priorityUl.appendChild(li);
  });
}

function renderNextList(normals, prios) {
  const container = document.getElementById('next-list');
  container.innerHTML = '<h2 class="text-lg font-semibold mb-2">Próximos</h2><ul></ul>';
  const ul = container.querySelector('ul');

  const merged = [];
  let p = 0, n = 0;
  while (merged.length < nextListMax && (p < prios.length || n < normals.length)) {
    if (p < prios.length) merged.push({ num: prios[p++], priority: true });
    if (merged.length >= nextListMax) break;
    if (n < normals.length) merged.push({ num: normals[n++], priority: false });
  }

  merged.forEach(item => {
    const li = document.createElement('li');
    const label = item.priority ? `P+${normalize(item.num)}` : normalize(item.num);
    li.textContent = label;
    if (item.priority) li.classList.add('priority');
    ul.appendChild(li);
  });
}

async function fetchCurrent() {
  try {
    const url = '/.netlify/functions/status' + (tenantId ? `?t=${tenantId}` : '');
    const res = await fetch(url);
    const data = await res.json();
    const { currentCall, names = {}, timestamp, attendant, currentCallPriority = 0 } = data;
    currentEl.textContent = currentCall || '—';
    currentEl.classList.toggle('priority', currentCallPriority > 0);
    const name = names[currentCall];
    if (name) {
      currentEl.classList.add('manual');
      nameEl.textContent = name;
    } else {
      currentEl.classList.remove('manual');
      nameEl.textContent = '';
    }
    if (priorityEl) priorityEl.textContent = currentCallPriority > 0 ? 'Preferencial' : '';
    if (idEl) idEl.textContent = attendant || '';
    if (
      currentCall &&
      (currentCall !== lastCall || timestamp !== lastTs || attendant !== lastId || currentCallPriority !== lastPriority)
    ) {
      alertUser(currentCall, attendant, currentCallPriority > 0, name);
      const container = document.getElementById('now-calling');
      container.classList.add('blink');
      setTimeout(() => container.classList.remove('blink'), 5000);
      lastCall = currentCall;
      lastTs = timestamp;
      lastId = attendant;
      lastPriority = currentCallPriority;
    }
    const { normals, prios } = computeQueues(data);
    lastNormals = normals;
    lastPrios = prios;
    updateCounts({
      normal: normals.length,
      preferencial: prios.length,
      total: normals.length + prios.length,
    });
    renderQueues(normals, prios);
    renderNextList(normals, prios);
  } catch (e) {
    console.error('Erro ao buscar currentCall:', e);
  }
}

function startPolling() {
  fetchCurrent();
  intervalId = setInterval(fetchCurrent, 5000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(intervalId);
    intervalId = null;
  } else {
    requestWakeLock();
    fetchCurrent();
    clearInterval(intervalId);
    intervalId = setInterval(fetchCurrent, 5000);
  }
});

window.addEventListener('beforeunload', () => {
  releaseWakeLock();
});

applyViewMode();
initPanels();
initControls();
initFullscreen();
startPolling();

setInterval(() => {
  const label = document.querySelector('.calling-label');
  if (label) {
    label.classList.add('nudge');
    setTimeout(() => label.classList.remove('nudge'), 1000);
  }
}, 180000);
