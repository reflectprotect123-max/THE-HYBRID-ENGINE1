/*
 * THE Hybrid System — design tokens.
 *
 * Lifted verbatim from the vanilla app's `:root` block and docs/DESIGN-TOKENS.md so
 * the React apps and the React Native app render the same product rather than
 * two products that resemble each other. Values here are the source of truth;
 * `tokens.css` is generated from this file's shape by hand and must stay in
 * step, and the native app consumes these objects directly.
 *
 * The one deliberate departure from the old CSS is `space`: the vanilla app was
 * on a 4px rhythm applied unevenly (most margins were literals). This is a
 * strict 8px grid. `half` (4px) exists for hairline cases — optical alignment
 * of an icon against text — and is named rather than inlined so every
 * off-grid use is visible in review instead of hidden in a stylesheet.
 */

export const color = {
  /* DEPTH — a four-step tonal ladder. The page sits BELOW cards so cards float. */
  bg: '#070706',
  panel: '#141311',
  panel2: '#1c1b18',
  panel3: '#0a0a09',
  well: '#0c0c0a',

  line: 'rgba(255,255,255,.065)',
  line2: 'rgba(255,255,255,.1)',
  hair: 'rgba(255,255,255,.08)',

  text: '#f5f1e9',
  muted: '#aaa49a',
  dim: '#847d73',

  /* BRAND — brass. Completion reads warm, never green; green is HR-only. */
  gold: '#c09358',
  gold2: '#e0bc87',
  goldWash: 'rgba(192,147,88,.09)',
  goldLine: 'rgba(224,188,135,.22)',
  doneBg: 'rgba(192,147,88,.14)',
  doneLine: 'rgba(224,188,135,.5)',
  doneInk: '#e6c795',
  /* Ink ON brass/gold — the doc's --on-accent gap, closed. */
  onAccent: '#1b1509',

  blue: '#82a8e9',
  blue2: '#6793ee',
  ok: '#9fc59b',
  warn: '#d1a464',
  bad: '#cf7f7c',

  /* HR semantics — the only green left after de-greening. */
  zoneBlue: '#5b8def',
  zoneGreen: '#33c07a',
  zoneRed: '#e0524d',

  /* Zone aliases as the engine names them (low / mod / high). */
  zLow: '#5b8def',
  zMod: '#cf9d4f',
  zHigh: '#e0524d',

  /* NEON — rings and lit strips glow brighter than the muted band inks.
     Read these; never hardcode a ring colour at a call site. */
  neonStrain: '#33C4FF',
  neonOk: '#3DFF9E',
  neonWarn: '#FFC24D',
  neonBad: '#FF5B57',

  ringIdle: 'rgba(255,255,255,.14)',
  trackSoft: 'rgba(255,255,255,.06)',
  track: 'rgba(255,255,255,.08)',
  trackStrong: 'rgba(255,255,255,.09)',
  chartDotRing: '#141312',
} as const;

/* Strict 8px grid. `half` is the only sanctioned off-grid step. */
export const space = {
  half: 4,
  1: 8,
  2: 16,
  3: 24,
  4: 32,
  5: 40,
  6: 48,
  8: 64,
  10: 80,
  12: 96,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
} as const;

export const fontSize = {
  1: 10,
  2: 11,
  3: 12,
  4: 13,
  5: 14,
  6: 16,
  7: 20,
  8: 26,
  9: 34,
} as const;

export const fontWeight = {
  reg: '500',
  med: '650',
  semi: '750',
  bold: '800',
  black: '900',
} as const;

export const duration = {
  fast: 120,
  base: 150,
  mid: 220,
  slow: 300,
} as const;

export const easing = {
  standard: 'cubic-bezier(.22,.8,.2,1)',
  entrance: 'cubic-bezier(.22,.9,.24,1)',
  overshoot: 'cubic-bezier(.34,1.56,.64,1)',
} as const;

export const shadow = {
  card: '0 1px 0 rgba(255,255,255,.028) inset, 0 14px 34px -18px rgba(0,0,0,.9)',
  liftOpen:
    '0 22px 48px -20px rgba(0,0,0,.9), 0 0 0 1px rgba(224,188,135,.16), inset 0 1px 0 rgba(255,255,255,.045)',
  wellInset: 'inset 0 2px 4px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.03)',
  brassEdge: 'inset 0 1px 0 rgba(255,255,255,.14), 0 1px 0 rgba(0,0,0,.35)',
} as const;

export const gradient = {
  brass: 'linear-gradient(180deg,#c8a06d,#b0854e)',
  brassWash: 'linear-gradient(180deg,rgba(224,188,135,.16),rgba(192,147,88,.05))',
} as const;

/* The engine returns zone keys; the UI needs both a legible data ink and an
   emissive variant. Kept here so `conZones()` stays free of presentation. */
export const zonePalette = {
  low: { color: color.zoneBlue, neon: color.neonStrain },
  mod: { color: color.zoneGreen, neon: color.neonOk },
  high: { color: color.zoneRed, neon: color.neonBad },
} as const;

export type ZoneKey = keyof typeof zonePalette;
