# Conditioning Evidence-Based Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the conditioning-science research (docs/research/2026-07-30-conditioning-progression-science.md, docs/research/2026-07-31-conditioning-evidence-cross-reference.md) and the Echo Bike V3 FTMS connectivity research (docs/research/echo-v3-connectivity-bundle/) into the app: capture felt RPE (a real pre-existing gap), reweight the conditioning progression algorithm so short-interval formats use RPE/completed-work rather than HR-zone-time alone, add a modality tag (row/run/ski/bike/air_bike), add a cardio-vs-mechanical completion split, and connect to a Rogue Echo Bike V3 over BLE/FTMS for live telemetry.

**Architecture:** Engine-first (packages/engine): new optional fields on `CondBlock`/`CondResult`, a per-format-per-modality progression key, and a reweighted `conAdapt()` — all additive and backward-compatible with existing stored data (no field is required, absent modality means "general conditioning," exactly as today). Then UI work on both apps' `Conditioning.tsx`, reusing existing chip/RPE patterns. Then the Echo V3 FTMS adapter, ported from the already-verified starter code in `docs/research/echo-v3-connectivity-bundle/code/starter/typescript/echo-v3-ftms.ts` into `apps/web`, with a native-BLE equivalent for mobile.

**Tech Stack:** TypeScript, Vitest (engine), React/Vite (web), Expo/React Native (mobile), Web Bluetooth (web BLE), a native BLE module (mobile BLE).

## Global Constraints

- `packages/engine/test/golden.test.ts` (33 tests) must stay green with ZERO fixtures edited throughout every task.
- Every new field on `CondBlock`/`CondResult` is optional. Absent modality/device/completion data must behave exactly as it does today — this is additive, not a migration.
- `conAdapt()`'s existing behavior for `steady` (HR-zone-time gated) does not change. Only `intervals`/`tempo` (the short-interval formats) get the RPE-aware reweighting, per the explicit design decision: short work uses RPE, duration work uses HR.
- Do not implement FTMS Control Point writes (target power/cadence/HR, start/stop-via-BLE). Read-only telemetry only, per the connectivity research's own recommendation — Echo-specific acceptance of control procedures is unverified.
- Concept2 Logbook API integration (Phase 6) is explicitly NOT implemented against a guessed API shape. Its one task is a research gate: get the real, verified API contract before writing any OAuth/sync code. Do not invent endpoint paths or field names.
- Do not touch `apps/*/src/screens/Planner.tsx`, `screens/planner/*`, or the guided builder (`screens/guided/*`) — this plan is scoped to the live Conditioning screens and the engine.
- Every new UI step must meet this app's existing touch-target rules: web 44×44px minimum, mobile 48×48dp minimum (via `Tap`'s `box` prop, matching established patterns — see `apps/mobile/src/ui.tsx`'s `Tap` component).

---

## Phase 1: Engine data model foundations

### Task 1: Add modality, device metadata, and completion fields

**Files:**
- Modify: `packages/engine/src/types.ts`
- Modify: `packages/engine/src/conditioning.ts`
- Test: `packages/engine/test/conditioning.test.ts`

**Interfaces:**
- Produces: `Modality` type, extended `CondBlock`/`CondResult`, `progressionKey(fmtKey, modality)` helper.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/engine/test/conditioning.test.ts (append)
import { progressionKey } from '../src/conditioning';

test('progressionKey is just the format when modality is absent', () => {
  expect(progressionKey('intervals', undefined)).toBe('intervals');
});

test('progressionKey composes format and modality when both are present', () => {
  expect(progressionKey('intervals', 'row')).toBe('intervals:row');
});
```

Run: `pnpm --filter @hybrid/engine test conditioning` — expect FAIL, `progressionKey` not exported.

- [ ] **Step 2: Add the types**

In `packages/engine/src/types.ts`, add near `CondFmtKey`:

```ts
export type Modality = 'row' | 'run' | 'ski' | 'bike' | 'air_bike';
```

Extend `CondBlock` (types.ts:105-119) with:

```ts
  /** Orthogonal to condFmt — row/run/ski/bike/air_bike. Absent means unlabeled/general conditioning. */
  modality?: Modality;
  /** Only ever set alongside modality: 'air_bike' — raw output units are not
   *  portable across air-bike brands/generations, so a same-device baseline
   *  needs this stored with every result (see docs/research/echo-v3-connectivity-bundle). */
  device?: { manufacturer?: string; model?: string; generation?: string; consoleMetric?: string };
```

Extend `CondResult` (types.ts:180-200) with:

```ts
  modality?: Modality;
  device?: { manufacturer?: string; model?: string; generation?: string; consoleMetric?: string };
  /** Did the cardiovascular signal (HR zone time) reach its target this session? */
  cardioCompletion?: 'met' | 'borderline' | 'not_met';
  /** Self-reported: did the prescribed mechanical work actually get completed? */
  mechanicalCompletion?: 'met' | 'borderline' | 'local_fatigue' | 'technique_fail' | 'pain_stop';
  /** Live FTMS telemetry, when the session came from a connected device. */
  avgPowerW?: number;
  avgCadenceRpm?: number;
```

- [ ] **Step 3: Add `progressionKey` to `conditioning.ts`**

```ts
export function progressionKey(fmtKey: CondFmtKey, modality?: Modality): string {
  return modality ? fmtKey + ':' + modality : fmtKey;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @hybrid/engine test conditioning` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/conditioning.ts packages/engine/test/conditioning.test.ts
git commit -m "engine: add modality, device metadata, and completion fields to CondBlock/CondResult"
```

---

### Task 2: Thread `progressionKey` through `conProgLevel` and `conAdapt`

**Files:**
- Modify: `packages/engine/src/conditioning.ts`
- Test: `packages/engine/test/conditioning.test.ts`

**Interfaces:**
- Consumes: `progressionKey` from Task 1.
- Produces: `conProgLevel(fmtKey, settings, modality?)`, `conAdapt(rec, settings)` (unchanged signature — reads `rec.modality` internally).

- [ ] **Step 1: Write the failing test**

```ts
test('conAdapt keys progress by format+modality, not format alone', () => {
  const settings = {};
  const rowResult = { fmt: 'intervals', modality: 'row', zsec: { low: 0, mod: 10, high: 0 }, dur: 20, felt: '5' } as CondResult;
  const { conProgress } = conAdapt(rowResult, settings);
  expect(conProgress['intervals:row']).toBeDefined();
  expect(conProgress['intervals']).toBeUndefined();
});
```

Run: `pnpm --filter @hybrid/engine test conditioning` — expect FAIL (still keyed by bare `fmtKey`).

- [ ] **Step 2: Update `conProgLevel`**

```ts
export function conProgLevel(fmtKey: string, settings?: Settings, modality?: Modality): number {
  const cp = (settings && settings.conProgress) || {};
  const f = cp[progressionKey(fmtKey as CondFmtKey, modality)];
  return f && Number.isFinite(f.level) ? Math.max(0, f.level | 0) : 0;
}
```

Update `conPrescription`'s one call site (`conditioning.ts:190`) to pass `ctx.modality` through — add `modality?: Modality` to `PrescriptionCtx`.

- [ ] **Step 3: Update `conAdapt`'s progress-map key**

In `conAdapt` (`conditioning.ts:273-318`), change `const cur: ProgressState = cp[fmtKey] || ...` and the final `cp[fmtKey] = ...` to both use `progressionKey(fmtKey, rec.modality)` instead of bare `fmtKey`.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @hybrid/engine test conditioning` — expect PASS, plus re-run the full engine suite (`pnpm --filter @hybrid/engine test`) to confirm nothing else broke — golden 33/33 included.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/conditioning.ts packages/engine/test/conditioning.test.ts
git commit -m "engine: key conditioning progression by format+modality, not format alone"
```

---

## Phase 2: Felt-RPE capture (the pre-existing gap)

### Task 3: Web — capture felt RPE at the end of a conditioning run

**Files:**
- Modify: `apps/web/src/screens/Conditioning.tsx`

**Interfaces:**
- Consumes: `Chip` from `../ui` (existing component, same one `RepsStep`/`CondDetailStep` use).
- Produces: a `'rating'` sub-state between `finish()` and the existing `result` display.

- [ ] **Step 1: Add a rating phase to the screen's state machine**

Add `const [rating, setRating] = useState(false);` alongside the existing `result` state. In `finish()`, after the existing `MIN_LOGGABLE_SEC` discard check and after building `rec` (but before calling `update()`), instead of immediately calling `update()` and `setResult(rec)`, stash the built `rec` in a ref (`const pendingRec = useRef<CondResult | null>(null); pendingRec.current = rec;`) and `setRating(true)` — defer the actual `update()`/`setResult()` call to a new `submitFelt(felt: string)` function:

```tsx
function submitFelt(felt: string) {
  const rec = pendingRec.current;
  if (!rec) return;
  rec.felt = felt;
  setResult(rec);
  setRating(false);
  update((draft) => {
    // identical body to the existing update() call in finish(), unchanged —
    // just moved here so it runs once felt is known.
  });
}
```

- [ ] **Step 2: Render the rating chips when `rating` is true**

Insert before the existing `{result ? (...) : null}` block:

```tsx
{rating ? (
  <>
    <SectionHead title="How did that feel?" />
    <div className="flex flex-wrap justify-center gap-1">
      {['3', '4', '5', '6', '7', '8', '9', '10'].map((r) => (
        <Chip key={r} on={false} onClick={() => submitFelt(r)}>
          RPE {r}
        </Chip>
      ))}
    </div>
  </>
) : null}
```

(Eight chips, RPE 3-10 — the app's existing strength-logging RPE range per `Logger.tsx`'s `fmtRpe` convention; reuse that range rather than inventing a new one.)

- [ ] **Step 3: Typecheck and build**

Run: `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/web build`

- [ ] **Step 4: Extend `react-smoke.mjs`'s conditioning coverage**

Add a step to whichever existing scenario runs a conditioning block through to completion: after clicking "Finish", assert `text=How did that feel?` appears, click an RPE chip, and assert the result screen's `felt RPE` line (already rendered by `Recap.tsx`/`History.tsx`) shows the chosen value.

- [ ] **Step 5: Run the full web smoke suite**

Run: `node checks/react-smoke.mjs` — expect all PASS including the new assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/Conditioning.tsx checks/react-smoke.mjs
git commit -m "web: capture felt RPE after a conditioning run"
```

---

### Task 4: Mobile — same felt-RPE capture

**Files:**
- Modify: `apps/mobile/src/screens/Conditioning.tsx`
- Test: add a scenario to whatever test file covers `ConditioningScreen` (create `apps/mobile/test/conditioning.test.tsx` if none exists, following `apps/mobile/test/training.test.tsx`'s harness pattern).

**Interfaces:** same shape as Task 3, using `Chip`/`SectionHead` from `../ui`.

- [ ] **Step 1: Add the same rating phase** to `ConditioningScreen`'s `finish()`, mirroring Task 3 Step 1 exactly (state, ref, deferred `submitFelt`).

- [ ] **Step 2: Render the same RPE chip row** when `rating` is true, using mobile's `Chip`/`View`/`SectionHead`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`

- [ ] **Step 4: Write/extend a real test** that seeds a store, drives a conditioning run to `finish()`, presses an RPE chip, and asserts (via `storage.getItem(LS_KEY)` read-back, matching `guidedBuilder.test.tsx`'s `persisted()`/`flushSave()` pattern) that the stored `CondResult.felt` matches what was pressed.

- [ ] **Step 5: Run the full mobile suite**

Run: `pnpm --filter @hybrid/mobile test`

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/Conditioning.tsx apps/mobile/test/conditioning.test.tsx
git commit -m "mobile: capture felt RPE after a conditioning run"
```

---

## Phase 3: Reweight `conAdapt` for short-interval formats

### Task 5: Use RPE for intervals/tempo completion, keep HR for steady

**Files:**
- Modify: `packages/engine/src/conditioning.ts`
- Test: `packages/engine/test/conditioning.test.ts`

**Interfaces:**
- Consumes: `condEffort`, `condEffortGap` (existing, already written and previously unused for this purpose).

- [ ] **Step 1: Write the failing tests**

```ts
test('intervals: felt RPE within the effort band counts as on-target even with weak zone time', () => {
  const settings = {};
  // effort 'hard' → RPE band per CON_EFFORTS; zone time deliberately below the
  // old 0.45 threshold to prove RPE, not zone time, is now driving this.
  const rec = { fmt: 'intervals', effort: 'hard', felt: '8', zsec: { low: 10, mod: 5, high: 0 }, dur: 20 } as CondResult;
  const { delta } = conAdapt(rec, settings);
  expect(delta).toBe(1);
});

test('intervals: no felt RPE falls back to the existing zone-time heuristic', () => {
  const settings = {};
  const rec = { fmt: 'intervals', effort: 'hard', zsec: { low: 0, mod: 10, high: 0 }, dur: 20 } as CondResult; // 50% >= 0.45
  const { delta } = conAdapt(rec, settings);
  expect(delta).toBe(1);
});

test('steady: still gated on zone time regardless of felt RPE', () => {
  const settings = {};
  const rec = { fmt: 'steady', effort: 'easy', felt: '9', zsec: { low: 1, mod: 0, high: 0 }, dur: 20 } as CondResult; // well under 0.6
  const { delta } = conAdapt(rec, settings);
  expect(delta).toBe(0); // a miss, not an earn — high RPE does not override steady's HR gate
});
```

Run: `pnpm --filter @hybrid/engine test conditioning` — expect the first test to FAIL against current code.

- [ ] **Step 2: Implement the reweighting in `conAdapt`**

Replace the single `onTarget` line (`conditioning.ts:299`) with a branch that only applies to non-`steady` formats:

```ts
const zoneOnTarget = workSec / total >= frac;
let onTarget = zoneOnTarget;
if (fmtKey !== 'steady' && rec.felt != null) {
  const eff = condEffort(rec);
  const gap = condEffortGap(eff, rec.felt);
  // Within the asked-for band (gap === 0) or harder than asked (gap > 0, still
  // real work done) counts as on-target; well under the target effort does not,
  // regardless of how much zone time was banked — this is the "RPE primary,
  // HR secondary/diagnostic" rule from the conditioning evidence review, applied
  // only to short-interval formats. Steady keeps the original zone-time gate.
  onTarget = gap != null ? gap >= 0 : zoneOnTarget;
}
```

(`frac`/`workSec`/`total` are already computed above this line — no other change needed. `zoneOnTarget` stays available for logging/diagnostics if a later task wants to record it, but only `onTarget` feeds the `if (onTarget && hrrOk && !overcooked && notRed)` decision below, unchanged.)

- [ ] **Step 3: Run tests, verify pass**

Run: `pnpm --filter @hybrid/engine test conditioning` then the full suite `pnpm --filter @hybrid/engine test` — golden 33/33 must stay green (this function isn't golden-covered, but confirm no cross-file breakage).

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/conditioning.ts packages/engine/test/conditioning.test.ts
git commit -m "engine: intervals/tempo progression uses felt RPE when available, steady stays HR-gated"
```

---

## Phase 4: Cardio vs. mechanical completion

### Task 6: Capture mechanical completion (technique/fatigue/pain) alongside the RPE rating

**Files:**
- Modify: `apps/web/src/screens/Conditioning.tsx`
- Modify: `apps/mobile/src/screens/Conditioning.tsx`
- Modify: `packages/engine/src/conditioning.ts` (compute `cardioCompletion` automatically)

**Interfaces:**
- Produces: `cardioCompletion` computed from existing zone-time data (no new input needed); `mechanicalCompletion` from a new one-question self-report.

- [ ] **Step 1: Add a pure helper to compute `cardioCompletion`**

```ts
// packages/engine/src/conditioning.ts
export function cardioCompletionFor(fmtKey: CondFmtKey, zsec: CondResult['zsec'], dur: number): 'met' | 'borderline' | 'not_met' {
  const z = zsec || { low: 0, mod: 0, high: 0 };
  const total = Math.max(1, (z.low||0)+(z.mod||0)+(z.high||0) || dur || 0);
  const workSec = fmtKey === 'steady' ? (z.low||0)+(z.mod||0) : (z.mod||0)+(z.high||0);
  const frac = workSec / total;
  const target = fmtKey === 'steady' ? 0.6 : 0.45;
  if (frac >= target) return 'met';
  if (frac >= target * 0.7) return 'borderline';
  return 'not_met';
}
```

Add a unit test in `conditioning.test.ts` covering all three bands.

- [ ] **Step 2: Web — ask the mechanical-completion question after the RPE chips**

Extend the Task 3 rating phase: after `submitFelt`, before calling `update()`, add one more chip row:

```tsx
{['met', 'local_fatigue', 'technique_fail', 'pain_stop'].map((m) => (
  <Chip key={m} on={false} onClick={() => submitMechanical(m)}>
    {m === 'met' ? 'Completed it' : m === 'local_fatigue' ? 'Muscles gave out' : m === 'technique_fail' ? 'Form broke down' : 'Stopped — pain'}
  </Chip>
))}
```

`submitMechanical` sets `rec.mechanicalCompletion`, computes `rec.cardioCompletion = cardioCompletionFor(...)`, then proceeds with the existing `update()`/`setResult()` call.

- [ ] **Step 3: Mobile — same second question**, mirrored.

- [ ] **Step 4: Typecheck + build both platforms**

Run: `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/web build && pnpm --filter @hybrid/mobile typecheck`

- [ ] **Step 5: Extend both platforms' conditioning tests** to cover the new question and assert the stored `mechanicalCompletion`/`cardioCompletion` values.

- [ ] **Step 6: Full verify**

Run: `pnpm run verify`

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/conditioning.ts packages/engine/test/conditioning.test.ts apps/web/src/screens/Conditioning.tsx apps/mobile/src/screens/Conditioning.tsx
git commit -m "conditioning: capture mechanical completion (technique/fatigue/pain), compute cardio completion automatically"
```

---

## Phase 5: Rogue Echo Bike V3 — FTMS live telemetry (web)

### Task 7: Port the verified FTMS parser into the web app

**Files:**
- Create: `apps/web/src/native/echoV3.ts` (adapted from `docs/research/echo-v3-connectivity-bundle/code/starter/typescript/echo-v3-ftms.ts` — already MIT-clean, written for this handoff, verified independently by hand-decoding its test payload)
- Test: `apps/web/test/echoV3.test.ts` (port the starter's own test, `docs/research/echo-v3-connectivity-bundle/code/starter/typescript/echo-v3-ftms.test.ts`)

**Interfaces:**
- Produces: `parseIndoorBikeData`, `connectEchoV3(onEvent, onDisconnected)` — same shape as the starter code.

- [ ] **Step 1: Copy the starter parser and its test in verbatim**, adjusting only the import path, into `apps/web/src/native/echoV3.ts` and `apps/web/test/echoV3.test.ts`.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @hybrid/web test echoV3` — expect PASS (this is porting already-passing, already-verified code, not new logic).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/native/echoV3.ts apps/web/test/echoV3.test.ts
git commit -m "web: port the verified Echo Bike V3 FTMS parser"
```

---

### Task 8: Wire Echo V3 connection into the live Conditioning screen

**Files:**
- Modify: `apps/web/src/screens/Conditioning.tsx`

**Interfaces:**
- Consumes: `connectEchoV3` from Task 7.

- [ ] **Step 1: Add an "Connect Echo Bike" control**, shown only when `sinkBlock?.modality === 'air_bike'` (or a manual toggle for a standalone run), alongside the existing strap-connect flow. On press, call `connectEchoV3(onFtmsEvent, onFtmsDisconnected)` instead of (or alongside) `connectStrap`.

- [ ] **Step 2: `onFtmsEvent` updates live state** — add `power_w`/`cadence_rpm`/`distance_m` to the `RUN` module object (same pattern as `RUN.bpm`), displayed on the live-run card alongside the existing HR ring (e.g. a small stats row: "287W · 78rpm · 1.2km").

- [ ] **Step 3: On `finish()`, average the banked power/cadence samples** into `rec.avgPowerW`/`rec.avgCadenceRpm`, and set `rec.device = { manufacturer: 'Rogue', model: 'Echo Bike', generation: 'V3.0' }` when the session came from an Echo V3 connection — per the connectivity research's explicit requirement to store device metadata since air-bike output isn't portable across devices.

- [ ] **Step 4: Typecheck, build, run the full web smoke suite.**

Run: `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/web build && node checks/react-smoke.mjs`

(No new automated FTMS-hardware test is possible without a physical bike — this step is manual-verification-required per `docs/research/echo-v3-connectivity-bundle/evidence/known_gaps.md`'s physical test plan. Note this explicitly in the task report.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/Conditioning.tsx
git commit -m "web: connect to a Rogue Echo Bike V3 over FTMS for live telemetry"
```

---

### Task 9: Mobile — native BLE FTMS reader

**Files:**
- Modify: `apps/mobile/src/native/capabilities.ts` (or wherever `createHeartRateMonitor` lives — follow that exact file's pattern)
- Modify: `apps/mobile/src/screens/Conditioning.tsx`

**Interfaces:**
- Produces: `createFtmsMonitor()`, matching `createHeartRateMonitor()`'s shape (`.start(onEvent, onStateChange)` / `.stop()`).

- [ ] **Step 1: Read the existing `createHeartRateMonitor` implementation** in full before writing anything — this task must match its BLE library, permission-request flow, and error/state-callback conventions exactly, not introduce a second BLE pattern.

- [ ] **Step 2: Implement `createFtmsMonitor()`**, subscribing to the same UUIDs as the web adapter (`0x1826` service, `0x2AD2` characteristic — from `echo_v3_capability_registry.json`), parsing with the identical flag/field logic as Task 7's `parseIndoorBikeData` (port it, or share it via a small local copy — there is no shared native/web code layer in this repo, so duplication here matches how `connectStrap`/`createHeartRateMonitor` are already two separate implementations of the same HR-parsing idea).

- [ ] **Step 3: Wire it into `ConditioningScreen`**, mirroring Task 8's web wiring (live stats display, averaged power/cadence on finish, device metadata stamped onto `rec`).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`

- [ ] **Step 5: Unit-test the parser logic** (pure function, testable without real BLE) using the same sample payload from `docs/research/echo-v3-connectivity-bundle/code/starter/sample_payloads.json`.

- [ ] **Step 6: Run the full mobile suite, commit.**

```bash
git add apps/mobile/src/native/capabilities.ts apps/mobile/src/screens/Conditioning.tsx apps/mobile/test/
git commit -m "mobile: connect to a Rogue Echo Bike V3 over FTMS for live telemetry"
```

**Note for whoever executes this task:** this is the highest-risk task in the plan. Expo's BLE support for arbitrary GATT services (not just the built-in Heart Rate profile) may need a specific library (e.g. `react-native-ble-plx`) not currently a dependency — confirm what's already available in `apps/mobile/package.json` before assuming a library is present, and flag back if a new native dependency needs approval before adding it.

---

## Phase 6: Concept2 Logbook integration — research gate first

### Task 10: Verify the real Concept2 Logbook API contract before writing any integration code

**Files:** none (research only — no code in this task)

- [ ] **Step 1: Do not implement against a guessed API shape.** Neither this plan's author nor prior research in this project has independently verified Concept2's actual Logbook API endpoints, OAuth flow details, or split-data field names against live documentation — this environment's network access is blocked, so it hasn't been checked.

- [ ] **Step 2: Get the real contract.** Either dispatch a scoped deep-research prompt (same pattern as `docs/research/2026-07-30-conditioning-progression-science.md`'s and the Echo Bike prompt's handoffs) asking specifically for: the OAuth2 authorization/token endpoints, the results-list endpoint and its exact response shape (especially the per-split fields: time, distance, pace, stroke rate, heart rate), rate limits, and whether SkiErg results come through the same endpoint as rowing results — or have the user supply Concept2's developer documentation directly.

- [ ] **Step 3: Once verified, write a follow-up plan** (a new plan doc, not an amendment to this one — this plan's scope ends here) for the actual OAuth-connect/callback/sync serverless functions, mirroring the existing WHOOP integration's shape (`whoop-connect`/`whoop-callback`/`whoop-sync` — read those functions first) and the Settings UI toggle pattern already established for WHOOP.

- [ ] **Step 4: Report status.** This task's only deliverable is either a verified API contract handed off for a new plan, or an explicit "blocked, need the user to get this via ChatGPT deep research" status — not code.

---

## Final Task: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1:** Run `pnpm run verify` — typecheck, full test suite (engine incl. golden 33/33, zero fixtures touched), build, CSP, web smoke, deploy smoke all green.
- [ ] **Step 2:** Confirm `git diff --stat` against the base commit touches only the files listed across Tasks 1-9 (Task 10 makes no code changes).
- [ ] **Step 3:** Report back: what shipped, what's manual-verification-required (Echo V3 hardware test per `known_gaps.md`), and that Concept2 integration is deliberately deferred pending the Task 10 research gate.
