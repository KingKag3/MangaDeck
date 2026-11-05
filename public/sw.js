// Minimal service worker so the browser offers "Install app". It only keeps the app shell (index.html) for
// launching when the network is slow; it never touches /api (chapters, images and GraphQL always go live).
const SHELL = 'mangadeck-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        void caches.open(SHELL).then((c) => c.put('/index.html', copy));
        return res;
      })
      .catch(async () => (await caches.match('/index.html')) ?? Response.error()),
  );
});
