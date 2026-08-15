import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { IS_SCOPED_BUILD } from './product';

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
 * RESTORED, BY BUILD RATHER THAN BY ROUTE (15 August 2026). The paragraph
 * above kept its warning — "restoring the athlete app means restoring the swap
 * here as well as the routes" — and this is that restoration, in the shape the
 * un-parking actually took.
 *
 * The athlete app came back on the BRANDED builds only
 * (`VITE_HYBRID_PRODUCT=conditioning`, its own site); the unscoped dashboard
 * build still parks everything and is still nothing but the bench. So the
 * question "which app is this?" is now answered by the BUILD, not the path,
 * and a per-route swap would be answering a question this origin no longer
 * asks: on a branded build `/coach` redirects to `/` (`CoachAccess`), so
 * offering the coach manifest there would install an icon that opens a
 * redirect — precisely the bug this file's own history records, mirrored.
 *
 * `pathname` stays a dependency even though neither branch reads it. A static
 * <link> cannot follow a route change in a single-page app, and re-running the
 * effect per navigation is what guarantees the href survives one; the two
 * branches simply agree with themselves across every route.
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
    const want = IS_SCOPED_BUILD ? ATHLETE_MANIFEST : COACH_MANIFEST;
    /* Only when it actually differs. Rewriting the href re-fetches the manifest
       and re-arms the install prompt, so doing it on every navigation would
       throw away a prompt the athlete had not answered yet. */
    if (!el.href.endsWith(want)) el.href = want;
  }, [pathname]);

  return null;
}
