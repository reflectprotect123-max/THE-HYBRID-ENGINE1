import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/*
 * Which app the browser is being offered to install.
 *
 * One origin, one index.html, but TWO installable apps — the athlete's and the
 * coach's. A PWA install is keyed on the manifest's `scope`, so two icons need
 * two manifests, and the page has to be pointing at the right one at the moment
 * the browser decides what it would install.
 *
 * That decision is per-navigation, not per-load, and this is a single-page app:
 * the athlete never reloads on the way to `/coach`, so a static <link> in the
 * HTML would mean the coach bench forever advertises itself as the athlete app.
 * Hence swapping the element's href as the route changes.
 *
 * The scopes are deliberately nested rather than disjoint. The athlete's is `/`
 * because its routes are spread across the root — `/home`, `/training`,
 * `/log/:bi/:ei`, `/progress` — and a narrower scope would push every one of
 * them out of the installed app and into a browser tab. The coach's `/coach` is
 * strictly inside it, which is fine: the spec resolves an install against the
 * most specific matching scope, so the bench installs as itself rather than as
 * a second copy of the athlete app.
 *
 * This lives in neutral ground, not under coach/ — it is about the document,
 * and putting DOM-manifest logic in the coach lane would be a crossing the lane
 * contract would rightly complain about.
 */

const ATHLETE_MANIFEST = '/manifest.webmanifest';
const COACH_MANIFEST = '/coach.webmanifest';

export function ManifestLink() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!el) return;
    const want = pathname === '/coach' || pathname.startsWith('/coach/') ? COACH_MANIFEST : ATHLETE_MANIFEST;
    /* Only when it actually differs. Rewriting the href re-fetches the manifest
       and re-arms the install prompt, so doing it on every navigation would
       throw away a prompt the athlete had not answered yet. */
    if (!el.href.endsWith(want)) el.href = want;
  }, [pathname]);

  return null;
}
