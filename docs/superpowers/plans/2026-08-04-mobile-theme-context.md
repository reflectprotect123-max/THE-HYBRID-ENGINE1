# Mobile Theme Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mobile app a real per-product color theme (strength brass vs conditioning teal) by replacing `packages/design`'s single static `color` export with a `ThemeProvider`/`useTheme()` context keyed on `PRODUCT_ID`, and migrating every mobile call site that reads a brand-differing color key onto it.

**Architecture:** `packages/design/src/tokens.ts` splits its color block into semantic keys shared by both products (`sharedColor`) and brand keys that differ (`strengthBrand`/`conditioningBrand`), composing `strengthColor`/`conditioningColor`. A new `packages/design/src/theme.ts` exposes a pure `resolvePalette(productId)`, a React `ThemeContext`/`ThemeProvider`, and a `useTheme()` hook. `apps/mobile/src/App.tsx` wraps its tree in `<ThemeProvider productId={PRODUCT_ID}>`; the handful of files that read brand-differing keys (`App.tsx` itself, `ui.tsx`, `Home.tsx`, `Settings.tsx`) swap their static `import { color } from '@hybrid/design'` for `useTheme()` inside each component. Files that only read semantic keys (`Conditioning.tsx`, `Progress.tsx`) are unaffected and are not touched.

**Tech Stack:** TypeScript, React 19 (Context API — `createContext`/`useContext`, no JSX needed in `packages/design` so no tsconfig/jsx changes), React Native / Expo, existing `jest-expo` + `@testing-library/react-native` suite in `apps/mobile`, `vitest` for `packages/design`'s own unit tests, pnpm workspaces.

## Global Constraints

- Key *names* on the color object do not change (`color.gold`, `color.doneInk`, etc.) — only which palette they resolve to. (Spec: "What differs per product".)
- Semantic/HR keys (`blue`, `blue2`, `ok`, `warn`, `bad`, `zoneBlue`/`zoneGreen`/`zoneRed`, `zLow`/`zMod`/`zHigh`, `neonStrain`/`neonOk`/`neonWarn`/`neonBad`, `ringIdle`/`trackSoft`/`track`/`trackStrong`/`chartDotRing`) must be byte-identical between `strengthColor` and `conditioningColor`. (Spec: "What stays shared".)
- No component, layout, or spacing/radius/motion change — this plan only changes which color values components read. (Spec: "What stays shared".)
- Conditioning brand values are exactly the ones in the approved mockup: `gold2` → `#7fe3d4`, `onAccent` → `#04211d`, full list in `docs/superpowers/specs/2026-08-04-product-retheme-design.md`.
- `packages/design`'s own `tsc`/`vitest` must be able to resolve `react` locally (peer + dev dependency), consistent with `apps/mobile` (`react@19.1.0`) and `apps/web` (`react@^19.2.0`).
- pnpm workspace, `pnpm@10.33.0` pinned (`package.json` `packageManager`), Node `>=20.19`.
- `web`'s CSS-variable half of the spec (`tokens.css`, `data-product` override) is explicitly **out of scope for this plan** — this plan is mobile-only.
- Every existing test (`apps/mobile`'s jest suite, `packages/engine`/`packages/guided-flow`'s vitest suites) must keep passing unmodified — the context's default value (`strengthColor`) is what makes that possible, since none of those tests wrap anything in `ThemeProvider`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/design/src/tokens.ts` (modify) | Split color data into shared vs per-product brand blocks; export `strengthColor`, `conditioningColor`, `Palette` type, and `color` (back-compat alias for `strengthColor`). |
| `packages/design/src/theme.ts` (new) | `resolvePalette(productId)`, `ThemeContext`, `ThemeProvider`, `useTheme()`. |
| `packages/design/src/index.ts` (modify) | Re-export `./theme` alongside `./tokens`. |
| `packages/design/package.json` (modify) | Add `@hybrid/product-scope` dependency, `react` peer/dev dependency, `@types/react` + `vitest` dev dependencies, real `test` script. |
| `packages/design/vitest.config.ts` (new) | Point vitest at `test/**/*.test.ts`, matching `packages/engine`/`packages/guided-flow`'s pattern. |
| `packages/design/test/tokens.test.ts` (new) | Assert shared keys match, brand keys differ, and `resolvePalette` resolves correctly. |
| `apps/mobile/src/App.tsx` (modify) | Wrap the app root in `ThemeProvider`; move the navigation `theme` object inside the component (was module-scope) so it can call `useTheme()`; migrate `TabNav`'s inline colors. |
| `apps/mobile/src/ui.tsx` (modify) | Migrate `Input`, `Btn`, `Ring` off the static `color` import. |
| `apps/mobile/src/screens/Home.tsx` (modify) | Migrate `SessionCard`'s two `goldWash` reads. |
| `apps/mobile/src/screens/Settings.tsx` (modify) | Migrate `RecoveryCard`, `CloudCard`, `WhoopCard`, `Concept2Card`'s `onAccent` reads. |
| `apps/mobile/test/theme.test.tsx` (new) | Render a probe component under `ThemeProvider` for each `ProductId` and assert the resolved color actually differs — the end-to-end proof the wiring works. |

`apps/mobile/src/screens/Conditioning.tsx` and `apps/mobile/src/screens/Progress.tsx` also import `color` from `@hybrid/design`, but every key they read (`ringIdle`, `neonOk`/`neonWarn`/`neonBad`, `zLow`, `neonStrain`, `ok`, `zMod`) is a **shared** key — identical in both palettes. They are not modified by this plan; noted here so their absence from the task list below is a deliberate, verified decision, not an oversight.

---

## Task 1: Split `packages/design`'s color tokens into shared vs per-product brand blocks

**Files:**
- Modify: `packages/design/src/tokens.ts`
- Create: `packages/design/test/tokens.test.ts`
- Create: `packages/design/vitest.config.ts`
- Modify: `packages/design/package.json`

**Interfaces:**
- Produces: `strengthColor: Palette`, `conditioningColor: Palette`, `type Palette`, `color: Palette` (unchanged alias, now `= strengthColor`) — all from `packages/design/src/tokens.ts`, consumed by Task 2's `theme.ts` and, transitively, by every later task.

- [ ] **Step 1: Add the vitest devDependency and a real test script**

`packages/design/package.json` currently has no runtime dependencies and a no-op `test` script. Replace the whole file:

```json
{
  "name": "@hybrid/design",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/tokens.css"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hybrid/product-scope": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "react": "^19.2.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Add the vitest config**

Create `packages/design/vitest.config.ts` (same pattern as `packages/guided-flow/vitest.config.ts`):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Install so the new deps resolve**

Run: `pnpm install`
Expected: lockfile updates, no errors. (No code exists yet to test — Step 4 writes the failing test first.)

- [ ] **Step 4: Write the failing test**

Create `packages/design/test/tokens.test.ts`:

```ts
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
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `pnpm --filter @hybrid/design test`
Expected: FAIL — `conditioningColor` is not exported from `../src/tokens` yet.

- [ ] **Step 6: Rewrite `tokens.ts`'s color section**

In `packages/design/src/tokens.ts`, replace the existing `export const color = { ... } as const;` block (everything from `export const color = {` through its closing `} as const;`) with:

```ts
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
  dim: '#5f7d7b',

  gold: '#3fada3',
  gold2: '#7fe3d4',
  goldWash: 'rgba(63,173,163,.09)',
  goldLine: 'rgba(127,227,212,.22)',
  doneBg: 'rgba(63,173,163,.14)',
  doneLine: 'rgba(127,227,212,.5)',
  doneInk: '#a7ece1',
  onAccent: '#04211d',
} as const;

export const strengthColor = { ...strengthBrand, ...sharedColor } as const;
export const conditioningColor = { ...conditioningBrand, ...sharedColor } as const;

/** The shape every palette has. Use this, not `typeof color`, when a type is
 * needed independent of which palette is active. */
export type Palette = typeof strengthColor;

/** Back-compat default — strength's palette, always. Prefer `useTheme()`
 * (./theme) in any component that should vary by product. */
export const color: Palette = strengthColor;
```

Leave every other export in the file (`space`, `radius`, `fontSize`, `fontWeight`, `duration`, `easing`, `shadow`, `gradient`, `zonePalette`, `ZoneKey`) exactly as-is — `zonePalette` reads `color.zoneBlue` etc., which are shared keys with identical values in both palettes, so it stays correct unchanged.

- [ ] **Step 7: Run the test again to confirm it passes**

Run: `pnpm --filter @hybrid/design test`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck the package**

Run: `pnpm --filter @hybrid/design typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/design/package.json packages/design/vitest.config.ts packages/design/test/tokens.test.ts packages/design/src/tokens.ts
git commit -m "design: split color tokens into shared + per-product brand blocks"
```

---

## Task 2: Add `ThemeProvider`/`useTheme` to `packages/design`

**Files:**
- Create: `packages/design/src/theme.ts`
- Modify: `packages/design/src/index.ts`
- Modify: `packages/design/test/tokens.test.ts`

**Interfaces:**
- Consumes: `strengthColor`, `conditioningColor`, `Palette` (Task 1, `./tokens`).
- Produces: `resolvePalette(productId: ProductId): Palette`, `ThemeProvider({ productId, children }: { productId: ProductId; children: ReactNode })`, `useTheme(): { color: Palette }` — all from `@hybrid/design`, consumed by every task from here on.

- [ ] **Step 1: Write the failing test**

Append to `packages/design/test/tokens.test.ts` (new `describe` block, same file):

```ts
import { resolvePalette } from '../src/theme';

describe('resolvePalette', () => {
  it('returns conditioningColor for the conditioning product', () => {
    expect(resolvePalette('conditioning')).toBe(conditioningColor);
  });

  it('returns strengthColor for the strength product', () => {
    expect(resolvePalette('strength')).toBe(strengthColor);
  });
});
```

(Add the `import { resolvePalette } from '../src/theme';` line next to the existing imports at the top of the file.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @hybrid/design test`
Expected: FAIL — cannot find module `../src/theme`.

- [ ] **Step 3: Write `theme.ts`**

Create `packages/design/src/theme.ts`. Written with `createElement` rather than JSX so the file can stay `.ts` (no `jsx` tsconfig setting needed for this package):

```ts
import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { ProductId } from '@hybrid/product-scope';
import { conditioningColor, strengthColor, type Palette } from './tokens';

/** Pure so it is testable without mounting anything React. */
export function resolvePalette(productId: ProductId): Palette {
  return productId === 'conditioning' ? conditioningColor : strengthColor;
}

const ThemeContext = createContext<Palette>(strengthColor);

/**
 * Wrap an app root in this, passing the build's `PRODUCT_ID`, and every
 * `useTheme()` below it resolves to that product's palette.
 *
 * Unwrapped consumers — which is every existing test, since none of them
 * know this exists yet — get strength's palette from the context's default
 * value rather than a thrown error. That default is what keeps this change
 * from being a breaking one.
 */
export function ThemeProvider({ productId, children }: { productId: ProductId; children: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: resolvePalette(productId) }, children);
}

export function useTheme(): { color: Palette } {
  return { color: useContext(ThemeContext) };
}
```

- [ ] **Step 4: Re-export it from the package root**

`packages/design/src/index.ts` currently reads:

```ts
export * from './tokens';
```

Change to:

```ts
export * from './tokens';
export * from './theme';
```

- [ ] **Step 5: Run the test again to confirm it passes**

Run: `pnpm --filter @hybrid/design test`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @hybrid/design typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/design/src/theme.ts packages/design/src/index.ts packages/design/test/tokens.test.ts
git commit -m "design: add ThemeProvider/useTheme context"
```

---

## Task 3: Wire `ThemeProvider` into `apps/mobile/src/App.tsx`

**Files:**
- Modify: `apps/mobile/src/App.tsx`

**Interfaces:**
- Consumes: `ThemeProvider`, `useTheme` (Task 2, `@hybrid/design`); `PRODUCT_ID` (already exported from `apps/mobile/src/product.ts`).

This is the task where the app actually starts varying by product — before this, `ThemeProvider` exists but nothing renders it.

- [ ] **Step 1: Update imports**

Change:

```ts
import { color, radius } from '@hybrid/design';
```

to:

```ts
import { ThemeProvider, radius, useTheme } from '@hybrid/design';
```

Change:

```ts
import { PRODUCT } from './product';
```

to:

```ts
import { PRODUCT, PRODUCT_ID } from './product';
```

Change:

```ts
import { useEffect, useState } from 'react';
```

to:

```ts
import { useEffect, useMemo, useState } from 'react';
```

- [ ] **Step 2: Delete the module-scope `theme` object**

Delete this whole block (it moves inside `App()` in Step 4, because it needs `useTheme()`, which only works inside a component):

```ts
const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: color.gold2,
    background: color.bg,
    card: color.panel3,
    text: color.text,
    border: color.line,
    notification: color.gold,
  },
  /* Whatever chrome the navigator draws itself renders in Inter too. The
     weights are 'normal' on purpose: each Inter file IS its weight, and a
     fontWeight on top invites Android to fake-bold an already-bold face. */
  fonts: {
    regular: { fontFamily: font.reg, fontWeight: 'normal' },
    medium: { fontFamily: font.med, fontWeight: 'normal' },
    bold: { fontFamily: font.semi, fontWeight: 'normal' },
    heavy: { fontFamily: font.bold, fontWeight: 'normal' },
  },
};
```

- [ ] **Step 3: Migrate `TabNav`**

Change:

```ts
function TabNav() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.gold2,
        tabBarInactiveTintColor: color.dim,
        /* The active tab per 04-athlete-03: gold ink over a soft gold wash,
           rounded like every other selected surface in the app. */
        tabBarActiveBackgroundColor: color.goldWash,
        tabBarItemStyle: { borderRadius: radius.sm, marginHorizontal: 4, marginVertical: 3 },
        tabBarStyle: { backgroundColor: color.panel3, borderTopColor: color.line },
        tabBarLabelStyle: { fontSize: 11, fontFamily: font.med },
        tabBarAccessibilityLabel: PRODUCT.name,
      }}
    >
```

to:

```ts
function TabNav() {
  const { color } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.gold2,
        tabBarInactiveTintColor: color.dim,
        /* The active tab per 04-athlete-03: gold ink over a soft gold wash,
           rounded like every other selected surface in the app. */
        tabBarActiveBackgroundColor: color.goldWash,
        tabBarItemStyle: { borderRadius: radius.sm, marginHorizontal: 4, marginVertical: 3 },
        tabBarStyle: { backgroundColor: color.panel3, borderTopColor: color.line },
        tabBarLabelStyle: { fontSize: 11, fontFamily: font.med },
        tabBarAccessibilityLabel: PRODUCT.name,
      }}
    >
```

- [ ] **Step 4: Rebuild `theme` inside `App()` and wrap the tree**

Change:

```ts
export function App() {
  /* Inter is the app's voice — the same family the design cards and both web
     apps set first in their stacks. Rendering before it loads would flash
     every screen in system Roboto, so the app holds on a blank frame for the
     few ms the six weights take. If loading ever ERRORS the app proceeds on
     the system fallback instead: an ugly launch beats no launch. */
  const reduceMotion = useReduceMotion();
  const [fontsReady, fontsError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });
  if (!fontsReady && !fontsError) return null;

  return (
    <SafeAreaProvider>
      <DbProvider>
```

to:

```ts
export function App() {
  /* Inter is the app's voice — the same family the design cards and both web
     apps set first in their stacks. Rendering before it loads would flash
     every screen in system Roboto, so the app holds on a blank frame for the
     few ms the six weights take. If loading ever ERRORS the app proceeds on
     the system fallback instead: an ugly launch beats no launch. */
  const reduceMotion = useReduceMotion();
  const { color } = useTheme();
  const theme: Theme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: color.gold2,
        background: color.bg,
        card: color.panel3,
        text: color.text,
        border: color.line,
        notification: color.gold,
      },
      /* Whatever chrome the navigator draws itself renders in Inter too. The
         weights are 'normal' on purpose: each Inter file IS its weight, and a
         fontWeight on top invites Android to fake-bold an already-bold face. */
      fonts: {
        regular: { fontFamily: font.reg, fontWeight: 'normal' },
        medium: { fontFamily: font.med, fontWeight: 'normal' },
        bold: { fontFamily: font.semi, fontWeight: 'normal' },
        heavy: { fontFamily: font.bold, fontWeight: 'normal' },
      },
    }),
    [color],
  );
  const [fontsReady, fontsError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });
  if (!fontsReady && !fontsError) return null;

  return (
    <SafeAreaProvider>
      <DbProvider>
```

Note `useTheme()` is called ABOVE the `if (!fontsReady...) return null;` early return, alongside the other unconditional hooks — same rule `useReduceMotion()` and `useFonts()` already follow.

- [ ] **Step 5: Migrate the `Stack.Navigator`'s `contentStyle`**

Change:

```ts
                contentStyle: { backgroundColor: color.bg },
```

This line is unchanged in source — it already reads `color.bg`, and `color` now comes from the `useTheme()` call added in Step 4, so no edit is needed here. (Confirms the destructure in Step 4 is what makes this line — and every other bare `color.*` reference already inside `App()`'s JSX — resolve correctly.)

- [ ] **Step 6: Wrap the whole return in `ThemeProvider`**

Change the outermost return shape:

```ts
  return (
    <SafeAreaProvider>
      <DbProvider>
        ...
      </DbProvider>
    </SafeAreaProvider>
  );
}
```

to:

```ts
  return (
    <ThemeProvider productId={PRODUCT_ID}>
      <SafeAreaProvider>
        <DbProvider>
          ...
        </DbProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
```

(Indent the existing JSX between `<SafeAreaProvider>` and `</SafeAreaProvider>` one level deeper; its content does not otherwise change.)

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors, and specifically no "cannot find name 'color'" — confirming no bare reference to the old static import survived.

- [ ] **Step 8: Run the existing jest suite (regression check)**

Run: `pnpm --filter @hybrid/mobile test`
Expected: PASS, same count as before this task (this task changes wiring, not behavior — every existing test renders under the context's default `strengthColor`, unchanged from today).

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/App.tsx
git commit -m "mobile: wire ThemeProvider into App.tsx"
```

---

## Task 4: Migrate `apps/mobile/src/ui.tsx` off the static `color` import

**Files:**
- Modify: `apps/mobile/src/ui.tsx`

**Interfaces:**
- Consumes: `useTheme` (Task 2, `@hybrid/design`).

- [ ] **Step 1: Update the import**

Change:

```ts
import { color } from '@hybrid/design';
```

to:

```ts
import { useTheme } from '@hybrid/design';
```

- [ ] **Step 2: Migrate `Input`**

Change:

```ts
export function Input({ w = 'reg', num, style, ...rest }: TextInputProps & { w?: Fw; num?: boolean }) {
  return (
    <RNTextInput
      placeholderTextColor={color.dim}
```

to:

```ts
export function Input({ w = 'reg', num, style, ...rest }: TextInputProps & { w?: Fw; num?: boolean }) {
  const { color } = useTheme();
  return (
    <RNTextInput
      placeholderTextColor={color.dim}
```

- [ ] **Step 3: Migrate `Btn`**

Change:

```ts
  const brass = variant === 'brass';
  /* py-1.5 + a 14px line box came to ~42px — under the bar by a hair, and the
     reason seven Settings buttons failed the audit. Declared rather than
     measured so Tap can make up the difference in slop. */
  const boxH = size === 'lg' ? 52 : 42;
  return (
```

to:

```ts
  const brass = variant === 'brass';
  const { color } = useTheme();
  /* py-1.5 + a 14px line box came to ~42px — under the bar by a hair, and the
     reason seven Settings buttons failed the audit. Declared rather than
     measured so Tap can make up the difference in slop. */
  const boxH = size === 'lg' ? 52 : 42;
  return (
```

(The existing `style={{ color: brass ? color.onAccent : color.text }}` line further down needs no edit — it already reads through `color`, now sourced from the hook.)

- [ ] **Step 4: Migrate `Ring`**

`Ring`'s `track`/`hole` currently default to `color.trackSoft`/`color.panel` in the function signature — a default parameter is evaluated only when the caller omits the argument, which means calling a hook there would make `useTheme()` run conditionally, breaking React's "same hooks, same order, every render" rule. Move the fallback into the body instead.

Change the signature:

```ts
export function Ring({
  frac,
  size = 104,
  stroke = 8,
  color: ink,
  track = color.trackSoft,
  hole = color.panel,
  glow,
  children,
}: {
```

to:

```ts
export function Ring({
  frac,
  size = 104,
  stroke = 8,
  color: ink,
  track,
  hole,
  glow,
  children,
}: {
```

Then, right after the destructure (before `const half = size / 2;`), add:

```ts
  const { color } = useTheme();
  const trackColor = track ?? color.trackSoft;
  const holeColor = hole ?? color.panel;
```

so the function now opens:

```ts
}) {
  const { color } = useTheme();
  const trackColor = track ?? color.trackSoft;
  const holeColor = hole ?? color.panel;
  const half = size / 2;
```

Then update the two usages further down. Change:

```ts
          borderColor: track,
```

to:

```ts
          borderColor: trackColor,
```

And change:

```ts
          backgroundColor: hole,
```

to:

```ts
          backgroundColor: holeColor,
```

- [ ] **Step 5: Confirm `zoneInk`/`zoneNeon` need no change**

`zoneInk` and `zoneNeon` (near the bottom of the file) read `color.zLow`/`color.zMod`/`color.zHigh`/`color.neonStrain`/`color.neonOk`/`color.neonBad` — every one of those is a **shared** key (Task 1), identical in both palettes. They can keep using the module-level `color` binding... except that binding no longer exists after Step 1 removed the import. Since these two are plain exported functions (not components — they cannot call `useTheme()`, which is a hook), give them their own tiny non-reactive import instead: add back a narrow import for just this purpose.

At the top of the file, alongside the `useTheme` import, add (named `semanticColor`, not `sharedColor`, to avoid echoing `tokens.ts`'s own unexported internal `sharedColor` constant — this is a call-site alias, a different thing):

```ts
import { color as semanticColor } from '@hybrid/design';
```

Then change:

```ts
export const zoneInk = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? color.zLow : k === 'mod' ? color.zMod : color.zHigh;

export const zoneNeon = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? color.neonStrain : k === 'mod' ? color.neonOk : color.neonBad;
```

to:

```ts
export const zoneInk = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? semanticColor.zLow : k === 'mod' ? semanticColor.zMod : semanticColor.zHigh;

export const zoneNeon = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? semanticColor.neonStrain : k === 'mod' ? semanticColor.neonOk : semanticColor.neonBad;
```

This is correct precisely because `zLow`/`zMod`/`zHigh`/`neonStrain`/`neonOk`/`neonBad` are shared keys — `semanticColor.zLow` (via the `strengthColor` alias) and a hypothetical `conditioningColor.zLow` are guaranteed equal by Task 1's own test, so which palette this alias points to cannot matter.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors.

- [ ] **Step 7: Run the existing jest suite**

Run: `pnpm --filter @hybrid/mobile test`
Expected: PASS, same count as before (`test/tap.test.tsx` renders `Btn`/`Chip`/`Tap` directly with no `ThemeProvider`, exercising the context's default value).

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/ui.tsx
git commit -m "mobile: migrate ui.tsx primitives to useTheme()"
```

---

## Task 5: Migrate `Home.tsx` and `Settings.tsx`

**Files:**
- Modify: `apps/mobile/src/screens/Home.tsx`
- Modify: `apps/mobile/src/screens/Settings.tsx`

**Interfaces:**
- Consumes: `useTheme` (Task 2, `@hybrid/design`).

- [ ] **Step 1: `Home.tsx` — update the import**

Change:

```ts
import { color } from '@hybrid/design';
```

to:

```ts
import { useTheme } from '@hybrid/design';
```

- [ ] **Step 2: `Home.tsx` — migrate `SessionCard`**

Change:

```ts
function SessionCard({
  className,
  tone,
  children,
}: {
  className?: string;
  tone?: 'raised';
  children: React.ReactNode;
}) {
  return (
    <Card tone={tone} className={`overflow-hidden ${className || ''}`}>
```

to:

```ts
function SessionCard({
  className,
  tone,
  children,
}: {
  className?: string;
  tone?: 'raised';
  children: React.ReactNode;
}) {
  const { color } = useTheme();
  return (
    <Card tone={tone} className={`overflow-hidden ${className || ''}`}>
```

(The two `backgroundColor: color.goldWash` lines below need no edit — they already read through `color`.)

- [ ] **Step 3: `Home.tsx` — typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors. (Home.tsx's other `color.*` reads — `neonOk`/`neonWarn`/`neonBad`/`zLow`/`neonStrain`/`ringIdle` — are all shared keys read inside components that still import `color` for other reasons... check: if `HomeScreen`'s own top-level component body used the old `color` import directly outside `SessionCard`, it would now fail to resolve. Run this typecheck to catch it — if it fails, add `const { color } = useTheme();` to whichever function the error points at, the same pattern as Step 2.)

- [ ] **Step 4: `Settings.tsx` — update the import**

Change:

```ts
import { color } from '@hybrid/design';
```

to:

```ts
import { useTheme } from '@hybrid/design';
```

- [ ] **Step 5: `Settings.tsx` — migrate `RecoveryCard`**

Change:

```ts
  const [saved, setSaved] = useState(false);
  const number = (value: string): number | undefined => {
```

to:

```ts
  const [saved, setSaved] = useState(false);
  const { color } = useTheme();
  const number = (value: string): number | undefined => {
```

(This is inside `function RecoveryCard() {`, which contains the `color.onAccent` usage at what was line 200.)

- [ ] **Step 6: `Settings.tsx` — migrate `CloudCard`**

Change:

```ts
function CloudCard() {
  const { enabled, user, busy, error, syncedAt, signIn, signUp, signOut, syncNow } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  if (!enabled) return null;
```

to:

```ts
function CloudCard() {
  const { enabled, user, busy, error, syncedAt, signIn, signUp, signOut, syncNow } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const { color } = useTheme();
  if (!enabled) return null;
```

`useTheme()` is added BEFORE the `if (!enabled) return null;` early return, alongside the other hooks — the same rule Task 3 Step 4 followed. Placing it after the guard would make it a conditionally-called hook.

- [ ] **Step 7: `Settings.tsx` — migrate `WhoopCard`**

Change:

```ts
function WhoopCard() {
  const { connected, sample, busy, error, lastSyncAt, connect, sync, disconnect } = useWhoop();
  const rec = todayRecovery(sample);
  return (
```

to:

```ts
function WhoopCard() {
  const { connected, sample, busy, error, lastSyncAt, connect, sync, disconnect } = useWhoop();
  const rec = todayRecovery(sample);
  const { color } = useTheme();
  return (
```

- [ ] **Step 8: `Settings.tsx` — migrate `Concept2Card`**

Change:

```ts
function Concept2Card() {
  const { connected, results, busy, error, lastSyncAt, connect, sync, disconnect } = useConcept2();
  const { db, update } = useDb();
  const [importMsg, setImportMsg] = useState('');
```

to:

```ts
function Concept2Card() {
  const { connected, results, busy, error, lastSyncAt, connect, sync, disconnect } = useConcept2();
  const { db, update } = useDb();
  const [importMsg, setImportMsg] = useState('');
  const { color } = useTheme();
```

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors, and specifically no "cannot find name 'color'" in `Settings.tsx` — confirming all 5 `onAccent` reads (in `RecoveryCard`, `CloudCard`, `WhoopCard`, `Concept2Card` ×2) now resolve.

- [ ] **Step 10: Run the existing jest suite**

Run: `pnpm --filter @hybrid/mobile test`
Expected: PASS, same count as before (`test/screens.test.tsx` renders `HomeScreen` via `renderScreen`, exercising `SessionCard` under the context's default value; there is no existing `Settings` screen test, so this task adds no new regression surface for `Settings.tsx` beyond the typecheck).

- [ ] **Step 11: Commit**

```bash
git add apps/mobile/src/screens/Home.tsx apps/mobile/src/screens/Settings.tsx
git commit -m "mobile: migrate Home.tsx and Settings.tsx to useTheme()"
```

---

## Task 6: Prove the wiring end-to-end, then full verification and push

**Files:**
- Create: `apps/mobile/test/theme.test.tsx`

**Interfaces:**
- Consumes: `ThemeProvider`, `useTheme` (Task 2, `@hybrid/design`).

Every task so far is verified by typecheck + the *existing* suite passing unchanged — which proves nothing broke, but nothing so far actually renders a component under `productId="conditioning"` and checks the color really changes. This task closes that gap.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/theme.test.tsx`:

```tsx
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider, conditioningColor, strengthColor, useTheme } from '@hybrid/design';

function Probe() {
  const { color } = useTheme();
  return <Text testID="ink">{color.onAccent}</Text>;
}

describe('ThemeProvider / useTheme', () => {
  it('resolves the strength palette under productId="strength"', () => {
    render(
      <ThemeProvider productId="strength">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('ink').props.children).toBe(strengthColor.onAccent);
  });

  it('resolves the conditioning palette under productId="conditioning"', () => {
    render(
      <ThemeProvider productId="conditioning">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('ink').props.children).toBe(conditioningColor.onAccent);
  });

  it('falls back to the strength palette when nothing wraps it', () => {
    render(<Probe />);
    expect(screen.getByTestId('ink').props.children).toBe(strengthColor.onAccent);
  });

  it('actually differs between the two products', () => {
    expect(conditioningColor.onAccent).not.toBe(strengthColor.onAccent);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @hybrid/mobile test -- theme.test`
Expected: FAIL if any earlier task's wiring is wrong (e.g. `ThemeProvider` not exported, `useTheme` throwing). If Tasks 1–5 were done correctly, this may in fact PASS immediately — that is fine and expected; it is still the step that proves it, not an assumption.

- [ ] **Step 3: If it failed, fix the wiring; then confirm it passes**

Run: `pnpm --filter @hybrid/mobile test -- theme.test`
Expected: PASS (4 tests).

- [ ] **Step 4: Full workspace typecheck**

Run: `pnpm -r typecheck`
Expected: every package passes, including `@hybrid/design`, `@hybrid/mobile`, `@hybrid/web`, `@hybrid/engine`, `@hybrid/guided-flow`, and the other ecosystem packages untouched by this plan.

- [ ] **Step 5: Full mobile test suite**

Run: `pnpm --filter @hybrid/mobile test`
Expected: PASS, previous count + 4 (this task's new `theme.test.tsx`).

- [ ] **Step 6: Full design package test**

Run: `pnpm --filter @hybrid/design test`
Expected: PASS (5 tests from Tasks 1–2).

- [ ] **Step 7: Confirm nothing outside mobile/design changed**

Run: `git status --short`
Expected: only files listed in this plan's File Structure section are modified/new — nothing under `apps/web`, `packages/engine`, `packages/coordinator`, etc.

- [ ] **Step 8: Commit and push**

```bash
git add apps/mobile/test/theme.test.tsx
git commit -m "mobile: add end-to-end ThemeProvider/useTheme test"
git push -u origin main
```
