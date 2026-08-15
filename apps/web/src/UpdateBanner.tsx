import { useEffect, useState } from 'react';
import { activateWaiting, onWaitingWorker } from './serviceWorker';

/*
 * "A new version is ready."
 *
 * The PWA is configured `registerType: 'prompt'`, which downloads a new service
 * worker and then WAITS for the app to activate it. This is the half that TELLS
 * someone, and lets them choose when.
 *
 * RESTORED 15 August 2026, hours after being deleted with the athlete surface,
 * because deleting it reintroduced the exact bug it exists to prevent.
 * `serviceWorker.ts` still registers, still detects a waiting worker and still
 * publishes it — but with no subscriber, a downloaded update sat there forever
 * and no deploy ever reached an installed app. That was the original defect,
 * verbatim. `checks/pwa-update.mjs` catches it and had never been wired into
 * CI, so nothing said a word.
 *
 * The reason for asking rather than reloading has changed owner, not force. It
 * was "a live logger and a running rest timer on a gym floor". It is now a
 * coach part-way through building a week in `DayBuilder`: reloading underneath
 * unsaved edits is a worse failure than waiting.
 *
 * REGISTRATION IS NOT HERE ANY MORE (12 August 2026). It used to be, and
 * because this component is mounted inside `Shell` — the athlete chrome —
 * every route outside Shell had no service worker at all. The coach workspace
 * is one of them, so `/coach` could not be installed as an app: an installable
 * PWA needs a worker with a fetch handler, and there was none. Registration
 * now happens in `serviceWorker.ts`, called from `App` above every route fork;
 * this file subscribes to it.
 */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => onWaitingWorker(setWaiting), []);

  if (!waiting || hidden) return null;

  return (
    <div className="fixed inset-x-0 bottom-9 z-50 mx-auto w-[min(92vw,26rem)] px-2">
      <div role="status" className="flex items-center gap-1 rounded-lg border border-gold-line bg-panel p-1.5 shadow-lift">
        <p className="min-w-0 flex-1 text-3 text-text">
          A new version is ready.
          <span className="block text-2 text-dim">Finish what you are doing — nothing reloads until you tap.</span>
        </p>
        <button
          onClick={() => activateWaiting(waiting)}
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
