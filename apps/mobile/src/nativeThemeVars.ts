import type { Palette } from '@hybrid/design';

/**
 * Maps a Palette onto the CSS variable names apps/mobile/tailwind.config.js
 * references. Kept as a flat literal, not a loop over Palette's keys, so a
 * key added to one file and not the other is a one-line diff, not a silent
 * gap. See docs/superpowers/specs/2026-08-04-nativewind-theme-vars-design.md.
 */
export function buildNativeThemeVars(color: Palette): Record<string, string> {
  return {
    '--color-bg': color.bg,
    '--color-panel': color.panel,
    '--color-panel2': color.panel2,
    '--color-panel3': color.panel3,
    '--color-well': color.well,
    '--color-line': color.line,
    '--color-line2': color.line2,
    '--color-text': color.text,
    '--color-muted': color.muted,
    '--color-dim': color.dim,
    '--color-gold': color.gold,
    '--color-gold2': color.gold2,
    '--color-gold-wash': color.goldWash,
    '--color-gold-line': color.goldLine,
    '--color-done-bg': color.doneBg,
    '--color-done-line': color.doneLine,
    '--color-done-ink': color.doneInk,
    '--color-on-accent': color.onAccent,
    '--color-ok': color.ok,
    '--color-warn': color.warn,
    '--color-bad': color.bad,
    '--color-z-low': color.zLow,
    '--color-z-mod': color.zMod,
    '--color-z-high': color.zHigh,
    '--color-track': color.track,
  };
}
