// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ManifestLink } from './manifestLink';

/*
 * WHICH APP THE BROWSER IS OFFERED.
 *
 * There was no test here, which is how the file drifted. It swapped between an
 * athlete manifest and a coach manifest by route, and on 13 August 2026 the
 * athlete web app was parked — `/` and every athlete address now redirect to
 * `/coach`, and the routes came out of `App.tsx`. The swap kept working
 * perfectly and kept offering an app that no longer exists: install from any
 * non-`/coach` path and you got an icon whose `start_url` is `/home`, which
 * redirects to the bench. Nothing failed, because nothing was watching.
 *
 * So these assert the CURRENT truth — one app, offered everywhere — and the
 * middle case is the one that would have caught the original drift.
 */

function withLink(pathname: string): string {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/manifest.webmanifest';
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
  it('offers the coach manifest on a coach route', () => {
    expect(withLink('/coach')).toContain('/coach.webmanifest');
  });

  it('offers the coach manifest on a PARKED athlete route too — that address redirects', () => {
    /* The regression case. `/home` is not the athlete app any more; it bounces
       to `/coach`. Offering the athlete manifest here installed an icon that
       opens a redirect, under the wrong name. */
    expect(withLink('/home')).toContain('/coach.webmanifest');
    expect(withLink('/home')).not.toContain('/manifest.webmanifest');
  });

  it('offers the coach manifest at the root', () => {
    expect(withLink('/')).toContain('/coach.webmanifest');
  });

  it('offers the coach manifest on an address that matches nothing at all', () => {
    /* The catch-all redirects to `/coach` like everything else, so there is no
       route left that should be offered a different app. */
    expect(withLink('/nowhere-in-particular')).toContain('/coach.webmanifest');
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
