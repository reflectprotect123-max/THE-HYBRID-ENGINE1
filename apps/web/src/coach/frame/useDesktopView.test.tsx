// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDesktopView } from './useDesktopView';

/*
 * "Desktop view" is a WHOLE-DOCUMENT switch — the viewport meta tag is the
 * only lever that can talk CSS media queries out of their answer, and there
 * is no way to scope it to a subtree. Everything below is about containing
 * that blast radius, which is the entire risk of the feature.
 */

const ORIGINAL = 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1';

function meta(): HTMLMetaElement {
  return document.querySelector('meta[name="viewport"]')!;
}

function Harness() {
  const { on, toggle } = useDesktopView();
  return <button type="button" onClick={toggle}>{on ? 'Phone view' : 'Desktop view'}</button>;
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<meta name="viewport" content="${ORIGINAL}">`;
});

describe('useDesktopView', () => {
  it('leaves the viewport alone until it is asked', () => {
    render(<Harness />);
    expect(meta().getAttribute('content')).toBe(ORIGINAL);
  });

  it('lays the page out at 1440px when switched on', () => {
    const { getByRole } = render(<Harness />);
    act(() => { getByRole('button').click(); });

    expect(meta().getAttribute('content')).toContain('width=1440');
    /*
     * `maximum-scale=1` MUST be gone. The original tag pins zoom, and a coach
     * left staring at a 1440px layout they cannot zoom into is worse off than
     * one who was never offered the switch.
     */
    expect(meta().getAttribute('content')).not.toContain('maximum-scale');
  });

  /*
   * The blast radius. This hook mounts inside the coach frame, which only
   * renders under `/coach` — so leaving 1440px set on the way out would
   * follow the user into the athlete app and break every screen there.
   */
  it('restores the original viewport when the coach bench unmounts', () => {
    const view = render(<Harness />);
    act(() => { view.getByRole('button').click(); });
    expect(meta().getAttribute('content')).toContain('width=1440');

    view.unmount();
    expect(meta().getAttribute('content')).toBe(ORIGINAL);
  });

  it('remembers the choice across a remount, and can be switched back', () => {
    const first = render(<Harness />);
    act(() => { first.getByRole('button').click(); });
    first.unmount();

    const second = render(<Harness />);
    expect(second.getByRole('button')).toHaveTextContent('Phone view');
    expect(meta().getAttribute('content')).toContain('width=1440');

    act(() => { second.getByRole('button').click(); });
    expect(meta().getAttribute('content')).toBe(ORIGINAL);
  });
});
