# Conditioning Evidence-Based Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the conditioning-science research (docs/research/2026-07-30-conditioning-progression-science.md, docs/research/2026-07-31-conditioning-evidence-cross-reference.md), the Echo Bike V3 FTMS connectivity research (docs/research/echo-v3-connectivity-bundle/), and the Concept2 Logbook API research (docs/research/concept2-logbook-bundle/) into the app: capture felt RPE (a real pre-existing gap), reweight the conditioning progression algorithm so short-interval formats use RPE/completed-work rather than HR-zone-time alone, add a modality tag (row/run/ski/bike/air_bike), add a cardio-vs-mechanical completion split, connect to a Rogue Echo Bike V3 over BLE/FTMS for live telemetry, and sync completed rowing/SkiErg results (with splits) from the Concept2 Logbook.

**Architecture:** Engine-first (packages/engine): new optional fields on `CondBlock`/`CondResult`, a per-format-per-modality progression key, and a reweighted `conAdapt()` — all additive and backward-compatible with existing stored data (no field is required, absent modality means "general conditioning," exactly as today). Then UI work on both apps' `Conditioning.tsx`, reusing existing chip/RPE patterns. Then the Echo V3 FTMS adapter, ported from the already-verified starter code in `docs/research/echo-v3-connectivity-bundle/code/starter/typescript/echo-v3-ftms.ts` into `apps/web`, with a native-BLE equivalent for mobile.

**Tech Stack:** TypeScript, Vitest (engine), React/Vite (web), Expo/React Native (mobile), Web Bluetooth (web BLE), a native BLE module (mobile BLE).

## Global Constraints

- `packages/engine/test/golden.test.ts` (33 tests) must stay green with ZERO fixtures edited throughout every task.
- Every new field on `CondBlock`/`CondResult` is optional. Absent modality/device/completion data must behave exactly as it does today — this is additive, not a migration.
- `conAdapt()`'s existing behavior for `steady` (HR-zone-time gated) does not change. Only `intervals`/`tempo` (the short-interval formats) get the RPE-aware reweighting, per the explicit design decision: short work uses RPE, duration work uses HR.
- Do not implement FTMS Control Point writes (target power/cadence/HR, start/stop-via-BLE). Read-only telemetry only, per the connectivity research's own recommendation — Echo-specific acceptance of control procedures is unverified.
- Concept2 Logbook integration (Phase 6) mirrors the existing WHOOP integration's architecture exactly — same generic `netlify/functions/_lib/oauth.mjs` (`loadToken`/`saveToken`/`syncRecord`/`newState`/`savePending`, already provider-keyed, not WHOOP-specific), same per-provider lib shape as `netlify/functions/_lib/whoop.mjs`, same three-function split (`*-connect.mjs`/`*-callback.mjs`/`*-sync.mjs`), same client-side Context/Provider shape as `apps/web/src/cloud/whoop.tsx`. Read those files before writing anything — this is an established, security-reviewed pattern (proper OAuth state, token refresh with rotation-safety, native-vs-browser dual path via Supabase identity, typed errors), not one to reinvent ad hoc. The API contract itself (endpoints, fields, scopes) is verified research, not a guess — see `docs/research/concept2-logbook-bundle/`.
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

**Important — this section was rewritten after Tasks 3 and 4 actually shipped (both went through a real fix round; read their reports before touching this file). The plan text below reflects their real shape, not a guess.** On both platforms, a finished run is held as a pending, not-yet-banked `CondResult` (web: `RUN.pending`, module scope; mobile: a `pending` ref, protected by an extended `beforeRemove` guard) until `submitFelt(felt)` sets `rec.felt` and immediately banks via the single write path (web: inline in `submitFelt`; mobile: a separate `bank(rec)` function `submitFelt` calls). This task adds a SECOND question after the first, so `submitFelt` can no longer be the thing that banks — banking has to move to whatever answers the LAST question. Getting this wrong reintroduces the exact bug Tasks 3/4 already found and fixed (a mid-rating navigate-away silently losing a finished run) at a new point in a now-two-step flow — the existing protections (RUN.pending / the extended beforeRemove guard) already cover "there's a pending record," but only if the pending record keeps existing across BOTH questions, not just the first.

- [ ] **Step 2: Web — restructure into a two-question flow, both covered by the existing `RUN.pending` protection.**

  - Change `submitFelt(felt)` to just set `RUN.pending!.felt = felt` and trigger a re-render (e.g. `setRating(true)` again, or a version bump — whatever makes React notice `RUN.pending` changed, since mutating module state directly doesn't trigger one on its own) — it must NOT bank anymore, and must NOT clear `RUN.pending`.
  - Add a new `submitMechanical(m: CondResult['mechanicalCompletion'])` that reads `RUN.pending`, sets `.mechanicalCompletion = m` and `.cardioCompletion = cardioCompletionFor(rec.fmt, rec.zsec, rec.dur)` (the Step 1 helper), clears `RUN.pending`, and does exactly what the OLD `submitFelt` used to do at the end (the `setResult`/`setRating(false)`/`update(...)` block) — this is now the single write path.
  - In the render, while `RUN.pending` is set: show the RPE chips when `RUN.pending.felt == null`; show the mechanical-completion chips (`['met', 'local_fatigue', 'technique_fail', 'pain_stop']`, labels as originally specified: "Completed it" / "Muscles gave out" / "Form broke down" / "Stopped — pain") once `RUN.pending.felt` is set but `.mechanicalCompletion` isn't.
  - This means a pending record can now be lost/interrupted at three points (before either question, between the two questions) instead of one — confirm `RUN.pending` genuinely survives all of them the same way Task 3's fix proved it survives navigation (module scope doesn't care which sub-question is showing).

- [ ] **Step 3: Mobile — the same restructuring**, mirrored onto `pending`/`submitFelt`/`bank`/the `beforeRemove` guard. The guard's "confirmed exit bank the pending record" behavior (added in Task 4's fix) must keep working no matter which of the two questions was showing when the athlete tried to leave — on a forced exit, bank with whatever was actually answered (`felt` if set, `mechanicalCompletion`/`cardioCompletion` left unset if the athlete never got that far) rather than assuming only `felt` can be missing.

- [ ] **Step 4: Typecheck + build both platforms**

Run: `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/web build && pnpm --filter @hybrid/mobile typecheck`

- [ ] **Step 5: Extend both platforms' conditioning tests** to cover the new question and assert the stored `mechanicalCompletion`/`cardioCompletion` values. Also extend (don't just re-verify) each platform's existing navigate-away-during-rating test from Tasks 3/4 to cover leaving BETWEEN the two questions (after answering RPE, before answering mechanical completion) — not just before the first one — since that's a new interruption point this task introduces.

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

- [ ] **Step 1: Add a "Connect Echo Bike" control**, alongside the existing strap-connect flow. Note: no task in this plan lets an athlete set `CondBlock.modality` ahead of time (there's no UI question for it), so do NOT gate this control on `sinkBlock?.modality === 'air_bike'` — that field is never populated before a session starts and the control would never show. Always offer it as a manual option next to the HR-strap connect button. On press, call `connectEchoV3(onFtmsEvent, onFtmsDisconnected)` instead of (or alongside) `connectStrap`.

- [ ] **Step 2: `onFtmsEvent` updates live state** — add `power_w`/`cadence_rpm`/`distance_m` to the `RUN` module object (same pattern as `RUN.bpm`), displayed on the live-run card alongside the existing HR ring (e.g. a small stats row: "287W · 78rpm · 1.2km").

- [ ] **Step 3: On `finish()`, average the banked power/cadence samples** into `rec.avgPowerW`/`rec.avgCadenceRpm`, and set `rec.device = { manufacturer: 'Rogue', model: 'Echo Bike', generation: 'V3.0' }` AND `rec.modality = 'air_bike'` when the session came from an Echo V3 connection — the modality tag is what makes Task 2's per-format-per-modality progression tracking (`progressionKey`) actually apply to air-bike sessions; without it every Echo Bike session would silently fall back to the bare-format (unlabeled) progress bucket, mixed in with plain/no-modality conditioning. Per the connectivity research's explicit requirement, store device metadata since air-bike output isn't portable across devices.

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

## Phase 6: Concept2 Logbook integration

The API contract is verified research, not a guess — real endpoints, real
documented response shapes, cross-checked against multiple independent
working clients (`pyconcept2`, `concept2-mcp-server`, live integration
reports from Intervals.icu and Browser Erg Analyzer). See
`docs/research/concept2-logbook-bundle/RESEARCH_REPORT.md` for the full
source-backed answer and `KNOWN_GAPS.md` for what still needs a real-account
test. The bundle's own starter code (`code/src/concept2-api.mjs`,
`code/src/sync.mjs`, `code/src/serverless-shape.mjs`) was independently
verified in this session: its 6 contract tests were run and passed, and its
three-function shape (`startConcept2OAuth`/`handleConcept2Callback`/
`syncConcept2Account`) already maps directly onto this app's existing
provider-agnostic OAuth plumbing.

### Task 10: `_lib/concept2.mjs` — the provider module, mirroring `_lib/whoop.mjs`

**Files:**
- Create: `netlify/functions/_lib/concept2.mjs`
- Test: `netlify/functions/_lib/concept2.test.mjs` (check whether WHOOP's lib has a sibling test file with this naming; if the repo tests Netlify functions differently, follow whatever pattern already covers `_lib/whoop.mjs` instead of introducing a new one)

**Interfaces:**
- Consumes: `_lib/config.mjs`'s `config`/`requireConfig` (same as WHOOP — add `concept2ClientId`/`concept2ClientSecret`/`concept2Callback` alongside the existing `whoop*` config keys).
- Produces: `createConcept2AuthUrl(state)`, `exchangeConcept2Code(code)`, `refreshConcept2Token(refreshToken)`, `concept2Fetch(path, token, params?)`, `normalizeConcept2Result(result, opts)`, a `Concept2Error` class, `tokenNeedsRefresh`-equivalent (reuse WHOOP's if it's provider-agnostic — check before duplicating), `mergeConcept2Token`.

- [ ] **Step 1: Read `_lib/whoop.mjs` in full before writing anything.** This task's job is to produce the Concept2-shaped twin of that file, not a fresh design — same error-class shape, same `requireConfig`/`nonEmptyString`/`timeoutSignal` conventions, same token-normalization approach (`normalizeTokenResponse`-equivalent using `expires_in`).

- [ ] **Step 2: Write failing tests first**, porting the bundle's own `docs/research/concept2-logbook-bundle/code/tests/contract.test.mjs` assertions (already verified passing standalone) into this repo's test conventions:

```js
test('posts the documented authorization-code form', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init.body.toString() });
    return { ok: true, text: async () => JSON.stringify({ access_token: 'a', token_type: 'Bearer', expires_in: 604800, refresh_token: 'r' }) };
  };
  const token = await exchangeConcept2Code('CODE', { fetchImpl });
  expect(calls[0].url).toBe('https://log.concept2.com/oauth/access_token');
  expect(calls[0].body).toContain('grant_type=authorization_code');
  expect(token.access_token).toBe('a');
});

test('treats a stroke 404 as valid summary-only data, not an error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '{"error":"no strokes"}' });
  const strokes = await getConcept2Strokes('RESULT_ID', TOKEN, { fetchImpl });
  expect(strokes).toBeNull();
});
```

Run the test file — expect FAIL (module doesn't exist yet).

- [ ] **Step 3: Implement `_lib/concept2.mjs`**, using `https://log.concept2.com` as the base, `/oauth/authorize` and `/oauth/access_token` for auth, `/api/users/me/results` (+ `{id}` and `{id}/strokes`) for data, `Accept: application/vnd.c2logbook.v1+json` on every API GET, and scopes `user:read,results:read` (comma-delimited per the documented format — do not use WHOOP's space-delimited convention here, they differ). Port `normalizeResult()`'s field mapping from the bundle's `concept2-api.mjs` (Task 10's research already verified this against the official documented shape). Treat a 404 from the strokes endpoint as "no stroke data" (return `null`), not a thrown error — this is documented, expected behavior for summary-only/manually-entered results, confirmed in `KNOWN_GAPS.md`.

- [ ] **Step 4: Run tests, verify pass.** Run the engine/functions test command this repo actually uses for `netlify/functions/_lib/*` (check `package.json` — likely the same Vitest/Node test runner as elsewhere).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_lib/concept2.mjs netlify/functions/_lib/concept2.test.mjs
git commit -m "netlify: Concept2 Logbook provider module, mirroring the WHOOP integration"
```

---

### Task 11: `concept2-connect`/`concept2-callback`/`concept2-sync` functions

**Files:**
- Create: `netlify/functions/concept2-connect.mjs`
- Create: `netlify/functions/concept2-callback.mjs`
- Create: `netlify/functions/concept2-sync.mjs`

**Interfaces:**
- Consumes: `_lib/concept2.mjs` (Task 10), `_lib/oauth.mjs`'s `newState`/`savePending`/`loadToken`/`saveToken`/`syncRecord` (already provider-agnostic — confirm by reading `_lib/oauth.mjs` before assuming), `_lib/identity.mjs`'s `ownerFromEvent`, `_lib/session.mjs`, `_lib/store.mjs`'s `connectNetlifyBlobs`.

- [ ] **Step 1: Read `whoop-connect.mjs`, `whoop-callback.mjs`, and `whoop-sync.mjs` in full.** These three files are the exact shape to reproduce, with `'whoop'` replaced by `'concept2'` as the provider key passed to `_lib/oauth.mjs`'s functions, and `_lib/whoop.mjs`'s calls replaced with `_lib/concept2.mjs`'s equivalents. Preserve the native-vs-browser dual path (`?client=native`), the `state` CSRF protection, and the token-rotation-safe refresh logic (`refreshWithoutDiscardingRotation`'s pattern in `whoop-sync.mjs`) exactly — these exist for real security reasons documented in those files' own comments, not incidental style.

- [ ] **Step 2: Write `concept2-connect.mjs`**, structurally identical to `whoop-connect.mjs`.

- [ ] **Step 3: Write `concept2-callback.mjs`**, structurally identical to `whoop-callback.mjs` (read it — not shown in this plan's research, but Task 9's file list confirms it exists at `netlify/functions/whoop-callback.mjs`).

- [ ] **Step 4: Write `concept2-sync.mjs`**, structurally identical to `whoop-sync.mjs`, but calling `listConcept2Results`/`getConcept2Result`/`getConcept2Strokes` and normalizing via Task 10's `normalizeConcept2Result`. Use `updated_after` (not a fixed lookback window) for regular syncs once a prior sync timestamp exists, falling back to a first-sync backfill window (e.g. `from` = 90 days back) — mirroring WHOOP sync's own regular-vs-backfill distinction (`REGULAR_SYNC_HISTORY_DAYS` vs `BACKFILL_SYNC_HISTORY_DAYS`).

- [ ] **Step 5: Add the required config keys** (`concept2ClientId`, `concept2ClientSecret`, `concept2Callback`) to `_lib/config.mjs`, matching how `whoopClientId`/`whoopClientSecret`/`whoopCallback` are declared there.

- [ ] **Step 6: Typecheck/lint whatever this repo runs for Netlify functions** (check root `package.json` scripts — there may not be a dedicated typecheck for `.mjs` functions; if not, a syntax-level `node --check` on each new file is the minimum bar).

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/concept2-connect.mjs netlify/functions/concept2-callback.mjs netlify/functions/concept2-sync.mjs netlify/functions/_lib/config.mjs
git commit -m "netlify: Concept2 OAuth connect/callback/sync functions"
```

---

### Task 12: Client-side Concept2 provider + Settings connect button (both platforms)

**Files:**
- Create: `apps/web/src/cloud/concept2.tsx`
- Create: `apps/mobile/src/cloud/concept2.tsx` (check whether mobile has a `cloud/whoop.tsx` equivalent first — mirror it; if mobile's WHOOP integration lives somewhere else, follow that location instead)
- Modify: `apps/web/src/screens/Settings.tsx`, `apps/mobile/src/screens/Settings.tsx` (add a "Connect Concept2" control alongside the existing WHOOP one)
- Modify: wherever the app's top-level provider tree is assembled (find where `WhoopProvider` is mounted — likely `App.tsx` on both platforms — and add `Concept2Provider` alongside it)

**Interfaces:**
- Produces: `Concept2Provider`, `useConcept2()` — same shape as `WhoopProvider`/`useWhoop()` (`connected`, `busy`, `error`, `connect()`, `sync()`, `disconnect()`).

- [ ] **Step 1: Read `apps/web/src/cloud/whoop.tsx` in full.** Reproduce its Context/Provider/hook shape exactly, swapping WHOOP's endpoint paths and sample-data shape for Concept2's (a list of recent results with modality/`type`, distance, time, and — when present — splits).

- [ ] **Step 2: Wire the provider into the app root**, mirroring wherever `WhoopProvider` is mounted today.

- [ ] **Step 3: Add a "Connect Concept2" button to Settings**, next to the existing WHOOP control, following that control's exact layout/copy conventions.

- [ ] **Step 4: Typecheck + build web; typecheck mobile.**

Run: `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/web build && pnpm --filter @hybrid/mobile typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/cloud/concept2.tsx apps/mobile/src/cloud/concept2.tsx apps/web/src/screens/Settings.tsx apps/mobile/src/screens/Settings.tsx
git commit -m "apps: Concept2 connect UI, mirroring the WHOOP settings control"
```

---

### Task 13: Attach synced Concept2 results to rowing/ski conditioning blocks

**Files:**
- Modify: `packages/engine/src/conditioning.ts` or a new `packages/engine/src/concept2.ts` (implementer's judgment — follow whichever pattern keeps `conditioning.ts` from growing unwieldy, matching this repo's established preference for splitting a file once it's doing too much)
- Test: corresponding test file

**Interfaces:**
- Consumes: normalized Concept2 results from Task 11's sync (`modality`, `startedAt`, `durationRaw`, `distanceRaw`, `workout.splits`).
- Produces: a pure function matching a synced result to the right `CondBlock`/session by time proximity, and mapping split data onto `CondResult`'s existing `zsec`/new `device` fields.

- [ ] **Step 1: Write the failing test** for a pure `matchConcept2Result(result, sessions)` function: given a synced result's `startedAt` and a list of the athlete's sessions with rowing/ski `CondBlock`s, return the best time-proximity match within a reasonable window (e.g. ±2 hours), or `null` if nothing's close enough — same idea as how a live conditioning run already matches `sinkBid`/`sinkBi` to a block, just matching by time instead of an explicit ID since a Concept2-logged row didn't originate from this app's own "Start" button.

- [ ] **Step 2: Implement it**, and a second pure function converting a normalized Concept2 result's `workout.splits` into whatever shape is most useful downstream — at minimum, store the raw `splits` array on `CondResult` alongside `device = { manufacturer: 'Concept2', model: <inferred from type>, consoleMetric: 'pace' }`. **Map Concept2's `type` field to this app's `Modality` type explicitly — they use different vocabularies, do not pass one through as the other:** Concept2's documented values are `rower`/`skierg`/`bike` (per `docs/research/concept2-logbook-bundle/RESEARCH_REPORT.md`), while this app's `Modality` (Task 1) is `'row' | 'run' | 'ski' | 'bike' | 'air_bike'` — write `rower → 'row'`, `skierg → 'ski'`, `bike → 'bike'`, anything else → leave `CondResult.modality` unset rather than guessing. Setting `rec.modality` correctly here is what makes Task 2's per-format-per-modality progression tracking actually apply to synced Concept2 sessions — per (per both evidence bundles) a Concept2 split's pace is meaningfully comparable across sessions and even machines, unlike air-bike watts.

- [ ] **Step 3: Run tests, verify pass. Run the full engine suite, confirm golden 33/33 stays untouched.**

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/conditioning.ts packages/engine/test/conditioning.test.ts
git commit -m "engine: match synced Concept2 results to rowing/ski conditioning blocks"
```

---

### Task 14: Concept2 contract check

**Files:**
- Create: `checks/concept2-contract.mjs`, mirroring `checks/whoop-contract.mjs`'s structure (source-scan-based static checks — read that file first for its exact pattern before writing a new one)
- Modify: root `package.json`'s `verify` script or wherever `whoop-contract` is currently invoked, to add the new check alongside it

- [ ] **Step 1: Read `checks/whoop-contract.mjs` in full**, then write the Concept2 equivalent checking for the same class of thing (correct scopes used, correct endpoint hosts referenced, no secrets logged, webhook/HMAC handling present if implemented, error responses shaped correctly) adapted to Concept2's actual contract from Task 10-13's implementation.

- [ ] **Step 2: Run it, confirm it passes against the real implementation.**

Run: `node checks/concept2-contract.mjs`

- [ ] **Step 3: Commit**

```bash
git add checks/concept2-contract.mjs package.json
git commit -m "checks: add a Concept2 integration contract check"
```

---

## Final Task: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1:** Run `pnpm run verify` — typecheck, full test suite (engine incl. golden 33/33, zero fixtures touched), build, CSP, web smoke, deploy smoke all green.
- [ ] **Step 2:** Confirm `git diff --stat` against the base commit touches only the files listed across Tasks 1-14.
- [ ] **Step 3:** Report back: what shipped, and what's manual-verification-required before either integration is trusted in production — the Echo V3 physical-device test plan (`docs/research/echo-v3-connectivity-bundle/evidence/known_gaps.md`) and the Concept2 real-account fixture checklist (`docs/research/concept2-logbook-bundle/KNOWN_GAPS.md`), neither of which can be satisfied without the real hardware/account in hand.
