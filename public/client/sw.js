self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const client of cs) {
        if (client.url.includes('/client/') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/client/');
    })
  );
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch {}
  const title = data.title || 'É a sua vez!';
  const options = {
    body: data.body || '',
    vibrate: [200,100,200],
    tag: 'sannext-call',
    renotify: true,
    requireInteraction: true,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
