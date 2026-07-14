const CACHE_NAME='the-hybrid-system-private-pwa-v3-2026-07-14';
const APP_SHELL = [
  './index.html',
  './focused-ui.js',
  './integrations-ui.js',
  './native-ui.css',
  './pwa.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackToIndex = false) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackToIndex) return caches.match('./index.html');
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith('/.netlify/functions/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(new Request('./index.html', { cache: 'no-store' }), true));
    return;
  }
  if (requestUrl.origin === self.location.origin) event.respondWith(networkFirst(event.request, false));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
