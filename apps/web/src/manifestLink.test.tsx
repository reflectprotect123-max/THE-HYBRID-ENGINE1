// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ManifestLink } from './manifestLink';
import { IS_SCOPED_BUILD } from './product';

/*
 * WHICH APP THE BROWSER IS OFFERED.
 *
 * There was no test here, which is how the file drifted. It swapped between an
 * athlete manifest and a coach manifest by route, and on 13 August 2026 the
 * athlete web app was parked — every athlete address redirected to `/coach`,
 * and the routes came out of `App.tsx`. The swap kept working perfectly and
 * kept offering an app that no longer existed: install from any non-`/coach`
 * path and you got an icon whose `start_url` is `/home`, which redirected to
 * the bench. Nothing failed, because nothing was watching.
 *
 * On 15 August the athlete app came back on the BRANDED builds only, so the
 * answer moved from the route to the build. These tests moved with it, and the
 * shape is deliberate: every case asserts against `IS_SCOPED_BUILD` rather
 * than hard-coding one manifest, so the same file is meaningful under `vitest
 * run` (unscoped, no VITE_HYBRID_PRODUCT) and under a branded run.
 *
 * The regression this guards is the SAME bug in both directions — offering an
 * app whose start_url only redirects. Unscoped, that is the athlete manifest;
 * branded, it is the coach one, because `/coach` redirects to `/` there.
 */

const EXPECTED = IS_SCOPED_BUILD ? '/manifest.webmanifest' : '/coach.webmanifest';
const WRONG = IS_SCOPED_BUILD ? '/coach.webmanifest' : '/manifest.webmanifest';

function withLink(pathname: string): string {
  const link = document.createElement('link');
  link.rel = 'manifest';
  // Deliberately the OTHER one, so a test that passes proves a rewrite
  // happened rather than that nothing touched an already-correct href.
  link.href = WRONG;
  document.head.appendChild(link);
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <ManifestLink />
    </MemoryRouter>,
  );
  const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href;
  link.remove();
  return href;
}

describe('ManifestLink', () => {
  it('offers this build’s own app at the root', () => {
    expect(withLink('/')).toContain(EXPECTED);
    expect(withLink('/')).not.toContain(WRONG);
  });

  it('offers the same app on a coach route', () => {
    /* Branded: `/coach` redirects to `/`, so the coach manifest would install
       an icon that opens a redirect. Unscoped: the bench IS this app. */
    expect(withLink('/coach')).toContain(EXPECTED);
  });

  it('offers the same app on an athlete route', () => {
    /* The case that would have caught the original drift. */
    expect(withLink('/home')).toContain(EXPECTED);
    expect(withLink('/home')).not.toContain(WRONG);
  });

  it('offers the same app on an address that matches nothing at all', () => {
    /* Whatever the catch-all does with it, the document still describes one
       installable app and it is this build's. */
    expect(withLink('/nowhere-in-particular')).toContain(EXPECTED);
  });

  it('does nothing when the document has no manifest link to rewrite', () => {
    /* It reads `document.querySelector` and returns early. Rendering without a
       <link> must not throw — index.html is the only thing that guarantees one. */
    expect(() =>
      render(
        <MemoryRouter initialEntries={['/coach']}>
          <ManifestLink />
        </MemoryRouter>,
      ),
    ).not.toThrow();
  });
});
