// Service worker: lets the browser install Mangadeck and keeps it usable when the server cannot be reached.
//  - the page itself (index.html) and the built files in /assets/ are kept, so the app opens offline
//  - pages of chapters saved for offline reading are answered from the cache the app filled (mangadeck-offline-pages)
//  - covers and icons are kept as they are seen (newest 400)
// GraphQL (/api/graphql) is never touched here: the app keeps its own last good answers (src/lib/offlineDb.ts).
const SHELL = 'mangadeck-shell-v2';
const ASSETS = 'mangadeck-assets-v1';
const COVERS = 'mangadeck-covers-v1';
const PAGES = 'mangadeck-offline-pages'; // filled by the app, never deleted here
const KEEP = [SHELL, ASSETS, COVERS, PAGES];

const PAGE_URL = /\/api\/v1\/manga\/\d+\/chapter\/\d+\/page\/\d+/;
const COVER_URL = /\/api\/v1\/(manga\/\d+\/thumbnail|extension\/icon\/|source\/[^/]+\/icon)/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(SHELL).then((c) => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(async () => (await caches.match('/index.html', { cacheName: SHELL })) ?? Response.error()),
    );
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) void c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (PAGE_URL.test(url.pathname)) {
    e.respondWith(
      caches.open(PAGES).then(async (c) => (await c.match(req)) ?? fetch(req)),
    );
    return;
  }

  if (COVER_URL.test(url.pathname)) {
    e.respondWith(
      caches.open(COVERS).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              void c.put(req, res.clone()).then(() => trim(COVERS, 400));
            }
            return res;
          })
          .catch(() => hit ?? Response.error());
        return hit ?? net;
      }),
    );
  }
});
