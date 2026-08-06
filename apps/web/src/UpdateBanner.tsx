import { useEffect, useRef, useState } from 'react';

/*
 * "A new version is ready."
 *
 * The PWA is configured `registerType: 'prompt'`, which downloads a new service
 * worker and then WAITS for the app to activate it — and nothing ever imported
 * the register helper, so nothing ever did. Every deploy landed on the site and
 * never reached an installed app: the browser held a fully downloaded new
 * version behind a worker that was never told to take over. Silent, permanent,
 * and invisible from the deploy side, which is the worst combination.
 *
 * 'prompt' is still the right mode and this is the missing half of it, not a
 * switch to autoUpdate. Auto-activation swaps the running code on the next
 * navigation, and this app is used mid-session on a gym floor with a live
 * logger and a running rest timer. Reloading underneath a working set to pick
 * up a copy change is a worse failure than waiting.
 *
 * Registered by hand rather than through `virtual:pwa-register`, which pulls in
 * workbox-window purely to send one message. The generated worker's protocol is
 * one string — it listens for SKIP_WAITING and calls skipWaiting() — so the
 * dependency buys nothing this file cannot do in twenty lines.
 */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [hidden, setHidden] = useState(false);
  /* controllerchange also fires on the FIRST install, when there was no
     previous version and nothing to tell anyone about. Only a reload the
     athlete asked for should reload. */
  const asked = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Already waiting from an earlier visit: the update downloaded, the tab
      // was closed before anyone tapped, and it has been sitting there since.
      if (reg.waiting) setWaiting(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // `controller` is null on a first-ever install — that is not an
          // update and must not raise a banner.
          if (next.state === 'installed' && navigator.serviceWorker.controller) setWaiting(next);
        });
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (asked.current) window.location.reload();
    });
  }, []);

  if (!waiting || hidden) return null;

  return (
    <div className="fixed inset-x-0 bottom-9 z-50 mx-auto w-[min(92vw,26rem)] px-2">
      <div role="status" className="flex items-center gap-1 rounded-lg border border-gold-line bg-panel p-1.5 shadow-lift">
        <p className="min-w-0 flex-1 text-3 text-text">
          A new version is ready.
          <span className="block text-2 text-dim">Finish your set — nothing reloads until you tap.</span>
        </p>
        <button
          onClick={() => {
            asked.current = true;
            waiting.postMessage({ type: 'SKIP_WAITING' });
          }}
          className="h-5 shrink-0 rounded-md px-1.5 text-3 font-[750] text-on-accent [background:var(--brass)]"
        >
          Reload
        </button>
        <button
          onClick={() => setHidden(true)}
          aria-label="dismiss update notice"
          className="h-5 w-5 shrink-0 rounded-md border border-line2 text-4 text-muted"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
