import { conditioningColor, strengthColor } from '@hybrid/design';
import { buildNativeThemeVars } from '../src/nativeThemeVars';

describe('buildNativeThemeVars', () => {
  it('maps every strengthColor brand/shared key to its CSS variable name', () => {
    const vars = buildNativeThemeVars(strengthColor);
    expect(vars).toEqual({
      '--color-bg': strengthColor.bg,
      '--color-panel': strengthColor.panel,
      '--color-panel2': strengthColor.panel2,
      '--color-panel3': strengthColor.panel3,
      '--color-well': strengthColor.well,
      '--color-line': strengthColor.line,
      '--color-line2': strengthColor.line2,
      '--color-text': strengthColor.text,
      '--color-muted': strengthColor.muted,
      '--color-dim': strengthColor.dim,
      '--color-gold': strengthColor.gold,
      '--color-gold2': strengthColor.gold2,
      '--color-gold-wash': strengthColor.goldWash,
      '--color-gold-line': strengthColor.goldLine,
      '--color-done-bg': strengthColor.doneBg,
      '--color-done-line': strengthColor.doneLine,
      '--color-done-ink': strengthColor.doneInk,
      '--color-on-accent': strengthColor.onAccent,
      '--color-ok': strengthColor.ok,
      '--color-warn': strengthColor.warn,
      '--color-bad': strengthColor.bad,
      '--color-z-low': strengthColor.zLow,
      '--color-z-mod': strengthColor.zMod,
      '--color-z-high': strengthColor.zHigh,
      '--color-track': strengthColor.track,
    });
  });

  it('produces different values for conditioningColor on every brand key', () => {
    const strength = buildNativeThemeVars(strengthColor);
    const conditioning = buildNativeThemeVars(conditioningColor);
    const brandVarNames = [
      '--color-bg', '--color-panel', '--color-panel2', '--color-panel3', '--color-well',
      '--color-line', '--color-line2', '--color-text', '--color-muted', '--color-dim',
      '--color-gold', '--color-gold2', '--color-gold-wash', '--color-gold-line',
      '--color-done-bg', '--color-done-line', '--color-done-ink', '--color-on-accent',
    ];
    for (const name of brandVarNames) {
      expect(conditioning[name]).not.toBe(strength[name]);
    }
  });

  it('produces identical values for conditioningColor on every shared key', () => {
    const strength = buildNativeThemeVars(strengthColor);
    const conditioning = buildNativeThemeVars(conditioningColor);
    const sharedVarNames = ['--color-ok', '--color-warn', '--color-bad', '--color-z-low', '--color-z-mod', '--color-z-high', '--color-track'];
    for (const name of sharedVarNames) {
      expect(conditioning[name]).toBe(strength[name]);
    }
  });

  it('returns exactly 25 keys, matching tailwind.config.js', () => {
    expect(Object.keys(buildNativeThemeVars(strengthColor))).toHaveLength(25);
  });

  it('every tailwind color value is a var() name this function actually provides', () => {
    const tailwindColors = require('../tailwind.config.js').theme.extend.colors;
    const provided = Object.keys(buildNativeThemeVars(strengthColor));
    const referenced = Object.values(tailwindColors).map((value) => {
      const str = String(value);
      const match = /^var\((--[a-z0-9-]+)\)$/.exec(str);
      return match ? match[1] : str;
    });
    expect(referenced.sort()).toEqual(provided.sort());
  });
});
