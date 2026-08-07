import { describe, expect, it } from 'vitest';
import { conditioningColor, nutritionColor, strengthColor } from '../src/tokens';
import { resolvePalette } from '../src/theme';

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

/* Every palette, so a fourth one cannot be added without the pairwise rules
   below being applied to it. */
const PALETTES = {
  strength: strengthColor,
  conditioning: conditioningColor,
  nutrition: nutritionColor,
} as const;

const PAIRS = [
  ['strength', 'conditioning'],
  ['strength', 'nutrition'],
  ['conditioning', 'nutrition'],
] as const;

describe('the three world palettes', () => {
  it.each(PAIRS)('%s and %s agree on every semantic key', (a, b) => {
    for (const key of SHARED_KEYS) {
      expect(PALETTES[b][key]).toBe(PALETTES[a][key]);
    }
  });

  it.each(PAIRS)('%s and %s differ on every brand key', (a, b) => {
    for (const key of BRAND_KEYS) {
      expect(PALETTES[b][key]).not.toBe(PALETTES[a][key]);
    }
  });

  it('conditioning uses the approved teal, not brass', () => {
    expect(conditioningColor.gold2).toBe('#7fe3d4');
    expect(conditioningColor.onAccent).toBe('#04211d');
  });
});

describe('nutritionColor', () => {
  /* The hues the SHARED semantics already own. A nutrition accent that landed
     on one of them would make "in zone" and "this is the nutrition world" the
     same colour in a glance, which is the one thing a third accent must not
     do. Compared against the shared block itself, so a future retune of the HR
     inks re-runs this comparison rather than silently invalidating it. */
  it('does not reuse an ink the shared semantics already mean something with', () => {
    const taken = new Set(SHARED_KEYS.map((k) => strengthColor[k]));
    expect(taken.has(nutritionColor.gold)).toBe(false);
    expect(taken.has(nutritionColor.gold2)).toBe(false);
  });
});

describe('resolvePalette', () => {
  it('returns conditioningColor for the conditioning product', () => {
    expect(resolvePalette('conditioning')).toBe(conditioningColor);
  });

  it('returns strengthColor for the strength product', () => {
    expect(resolvePalette('strength')).toBe(strengthColor);
  });

  it('returns nutritionColor for the nutrition world', () => {
    expect(resolvePalette('nutrition')).toBe(nutritionColor);
  });
});
