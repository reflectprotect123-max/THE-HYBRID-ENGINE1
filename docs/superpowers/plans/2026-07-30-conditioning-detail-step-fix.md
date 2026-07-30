# Conditioning Detail Step Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the guided builder's Conditioning detail step (`CondDetailStep`, both apps) so tapping a format actually shows something specific to it, and stop asking for a "Minutes" value that nothing downstream ever reads.

**Architecture:** Delete the dead `minutes` stepper and its plumbing (Draft field, `EMPTY_DRAFT` default, `commitBlock`'s write) from both platforms' guided builders. Replace the stepper in `CondDetailStep` with the selected format's own `desc` string, already defined in `packages/engine/src/conditioning.ts`'s `CON_FORMATS` and currently rendered nowhere in either app.

**Tech Stack:** React/Vite (web), Expo/React Native (mobile), `@hybrid/engine`, `@hybrid/guided-flow`. No engine changes.

## Root cause (why every format "just asks for time")

Read directly from source, not inferred:

- `CondDetailStep.tsx` (`apps/web/src/screens/guided/CondDetailStep.tsx:39-56`, `apps/mobile/src/screens/guided/CondDetailStep.tsx`) renders the identical "Minutes (optional)" +/− stepper under every one of the 5 formats (`steady`, `intervals`, `tempo`, `custom`, `free`). Nothing else in the step changes when a different format chip is tapped — no format-specific content is shown at all.
- That value is written onto the new block (`GuidedBuilder.tsx`: `block.minutes = draft.minutes || ''`) — and then **never read again by anything**, for any format, confirmed by grepping every reference to `.minutes` in the repo:
  - The live Conditioning "Set up" screen (`apps/web/src/screens/Conditioning.tsx`, `apps/mobile/src/screens/Conditioning.tsx`) computes its own numbers via `conPrescription(fmt, {settings, whoop})` — the athlete's earned progression level plus today's recovery gate — and never looks at `sinkBlock.minutes`. This is true even for `steady`, where you might expect it to matter: `conPrescription`'s steady branch derives `p.minutes` from the *format's hardcoded base* (`CON_FORMATS.steady.base.minutes = 20`) plus a progression bonus, not from the block.
  - The Planner's block card (`CondBlockCard.tsx`, both apps) never displays `minutes` at all.
  - `packages/engine/src/types.ts:114`'s `CondBlock.minutes` field has no doc comment (unlike its neighbor `targetDistanceM`, explicitly commented `/** coach-authored target, purely a display chip — no progression tie-in */`), but behaves identically in practice: authored, stored, and ignored.
  - The only other place `minutes` appears is `emit.ts:95` (`newBlock`'s `BlockOpts.minutes`, for `StrengthBlock`, a completely different code path — the legacy text-import/coach-authoring surface) and `emit.ts:108` (`newCondBlock`'s 4-arg signature, same import surface). Neither is touched by this plan.
- Meanwhile `CON_FORMATS[k].desc` (`packages/engine/src/conditioning.ts:48-98`) already holds exactly the differentiating text an athlete would expect to see per format — `"Zone 2 · 20 min"` (steady), `"8×30s / 90s"` (intervals), `"10×15s / 60s"` (tempo), `"your rounds"` (custom), `"just track HR"` (free) — and is rendered **nowhere** in either app (`grep -rn '\.desc\b'` across both apps: zero hits).
- `canAdvance('cond-detail', draft)` (`packages/guided-flow/src/flowSteps.ts:61`) only requires `condFmt` to be non-empty — `minutes` was never a gate, just a dead, confusing control sitting under every format.

**What this plan does NOT touch, and why:**

- `CondBlock.minutes` the *type field* stays — `emit.newCondBlock`'s coach-import path still writes it, unrelated to the guided builder.
- `effort` / `targetZone` are untouched — these already work: `effort` is documented in `types.ts:111` as the authored target and is genuinely consumed later, by `condEffort()`/`condEffortGap()` scoring how a felt RPE compares to the asked-for band.
- `settings.customFmt` (`packages/engine/src/types.ts:265`, the Custom format's own rounds/work/rest) has **no editing UI anywhere in either app** — grepped both apps for `customFmt`, zero hits outside the engine and the type. Custom silently always falls back to the hardcoded defaults in `customFmtBase()` (6 rounds × 40s work / 80s rest). This is a real, separate gap — surfacing a way to actually set it is a bigger feature (a new Settings control) and is explicitly out of scope for this plan.

## Global Constraints

- `packages/engine/test/golden.test.ts` (33 tests) must stay green with ZERO fixtures edited — this plan makes no engine changes, so this should be a non-issue, but every task still runs the full engine suite to confirm.
- No changes to `packages/engine/src/*`, `apps/*/src/screens/Planner.tsx`, `apps/*/src/screens/planner/*`, or `apps/*/src/screens/Conditioning.tsx` (the live-run screen) — this plan is scoped to the guided builder's authoring step only.
- Web keeps the existing 44×44px touch minimum; mobile keeps its 48×48dp minimum (unaffected here since this plan removes controls, it doesn't add any new tappable ones beyond the existing format/effort chips).
- Frequent commits, TDD for logic, one task = one reviewable unit of work.

---

### Task 1: Web — drop the minutes stepper, show the format's own description

**Files:**
- Modify: `apps/web/src/screens/guided/CondDetailStep.tsx`
- Modify: `apps/web/src/screens/guided/GuidedBuilder.tsx`
- Modify: `checks/react-smoke.mjs` (the existing guided-builder conditioning coverage, if any references the minutes control)

**Interfaces:**
- Consumes: `CON_FORMATS` from `@hybrid/engine` (already imported) — each format's `.desc` string.
- Produces: `CondDetailStep` no longer accepts a `minutes` prop or emits `{minutes}` patches; `GuidedBuilder`'s `Draft` interface drops `minutes`, `EMPTY_DRAFT` drops it, `commitBlock`'s `cond` branch no longer sets `block.minutes`.

- [ ] **Step 1: Update `CondDetailStep.tsx`** — remove the `minutes`/`onChange minutes` prop and the whole +/− stepper block (lines ~39-56 in the current file), replacing it with the selected format's description, shown only once a format is picked:

```tsx
import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { Button, Chip } from '../../ui';

export function CondDetailStep({
  condFmt,
  effort,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  condFmt: CondFmtKey | '';
  effort: EffortKey;
  onChange: (patch: { condFmt?: CondFmtKey; effort?: EffortKey }) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What kind of conditioning?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {CON_FORMAT_KEYS.map((k) => (
          <Chip key={k} on={condFmt === k} onClick={() => onChange({ condFmt: k })}>
            {condFmt === k ? '✓ ' : ''}{CON_FORMATS[k].name}
          </Chip>
        ))}
      </div>
      {condFmt ? <p className="text-3 text-dim">{CON_FORMATS[condFmt].desc}</p> : null}
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Effort</span>
      <div className="flex flex-wrap justify-center gap-1">
        {CON_EFFORT_KEYS.map((k) => (
          <Chip key={k} on={effort === k} onClick={() => onChange({ effort: k })}>
            {effort === k ? '✓ ' : ''}{CON_EFFORTS[k].name}
          </Chip>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `GuidedBuilder.tsx`** — remove `minutes: number;` from the `Draft` interface, remove `minutes: 0,` from `EMPTY_DRAFT`, remove the `minutes={draft.minutes}` and `onChange={(p) => patch(p)}`'s minutes half from the `CondDetailStep` render call (the `onChange` prop stays, just narrower), and in `commitBlock`'s `kind === 'cond'` branch delete the line `block.minutes = draft.minutes || '';` entirely — leave `block.minutes` unset (the type field is optional).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: no errors (confirms nothing else references `draft.minutes` or `CondDetailStep`'s old `minutes` prop).

- [ ] **Step 4: Update the existing react-smoke.mjs conditioning coverage, if it touches minutes**

Read `checks/react-smoke.mjs` for any step that fills or asserts a "minutes" control inside the guided builder's conditioning flow (search for `fewer minutes`, `more minutes`, or a `+build/` scenario that picks a conditioning block-type). If found, remove the fill/assert on that control. Add one assertion that the format's description text appears after picking a format, e.g.:

```js
await page.click('button:has-text("Intervals")');
await page.waitForSelector('text=8×30s / 90s');
```

- [ ] **Step 5: Build and run the full web smoke suite**

Run: `pnpm --filter @hybrid/web build && node checks/react-smoke.mjs`
Expected: all scenarios PASS, including the new/updated conditioning assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/guided/CondDetailStep.tsx apps/web/src/screens/guided/GuidedBuilder.tsx checks/react-smoke.mjs
git commit -m "web guided builder: drop the dead minutes stepper, show the format's own description"
```

---

### Task 2: Mobile — same fix, native side

**Files:**
- Modify: `apps/mobile/src/screens/guided/CondDetailStep.tsx`
- Modify: `apps/mobile/src/screens/guided/GuidedBuilder.tsx`
- Modify: `apps/mobile/test/guidedBuilder.test.tsx` (if it exercises the conditioning path and touches minutes)

**Interfaces:**
- Same shape as Task 1, mobile components (`View`/`Chip`/`Btn`/`T` from `../../ui` instead of web's `div`/`Chip`/`Button`).

- [ ] **Step 1: Update `CondDetailStep.tsx`** (mobile) — same change as Task 1 Step 1, translated to the mobile component set: drop the `minutes` prop and its `Tap`/stepper controls, render `CON_FORMATS[condFmt].desc` as a `<T>` once a format is picked.

- [ ] **Step 2: Update `GuidedBuilder.tsx`** (mobile) — same change as Task 1 Step 2: drop `minutes` from `Draft`/`EMPTY_DRAFT`, drop the `block.minutes = draft.minutes || '';` line from `commitBlock`'s `cond` branch, narrow the `CondDetailStep` render call.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: no errors.

- [ ] **Step 4: Update `guidedBuilder.test.tsx` if it covers the conditioning path**

Search the file for any conditioning-block scenario. If one fires a minutes stepper button (`fireEvent.press(screen.getByText('...'))` on a `+`/`−` control), remove it. Add an assertion the format description text renders, e.g. after pressing the "Intervals" chip:

```tsx
expect(screen.getByText('8×30s / 90s')).toBeTruthy();
```

- [ ] **Step 5: Run the full mobile test suite**

Run: `pnpm --filter @hybrid/mobile test`
Expected: all suites pass, including the new/updated assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/guided/CondDetailStep.tsx apps/mobile/src/screens/guided/GuidedBuilder.tsx apps/mobile/test/guidedBuilder.test.tsx
git commit -m "mobile guided builder: drop the dead minutes stepper, show the format's own description"
```

---

### Task 3: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full project verify**

Run: `pnpm run verify`
Expected: typecheck, full test suite (engine 250/250 incl. golden 33/33, zero fixtures touched), build, CSP check, web smoke, and deploy smoke all green.

- [ ] **Step 2: Confirm no unrelated diffs**

Run: `git diff --stat main` (or the appropriate base) and confirm only the files listed in Tasks 1-2 changed, plus this plan doc.

- [ ] **Step 3: Report back**

Summarize: what changed, verification results, and explicitly flag the `settings.customFmt` gap (Custom format has no way to actually customize its rounds/work/rest anywhere in the app) as a separate, un-actioned finding for a future pass.

---
