import { describe, expect, it } from 'vitest';
import { navTabs } from './BottomNav';

describe('navTabs', () => {
  it('points the second tab at /training for a strength-scoped build', () => {
    expect(navTabs('strength', true)[1].to).toBe('/training');
  });

  it('points the second tab at /conditioning for a conditioning-scoped build', () => {
    expect(navTabs('conditioning', true)[1].to).toBe('/conditioning');
  });

  it('keeps /training for the unscoped dashboard build, even if PRODUCT_ID defaulted to conditioning', () => {
    expect(navTabs('conditioning', false)[1].to).toBe('/training');
  });

  it('always keeps Home, Library, Progress and Settings in the other four slots', () => {
    const tabs = navTabs('strength', true).map((t) => t.to);
    expect(tabs).toEqual(['/', '/training', '/library', '/progress', '/settings']);
  });

  /*
   * The hybrid build is the whole point of the app: it owns both disciplines,
   * so both have to be reachable from the bar. Before this, conditioning was
   * reachable only through a text link inside one card on Home.
   */
  it('gives the unscoped hybrid build BOTH training tabs', () => {
    const tabs = navTabs('strength', false).map((t) => t.to);
    expect(tabs).toEqual(['/home', '/training', '/conditioning', '/library', '/progress', '/settings']);
  });

  it('exposes conditioning on the hybrid build whichever way PRODUCT_ID defaulted', () => {
    for (const id of ['strength', 'conditioning'] as const) {
      expect(navTabs(id, false).map((t) => t.to)).toContain('/conditioning');
    }
  });

  /*
   * The branded builds are single-purpose products and must NOT grow a tab into
   * a discipline they do not own — a strength build has no conditioning to
   * show, and vice versa. Guarded explicitly because the hybrid change above is
   * exactly the kind of edit that leaks across the boundary.
   */
  it('never gives a branded build a tab into the discipline it does not own', () => {
    expect(navTabs('strength', true).map((t) => t.to)).not.toContain('/conditioning');
    expect(navTabs('conditioning', true).map((t) => t.to)).not.toContain('/training');
  });

  it('keeps the branded builds at five tabs and the hybrid at six', () => {
    expect(navTabs('strength', true)).toHaveLength(5);
    expect(navTabs('conditioning', true)).toHaveLength(5);
    expect(navTabs('strength', false)).toHaveLength(6);
  });

  it('points Home at / for a scoped build, where / IS the Home screen', () => {
    expect(navTabs('strength', true)[0].to).toBe('/');
    expect(navTabs('conditioning', true)[0].to).toBe('/');
  });

  it('points Home at /home for the unscoped dashboard build, where / is the coach bench', () => {
    // Leaving this at `/` would make the Home tab eject the athlete into the
    // coach workspace — the one place the athlete app must not send them.
    expect(navTabs('conditioning', false)[0].to).toBe('/home');
    expect(navTabs('strength', false)[0].to).toBe('/home');
  });
});
