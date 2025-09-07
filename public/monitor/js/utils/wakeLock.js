let wakeLock = null;
let noSleep = null;

export async function requestWakeLock() {
  if (wakeLock || (noSleep && noSleep.isEnabled)) return;
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch (e) {
      console.error('wakeLock', e);
    }
  } else if (window.NoSleep) {
    if (!noSleep) noSleep = new window.NoSleep();
    try { noSleep.enable(); } catch (e) { console.error('NoSleep', e); }
  }
}

export function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  if (noSleep && noSleep.isEnabled) {
    try { noSleep.disable(); } catch {}
  }
}

export function initWakeLock() {
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseWakeLock();
    } else {
      requestWakeLock();
    }
  });
  window.addEventListener('pagehide', releaseWakeLock);
  window.addEventListener('freeze', releaseWakeLock);
  window.addEventListener('focus', requestWakeLock);
}
