# Phase 1 — Working-Weight Confidence Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Phase 0's `explainWorkingWeight` confidence signal in the Logger screen on both apps — when a working weight has no recovery data behind it (no WHOOP connected), the athlete sees an "estimate" tag next to it instead of an identically-styled number as a WHOOP-eased suggestion.

**Architecture:** `Logger.tsx` on both apps already computes `earned = nextWorkingWeight(...)` and renders `earned.note` as a plain string next to the weight field. This adds one more computed value — `explainWorkingWeight(earned, todayRecovery(whoop))` from Phase 0's `@hybrid/engine` exports — and appends `' · estimate'` to the existing note string when its `confidence` comes back `'low'`. No new component, no new engine code, no change to `nextWorkingWeight` or the weight number itself.

**Tech Stack:** React 19 (web) / React Native 0.81 (mobile), both already importing `@hybrid/engine`; Playwright (`checks/react-smoke.mjs`) for web; Jest + React Native Testing Library (`apps/mobile/test/logger.test.tsx`) for mobile.

## Global Constraints

- `pnpm run verify` must stay green after every task.
- Golden suite untouched: `Logger.tsx` is outside the golden fixture path entirely, but never touch `packages/engine/test/golden/*` or `golden.test.ts` regardless.
- No change to `nextWorkingWeight`, `todayRecovery`, or `explainWorkingWeight`'s existing behavior — this consumes Phase 0's already-built, already-tested `explainWorkingWeight(w, rec)` exactly as it stands.
- The weight number shown to the athlete never changes — only the note text next to it gains an optional suffix.
- When `confidence === 'high'` (WHOOP connected), rendered output is byte-for-byte identical to today — this is the one behavior-preservation guarantee to verify per task.
- One commit per task, direct to `main` (this repo's established convention — no feature branch, no PR, matching every prior phase).

---

### Task 1: Web Logger — confidence-aware weight note

**Files:**
- Modify: `apps/web/src/screens/Logger.tsx:3-30` (import block), `:111-114` (earned memo), `:339-347` (StepperField note prop)
- Test: `checks/react-smoke.mjs` (new scenario, inserted before the existing `'a weight of 1e309 cannot poison the record'` test)

**Interfaces:**
- Consumes: `explainWorkingWeight(w: WorkingWeight | null, rec?: number | null): TrainingDecisionExplanation` and `todayRecovery(whoop?: WhoopSample | null): number | null` — both already exported from `@hybrid/engine` (Phase 0). `TrainingDecisionExplanation.confidence: 'low' | 'medium' | 'high'`.
- Produces: nothing new for later tasks — this task and Task 2 are independent, parallel changes to two separate apps.

- [ ] **Step 1: Add the new imports**

In `apps/web/src/screens/Logger.tsx`, add `explainWorkingWeight` and `todayRecovery` to the existing `@hybrid/engine` import block (the named-import list starting at line 3):

```typescript
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  explainWorkingWeight,
  fmtRest,
  fmtRpe,
  isCond,
  isText,
  isLiftMode,
  isWarmup,
  MAX_KG,
  nextLoggerLocation,
  nextWorkingWeight,
  plateBreakdown,
  prefillPrimary,
  prefillSecondary,
  repFloorOf,
  rpeCenterOf,
  sanNumStr,
  saneKg,
  sessionLetters,
  sessionProgress,
  targetLine,
  todayRecovery,
  type Exercise,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
```

- [ ] **Step 2: Compute the explanation alongside `earned`**

Immediately after the existing `earned` memo (around line 111-114), add:

```typescript
  const rec = todayRecovery(whoop);
  const earnedExplained = useMemo(
    () => (earned ? explainWorkingWeight(earned, rec) : null),
    [earned, rec],
  );
```

- [ ] **Step 3: Append the estimate suffix to the note string**

In the `StepperField` JSX (around line 339-347), change the `note` prop from:

```tsx
                      note={
                        earned && !isWarmup(st)
                          ? earned.dailyAdj < 0
                            ? `earned ${earned.earned}kg · ${earned.note}`
                            : `earned ${earned.earned}kg last time`
                          : ''
                      }
```

to:

```tsx
                      note={
                        earned && !isWarmup(st)
                          ? (earned.dailyAdj < 0
                              ? `earned ${earned.earned}kg · ${earned.note}`
                              : `earned ${earned.earned}kg last time`) +
                            (earnedExplained?.confidence === 'low' ? ' · estimate' : '')
                          : ''
                      }
```

- [ ] **Step 4: Run typecheck to confirm no compile errors**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: exit 0.

- [ ] **Step 5: Add the react-smoke scenario**

In `checks/react-smoke.mjs`, insert a new `await t(...)` block immediately before the existing `await t('a weight of 1e309 cannot poison the record', ...)` block (search for that exact string to find the insertion point):

```javascript
await t('a working weight shown with no WHOOP data connected is marked as an estimate', async () => {
  // No WHOOP sample exists anywhere in this file's seed data, so confidence
  // is always 'low' here — this is the default state for any athlete
  // without a connected strap, not a special-cased fixture.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.settings.liftProgress = Object.assign({}, db.settings.liftProgress, {
      'back squat': { kg: 105, at: Date.now() - 1000 },
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip rest")');
  if (skip) await skip.click();
  await page.waitForSelector('input[aria-label="Weight"]');
  const txt = await page.textContent('body');
  assert(/earned 105kg last time/.test(txt), 'expected the earned-weight note, got: ' + txt.slice(0, 400));
  assert(/estimate/.test(txt), 'expected an estimate tag with no WHOOP data connected, got: ' + txt.slice(0, 400));
});
```

This reuses the same mid-script seed-then-`page.goto` pattern already established by the file's own `'a reported pain stop holds the setup screen until acknowledged'` and `'a completed conditioning block stays clickable'` scenarios — it only adds `settings.liftProgress`, never touches `sessions`/`blocks`, so it cannot perturb any other scenario's state or the arithmetic the very next (`1e309`) test depends on.

- [ ] **Step 6: Run the smoke suite to verify it passes**

Run: `pnpm run smoke`
Expected: exit 0, including the new scenario.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/screens/Logger.tsx checks/react-smoke.mjs
git commit -m "web: mark the logged working weight as an estimate with no recovery data (Phase 1)"
```

---

### Task 2: Mobile Logger — confidence-aware weight note

**Files:**
- Modify: `apps/mobile/src/screens/Logger.tsx:5-33` (import block), `:128-131` (earned memo), `:357-366` (weight note JSX)
- Test: `apps/mobile/test/logger.test.tsx` (new test)

**Interfaces:**
- Consumes: same as Task 1 — `explainWorkingWeight`, `todayRecovery` from `@hybrid/engine`.
- Produces: nothing new — independent of Task 1.

- [ ] **Step 1: Add the new imports**

In `apps/mobile/src/screens/Logger.tsx`, add `explainWorkingWeight` and `todayRecovery` to the existing `@hybrid/engine` import block:

```typescript
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  explainWorkingWeight,
  fmtRest,
  fmtRpe,
  isCond,
  isText,
  isLiftMode,
  isWarmup,
  MAX_KG,
  nextLoggerLocation,
  nextWorkingWeight,
  plateBreakdown,
  prefillPrimary,
  prefillSecondary,
  repFloorOf,
  rpeCenterOf,
  sanNumStr,
  saneKg,
  sessionLetters,
  sessionProgress,
  targetLine,
  todayRecovery,
  type Exercise,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
```

- [ ] **Step 2: Compute the explanation alongside `earned`**

Immediately after the existing `earned` memo (around line 128-131), add:

```typescript
  const rec = todayRecovery(whoop);
  const earnedExplained = useMemo(
    () => (earned ? explainWorkingWeight(earned, rec) : null),
    [earned, rec],
  );
```

(Note: mobile's `whoop` comes from `useDb()` at the top of the component, same as web — confirm it's already in scope before this step; it is, per the existing `earned` memo's own dependency array.)

- [ ] **Step 3: Append the estimate suffix to the weight note**

In the weight-note JSX (around line 357-366), change:

```tsx
                      {earned && !isWarmup(st) ? (
                        <T num className="text-2 text-muted">
                          {earned.dailyAdj < 0
                            ? `earned ${earned.earned}kg · ${earned.note}`
                            : `earned ${earned.earned}kg last time`}
                        </T>
                      ) : null}
```

to:

```tsx
                      {earned && !isWarmup(st) ? (
                        <T num className="text-2 text-muted">
                          {(earned.dailyAdj < 0
                            ? `earned ${earned.earned}kg · ${earned.note}`
                            : `earned ${earned.earned}kg last time`) +
                            (earnedExplained?.confidence === 'low' ? ' · estimate' : '')}
                        </T>
                      ) : null}
```

- [ ] **Step 4: Write the new test**

In `apps/mobile/test/logger.test.tsx`, add a new `it()` inside the existing `describe('Logger', ...)` block, near the existing `'prefills the weight from what the last session EARNED'` test:

```typescript
  it('marks the earned weight as an estimate when no WHOOP recovery data is available', () => {
    // No live WHOOP connection exists in this test harness (network
    // required), so this is the default state for any athlete without a
    // connected strap — not a special-cased fixture. See the existing
    // 'eases the prefill on a red recovery morning' test above for the
    // same reasoning.
    liveSession({ settings: { liftProgress: { 'back squat': { kg: 105, at: 1000 } } } });
    mount();
    expect(screen.getByText('earned 105kg last time · estimate')).toBeTruthy();
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @hybrid/mobile test -- logger.test.tsx`
Expected: PASS, including the new test.

- [ ] **Step 6: Run the full mobile suite to confirm nothing else broke**

Run: `pnpm --filter @hybrid/mobile test`
Expected: all tests pass (existing count + 1).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/Logger.tsx apps/mobile/test/logger.test.tsx
git commit -m "mobile: mark the logged working weight as an estimate with no recovery data (Phase 1)"
```

---

### Task 3: Full verification and push

**Files:** none (verification only)

**Interfaces:**
- Consumes: Tasks 1 and 2's changes together.
- Produces: nothing — final gate for this plan.

- [ ] **Step 1: Run the full repo verification**

Run: `pnpm run verify` (from the repo root)
Expected: exit 0 — typecheck clean (both apps), all unit tests green (engine unchanged, mobile +1, web unchanged in count but exercising the new scenario via smoke), build clean, CSP check clean, react-smoke green (including the new scenario), deploy-smoke green.

- [ ] **Step 2: Manually confirm the "no new UI when confidence is high" guarantee**

This can't be asserted by the existing test harnesses (neither can simulate a connected WHOOP without deeper provider mocking — see the design doc's `docs/superpowers/specs/2026-08-01-adaptive-phase1-confidence-ui-design.md` for why). Read the diff for both `Logger.tsx` files one more time and confirm by inspection: the `earnedExplained?.confidence === 'low' ? ' · estimate' : ''` expression is `''` (a no-op string concatenation) for every value other than `'low'` — `'medium'`, `'high'`, and `null` (when `earnedExplained` itself is null) all fall through to the empty-string branch, so the rendered text for a WHOOP-connected athlete is provably identical to before this plan, by the expression's own structure rather than by a runnable test.

- [ ] **Step 3: Push**

```bash
git push -u origin main
```

- [ ] **Step 4: Update handoff.md**

Add a dated note to `handoff.md`'s "Current State" section: Phase 1's UI slice shipped (working-weight confidence indicator, both apps), real commit SHAs, real test counts from Step 1's output, and that the remaining Phase 1 roadmap item (the other three explainers — `explainSetAdjustment`, `explainConPrescription`, `explainConAdapt` — still have no UI consumer, deliberately out of scope per the design doc) is available for a future slice whenever wanted, alongside Phase 2 (adaptive strength progression) as the next roadmap phase.

```bash
git add handoff.md
git commit -m "docs: handoff — Phase 1 working-weight confidence indicator shipped"
git push -u origin main
```

---

## Self-Review Notes

**Spec coverage:** The design doc's two changed files (`Logger.tsx` both apps), one new engine-consuming computation (`explainWorkingWeight(earned, rec)`), one UI change (append `' · estimate'` on low confidence, no other visual change), and the "no new UI when confidence is high" guarantee are all covered — Task 1 (web), Task 2 (mobile), Task 3 (verify + the high-confidence guarantee, documented since it isn't independently testable in this harness).

**Placeholder scan:** No TBD/TODO. Every step has complete, real code, verified against the actual current file contents (line numbers and surrounding code read directly from the repository, not guessed) and against real existing test patterns (`checks/react-smoke.mjs`'s pain-stop/conditioning-block scenarios for the seed-then-navigate pattern; `apps/mobile/test/logger.test.tsx`'s own existing `liveSession`/`mount` helpers and its own prior no-WHOOP-data test for the confidence-is-always-low-in-this-harness reasoning).

**Type consistency:** `explainWorkingWeight(w, rec)` and its `confidence` field are used identically in both Task 1 and Task 2 — same signature, same optional-chaining guard (`earnedExplained?.confidence === 'low'`), same fallback to `''` for every other case. No task invents a new type or field.
