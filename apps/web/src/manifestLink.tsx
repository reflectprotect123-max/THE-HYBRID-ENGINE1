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
 * DELETED, NOT PARKED (15 August 2026). The athlete web app came back for one
 * day as a branded conditioning build and was then cut with everything outside
 * the two surviving products, the Android APK and this bench. So there is once
 * again exactly ONE installable app on this origin, and no build in which that
 * is not true — which is why this answers unconditionally rather than by route
 * or by build flag.
 *
 * `ATHLETE_MANIFEST` is kept as a named export and nothing reads it.
 * `vite.config.ts` still EMITS `manifest.webmanifest`, and the service
 * worker's precache scope still depends on that file existing, so the constant
 * documents a real artefact rather than a hope. Deleting it would make any
 * future athlete app a rediscovery rather than a re-wiring.
 *
 * `pathname` stays a dependency even though nothing branches on it. A static
 * <link> cannot follow a route change in a single-page app, and re-running the
 * effect per navigation is what guarantees the href survives one.
 *
 * This lives in neutral ground, not under coach/ — it is about the document,
 * and putting DOM-manifest logic in the coach lane would be a crossing the lane
 * contract would rightly complain about.
 */

export const ATHLETE_MANIFEST = '/manifest.webmanifest';
const COACH_MANIFEST = '/coach.webmanifest';

export function ManifestLink() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!el) return;
    const want = COACH_MANIFEST;
    /* Only when it actually differs. Rewriting the href re-fetches the manifest
       and re-arms the install prompt, so doing it on every navigation would
       throw away a prompt the athlete had not answered yet. */
    if (!el.href.endsWith(want)) el.href = want;
  }, [pathname]);

  return null;
}
