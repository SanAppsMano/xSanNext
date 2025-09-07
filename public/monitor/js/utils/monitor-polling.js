// Global helpers to manage polling timers and abort signals
let pollingIntervalId = null;
let kpiIntervalId = null;
let aborter = null;

export function startPolling(fn, ms = 4000) {
  if (pollingIntervalId != null) return;
  pollingIntervalId = window.setInterval(fn, ms);
}

export function startKpi(fn, ms = 1000) {
  if (kpiIntervalId != null) return;
  kpiIntervalId = window.setInterval(fn, ms);
}

export function stopAllPolling() {
  if (pollingIntervalId != null) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
  if (kpiIntervalId != null) {
    clearInterval(kpiIntervalId);
    kpiIntervalId = null;
  }
  if (aborter) {
    try { aborter.abort(); } catch (e) {}
    aborter = null;
  }
}

export function newAborter() {
  aborter = new AbortController();
  return aborter.signal;
}

const FLAG = 'xsn_monitor_polling';
export function setPollingFlag(on) {
  sessionStorage.setItem(FLAG, on ? 'on' : 'off');
}
export function isPollingOn() {
  return sessionStorage.getItem(FLAG) !== 'off';
}
