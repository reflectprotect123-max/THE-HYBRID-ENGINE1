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

/**
 * Semantic colors — heart-rate zones, pass/fail status, neon emphasis. These
 * mean something specific regardless of which product is running and must
 * resolve to the SAME value in every palette, or "in zone" would mean a
 * different color depending on which app happened to render it.
 */
const sharedColor = {
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

/** Depth + brand — the values a per-product theme actually changes. */
const strengthBrand = {
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
} as const;

/**
 * Conditioning's brand block — cool teal, same shape as `strengthBrand`.
 * Values match the approved mockup; see
 * docs/superpowers/specs/2026-08-04-product-retheme-design.md.
 */
const conditioningBrand = {
  bg: '#05080a',
  panel: '#101a1d',
  panel2: '#16262a',
  panel3: '#070d0f',
  well: '#081113',

  line: 'rgba(190,235,230,.065)',
  line2: 'rgba(190,235,230,.1)',
  hair: 'rgba(190,235,230,.08)',

  text: '#eaf6f4',
  muted: '#93b0ae',
  dim: '#6d8d8b',

  gold: '#3fada3',
  gold2: '#7fe3d4',
  goldWash: 'rgba(63,173,163,.09)',
  goldLine: 'rgba(127,227,212,.22)',
  doneBg: 'rgba(63,173,163,.14)',
  doneLine: 'rgba(127,227,212,.5)',
  doneInk: '#a7ece1',
  onAccent: '#04211d',
} as const satisfies Record<keyof typeof strengthBrand, string>;

/**
 * Nutrition's brand block — amethyst, same shape as `strengthBrand`.
 *
 * Violet is the only hue left that cannot be misread: brass is Strength, teal
 * is Conditioning, and green/blue/amber/red are all spoken for by the SHARED
 * semantics above (HR zones, ok/warn/bad), which mean the same thing in every
 * world. An accent that collided with one of those would make "in zone" and
 * "this is the nutrition world" the same colour.
 *
 * Every ink here clears 4.5:1 on every surface here — `dim` included, which is
 * the one ink the older two palettes ship at 4.2 on `panel2` (see
 * docs/DESIGN-TOKENS.md). Nothing forced that compromise on a new palette, so
 * it was not inherited. `node checks/contrast.mjs` prints the table.
 */
const nutritionBrand = {
  bg: '#07060a',
  panel: '#151220',
  panel2: '#1d1a2b',
  panel3: '#0a0810',
  well: '#0c0a12',

  line: 'rgba(219,208,255,.065)',
  line2: 'rgba(219,208,255,.1)',
  hair: 'rgba(219,208,255,.08)',

  text: '#f3effa',
  muted: '#b0a8c0',
  dim: '#9188a6',

  gold: '#9b83e0',
  gold2: '#c9b6f7',
  goldWash: 'rgba(155,131,224,.09)',
  goldLine: 'rgba(201,182,247,.22)',
  doneBg: 'rgba(155,131,224,.14)',
  doneLine: 'rgba(201,182,247,.5)',
  doneInk: '#d9c9ff',
  onAccent: '#171033',
} as const satisfies Record<keyof typeof strengthBrand, string>;

export const strengthColor = { ...strengthBrand, ...sharedColor } as const;
export const conditioningColor = { ...conditioningBrand, ...sharedColor } as const;
export const nutritionColor = { ...nutritionBrand, ...sharedColor } as const;

/** The shape every palette has. Use this, not `typeof color`, when a type is
 * needed independent of which palette is active. Widened to `string` per key
 * (rather than `typeof strengthColor`, whose `as const` gives each value a
 * narrow literal type) so every palette is structurally assignable without a
 * cast — `Palette` describes "some string per key," not one palette's exact
 * literals. */
export type Palette = { readonly [K in keyof typeof strengthColor]: string };

/** Back-compat default — strength's palette, always. Prefer `useTheme()`
 * (./theme) in any component that should vary by product. */
export const color: Palette = strengthColor;

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
