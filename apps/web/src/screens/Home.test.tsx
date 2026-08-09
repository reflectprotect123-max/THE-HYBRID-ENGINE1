import { describe, expect, it } from 'vitest';
import { showZonesCard } from './Home';

describe('showZonesCard', () => {
  it('hides the zones door for a strength-scoped build', () => {
    expect(showZonesCard('strength', true)).toBe(false);
  });

  it('keeps the zones door for a conditioning-scoped build', () => {
    expect(showZonesCard('conditioning', true)).toBe(true);
  });

  it('keeps the zones door for the unscoped dashboard build, even if the product defaulted to strength', () => {
    expect(showZonesCard('strength', false)).toBe(true);
  });
});
