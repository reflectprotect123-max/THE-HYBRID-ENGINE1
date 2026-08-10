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
