# Mobile NativeWind Theme Vars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing NativeWind className color usage in the mobile app (`bg-panel`, `text-gold2`, `border-line`, etc — ~518 call sites) resolve through the active per-product palette (`strengthColor`/`conditioningColor`), without touching any of those call sites.

**Architecture:** NativeWind's runtime (`react-native-css-interop@0.2.6`, bundled with the already-installed `nativewind@4.2.6`) exports a real `vars()` function — CSS custom properties resolved at render time, the same mechanism the web app's `tokens.css` already uses. `apps/mobile/tailwind.config.js`'s color table changes from literal hex/rgba values to `var(--color-*)` references; one `View` wrapping the app root, styled with `vars(...)` built from the already-wired `useTheme()` context, supplies the actual values. Every existing className then re-themes automatically.

**Tech Stack:** NativeWind 4.2.6, `react-native-css-interop` (already a transitive dependency, no version change), React Native, Jest (`apps/mobile`'s existing suite).

## Global Constraints

- Every one of `tailwind.config.js`'s existing 25 color keys is kept — none added, none removed. (Spec: "Design — apps/mobile/tailwind.config.js".)
- `apps/mobile/src/nativeThemeVars.ts`'s key mapping is a flat literal (25 explicit `'--color-*': color.someKey` pairs), not a generic loop over `Palette` — so a key added to one file and not the other shows up as a one-line diff, not a silent gap. (Spec: "The mapping is a flat literal... deliberately.")
- `className="flex-1"` on the wrapping `View` is required, not optional — a bare `View` has no intrinsic size and would collapse the whole app to invisible. (Spec: "load-bearing, not decoration".)
- No existing className call site (all ~518 of them, across `apps/mobile/src/screens/*` and `ui.tsx`) is modified by this plan.
- No change to the web app, to `packages/design`, or to NativeWind's version.
- `apps/mobile/jest.config.js` maps `.css` imports to a stub — no jest test in this plan can observe an actual resolved native style. This is a stated, accepted limitation, not a gap to work around with a different testing library. Visual proof is a manual step (Task 2, Step 7), not automated.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/mobile/src/nativeThemeVars.ts` (new) | `buildNativeThemeVars(color: Palette): Record<string, string>` — pure mapping from a `Palette` to the 25 `--color-*` CSS variable names `tailwind.config.js` will reference. |
| `apps/mobile/test/nativeThemeVars.test.ts` (new) | Unit tests for the above — the only automated proof in this plan. |
| `apps/mobile/tailwind.config.js` (modify) | Swap literal color values for `var(--color-*)` references. Same 25 keys, values only. |
| `apps/mobile/src/App.tsx` (modify) | Wrap `AppInner`'s return in one `View` styled with `vars(buildNativeThemeVars(color))`. |

---

## Task 1: `buildNativeThemeVars` pure mapping function

**Files:**
- Create: `apps/mobile/src/nativeThemeVars.ts`
- Create: `apps/mobile/test/nativeThemeVars.test.ts`

**Interfaces:**
- Consumes: `type Palette` from `@hybrid/design` (already exists — the shape both `strengthColor` and `conditioningColor` share).
- Produces: `buildNativeThemeVars(color: Palette): Record<string, string>`, consumed by Task 2's `App.tsx` change.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/nativeThemeVars.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @hybrid/mobile test -- nativeThemeVars`
Expected: FAIL — cannot find module `../src/nativeThemeVars`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/nativeThemeVars.ts`:

```ts
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
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `pnpm --filter @hybrid/mobile test -- nativeThemeVars`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/nativeThemeVars.ts apps/mobile/test/nativeThemeVars.test.ts
git commit -m "mobile: add buildNativeThemeVars mapping"
```

---

## Task 2: Wire `tailwind.config.js` and `App.tsx` to the runtime vars

**Files:**
- Modify: `apps/mobile/tailwind.config.js`
- Modify: `apps/mobile/src/App.tsx`

**Interfaces:**
- Consumes: `buildNativeThemeVars` (Task 1, `../src/nativeThemeVars`); `vars` from `nativewind` (already a transitive dependency — no `package.json` change needed, `nativewind` is already in `apps/mobile/package.json`'s dependencies).

- [ ] **Step 1: Rewrite `tailwind.config.js`'s color values**

Current file (`apps/mobile/tailwind.config.js`):

```js
/*
 * NativeWind reads the SAME token names as the web app's Tailwind theme, so a
 * class like `bg-panel` or `text-gold2` means the same colour on both. The 8px
 * grid is enforced the same way too: the spacing scale is multiples of 8.
 */
const space = { 0.5: 4, 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 8: 64, 10: 80, 12: 96 };
const px = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v + 'px']));

module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#070706', panel: '#141311', panel2: '#1c1b18', panel3: '#0a0a09', well: '#0c0c0a',
        line: 'rgba(255,255,255,.065)', line2: 'rgba(255,255,255,.1)',
        text: '#f5f1e9', muted: '#aaa49a', dim: '#847d73',
        gold: '#c09358', gold2: '#e0bc87',
        'gold-wash': 'rgba(192,147,88,.09)', 'gold-line': 'rgba(224,188,135,.22)',
        'done-bg': 'rgba(192,147,88,.14)', 'done-line': 'rgba(224,188,135,.5)', 'done-ink': '#e6c795',
        'on-accent': '#1b1509',
        ok: '#9fc59b', warn: '#d1a464', bad: '#cf7f7c',
        'z-low': '#5b8def', 'z-mod': '#cf9d4f', 'z-high': '#e0524d',
        track: 'rgba(255,255,255,.08)',
      },
      spacing: px(space),
      borderRadius: { sm: '10px', md: '14px', lg: '18px', pill: '999px' },
      fontSize: {
        1: '10px', 2: '11px', 3: '12px', 4: '13px', 5: '14px',
        6: '16px', 7: '20px', 8: '26px', 9: '34px',
      },
    },
  },
  plugins: [],
};
```

Change ONLY the `colors` block's values (every key name stays exactly the same), to:

```js
      colors: {
        bg: 'var(--color-bg)', panel: 'var(--color-panel)', panel2: 'var(--color-panel2)',
        panel3: 'var(--color-panel3)', well: 'var(--color-well)',
        line: 'var(--color-line)', line2: 'var(--color-line2)',
        text: 'var(--color-text)', muted: 'var(--color-muted)', dim: 'var(--color-dim)',
        gold: 'var(--color-gold)', gold2: 'var(--color-gold2)',
        'gold-wash': 'var(--color-gold-wash)', 'gold-line': 'var(--color-gold-line)',
        'done-bg': 'var(--color-done-bg)', 'done-line': 'var(--color-done-line)', 'done-ink': 'var(--color-done-ink)',
        'on-accent': 'var(--color-on-accent)',
        ok: 'var(--color-ok)', warn: 'var(--color-warn)', bad: 'var(--color-bad)',
        'z-low': 'var(--color-z-low)', 'z-mod': 'var(--color-z-mod)', 'z-high': 'var(--color-z-high)',
        track: 'var(--color-track)',
      },
```

Also update the file's top comment — it currently says "NativeWind reads the SAME token names as the web app's Tailwind theme" which is still true, but doesn't mention the var indirection this task adds. Change the comment block to:

```js
/*
 * NativeWind reads the SAME token names as the web app's Tailwind theme, so a
 * class like `bg-panel` or `text-gold2` means the same colour on both. The 8px
 * grid is enforced the same way too: the spacing scale is multiples of 8.
 *
 * Colors are `var(--color-*)` references, not literals — App.tsx wraps the
 * app root in a View styled with NativeWind's `vars()`, fed by the active
 * ThemeProvider palette (packages/design), so every className below re-themes
 * per product without any call site changing. See
 * docs/superpowers/specs/2026-08-04-nativewind-theme-vars-design.md.
 */
```

Nothing else in this file changes (spacing/borderRadius/fontSize stay literal — they don't vary by product).

- [ ] **Step 2: Typecheck (config file has no types, but confirm nothing else broke)**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors. (This step mainly exists to catch a stray syntax error in the `.js` file before moving on — `tsc` won't type-check a `.js` config, but a broken `require()` in it would surface when Metro/Jest load the app, which the next steps will catch.)

- [ ] **Step 3: Update `App.tsx`'s imports**

Change:

```ts
import { AccessibilityInfo, Text } from 'react-native';
```

to:

```ts
import { AccessibilityInfo, Text, View } from 'react-native';
```

Add a new import line after the `@hybrid/design` import:

```ts
import { ThemeProvider, radius, useTheme } from '@hybrid/design';
import { vars } from 'nativewind';
import { buildNativeThemeVars } from './nativeThemeVars';
```

- [ ] **Step 4: Wrap `AppInner`'s return in the vars-styled `View`**

Change:

```tsx
  return (
      <SafeAreaProvider>
        <DbProvider>
          <SyncProvider>
            <WhoopProvider>
              <Concept2Provider>
              <RestProvider>
              <SetTimerProvider>
            <NavigationContainer theme={theme}>
              <StatusBar style="light" />
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: color.bg },
                  /* 'fade', not 'none'. A screen that simply appears reads as a
                     glitch — the eye cannot tell a navigation from a redraw — so
                     the calm version still marks the transition, it just does not
                     travel. */
                  animation: reduceMotion ? 'fade' : 'slide_from_right',
                  gestureEnabled: true,
                }}
              >
                <Stack.Screen name="Tabs" component={TabNav} />
                <Stack.Screen name="Logger" component={LoggerScreen} />
                <Stack.Screen name="Planner" component={PlannerScreen} />
                <Stack.Screen name="GuidedBuilder" component={GuidedBuilderScreen} />
                <Stack.Screen name="Recap" component={RecapScreen} />
                <Stack.Screen name="Conditioning" component={ConditioningScreen} />
                <Stack.Screen name="History" component={HistoryScreen} />
                <Stack.Screen name="Calendar" component={CalendarScreen} />
                <Stack.Screen name="Exercise" component={ExerciseScreen} />
                <Stack.Screen name="Day" component={DayScreen} />
              </Stack.Navigator>
                </NavigationContainer>
              </SetTimerProvider>
              </RestProvider>
              </Concept2Provider>
            </WhoopProvider>
          </SyncProvider>
        </DbProvider>
      </SafeAreaProvider>
  );
}
```

to (only the outermost wrapper changes — everything from `<SafeAreaProvider>` to `</SafeAreaProvider>` is unchanged, just now nested one level deeper inside the new `View`):

```tsx
  return (
    <View className="flex-1" style={vars(buildNativeThemeVars(color))}>
      <SafeAreaProvider>
        <DbProvider>
          <SyncProvider>
            <WhoopProvider>
              <Concept2Provider>
              <RestProvider>
              <SetTimerProvider>
            <NavigationContainer theme={theme}>
              <StatusBar style="light" />
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: color.bg },
                  /* 'fade', not 'none'. A screen that simply appears reads as a
                     glitch — the eye cannot tell a navigation from a redraw — so
                     the calm version still marks the transition, it just does not
                     travel. */
                  animation: reduceMotion ? 'fade' : 'slide_from_right',
                  gestureEnabled: true,
                }}
              >
                <Stack.Screen name="Tabs" component={TabNav} />
                <Stack.Screen name="Logger" component={LoggerScreen} />
                <Stack.Screen name="Planner" component={PlannerScreen} />
                <Stack.Screen name="GuidedBuilder" component={GuidedBuilderScreen} />
                <Stack.Screen name="Recap" component={RecapScreen} />
                <Stack.Screen name="Conditioning" component={ConditioningScreen} />
                <Stack.Screen name="History" component={HistoryScreen} />
                <Stack.Screen name="Calendar" component={CalendarScreen} />
                <Stack.Screen name="Exercise" component={ExerciseScreen} />
                <Stack.Screen name="Day" component={DayScreen} />
              </Stack.Navigator>
                </NavigationContainer>
              </SetTimerProvider>
              </RestProvider>
              </Concept2Provider>
            </WhoopProvider>
          </SyncProvider>
        </DbProvider>
      </SafeAreaProvider>
    </View>
  );
}
```

`className="flex-1"` is required — without it the wrapping `View` has no intrinsic size and the whole app renders invisible. `color` is already in scope from the `useTheme()` call earlier in `AppInner` (line ~171) — no new hook needed.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors — specifically, no "cannot find module 'nativewind'" (it's already a dependency) and no unused-import warnings.

- [ ] **Step 6: Run the existing jest suite (regression check)**

Run: `pnpm --filter @hybrid/mobile test`
Expected: PASS, same count as before this task (114 tests — see Global Constraints on why jest can't observe the actual themed output; this step only confirms nothing else broke, e.g. no component crashing because `vars`/`buildNativeThemeVars` throw during render).

- [ ] **Step 7: Manual visual verification (not automatable — see Global Constraints)**

This is the step that actually proves the fix works; Steps 5-6 only prove it doesn't crash. Do ONE of the following, whichever is available in the current environment:

- **Preferred:** run `pnpm --filter @hybrid/mobile bundle` twice — once with `EXPO_PUBLIC_HYBRID_PRODUCT` unset (strength) and once with `EXPO_PUBLIC_HYBRID_PRODUCT=conditioning` — producing two Android export bundles, then start each under Expo Go / an emulator and visually confirm: the strength build shows the existing brass/gold app (unchanged from before this plan), and the conditioning build shows the SAME layouts in the teal palette from `conditioningColor` (background, panels, gold-wash accents, etc all read as teal, not brass).
- **If no device/emulator is available:** open `apps/mobile/src/App.tsx` and confirm by inspection that `vars(buildNativeThemeVars(color))` is reachable from every screen (i.e. no screen renders outside the wrapping `View` — check that `Stack.Screen`'s components, e.g. `HomeScreen`, are all descendants of the `View` added in Step 4, not siblings or portals rendered elsewhere). Explicitly state in the task's completion report that visual verification was NOT performed and why, rather than silently skipping it.

Record which option was used and its outcome in the task's report — do not claim visual confirmation without actually having produced it.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/tailwind.config.js apps/mobile/src/App.tsx
git commit -m "mobile: theme NativeWind classes via runtime CSS vars"
```
