# Adaptive Training Engine — Phase 0 (Baseline & Contracts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a typed, reason-coded, confidence-scored contract for explaining a training decision the deterministic engine already made, and wrap four existing decision surfaces (per-set autoreg, per-lift working-weight, per-session conditioning prescription, per-session conditioning adaptation) into that shape — read-only, zero behavior change, zero UI change.

**Architecture:** New `packages/engine/src/adaptive/` module: `types.ts` (the contract) and `explain.ts` (pure wrapper functions, one per existing decision surface). Each wrapper takes an already-computed output from an existing golden-tested function and returns a `TrainingDecisionExplanation` — it never recomputes, second-guesses, or alters the decision itself. `@hybrid/engine`'s `index.ts` re-exports both new files so both apps can import from `@hybrid/engine` exactly as they do today.

**Tech Stack:** TypeScript (framework-free, matches every other file in `packages/engine`), Vitest (`describe`/`it`/`expect` globals, no import needed — see `vitest.config.ts`), pnpm workspaces.

## Global Constraints

- `pnpm run verify` must stay green after every task (this repo's standing rule — see `handoff.md`).
- Golden suite is sacrosanct: never edit `packages/engine/test/golden/*`, `packages/engine/test/golden.test.ts`, or any fixture-pinned function's signature or output. Golden count must read exactly `33/33` after every task.
- No existing function's signature or return type changes. `computeSetAdjustment`, `nextWorkingWeight`, `conPrescription`, `conAdapt` are read from, never modified, in this phase.
- Zero UI change in Phase 0 — no screen in `apps/web` or `apps/mobile` is touched. Phase 1 is where a "why" string first reaches a screen.
- `reasonCodes` are a closed, stable `ReasonCode` string-literal union, never free text — a later caller (UI copy, an AI explainer) switches on these values, so a typo here is a silent contract break, not a cosmetic one.
- New code lives entirely under `packages/engine/src/adaptive/`; nothing elsewhere in `packages/engine/src` is edited except `index.ts`'s export list (Task 5).
- One commit per task, following this repo's established SDD discipline (see `git log` — every prior phase in this project shipped that way).
- Test files are flat under `packages/engine/test/` (no subdirectories besides the existing `golden/`), matching every other test file in the package.

---

### Task 1: Adaptive contract types + `explainSetAdjustment`

**Files:**
- Create: `packages/engine/src/adaptive/types.ts`
- Create: `packages/engine/src/adaptive/explain.ts`
- Test: `packages/engine/test/adaptive.test.ts`

**Interfaces:**
- Consumes: `SetAdjustment` (`packages/engine/src/types.ts:398-403`, fields `delta: number`, `newWeight: number`, `verdict: string`, `cls: 'good'|'bad'`), `computeSetAdjustment` (`packages/engine/src/autoreg.ts:57`, signature `(reps: number, rpe: number, low: number, weight: number, center: number) => SetAdjustment`).
- Produces: `ProgressionAction`, `Confidence`, `SafetyState`, `ReasonCode`, `TrainingDecisionExplanation` (all exported from `adaptive/types.ts`); `explainSetAdjustment(adj: SetAdjustment): TrainingDecisionExplanation` (from `adaptive/explain.ts`). Every later task in this plan imports these.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/engine/test/adaptive.test.ts
import { describe, expect, it } from 'vitest';
import { computeSetAdjustment } from '../src/autoreg';
import { explainSetAdjustment } from '../src/adaptive/explain';

describe('explainSetAdjustment', () => {
  it('wraps a missed set as reduce_load with a stable reason code, without altering the underlying math', () => {
    const adj = computeSetAdjustment(3, 10, 5, 24.9, 10);
    expect(adj).toEqual({ delta: -2.4, newWeight: 22.5, verdict: 'missed the rep floor', cls: 'bad' });
    expect(explainSetAdjustment(adj)).toEqual({
      action: 'reduce_load',
      confidence: 'high',
      reasonCodes: ['missed_rep_floor'],
      note: 'missed the rep floor',
      safetyState: 'approved',
      dataLimitations: [],
    });
  });

  it('wraps an exact on-target hold as hold', () => {
    const adj = computeSetAdjustment(5, 8.5, 5, 101, 8.5);
    const explained = explainSetAdjustment(adj);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['on_target']);
    expect(explained.note).toBe('right on target');
  });

  it('wraps an easy set (delta > 0) as progress_load', () => {
    const adj = computeSetAdjustment(5, 6, 0, 100, 8.5);
    expect(adj.delta).toBeGreaterThan(0);
    const explained = explainSetAdjustment(adj);
    expect(explained.action).toBe('progress_load');
    expect(explained.reasonCodes).toEqual(['too_light']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: FAIL — `Cannot find module '../src/adaptive/explain'` (the module doesn't exist yet).

- [ ] **Step 3: Write the contract types**

```typescript
// packages/engine/src/adaptive/types.ts
/**
 * Additive, read-only contract for explaining a decision the deterministic
 * engine already made. See
 * docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md §10.D.
 *
 * Nothing in this file changes what any existing function computes — it only
 * gives an already-computed output a typed, reason-coded shape a later UI or
 * AI-explainer layer can consume without re-deriving the underlying math.
 */

export type ProgressionAction =
  | 'progress_load'
  | 'progress_reps'
  | 'hold'
  | 'reduce_load'
  | 'reduce_volume'
  | 'repeat_session'
  | 'substitute_exercise'
  | 'deload'
  | 'pause_insufficient_data';

export type Confidence = 'low' | 'medium' | 'high';

export type SafetyState = 'approved' | 'held' | 'reduced' | 'blocked';

/**
 * Closed set of stable reason codes. A caller switches on these values, so
 * every explainer in `explain.ts` must draw only from this union — never
 * emit a raw verdict string here even though several explainers echo that
 * same string back in the `note` field for a human to read.
 */
export type ReasonCode =
  | 'missed_rep_floor'
  | 'way_too_light'
  | 'too_light'
  | 'easy'
  | 'touch_under_target'
  | 'on_target'
  | 'grindy'
  | 'max_effort'
  | 'unclassified'
  | 'eased_for_recovery'
  | 'at_earned_weight'
  | 'no_earned_weight'
  | 'at_earned_level'
  | 'baseline_format'
  | 'conditioning_level_progressed'
  | 'conditioning_level_deloaded'
  | 'conditioning_session_excluded'
  | 'conditioning_no_hr_data'
  | 'conditioning_level_held';

export interface TrainingDecisionExplanation {
  action: ProgressionAction;
  confidence: Confidence;
  reasonCodes: ReasonCode[];
  /** Plain-language note, safe to render directly. */
  note: string;
  safetyState: SafetyState;
  /** What's missing that would raise confidence, if anything. */
  dataLimitations: string[];
}
```

- [ ] **Step 4: Write `explainSetAdjustment`**

```typescript
// packages/engine/src/adaptive/explain.ts
import type { SetAdjustment } from '../types';
import type { ReasonCode, TrainingDecisionExplanation } from './types';

const SET_ADJUSTMENT_REASON_CODES: Record<string, ReasonCode> = {
  'missed the rep floor': 'missed_rep_floor',
  'way too light': 'way_too_light',
  'too light': 'too_light',
  'easy': 'easy',
  'a touch under target': 'touch_under_target',
  'right on target': 'on_target',
  'grindy': 'grindy',
  'max effort': 'max_effort',
};

/**
 * Explains an already-computed set adjustment. Read-only: never recomputes
 * or alters `adj` — it only reshapes it into the adaptive-decision contract.
 */
export function explainSetAdjustment(adj: SetAdjustment): TrainingDecisionExplanation {
  const action = adj.delta < 0 ? 'reduce_load' : adj.delta > 0 ? 'progress_load' : 'hold';
  return {
    action,
    confidence: 'high',
    reasonCodes: [SET_ADJUSTMENT_REASON_CODES[adj.verdict] || 'unclassified'],
    note: adj.verdict,
    safetyState: 'approved',
    dataLimitations: [],
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: PASS (3/3 in this file).

- [ ] **Step 6: Run the full engine suite to confirm nothing else moved**

Run: `cd packages/engine && pnpm test`
Expected: all prior suites still pass, golden suite still exactly `33/33`, plus the 3 new cases.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/adaptive/types.ts packages/engine/src/adaptive/explain.ts packages/engine/test/adaptive.test.ts
git commit -m "engine: adaptive-decision contract types + explainSetAdjustment (Phase 0)"
```

---

### Task 2: `explainWorkingWeight`

**Files:**
- Modify: `packages/engine/src/adaptive/explain.ts`
- Modify: `packages/engine/test/adaptive.test.ts`

**Interfaces:**
- Consumes: `WorkingWeight` (`packages/engine/src/lift.ts:138-146`, fields `kg: number`, `earned: number`, `dailyAdj: number`, `note: string`), `nextWorkingWeight` (`packages/engine/src/lift.ts:162-166`, signature `(name: string, settings?: Settings, whoop?: WhoopSample | null) => WorkingWeight | null`).
- Produces: `explainWorkingWeight(w: WorkingWeight | null): TrainingDecisionExplanation`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to packages/engine/test/adaptive.test.ts
import { nextWorkingWeight } from '../src/lift';
import { explainWorkingWeight } from '../src/adaptive/explain';

describe('explainWorkingWeight', () => {
  it('reports pause_insufficient_data when nothing has been earned yet', () => {
    expect(nextWorkingWeight('Back squat', {})).toBeNull();
    const explained = explainWorkingWeight(null);
    expect(explained).toEqual({
      action: 'pause_insufficient_data',
      confidence: 'low',
      reasonCodes: ['no_earned_weight'],
      note: 'No working weight has been earned for this movement yet.',
      safetyState: 'approved',
      dataLimitations: ['no_lift_history'],
    });
  });

  it('holds at the earned weight on a green or amber day', () => {
    const settings = { liftProgress: { 'back squat': { kg: 100, at: 1 } } };
    const w = nextWorkingWeight('Back squat', settings, { recoveryScore: 80 });
    const explained = explainWorkingWeight(w);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['at_earned_weight']);
    expect(explained.confidence).toBe('high');
  });

  it('eases and explains why on a red day', () => {
    const settings = { liftProgress: { 'back squat': { kg: 100, at: 1 } } };
    const w = nextWorkingWeight('Back squat', settings, { recoveryScore: 20 });
    expect(w?.note).toBe('eased for 20% recovery');
    const explained = explainWorkingWeight(w);
    expect(explained).toEqual({
      action: 'reduce_load',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: 'eased for 20% recovery',
      safetyState: 'approved',
      dataLimitations: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: FAIL — `explainWorkingWeight is not a function` (or similar TS/runtime error).

- [ ] **Step 3: Implement `explainWorkingWeight`**

```typescript
// append to packages/engine/src/adaptive/explain.ts
import type { WorkingWeight } from '../lift';

/**
 * Explains an already-computed working-weight offer. Read-only, same
 * discipline as `explainSetAdjustment`.
 */
export function explainWorkingWeight(w: WorkingWeight | null): TrainingDecisionExplanation {
  if (!w) {
    return {
      action: 'pause_insufficient_data',
      confidence: 'low',
      reasonCodes: ['no_earned_weight'],
      note: 'No working weight has been earned for this movement yet.',
      safetyState: 'approved',
      dataLimitations: ['no_lift_history'],
    };
  }
  if (w.dailyAdj < 0) {
    return {
      action: 'reduce_load',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: w.note,
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  return {
    action: 'hold',
    confidence: 'high',
    reasonCodes: ['at_earned_weight'],
    note: w.note,
    safetyState: 'approved',
    dataLimitations: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: PASS (6/6 in this file).

- [ ] **Step 5: Run the full engine suite**

Run: `cd packages/engine && pnpm test`
Expected: golden suite still `33/33`, all suites green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/adaptive/explain.ts packages/engine/test/adaptive.test.ts
git commit -m "engine: explainWorkingWeight (Phase 0)"
```

---

### Task 3: `explainConPrescription`

**Files:**
- Modify: `packages/engine/src/adaptive/explain.ts`
- Modify: `packages/engine/test/adaptive.test.ts`

**Interfaces:**
- Consumes: `Prescription` (`packages/engine/src/types.ts:435-444`, fields `level: number`, `dailyAdj: number`, `rec: number | null`, `note: string`, plus format-specific `minutes?`/`rounds?`/`work?`/`rest?`), `conPrescription` (`packages/engine/src/conditioning.ts:243`, signature `(fmtKey: CondFmtKey, ctx?: PrescriptionCtx) => Prescription`).
- Produces: `explainConPrescription(p: Prescription): TrainingDecisionExplanation`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to packages/engine/test/adaptive.test.ts
import { conPrescription } from '../src/conditioning';
import { explainConPrescription } from '../src/adaptive/explain';

describe('explainConPrescription', () => {
  it('holds at baseline with low confidence when no device is connected', () => {
    const p = conPrescription('intervals', {});
    expect(p.rec).toBeNull();
    const explained = explainConPrescription(p);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['baseline_format']);
    expect(explained.confidence).toBe('low');
    expect(explained.dataLimitations).toEqual(['no_recovery_data']);
  });

  it('holds at the earned level with high confidence when recovery data exists', () => {
    const settings = { conProgress: { intervals: { level: 3, miss: 0 } } };
    const p = conPrescription('intervals', { settings, whoop: { recoveryScore: 80 } });
    expect(p.note).toBe('Level 3');
    const explained = explainConPrescription(p);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['at_earned_level']);
    expect(explained.confidence).toBe('high');
    expect(explained.dataLimitations).toEqual([]);
  });

  it('explains an eased day', () => {
    const p = conPrescription('intervals', { whoop: { recoveryScore: 20 } });
    expect(p.note).toBe('eased today for 20% recovery');
    const explained = explainConPrescription(p);
    expect(explained).toEqual({
      action: 'reduce_volume',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: 'eased today for 20% recovery',
      safetyState: 'approved',
      dataLimitations: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: FAIL — `explainConPrescription is not a function`.

- [ ] **Step 3: Implement `explainConPrescription`**

```typescript
// append to packages/engine/src/adaptive/explain.ts
import type { Prescription } from '../types';

/** Explains an already-computed conditioning prescription. Read-only. */
export function explainConPrescription(p: Prescription): TrainingDecisionExplanation {
  if (p.dailyAdj < 0) {
    return {
      action: 'reduce_volume',
      confidence: 'high',
      reasonCodes: ['eased_for_recovery'],
      note: p.note,
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  const noRecoveryData = p.rec == null;
  return {
    action: 'hold',
    confidence: noRecoveryData ? 'low' : 'high',
    reasonCodes: [p.level > 0 ? 'at_earned_level' : 'baseline_format'],
    note: p.note,
    safetyState: 'approved',
    dataLimitations: noRecoveryData ? ['no_recovery_data'] : [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: PASS (9/9 in this file).

- [ ] **Step 5: Run the full engine suite**

Run: `cd packages/engine && pnpm test`
Expected: golden suite still `33/33`, all suites green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/adaptive/explain.ts packages/engine/test/adaptive.test.ts
git commit -m "engine: explainConPrescription (Phase 0)"
```

---

### Task 4: `explainConAdapt`

**Files:**
- Modify: `packages/engine/src/adaptive/explain.ts`
- Modify: `packages/engine/test/adaptive.test.ts`

**Interfaces:**
- Consumes: `CondResult` (`packages/engine/src/types.ts:183-233`), `AdaptResult` (`packages/engine/src/types.ts` via `conditioning.ts:332-335`, fields `delta: -1|0|1`, `conProgress: Record<string, ProgressState>`), `conAdapt` (`packages/engine/src/conditioning.ts:354`, signature `(rec: CondResult | null | undefined, settings?: Settings) => AdaptResult`).
- Produces: `explainConAdapt(rec: CondResult | null | undefined, result: AdaptResult): TrainingDecisionExplanation`.

**Design note:** `conAdapt`'s internal on-target/overcooked/recovery gates are private — re-deriving *why* it decided what it did would duplicate that logic and risk drift from the real decision. This explainer only classifies the *already-returned* `delta`, plus the two data-quality facts already public on `CondResult` (`sim`, `zsec`), so it can never disagree with `conAdapt` about what happened.

- [ ] **Step 1: Write the failing test**

```typescript
// append to packages/engine/test/adaptive.test.ts
import { conAdapt } from '../src/conditioning';
import type { CondResult } from '../src/types';
import { explainConAdapt } from '../src/adaptive/explain';

describe('explainConAdapt', () => {
  it('explains a progressed level', () => {
    const rec = { fmt: 'intervals', effort: 'hard', felt: '8', zsec: { low: 10, mod: 5, high: 0 }, dur: 20 } as CondResult;
    const result = conAdapt(rec, {});
    expect(result.delta).toBe(1);
    const explained = explainConAdapt(rec, result);
    expect(explained.action).toBe('progress_load');
    expect(explained.reasonCodes).toEqual(['conditioning_level_progressed']);
    expect(explained.confidence).toBe('high');
  });

  it('explains a deload after two consecutive misses', () => {
    const rec = { fmt: 'steady', effort: 'easy', felt: '9', zsec: { low: 5, mod: 0, high: 5 }, dur: 20 } as CondResult;
    const r1 = conAdapt(rec, {});
    expect(r1.delta).toBe(0); // first miss, not yet deloaded
    const r2 = conAdapt(rec, { conProgress: r1.conProgress });
    expect(r2.delta).toBe(-1);
    const explained = explainConAdapt(rec, r2);
    expect(explained.action).toBe('deload');
    expect(explained.reasonCodes).toEqual(['conditioning_level_deloaded']);
  });

  it('explains a held level on a first miss (not yet deloaded)', () => {
    const rec = { fmt: 'steady', effort: 'easy', felt: '9', zsec: { low: 5, mod: 0, high: 5 }, dur: 20 } as CondResult;
    const result = conAdapt(rec, {});
    expect(result.delta).toBe(0);
    const explained = explainConAdapt(rec, result);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['conditioning_level_held']);
    expect(explained.confidence).toBe('medium');
  });

  it('explains a no-HR-data session as low confidence, not a miss', () => {
    const rec = { id: 'a', fmt: 'intervals', zsec: { low: 0, mod: 0, high: 0 }, dur: 1200 } as CondResult;
    const result = conAdapt(rec, {});
    expect(result.delta).toBe(0);
    const explained = explainConAdapt(rec, result);
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['conditioning_no_hr_data']);
    expect(explained.dataLimitations).toEqual(['no_device_data']);
  });

  it('explains an excluded/simulated session', () => {
    const explained = explainConAdapt(null, { delta: 0, conProgress: {} });
    expect(explained.action).toBe('hold');
    expect(explained.reasonCodes).toEqual(['conditioning_session_excluded']);
    expect(explained.dataLimitations).toEqual(['simulated_or_missing_session']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: FAIL — `explainConAdapt is not a function`.

- [ ] **Step 3: Implement `explainConAdapt`**

```typescript
// append to packages/engine/src/adaptive/explain.ts
import type { AdaptResult } from '../conditioning';
import type { CondResult } from '../types';

/**
 * Explains an already-computed conditioning-adaptation result. Never
 * recomputes `conAdapt`'s own gates — see the Task 4 design note in
 * docs/superpowers/plans/2026-08-01-adaptive-training-phase0.md.
 */
export function explainConAdapt(rec: CondResult | null | undefined, result: AdaptResult): TrainingDecisionExplanation {
  if (result.delta > 0) {
    return {
      action: 'progress_load',
      confidence: 'high',
      reasonCodes: ['conditioning_level_progressed'],
      note: 'Conditioning level progressed after an on-target session.',
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  if (result.delta < 0) {
    return {
      action: 'deload',
      confidence: 'high',
      reasonCodes: ['conditioning_level_deloaded'],
      note: 'Conditioning level eased back after repeated missed sessions.',
      safetyState: 'approved',
      dataLimitations: [],
    };
  }
  if (!rec || rec.sim) {
    return {
      action: 'hold',
      confidence: 'low',
      reasonCodes: ['conditioning_session_excluded'],
      note: 'This session does not count toward conditioning progression.',
      safetyState: 'approved',
      dataLimitations: ['simulated_or_missing_session'],
    };
  }
  const z = rec.zsec || { low: 0, mod: 0, high: 0 };
  const zoned = (z.low || 0) + (z.mod || 0) + (z.high || 0);
  if (zoned <= 0) {
    return {
      action: 'hold',
      confidence: 'low',
      reasonCodes: ['conditioning_no_hr_data'],
      note: 'No heart-rate zone data was captured, so this session neither earns nor costs progression.',
      safetyState: 'approved',
      dataLimitations: ['no_device_data'],
    };
  }
  return {
    action: 'hold',
    confidence: 'medium',
    reasonCodes: ['conditioning_level_held'],
    note: 'Conditioning level held at its current stage.',
    safetyState: 'approved',
    dataLimitations: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: PASS (14/14 in this file).

- [ ] **Step 5: Run the full engine suite**

Run: `cd packages/engine && pnpm test`
Expected: golden suite still `33/33`, all suites green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/adaptive/explain.ts packages/engine/test/adaptive.test.ts
git commit -m "engine: explainConAdapt (Phase 0)"
```

---

### Task 5: Export from `@hybrid/engine` and full-repo verification

**Files:**
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: everything produced in Tasks 1–4.
- Produces: `@hybrid/engine` now exports `ProgressionAction`, `Confidence`, `SafetyState`, `ReasonCode`, `TrainingDecisionExplanation`, `explainSetAdjustment`, `explainWorkingWeight`, `explainConPrescription`, `explainConAdapt` — the surface Phase 1's "why" UI and Phase 2/3's new decision functions import from.

- [ ] **Step 1: Add the export lines**

```typescript
// packages/engine/src/index.ts — add these two lines to the existing export list,
// after the `export * from './cloud';` line and before `export * from './storage';`
export * from './adaptive/types';
export * from './adaptive/explain';
```

- [ ] **Step 2: Write a smoke test proving both apps' import path works**

```typescript
// append to packages/engine/test/adaptive.test.ts
import { explainSetAdjustment as explainSetAdjustmentFromIndex } from '../src/index';

describe('adaptive exports reach @hybrid/engine\'s public surface', () => {
  it('explainSetAdjustment is reachable from the package index, not just the adaptive module', () => {
    expect(typeof explainSetAdjustmentFromIndex).toBe('function');
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/adaptive.test.ts`
Expected: PASS (15/15 in this file).

- [ ] **Step 4: Run the engine package's own typecheck**

Run: `cd packages/engine && pnpm run typecheck`
Expected: exit 0, no new errors. This also confirms neither app's typecheck can break from this change until a later phase actually imports the new exports there.

- [ ] **Step 5: Run the full engine test suite one more time**

Run: `cd packages/engine && pnpm test`
Expected: exit 0. Golden suite exactly `33/33` (unchanged from the Phase 0 baseline recorded in `handoff.md`). Total engine test count is `304 + 15` (the 15 new cases across Tasks 1–5's `adaptive.test.ts`).

- [ ] **Step 6: Run the full repo verification**

Run: `pnpm run verify` (from the repo root, `/workspace/the-hybrid-engine1`)
Expected: exit 0 — typecheck clean, all unit tests green (engine/mobile/web/guided-flow), build clean, CSP check clean, react-smoke green, deploy-smoke green. No UI changed in this phase, so react-smoke/deploy-smoke pass unmodified.

- [ ] **Step 7: Commit and push**

```bash
git add packages/engine/src/index.ts packages/engine/test/adaptive.test.ts
git commit -m "engine: export adaptive-decision contract from @hybrid/engine (Phase 0 complete)"
git push -u origin main
```

- [ ] **Step 8: Update `handoff.md`**

Add a dated entry to `handoff.md`'s "Current State" section recording: Phase 0 shipped (types + 4 explainers + exports), engine suite now `304+15/304+15` (state the real total from Step 5's output), golden still `33/33`, zero UI change, and that Phase 1's remaining piece (surfacing a "why" string in at least one screen per app, per the roadmap's Phase 1 acceptance criteria) is next — awaiting your go-ahead to start, per this project's standing per-phase review gate.

```bash
git add handoff.md
git commit -m "docs: handoff — Phase 0 (adaptive contracts) shipped"
git push -u origin main
```

---

## Self-Review Notes

**Spec coverage:** Phase 0's roadmap row (design doc §14) asks for exactly two things — contract types, and wrapping "autoreg verdict, `conAdapt` note, `conPrescription` note" — plus its own acceptance criteria ("New pure functions unit-tested; golden suite unchanged 308/308; zero UI change"). This plan covers the contract (Task 1), autoreg (Task 1), `conPrescription` (Task 3), `conAdapt` (Task 4), and additionally `nextWorkingWeight` (Task 2) — included because it is `conPrescription`'s direct strength-side analog (both are the "what does today's session look like" surface for their domain) and Phase 1's "why" UI needs a strength-side explainer just as much as a conditioning-side one; leaving it out of Phase 0 would just move the same work into Phase 1 under a tighter review gate for no benefit. All four wrapped functions are read from, never modified.

**Placeholder scan:** No TBD/TODO markers. Every step has real, complete code. All test fixtures (`recoveryScore: 20`, `zsec` values, etc.) were taken from or cross-checked against this repo's existing test suites (`lift.test.ts`, `conditioning.test.ts`) so expected values are real, not guessed.

**Type consistency:** `ReasonCode` is defined once in Task 1 and every subsequent task's new codes (`at_earned_weight`, `no_earned_weight`, `at_earned_level`, `baseline_format`, the four `conditioning_*` codes) were added to that same union up front — no task invents a code outside it. `TrainingDecisionExplanation`'s field names (`action`, `confidence`, `reasonCodes`, `note`, `safetyState`, `dataLimitations`) are identical across all four `explain*` functions.
