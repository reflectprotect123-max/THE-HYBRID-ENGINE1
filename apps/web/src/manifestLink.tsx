import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/*
 * Which app the browser is being offered to install.
 *
 * ONE installable app in this browser, since 13 August 2026: the coach's.
 *
 * This file used to swap between two manifests as the route changed, because
 * one origin served two apps — the athlete's at `/` and the coach's at
 * `/coach` — and a PWA install is keyed on the manifest's `scope`. The
 * paragraph that stood here explained why the scopes were nested rather than
 * disjoint: "the athlete's is `/` because its routes are spread across the
 * root — `/home`, `/training`, `/log/:bi/:ei`, `/progress`".
 *
 * NONE OF THOSE ROUTES EXIST. The athlete web app was parked (see CLAUDE.md):
 * `/` and every athlete address redirects to `/coach`, and the routes were
 * removed from `App.tsx`. So offering the athlete manifest — which this did on
 * every non-`/coach` path, meaning every path that redirects — installed an
 * icon whose `start_url: '/home'` opens a redirect to the bench. A real app,
 * reached the long way, under the wrong name.
 *
 * The coach manifest is now offered unconditionally. There is no route this
 * app serves that is not the bench.
 *
 * The athlete manifest is NOT deleted, for the same reason the athlete screens
 * are not: parked means restorable. `vite.config.ts` still emits it, and the
 * service worker's precache scope still depends on it. Restoring the athlete
 * app means restoring the swap here as well as the routes — and the nested
 * scopes above are the design to restore, not to reinvent.
 *
 * This lives in neutral ground, not under coach/ — it is about the document,
 * and putting DOM-manifest logic in the coach lane would be a crossing the lane
 * contract would rightly complain about.
 */

/* Kept, unused, and deliberately so — see the header. Deleting it would make
   restoring the athlete app a rediscovery rather than a re-wiring. */
export const ATHLETE_MANIFEST = '/manifest.webmanifest';
const COACH_MANIFEST = '/coach.webmanifest';

export function ManifestLink() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!el) return;
    /* `pathname` is still a dependency, and the swap is still per-navigation
       rather than per-load, because this is a single-page app and a static
       <link> could not follow a route change. What changed is that every route
       now wants the same answer. */
    const want = COACH_MANIFEST;
    /* Only when it actually differs. Rewriting the href re-fetches the manifest
       and re-arms the install prompt, so doing it on every navigation would
       throw away a prompt the athlete had not answered yet. */
    if (!el.href.endsWith(want)) el.href = want;
  }, [pathname]);

  return null;
}
