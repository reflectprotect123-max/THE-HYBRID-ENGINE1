/*
 * Tombstone for the pre-React service worker.
 *
 * This file exists ONLY so clients that registered the old worker have
 * something to update to. It unregisters itself and clears the caches the old
 * worker created, handing the origin over to the Workbox worker at /sw.js.
 *
 * Do not add behaviour here. When no client has been offline longer than a
 * cache lifetime, this can be deleted.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('the-hybrid-engine-training-pwa-')).map((k) => caches.delete(k)),
      );
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })(),
  );
});
