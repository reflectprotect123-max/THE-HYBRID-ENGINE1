/*
 * Registering the service worker, once, for the whole origin.
 *
 * THE BUG THIS FIXES. The only `navigator.serviceWorker.register` call lived
 * inside `UpdateBanner`, and `UpdateBanner` is mounted inside `Shell` — the
 * ATHLETE chrome. Four route groups render outside Shell: the coach workspace
 * (`/coach/*`), the logger (`/log/:bi/:ei`), the planner and the guided
 * builder. On any of them no worker was ever registered.
 *
 * That is not a caching nicety. An installable PWA needs a service worker with
 * a fetch handler, so a coach who opens `/coach` and stays there was never
 * offered the install prompt at all — the app simply could not be installed
 * from the surface they use. It also meant that on those routes an update
 * downloaded on a previous visit sat waiting with nothing listening for it.
 *
 * So registration moves here and is called from `App`, above every route fork,
 * and `UpdateBanner` becomes what its name says: the banner. The registration
 * is a module singleton rather than an effect per component — two components
 * registering the same script race for one scope, and the winner is whichever
 * one attached its listeners first.
 */

type Listener = (waiting: ServiceWorker | null) => void;

let started = false;
let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();
/** Set when the app asks a waiting worker to take over — see `activateWaiting`. */
let reloadOnControllerChange = false;

function publish(next: ServiceWorker | null) {
  waiting = next;
  for (const listener of listeners) listener(next);
}

/**
 * Register the worker. Safe to call any number of times; only the first does
 * anything.
 *
 * Never rejects: a browser with no service-worker support, a private window
 * that refuses registration, or a worker that 404s must not take the app down
 * with it. The app works without a worker — it is offline support and
 * installability that are lost, not the session in front of the athlete.
 */
export function startServiceWorker(): void {
  if (started) return;
  started = true;
  /* The VALUE, not the key. `'serviceWorker' in navigator` is true whenever
     the property exists at all — including when it is undefined, which is how
     some embedded webviews and every test that stubs it out present
     themselves. Checking the key alone threw on the very next line. */
  const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  if (!container) return;

  container
    .register('/sw.js')
    .then((reg) => {
      // Already waiting from an earlier visit: the update downloaded, the tab
      // was closed before anyone tapped, and it has been sitting there since.
      if (reg.waiting) publish(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // `controller` is null on a first-ever install — that is not an
          // update and must not raise a banner.
          if (next.state === 'installed' && container.controller) publish(next);
        });
      });
    })
    .catch(() => {
      /* Nothing to do and nothing to say: see the note above. */
    });

  container.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) window.location.reload();
  });
}

/** Subscribe to the waiting worker. Returns the unsubscribe. */
export function onWaitingWorker(listener: Listener): () => void {
  listeners.add(listener);
  // Late subscribers still hear about a worker that started waiting before
  // they mounted — the banner is mounted deep in the tree and registration
  // happens at the root, so this ordering is the normal case, not the edge.
  if (waiting) listener(waiting);
  return () => listeners.delete(listener);
}

/**
 * Tell the waiting worker to take over, and reload when it does.
 *
 * The reload flag is set HERE rather than in the banner, because
 * `controllerchange` also fires on a first-ever install where there is nothing
 * to reload for — reloading then would bounce an athlete mid-session for no
 * reason.
 */
export function activateWaiting(worker: ServiceWorker): void {
  reloadOnControllerChange = true;
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/** Test seam. Resets the singleton so each test starts from a clean origin. */
export function resetServiceWorkerForTests(): void {
  started = false;
  waiting = null;
  reloadOnControllerChange = false;
  listeners.clear();
}
