const CACHE_PREFIX='the-hybrid-engine-training-pwa-';
const CACHE_NAME='the-hybrid-engine-training-pwa-v42-2026-07-22';
const APP_SHELL = [
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fonts/inter-var.woff2',
  './vendor/supabase-2.110.7.js'
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
      .then(keys => Promise.all(keys.map(key => key !== CACHE_NAME && key.startsWith(CACHE_PREFIX) ? caches.delete(key) : null)))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackToIndex = false) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok && !/\bno-store\b/i.test(fresh.headers.get('cache-control') || '')) cache.put(request, fresh.clone()).catch(() => {});
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
    if (requestUrl.pathname === '/privacy' || requestUrl.pathname === '/privacy.html') {
      event.respondWith(networkFirst(event.request, false));
      return;
    }
    event.respondWith(networkFirst(new Request('./index.html', { cache: 'no-store' }), true));
    return;
  }
  const isAppShell = requestUrl.origin === self.location.origin && APP_SHELL.some(path => new URL(path, self.location.href).pathname === requestUrl.pathname);
  if (isAppShell) event.respondWith(networkFirst(event.request, false));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
