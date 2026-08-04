# Per-product re-theme: strength (brass) vs conditioning (teal)

Status: approved by user 2026-08-04. Visual direction confirmed via artifact mockup
(side-by-side card comparison, teal accent kept clear of the existing HR zone-blue).

## Motivation

`packages/design` ships one token set. Both apps already carry `PRODUCT_ID`
(`'strength' | 'conditioning'`) end to end — web sets `data-product` on the
document root, mobile has it available at the app root — but today it is only
used for the product name and `aria-label`. Visually the two apps are
identical, which undercuts the split described in `handoff.md` and the
ecosystem architecture: two products should *read* as two products.

This spec covers presentation only. It does not touch screen/route gating,
data models, sync, or the coordinator — those are separately tracked gaps.

## What stays shared

Everything structural and everything semantic stays identical across both
themes, so the two apps remain the same underlying design system rather than
forking it:

- `space`, `radius`, `fontSize`, `fontWeight`, `duration`, `easing` — the 8px
  grid, radii, type scale, and motion curves are brand-neutral.
- HR/status semantics: `blue`/`blue2`, `ok`/`warn`/`bad`, `zoneBlue`/`zoneGreen`/`zoneRed`
  (and their `zLow`/`zMod`/`zHigh` aliases), `neonStrain`/`neonOk`/`neonWarn`/`neonBad`,
  `ringIdle`/`trackSoft`/`track`/`trackStrong`/`chartDotRing`. These mean something
  specific (heart-rate zone, pass/fail) and must not be reinterpreted as brand color.
- Component code and layout. No component gets a conditioning-only or
  strength-only variant; only the color values a component reads change.

## What differs per product

The "depth" and "brand" color groups in `tokens.ts`/`tokens.css`:
`bg`, `panel`, `panel2`, `panel3`, `well`, `line`, `line2`, `hair`, `text`,
`muted`, `dim`, `gold`, `gold2`, `goldWash`, `goldLine`, `doneBg`, `doneLine`,
`doneInk`, `onAccent`, plus the shadow/gradient values that are tuned against
the brand color (`shadow.liftOpen`, `shadow.brassEdge`, `gradient.brass`,
`gradient.brassWash`).

Key *names* do not change — consumers keep writing `color.gold`,
`color.doneInk`, etc. Only which palette those names resolve to changes per
product. This keeps the diff to "swap the value source," not "rename every
call site."

### Conditioning palette (new)

Cool teal/blue-black, mirroring the same structural relationships the brass
palette has (same relative lightness steps between `bg`/`panel`/`panel2`, same
wash/line/glow pattern) with the hue rotated from warm brass to cool teal:

```
bg:        #05080a
panel:     #101a1d
panel2:    #16262a
panel3:    #070d0f
well:      #081113

line:      rgba(190,235,230,.065)
line2:     rgba(190,235,230,.1)
hair:      rgba(190,235,230,.08)

text:      #eaf6f4
muted:     #93b0ae
dim:       #5f7d7b

gold:      #3fada3   (was #c09358)
gold2:     #7fe3d4   (was #e0bc87)
goldWash:  rgba(63,173,163,.09)
goldLine:  rgba(127,227,212,.22)

doneBg:    rgba(63,173,163,.14)
doneLine:  rgba(127,227,212,.5)
doneInk:   #a7ece1
onAccent:  #04211d

shadow.liftOpen:  0 22px 48px -20px rgba(0,0,0,.9), 0 0 0 1px rgba(127,227,212,.16), inset 0 1px 0 rgba(190,235,230,.045)
shadow.brassEdge: inset 0 1px 0 rgba(190,235,230,.14), 0 1px 0 rgba(0,0,0,.35)
gradient.brass:      linear-gradient(180deg,#5fd1c6,#2f9a92)
gradient.brassWash:  linear-gradient(180deg,rgba(127,227,212,.16),rgba(63,173,163,.05))
```

These are the exact values shown in the approved mockup
(`.superpowers/brainstorm` artifact, teal card).

Type family, weights, and the type scale are unchanged for conditioning —
this pass is color-only. (A distinct heading typeface per product was
discussed and explicitly deferred, not adopted.)

## Web: attribute-scoped CSS

`tokens.css`'s `@theme` block already becomes plain CSS custom properties
under `:root`. Add one more block:

```css
:root[data-product="conditioning"] {
  --color-bg: #05080a;
  --color-panel: #101a1d;
  /* ...every "differs per product" key above... */
}
```

`App.tsx` already sets `data-product={PRODUCT_ID}` on its root element — no
web component changes needed. Every existing Tailwind utility
(`bg-panel`, `text-gold`, `border-line`, etc.) resolves through `var(--color-*)`
already, so the override cascades automatically. This is the low-risk half of
the change: one CSS file, additive block, zero component diffs.

## Mobile: theme context

Mobile has no CSS cascade. `packages/design` currently exports a single
`color` object that six files import directly
(`App.tsx`, `ui.tsx`, `screens/Conditioning.tsx`, `screens/Home.tsx`,
`screens/Progress.tsx`, `screens/Settings.tsx`). A static import can't vary
per build, so this needs a real (small) mechanism:

1. `packages/design/src/tokens.ts` splits its current color block into
   `sharedColor` (the "stays shared" keys) and two brand blocks,
   `strengthBrand` / `conditioningBrand` (the "differs per product" keys).
   Export `strengthColor = { ...sharedColor, ...strengthBrand }` and
   `conditioningColor = { ...sharedColor, ...conditioningBrand }`, both typed
   as `Palette` (the current `typeof color` shape, unchanged). Keep exporting
   `color` as an alias for `strengthColor` so anything not yet migrated still
   compiles.
2. New `packages/design/src/theme.tsx`: a `ThemeContext` (default
   `strengthColor`), a `ThemeProvider({ productId, children })` that resolves
   `productId === 'conditioning' ? conditioningColor : strengthColor` and
   provides it, and a `useTheme()` hook returning `{ color }` (the non-color
   tokens stay static imports — they don't vary, so they don't need to be in
   context).
3. Mobile `App.tsx` wraps its root in
   `<ThemeProvider productId={PRODUCT_ID}>...</ThemeProvider>` (`PRODUCT_ID`
   already exists via `apps/mobile/src/product.ts`).
4. The six consuming files switch `import { color } from '@hybrid/design'` to
   `import { useTheme } from '@hybrid/design'` and read `const { color } =
   useTheme();` inside the component body. Spot-checked `ui.tsx`: all current
   uses are inline JSX style values or component-body defaults (e.g.
   `track = color.trackSoft` as a default parameter) — none are baked into a
   module-scope `StyleSheet.create`, so this is a mechanical swap per file,
   not a structural rewrite. Each file gets verified individually during
   implementation in case one has a pattern this spec didn't spot.

No new dependency — React context is already used elsewhere in the app.

## Rollout

No data migration, no schema change, no build-tooling change. Both products
already build as separate artifacts
(`VITE_HYBRID_PRODUCT=conditioning` / `EXPO_PUBLIC_HYBRID_PRODUCT=conditioning`),
so this is purely which values those existing builds pick up.

## Testing

- Web: existing `checks/react-smoke.mjs`-style scenario, run once per product
  build (`dist-strength`, `dist-conditioning`), asserting the rendered
  `--color-panel`/`--color-gold` (computed style) differ between the two and
  match the spec values.
- Mobile: a render test (existing test setup, e.g. via `@testing-library/react-native`
  if already in use, otherwise a light render check) asserting `useTheme()`
  under each `PRODUCT_ID` returns the corresponding palette object, plus one
  smoke render per screen per product to catch anything still importing the
  bare `color` alias where it should now use the hook.
- Visual: regenerate the two `dist-*` screenshots (same script used in the
  earlier EAS/build verification pass) and eyeball them against the approved
  mockup.

## Explicitly out of scope

- Screen/route gating per product (already a tracked, separate gap).
- A distinct heading typeface per product (discussed, deferred).
- Conditioning's own EAS project / signing key (already a tracked, separate
  gap — unrelated to this color change).
- Any change to `shared-core`, `coordinator`, or sync/migration code.
