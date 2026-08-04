import { describe, expect, it } from 'vitest';
import { conditioningColor, strengthColor } from '../src/tokens';

const SHARED_KEYS = [
  'blue', 'blue2', 'ok', 'warn', 'bad',
  'zoneBlue', 'zoneGreen', 'zoneRed', 'zLow', 'zMod', 'zHigh',
  'neonStrain', 'neonOk', 'neonWarn', 'neonBad',
  'ringIdle', 'trackSoft', 'track', 'trackStrong', 'chartDotRing',
] as const;

const BRAND_KEYS = [
  'bg', 'panel', 'panel2', 'panel3', 'well',
  'line', 'line2', 'hair', 'text', 'muted', 'dim',
  'gold', 'gold2', 'goldWash', 'goldLine',
  'doneBg', 'doneLine', 'doneInk', 'onAccent',
] as const;

describe('strengthColor / conditioningColor', () => {
  it('agree on every semantic key', () => {
    for (const key of SHARED_KEYS) {
      expect(conditioningColor[key]).toBe(strengthColor[key]);
    }
  });

  it('differ on every brand key', () => {
    for (const key of BRAND_KEYS) {
      expect(conditioningColor[key]).not.toBe(strengthColor[key]);
    }
  });

  it('conditioning uses the approved teal, not brass', () => {
    expect(conditioningColor.gold2).toBe('#7fe3d4');
    expect(conditioningColor.onAccent).toBe('#04211d');
  });
});
