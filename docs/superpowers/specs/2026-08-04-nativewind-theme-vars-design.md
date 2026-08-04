# Mobile NativeWind theming via runtime CSS variables

Status: approved by user 2026-08-04, following up on the mobile theme-context
branch merged in commit `868e66a`.

## Motivation

That branch's final review (see `docs/superpowers/plans/2026-08-04-mobile-theme-context.md`'s
ledger) correctly flagged that `apps/mobile/src/screens/*` and `ui.tsx` have
roughly 518 NativeWind className usages (`bg-panel`, `text-gold2`,
`border-line`, etc) that read colors from `apps/mobile/tailwind.config.js`'s
static, compile-time color table — not from the `useTheme()` context that
branch wired up. The reviewer's assumption at the time was that NativeWind
compiles class colors at build time with no runtime indirection, meaning the
only fix would be migrating all 518 call sites by hand.

That assumption is wrong for the NativeWind version actually installed here.
`apps/mobile/package.json` pins `nativewind@^4.2.1`, resolving to `4.2.6`,
whose runtime (`react-native-css-interop@0.2.6`) exports a real `vars()`
function — confirmed by reading `node_modules/react-native-css-interop/dist/runtime/native/api.d.ts`:

```ts
export declare function vars(variables: Record<string, RuntimeValueDescriptor>): Record<string, any>;
```

`vars()` returns a style-like value that, applied to a wrapping `View`,
defines CSS custom properties for that subtree — resolved at runtime, not
baked in at compile time. This is the exact mechanism the web app's
`tokens.css` already uses (`var(--color-bg)` etc, overridden by a
`data-product` attribute selector); NativeWind's `vars()` is React Native's
runtime equivalent. So the 518 call sites don't need touching at all — only
the value each `var(--color-*)` resolves to needs to vary per product.

## Design

### `apps/mobile/tailwind.config.js`

Keep every existing key exactly as-is (all 25: `bg`, `panel`, `panel2`,
`panel3`, `well`, `line`, `line2`, `text`, `muted`, `dim`, `gold`, `gold2`,
`gold-wash`, `gold-line`, `done-bg`, `done-line`, `done-ink`, `on-accent`,
`ok`, `warn`, `bad`, `z-low`, `z-mod`, `z-high`, `track`). Change only the
*values* from literal hex/rgba strings to `var(--color-*)` references, using
the same variable names the web app's `tokens.css` already defines (e.g.
`bg: '#070706'` → `bg: 'var(--color-bg)'`, `'gold-wash': 'rgba(...)'` →
`'gold-wash': 'var(--color-gold-wash)'`). No key is added or removed — this
branch does not backfill any `Palette` key the Tailwind config doesn't
already expose as a class, matching the "match config exactly" scope
decision.

### `apps/mobile/src/nativeThemeVars.ts` (new)

One pure function:

```ts
import type { Palette } from '@hybrid/design';

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
```

The mapping is a flat literal, not a generic loop over `Palette`'s keys —
deliberately, so it stays visibly parallel to `tailwind.config.js`'s key
list. A key added to one and not the other is a one-line diff away from
being caught by review, rather than silently absent.

### `apps/mobile/src/App.tsx`

Import `vars` from `nativewind` and `View` from `react-native` (already
imports `AccessibilityInfo, Text` from `react-native`; add `View` to that
import). In `AppInner` (the component below `<ThemeProvider>`, per the
provider-above-consumer fix already merged), wrap the existing return value
in one `View`:

```tsx
const { color } = useTheme();
// ...unchanged...
return (
  <View className="flex-1" style={vars(buildNativeThemeVars(color))}>
    <SafeAreaProvider>
      {/* everything currently here, unchanged */}
    </SafeAreaProvider>
  </View>
);
```

`className="flex-1"` is load-bearing, not decoration — a bare `View` has no
intrinsic size, and without it the wrapper collapses and nothing inside
renders visibly.

## What stays untouched

- All 518 existing className usages across `apps/mobile/src/screens/*` and
  `ui.tsx` — that's the entire point.
- The web app and its `tokens.css` mechanism — already correct, unrelated
  runtime.
- `packages/design`'s `Palette`/`strengthColor`/`conditioningColor`/
  `ThemeProvider`/`useTheme` — consumed as-is, no changes.
- No NativeWind/react-native-css-interop version change — `4.2.6` already
  has `vars()`.

## Testing

- `buildNativeThemeVars(strengthColor)` and `buildNativeThemeVars(conditioningColor)`
  return the expected 25-key objects with real, differing values —
  a plain vitest/jest unit test on a pure function, no rendering needed.
- **Known gap, stated plainly rather than hidden**: `apps/mobile/jest.config.js`
  maps `\.css$` to a stub (`test/style-stub.js`), and NativeWind's class→style
  resolution depends on the compiled CSS pipeline that stub replaces. This
  means no jest test can observe an actual resolved native style (e.g.
  assert a rendered `View`'s `backgroundColor`) — jest proves the *inputs*
  to `vars()` are correct, not that NativeWind's runtime actually applies
  them. Visual proof requires a real render: a dev-client build or an EAS
  preview build under each product's env var, screenshotted, the same way
  the earlier web `dist-strength`/`dist-conditioning` screenshots were taken
  in this session. This plan's implementation task must include that manual
  visual check as its own step, not skip it because jest is green.

## Out of scope

- Adding any `Palette` key as a new Tailwind class that isn't already one.
- Any change to route/screen gating per product (already a separately
  tracked gap).
- Any change to the 518 call sites themselves.
