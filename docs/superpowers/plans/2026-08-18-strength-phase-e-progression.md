# Strength Rebuild — Phase E (Deterministic Progression) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the deleted deterministic progression engine
(`packages/engine/src/adaptive/{exposures,strength}.ts`) onto the Phase A
schema — exposure classification, calibration state, and a
`decideProgression` function that issues progress/hold/deload calls with
anchor-load deload protection. No UI.

**Architecture:** Three new files inside the existing `@hybrid/strength-engine`
package (`packages/strength-engine/src/`), each a pure function/type module
with zero I/O, consuming Phase A's already-shipped
`PerformedSetWithMeasurements`/`measurementValue` (`performed.ts`) and
`currentWorkingMax`/`WorkingMaxEvent` (`workingMax.ts`). Same shape as every
Phase A file — no new package, no new dependency.

**Tech Stack:** TypeScript, Vitest, colocated tests — identical to Phase A.

## Global Constraints

- Colocated tests only: `src/foo.ts` tested by `src/foo.test.ts`, same
  directory (CLAUDE.md, "Where a test goes").
- `pain_blocked` outranks `missed` when classifying an exposure — checked
  first. This does not reinstate a session stop (CLAUDE.md, "The auto-coach
  is deleted" — unchanged by this rebuild); it only excludes a flagged set
  from load-progression math.
- `anchorKgFor` must return `null` (a real, held state) when nothing on
  record is on-target — never fall back to a missed weight. This is the
  single invariant a deload's correctness depends on.
- The 2.5%/5% deltas come from `docs/research/strength-adaptive-engine-v2/README_FIRST.md`'s
  "locked implementation decisions" and are used verbatim, not re-derived.
- Full source: `docs/superpowers/specs/2026-08-17-adaptive-engine-v2-design.md`,
  Phase E (Slices 31-33).
- Real shipped Phase A signatures this plan builds on (verified against the
  current repo, not assumed from the spec — the spec predates a few
  post-review renames):
  ```ts
  // packages/strength-engine/src/performed.ts
  export interface PerformedMeasurement { metricKey: MetricKey; value: number; }
  export interface PerformedSet {
    id: string; assignedSessionId: string; exerciseId: string;
    prescribedSetId: string | null; ordinal: number;
    status: 'completed' | 'skipped' | 'not_reached';
    performedAt: string; clientCreatedAt: string;
  }
  export interface PerformedSetWithMeasurements extends PerformedSet {
    measurements: PerformedMeasurement[];
  }
  export function measurementValue(set: PerformedSetWithMeasurements, key: MetricKey): number | null;

  // packages/strength-engine/src/workingMax.ts
  export interface WorkingMaxEvent {
    id: string; athleteId: string; exerciseId: string; valueKg: number;
    source: 'auto_estimate' | 'coach_set' | 'athlete_set' | 'test_result';
    formula: E1rmFormula | null; fromSetId: string | null; effectiveAt: string;
  }
  export function currentWorkingMax(events: WorkingMaxEvent[], asOf: string): WorkingMaxEvent | null;
  ```

---

### Task 1: Exposure classification

**Files:**
- Create: `packages/strength-engine/src/exposure.ts`
- Create: `packages/strength-engine/src/exposure.test.ts`

**Interfaces:**
- Consumes: `PerformedSetWithMeasurements`, `measurementValue` (`performed.ts`, Phase A).
- Produces: `ExposureClass`, `StrengthExposure`, `strengthExposuresFor()` —
  Task 2 (`calibrationStateFor`) and Task 3 (`decideProgression`) both
  consume `StrengthExposure[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/strength-engine/src/exposure.test.ts
import { describe, it, expect } from 'vitest';
import { strengthExposuresFor } from './exposure';
import type { PerformedSetWithMeasurements } from './performed';

function set(overrides: Partial<PerformedSetWithMeasurements> & { measurements?: PerformedSetWithMeasurements['measurements'] }): PerformedSetWithMeasurements {
  return {
    id: 'p1', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: 's1',
    ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
    measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }],
    ...overrides,
  };
}

describe('strengthExposuresFor', () => {
  it('classifies a completed set with a load and no rating as successful_but_uncertain', () => {
    const exposures = strengthExposuresFor('sq', [set({})]);
    expect(exposures).toHaveLength(1);
    expect(exposures[0]).toMatchObject({ exerciseId: 'sq', reps: 5, loadKg: 100, exposureClass: 'successful_but_uncertain', rated: false });
  });

  it('classifies a rated completed set as successful', () => {
    const exposures = strengthExposuresFor('sq', [set({ measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }, { metricKey: 'rpe', value: 8 }] })]);
    expect(exposures[0].exposureClass).toBe('successful');
    expect(exposures[0].rated).toBe(true);
  });

  it('classifies a skipped set as missed', () => {
    const exposures = strengthExposuresFor('sq', [set({ status: 'skipped' })]);
    expect(exposures[0].exposureClass).toBe('missed');
  });

  it('pain_blocked outranks missed — a skipped, pain-flagged set is never classified as missed', () => {
    const exposures = strengthExposuresFor('sq', [set({ status: 'skipped', measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }, { metricKey: 'pain', value: 1 }] })]);
    expect(exposures[0].exposureClass).toBe('pain_blocked');
    expect(exposures[0].painFlagged).toBe(true);
  });

  it('ignores sets for a different exercise', () => {
    const exposures = strengthExposuresFor('bench-press', [set({})]);
    expect(exposures).toHaveLength(0);
  });

  it('ignores sets with no load measurement (bodyweight-only work is not a strength exposure for this engine)', () => {
    const exposures = strengthExposuresFor('sq', [set({ measurements: [{ metricKey: 'reps', value: 12 }] })]);
    expect(exposures).toHaveLength(0);
  });

  it('sorts exposures oldest-first by performedAt, regardless of input order', () => {
    const a = set({ id: 'p-later', performedAt: '2026-08-22T10:00:00Z' });
    const b = set({ id: 'p-earlier', performedAt: '2026-08-18T10:00:00Z' });
    const exposures = strengthExposuresFor('sq', [a, b]);
    expect(exposures.map(e => e.performedSetId)).toEqual(['p-earlier', 'p-later']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test exposure.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/exposure.ts
import { measurementValue } from './performed';
import type { PerformedSetWithMeasurements } from './performed';

export type ExposureClass = 'successful' | 'successful_but_uncertain' | 'missed' | 'pain_blocked';

export interface StrengthExposure {
  exerciseId: string;
  reps: number;
  loadKg: number;
  rated: boolean;
  painFlagged: boolean;
  exposureClass: ExposureClass;
  performedSetId: string;
  performedAt: string;
}

/**
 * One exposure per performed_set for this exercise that carries a real load
 * measurement — sets with no `load` measurement (e.g. pure-bodyweight or
 * cardio-adjacent work) are not strength evidence and are skipped entirely,
 * mirroring `strengthExposuresFor`'s deleted predecessor's `lastWorkingSet`
 * selection rule.
 */
export function strengthExposuresFor(exerciseId: string, performed: PerformedSetWithMeasurements[]): StrengthExposure[] {
  const relevant = performed.filter(p => p.exerciseId === exerciseId);
  const exposures: StrengthExposure[] = [];

  for (const set of relevant) {
    const loadKg = measurementValue(set, 'load');
    if (loadKg == null) continue;
    const reps = measurementValue(set, 'reps') ?? 0;
    const rated = measurementValue(set, 'rpe') != null;
    const painFlagged = measurementValue(set, 'pain') != null;

    // pain_blocked outranks everything else — a set can be both a miss and
    // pain-flagged, and "missed" would feed a real injury signal into
    // load-progression math instead of excluding it entirely.
    let exposureClass: ExposureClass;
    if (painFlagged) exposureClass = 'pain_blocked';
    else if (set.status !== 'completed') exposureClass = 'missed';
    else exposureClass = rated ? 'successful' : 'successful_but_uncertain';

    exposures.push({ exerciseId, reps, loadKg, rated, painFlagged, exposureClass, performedSetId: set.id, performedAt: set.performedAt });
  }

  return exposures.sort((a, b) => a.performedAt.localeCompare(b.performedAt));
}
```

Note: `'pain'` here is a metric key used as a boolean-ish presence check
(`measurementValue(set, 'pain') != null`) — not one of Phase A's Slice 1
seeded metric keys (`load, reps, rpe, rir, tempo, rest, distance, duration,
calories, watts, height`). This is a deliberate, minimal reach: the logger
(a later phase) is expected to write a `pain` measurement when an athlete
flags a set, the same way `LoggedSet.painFlagged` worked in the deleted
engine. If `metric.key` has a foreign-key constraint against Phase A's
`metric` table by the time this ships to a real database, add a `pain` row
to the seed migration in this task's Step 6 rather than leaving it
unseeded — check `packages/strength-engine/src/metric.ts`'s current
`METRICS` map before writing Step 6 and add the row if it's missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test exposure.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Check whether `metric` needs a `pain` seed row**

Run: `grep -n "pain" packages/strength-engine/src/metric.ts`
If no `pain` entry exists, append a row to the seed `INSERT` in
`supabase/migrations/20260818_strength_rebuild.sql` (bool-ish presence
metric, `value_type: 'scalar'`, `aggregation: 'none'`,
`higher_is_better: null`, `is_load_bearing: false`), then regenerate:

```bash
node scripts/gen-metric-registry.mjs
```

Run: `pnpm --filter @hybrid/strength-engine test metric.test.ts`
Expected: PASS (the generator drift test still holds byte-identity).

- [ ] **Step 6: Commit**

```bash
git add packages/strength-engine/src/exposure.ts packages/strength-engine/src/exposure.test.ts
# if Step 5 touched the migration/generated file, add those too:
git add supabase/migrations/20260818_strength_rebuild.sql packages/strength-engine/src/metric.ts
git commit -m "Add exposure classification (Phase E Slice 31)"
```

---

### Task 2: Calibration state

**Files:**
- Create: `packages/strength-engine/src/calibration.ts`
- Create: `packages/strength-engine/src/calibration.test.ts`

**Interfaces:**
- Consumes: `StrengthExposure`, `ExposureClass` (Task 1).
- Produces: `CalibrationState`, `calibrationStateFor()` — Task 3
  (`decideProgression`) gates on this before issuing any progress/deload
  call.

- [ ] **Step 1: Write the failing test**

```ts
// packages/strength-engine/src/calibration.test.ts
import { describe, it, expect } from 'vitest';
import { calibrationStateFor } from './calibration';
import type { StrengthExposure } from './exposure';

function exposure(overrides: Partial<StrengthExposure>): StrengthExposure {
  return {
    exerciseId: 'sq', reps: 5, loadKg: 100, rated: true, painFlagged: false,
    exposureClass: 'successful', performedSetId: 'p1', performedAt: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

describe('calibrationStateFor', () => {
  it('is uncalibrated with zero usable exposures', () => {
    expect(calibrationStateFor([])).toBe('uncalibrated');
  });

  it('is uncalibrated when every exposure is pain_blocked (no usable evidence)', () => {
    const exposures = [exposure({ exposureClass: 'pain_blocked' }), exposure({ exposureClass: 'pain_blocked', performedSetId: 'p2' })];
    expect(calibrationStateFor(exposures)).toBe('uncalibrated');
  });

  it('is building with 1-2 usable exposures', () => {
    expect(calibrationStateFor([exposure({}), exposure({ performedSetId: 'p2' })])).toBe('building');
  });

  it('is calibrated at exactly 3 usable exposures', () => {
    const exposures = [exposure({ performedSetId: 'p1' }), exposure({ performedSetId: 'p2' }), exposure({ performedSetId: 'p3' })];
    expect(calibrationStateFor(exposures)).toBe('calibrated');
  });

  it('pain_blocked exposures do not count toward the 3-exposure minimum', () => {
    const exposures = [exposure({ performedSetId: 'p1' }), exposure({ performedSetId: 'p2' }), exposure({ exposureClass: 'pain_blocked', performedSetId: 'p3' })];
    expect(calibrationStateFor(exposures)).toBe('building');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test calibration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/calibration.ts
import type { StrengthExposure } from './exposure';

export type CalibrationState = 'calibrated' | 'building' | 'uncalibrated';

const MIN_EXPOSURES = 3;

export function calibrationStateFor(exposures: StrengthExposure[]): CalibrationState {
  const usable = exposures.filter(e => e.exposureClass !== 'pain_blocked');
  if (usable.length === 0) return 'uncalibrated';
  return usable.length >= MIN_EXPOSURES ? 'calibrated' : 'building';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test calibration.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/strength-engine/src/calibration.ts packages/strength-engine/src/calibration.test.ts
git commit -m "Add calibration state (Phase E Slice 32)"
```

---

### Task 3: `decideProgression`

**Files:**
- Create: `packages/strength-engine/src/progression.ts`
- Create: `packages/strength-engine/src/progression.test.ts`

**Interfaces:**
- Consumes: `StrengthExposure`, `ExposureClass` (Task 1);
  `calibrationStateFor`, `CalibrationState` (Task 2).
- Produces: `ProgressionDecision`, `ProgressionDecider` (the seam interface
  named in the spec's Architecture section), `decideProgression()`,
  `anchorKgFor()` — a later phase's `AiRetrievalDecider` (on hold, not part
  of this plan) implements the same `ProgressionDecider` interface.

- [ ] **Step 1: Write the failing test — anchor-load protection first, since it's the one invariant this whole task exists to get right**

```ts
// packages/strength-engine/src/progression.test.ts
import { describe, it, expect } from 'vitest';
import { decideProgression, anchorKgFor } from './progression';
import type { StrengthExposure } from './exposure';

function exposure(overrides: Partial<StrengthExposure>): StrengthExposure {
  return {
    exerciseId: 'sq', reps: 5, loadKg: 100, rated: true, painFlagged: false,
    exposureClass: 'successful', performedSetId: 'p1', performedAt: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

describe('anchorKgFor', () => {
  it('anchors on the last exposure classified successful or successful_but_uncertain — never a missed load', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', loadKg: 100, exposureClass: 'successful', performedAt: '2026-08-18T10:00:00Z' }),
      // a missed set within-session walked the load DOWN to 94 — this must not become the anchor
      exposure({ performedSetId: 'p2', loadKg: 94, exposureClass: 'missed', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    expect(anchorKgFor(exposures)).toBe(100);
  });

  it('returns null when nothing on record is on-target — a real held state, not a fallback to a missed weight', () => {
    const exposures = [exposure({ exposureClass: 'missed' }), exposure({ exposureClass: 'pain_blocked', performedSetId: 'p2' })];
    expect(anchorKgFor(exposures)).toBeNull();
  });

  it('picks the MOST RECENT on-target exposure when several exist', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', loadKg: 90, performedAt: '2026-08-10T10:00:00Z' }),
      exposure({ performedSetId: 'p2', loadKg: 95, performedAt: '2026-08-15T10:00:00Z' }),
      exposure({ performedSetId: 'p3', loadKg: 92, exposureClass: 'missed', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    expect(anchorKgFor(exposures)).toBe(95);
  });
});

describe('decideProgression', () => {
  it('holds with insufficient_exposure when calibration is building or uncalibrated', () => {
    const decision = decideProgression([exposure({})], { exerciseId: 'sq' });
    expect(decision.action).toBe('hold');
    expect(decision.reasonCodes).toContain('insufficient_exposure');
    expect(decision.source).toBe('deterministic');
  });

  it('progresses 2.5% when the last 3 exposures are all on-target successes', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', performedAt: '2026-08-14T10:00:00Z' }),
      exposure({ performedSetId: 'p2', performedAt: '2026-08-17T10:00:00Z' }),
      exposure({ performedSetId: 'p3', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    const decision = decideProgression(exposures, { exerciseId: 'sq' });
    expect(decision.action).toBe('progress');
    expect(decision.deltaPct).toBe(0.025);
    expect(decision.reasonCodes).toContain('three_on_target');
  });

  it('deloads 5% off the anchor when 2+ of the last 3 exposures are missed', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', loadKg: 100, exposureClass: 'successful', performedAt: '2026-08-10T10:00:00Z' }),
      exposure({ performedSetId: 'p2', loadKg: 94, exposureClass: 'missed', performedAt: '2026-08-15T10:00:00Z' }),
      exposure({ performedSetId: 'p3', loadKg: 92, exposureClass: 'missed', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    const decision = decideProgression(exposures, { exerciseId: 'sq' });
    expect(decision.action).toBe('deload');
    expect(decision.deltaPct).toBe(-0.05);
    expect(decision.reasonCodes).toContain('repeated_deterioration');
  });

  it('holds with mixed_signal when neither the progress nor deload condition is met', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', exposureClass: 'successful', performedAt: '2026-08-14T10:00:00Z' }),
      exposure({ performedSetId: 'p2', exposureClass: 'missed', performedAt: '2026-08-17T10:00:00Z' }),
      exposure({ performedSetId: 'p3', exposureClass: 'successful', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    const decision = decideProgression(exposures, { exerciseId: 'sq' });
    expect(decision.action).toBe('hold');
    expect(decision.reasonCodes).toContain('mixed_signal');
  });

  it('holds rather than deloading when repeated_deterioration is met but there is no on-target anchor to deload from', () => {
    const exposures = [
      exposure({ performedSetId: 'p1', exposureClass: 'missed', performedAt: '2026-08-10T10:00:00Z' }),
      exposure({ performedSetId: 'p2', exposureClass: 'missed', performedAt: '2026-08-15T10:00:00Z' }),
      exposure({ performedSetId: 'p3', exposureClass: 'missed', performedAt: '2026-08-20T10:00:00Z' }),
    ];
    const decision = decideProgression(exposures, { exerciseId: 'sq' });
    expect(decision.action).toBe('hold');
    expect(decision.reasonCodes).toContain('mixed_signal');
  });

  it('every decision carries exerciseId and source: deterministic', () => {
    const decision = decideProgression([exposure({})], { exerciseId: 'front-squat' });
    expect(decision.exerciseId).toBe('front-squat');
    expect(decision.source).toBe('deterministic');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test progression.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/progression.ts
import { calibrationStateFor } from './calibration';
import type { StrengthExposure } from './exposure';

export interface ProgressionDecision {
  exerciseId: string;
  action: 'progress' | 'hold' | 'deload' | 'retest';
  deltaPct?: number;
  confidence: number;
  source: 'deterministic' | 'ai_retrieval';
  reasonCodes: string[];
}

export interface DecideCtx {
  exerciseId: string;
}

/**
 * The seam: both this deterministic implementation and a future AI-backed
 * one (on hold — see docs/superpowers/specs/2026-08-17-adaptive-engine-v2-design.md,
 * "build-order note") satisfy this same interface, interchangeably.
 */
export interface ProgressionDecider {
  decide(exposures: StrengthExposure[], ctx: DecideCtx): ProgressionDecision;
}

/**
 * The most recent load the athlete actually SUCCEEDED at — the anchor a
 * deload is measured from. A deload must never be cut from a load a MISSED
 * set already walked down within-session: an athlete who opened at 100kg
 * and missed down to 94kg is still anchored at 100, not 94, or the athlete
 * is charged twice for one miss. `null` is a real, held state — the caller
 * must not fall back to the most recent (missed) weight.
 */
export function anchorKgFor(exposures: StrengthExposure[]): number | null {
  for (let i = exposures.length - 1; i >= 0; i--) {
    const e = exposures[i];
    if (e.exposureClass === 'successful' || e.exposureClass === 'successful_but_uncertain') return e.loadKg;
  }
  return null;
}

function base(ctx: DecideCtx): Pick<ProgressionDecision, 'exerciseId' | 'source'> {
  return { exerciseId: ctx.exerciseId, source: 'deterministic' };
}

export function decideProgression(exposures: StrengthExposure[], ctx: DecideCtx): ProgressionDecision {
  const calibration = calibrationStateFor(exposures);
  if (calibration !== 'calibrated') {
    return { ...base(ctx), action: 'hold', confidence: 0.3, reasonCodes: ['insufficient_exposure'] };
  }

  const recent = exposures.slice(-3);
  const allSuccessful = recent.every(e => e.exposureClass === 'successful' || e.exposureClass === 'successful_but_uncertain');
  const repeatedDeterioration = recent.filter(e => e.exposureClass === 'missed').length >= 2;
  const anchor = anchorKgFor(exposures);

  if (allSuccessful) {
    return { ...base(ctx), action: 'progress', deltaPct: 0.025, confidence: 0.9, reasonCodes: ['three_on_target'] };
  }
  if (repeatedDeterioration && anchor != null) {
    return { ...base(ctx), action: 'deload', deltaPct: -0.05, confidence: 0.85, reasonCodes: ['repeated_deterioration'] };
  }
  // repeatedDeterioration with no anchor (every exposure missed, nothing to
  // deload FROM) deliberately falls through to hold, same reason code as
  // any other mixed signal — there is no meaningful distinction from the
  // caller's side between "signals conflict" and "signals agree on deload
  // but there is nothing to anchor it to".
  return { ...base(ctx), action: 'hold', confidence: 0.7, reasonCodes: ['mixed_signal'] };
}

export const DeterministicDecider: ProgressionDecider = {
  decide: decideProgression,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test progression.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the three new modules to the package barrel**

```ts
// packages/strength-engine/src/index.ts — append these three lines to the
// existing export * from './...' list (alongside metric/exercise/rounding/
// prescription/resolve/session/performed/e1rm/workingMax/pr/load):
export * from './exposure';
export * from './calibration';
export * from './progression';
```

- [ ] **Step 6: Update the barrel-completeness test**

Find the barrel test in `packages/strength-engine/src/index.test.ts`
(`describe('package barrel', ...)`) and add assertions for the three new
exports:

```ts
// append inside the existing 'exports the full public surface' test:
expect(typeof engine.strengthExposuresFor).toBe('function');
expect(typeof engine.calibrationStateFor).toBe('function');
expect(typeof engine.decideProgression).toBe('function');
expect(typeof engine.anchorKgFor).toBe('function');
```

- [ ] **Step 7: Run the full package suite + repo-wide verification**

Run: `pnpm --filter @hybrid/strength-engine test && pnpm --filter @hybrid/strength-engine typecheck`
Expected: PASS, all Phase A + Phase E tests green.

Run: `pnpm run typecheck && pnpm run test && pnpm run check:ecosystem`
Expected: all green — this task only adds new files and appends three
export lines to an existing barrel, so no other package should be
affected, but confirm rather than assume.

- [ ] **Step 8: Commit**

```bash
git add packages/strength-engine/src/progression.ts packages/strength-engine/src/progression.test.ts packages/strength-engine/src/index.ts packages/strength-engine/src/index.test.ts
git commit -m "Add decideProgression + ProgressionDecider seam (Phase E Slice 33, close)"
```

---

## Self-Review Notes

**Spec coverage**: Slice 31 (exposure classification) → Task 1. Slice 32
(calibration state) → Task 2. Slice 33 (`decideProgression`, anchor-load
protection) → Task 3, including the exact anchor-load regression case the
spec calls out by name (a 100kg opener walked down to 94kg by a missed set
must still anchor a deload at 100, not 94 — Task 3 Step 1's first test).
The `ProgressionDecision`/`ProgressionDecider` shapes match the spec's
Architecture section's seam definition verbatim (`action`, `deltaPct`,
`confidence`, `source`, `reasonCodes`).

**Not in this plan, by design**: Phase F (knowledge-base/retrieval infra —
independent of Phase E, gets its own plan) and everything from Phase G
onward (the AI model call — on hold per the spec's build-order note, no
model/hosting decision made yet). Nothing in this plan references an AI
call; `ProgressionDecider` is defined here purely as the interface shape a
future implementation would satisfy.

**Type consistency checked**: `StrengthExposure` (Task 1) is used
identically by `calibrationStateFor` (Task 2) and `decideProgression`/
`anchorKgFor` (Task 3) — same field names (`exposureClass`, `loadKg`,
`performedAt`, etc.) throughout. `ProgressionDecision`'s `reasonCodes` are
machine-readable strings (`'insufficient_exposure'`, `'three_on_target'`,
`'repeated_deterioration'`, `'mixed_signal'`), never prose, matching the
spec's explicit requirement that nothing here is athlete-facing explanation.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-18-strength-phase-e-progression.md`.**
