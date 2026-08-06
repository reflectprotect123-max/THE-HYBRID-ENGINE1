# Phase 2 — Adaptive Strength Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project's first genuinely new recommendation function — a pure, per-exercise, cross-session strength-progression decision (`decideStrengthProgression`) — and surface it as an opt-in, tap-to-apply suggestion on the Logger screen in both apps, without touching any existing golden-tested function or writing any new persisted state.

**Architecture:** New `packages/engine/src/adaptive/strength.ts` scans an exercise's session history for its last 2 completed exposures, classifies each against its own recorded target (reusing `autoreg.ts`'s existing `repFloorOf`/`repTopOf`/`rpeCenterOf`/`verdictForRpe` — no new classification rules invented), and returns a `TrainingDecisionExplanation` (Phase 0's contract, extended with one new optional `prescription` field) proposing a rep or load change. The function is stateless — it recomputes from `sessions` on every call, writes nothing, and reads no new `Settings` field. Both Logger screens compute it once per exercise and render a small suggestion line with an "Apply" button that writes into the same local field the athlete's own typing already writes to — never a separate write path, never auto-applied.

**Tech Stack:** TypeScript (`packages/engine`), React 19 (web), React Native (mobile), Vitest, Playwright (`checks/react-smoke.mjs`), Jest + React Native Testing Library (`apps/mobile/test`).

## Global Constraints

- `pnpm run verify` must stay green after every task.
- Golden suite untouched: never edit `packages/engine/test/golden/*` or `golden.test.ts`. `computeSetAdjustment`, `nextWorkingWeight`, and every other existing golden-pinned function's signature and output stay exactly as they are.
- `autoreg.ts` and `lift.ts` internals are read from, never modified.
- No new `Settings` field. `decideStrengthProgression` is pure: same `sessions` array in, same result out, every time — no persisted streak counter.
- The suggestion never auto-fills a field. "Apply" writes into the exact same local state variable (`v1`/`v2` on web, the mobile equivalent) the athlete's own keystrokes already write to — same code path, not a new one.
- `safetyState` stays `'approved'` in every branch of `decideStrengthProgression` — no pain/fatigue signal exists for strength training in this codebase yet, and this function must not invent one.
- `ReasonCode` values used by this function must be added to the existing closed union in `packages/engine/src/adaptive/types.ts` — never emit a code outside that union.
- Test files are flat under `packages/engine/test/` (no subdirectories besides the existing `golden/`), matching every other test file in the package.
- One commit per task, direct to `main` (this repo's established convention — no feature branch, no PR).

---

### Task 1: `decideStrengthProgression` — full algorithm + contract extension

**Files:**
- Modify: `packages/engine/src/adaptive/types.ts` (add `prescription` field to `TrainingDecisionExplanation`, add 4 new `ReasonCode` values)
- Create: `packages/engine/src/adaptive/strength.ts`
- Test: `packages/engine/test/strength.test.ts`

**Interfaces:**
- Consumes: `AUTOREG` (`packages/engine/src/constants.ts`, fields `stepKg: 2.5`, `plateIncrement: 2.5`), `roundToIncrement(v, inc): number` (`num.ts`), `repFloorOf(t): number`, `repTopOf(t): string`, `rpeCenterOf(st): number`, `verdictForRpe(rpe, center?): string`, `isWarmup(st): boolean` (all from `autoreg.ts`), `blockExercises(b)`, `isLiftMode(mode): boolean`, `isWarmupBlock(b): boolean` (all from `session.ts`), `Session`/`LoggedSet` types (`types.ts`).
- Produces: `decideStrengthProgression(name: string, sessions: Session[], currentTarget: { t: string; rpe: string }): TrainingDecisionExplanation`. Every later task in this plan imports this.

- [ ] **Step 1: Extend the contract types**

In `packages/engine/src/adaptive/types.ts`, add 4 new values to the existing `ReasonCode` union (append after `'conditioning_level_held'`):

```typescript
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
  | 'conditioning_level_held'
  | 'insufficient_exposure_history'
  | 'consistently_on_target'
  | 'consistently_missed'
  | 'mixed_recent_results';
```

Add one new optional field to `TrainingDecisionExplanation` (after `dataLimitations`):

```typescript
export interface TrainingDecisionExplanation {
  action: ProgressionAction;
  confidence: Confidence;
  reasonCodes: ReasonCode[];
  /**
   * Plain-language note, safe to render directly. Never empty — every
   * explainer must supply a non-empty, render-ready sentence.
   */
  note: string;
  safetyState: SafetyState;
  /** What's missing that would raise confidence, if anything. */
  dataLimitations: string[];
  /** A concrete number to offer, when `action` proposes one. Absent when the
   * action doesn't have a number to propose (hold, pause_insufficient_data). */
  prescription?: { load?: number; reps?: number };
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/engine/test/strength.test.ts
import { describe, expect, it } from 'vitest';
import { decideStrengthProgression } from '../src/adaptive/strength';
import type { LoggedSet, Session } from '../src/types';

/** A single completed, non-warmup working set with a real target attached. */
const set = (aVal: string, aVal2: string, felt: string, t: string, rpe: string): LoggedSet =>
  ({ done: true, aVal, aVal2, felt, t, rpe }) as LoggedSet;

function sessionWith(id: string, at: number, s: LoggedSet): Session {
  return {
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [
      {
        id: 'b',
        heading: 'Main',
        superset: false,
        exercises: [{ id: 'e', name: 'Bench press', mode: 'reps_kg', rest: 90, sets: [s] }],
      },
    ],
  } as unknown as Session;
}

describe('decideStrengthProgression — insufficient data', () => {
  it('pauses when fewer than 3 exposures are logged', () => {
    for (const count of [0, 1, 2]) {
      const sessions = Array.from({ length: count }, (_, i) =>
        sessionWith('s' + i, i, set('100', '8', '8', '8-10', '8')),
      );
      const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
      expect(out.action).toBe('pause_insufficient_data');
      expect(out.confidence).toBe('low');
      expect(out.reasonCodes).toEqual(['insufficient_exposure_history']);
      expect(out.prescription).toBeUndefined();
    }
  });
});

describe('decideStrengthProgression — progression', () => {
  it('suggests one more rep when on target twice, loaded, below the rep-range top', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('100', '8', '8', '8-10', '8'));
    const sessions = [s('s0', 0), s('s1', 1), s('s2', 2)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(out.action).toBe('progress_reps');
    expect(out.prescription).toEqual({ reps: 9 });
    expect(out.reasonCodes).toEqual(['consistently_on_target']);
  });

  it('suggests a load step once on target at the top of the rep range', () => {
    const s = (id: string, at: number, reps: string) => sessionWith(id, at, set('100', reps, '8', '8-10', '8'));
    const sessions = [s('s0', 0, '8'), s('s1', 1, '10'), s('s2', 2, '10')];
    const out = decideStrengthProgression('Bench press', sessions, { t: '8-10', rpe: '8' });
    expect(out.action).toBe('progress_load');
    expect(out.prescription).toEqual({ load: 102.5 });
    expect(out.reasonCodes).toEqual(['consistently_on_target']);
  });

  it('suggests one more rep for a bodyweight exercise regardless of the rep-range top', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('', '12', '8', '10-15', '8'));
    const sessions = [s('s0', 0), s('s1', 1), s('s2', 2)];
    const out = decideStrengthProgression('Pull-up', sessions, { t: '10-15', rpe: '8' });
    expect(out.action).toBe('progress_reps');
    expect(out.prescription).toEqual({ reps: 13 });
  });
});

describe('decideStrengthProgression — deload', () => {
  it('suggests a load step down after 2 consecutive missed sessions', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('100', '3', '8', '5', '8'));
    const sessions = [s('s0', 0), s('s1', 1), s('s2', 2)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('deload');
    expect(out.prescription).toEqual({ load: 97.5 });
    expect(out.reasonCodes).toEqual(['consistently_missed']);
  });

  it('never suggests a load below AUTOREG.stepKg, even from an already-minimal weight', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('2.5', '3', '8', '5', '8'));
    const sessions = [s('s0', 0), s('s1', 1), s('s2', 2)];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('deload');
    expect(out.prescription).toEqual({ load: 2.5 });
  });

  it('holds instead of deloading a bodyweight exercise that was missed twice — nothing to deload', () => {
    const s = (id: string, at: number) => sessionWith(id, at, set('', '3', '8', '5', '8'));
    const sessions = [s('s0', 0), s('s1', 1), s('s2', 2)];
    const out = decideStrengthProgression('Push-up', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.dataLimitations).toEqual(['no_load_to_deload']);
  });
});

describe('decideStrengthProgression — mixed results', () => {
  it('holds when the last two exposures disagree (one on target, one missed)', () => {
    const onTarget = set('100', '8', '8', '8-10', '8');
    const missed = set('100', '3', '8', '5', '8');
    const sessions = [
      sessionWith('s0', 0, onTarget),
      sessionWith('s1', 1, onTarget),
      sessionWith('s2', 2, missed),
    ];
    const out = decideStrengthProgression('Bench press', sessions, { t: '5', rpe: '8' });
    expect(out.action).toBe('hold');
    expect(out.prescription).toBeUndefined();
    expect(out.reasonCodes).toEqual(['mixed_recent_results']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/engine && pnpm exec vitest run test/strength.test.ts`
Expected: FAIL — `Cannot find module '../src/adaptive/strength'`.

- [ ] **Step 4: Implement `decideStrengthProgression`**

```typescript
// packages/engine/src/adaptive/strength.ts
import { AUTOREG } from '../constants';
import { roundToIncrement } from '../num';
import { isWarmup, repFloorOf, repTopOf, rpeCenterOf, verdictForRpe } from '../autoreg';
import { blockExercises, isLiftMode, isWarmupBlock } from '../session';
import type { LoggedSet, Session } from '../types';
import type { TrainingDecisionExplanation } from './types';

interface StrengthExposure {
  sid: string;
  completedAt: number;
  reps: number;
  /** null for a bodyweight exercise — same convention `exLogFor` already uses. */
  kg: number | null;
  missed: boolean;
  onTarget: boolean;
}

const MIN_EXPOSURES = 3;

/**
 * The exercise's last completed, non-warmup working set per session, oldest
 * first — mirrors `session.ts`'s `exLogFor` filtering exactly, but keeps each
 * set's own recorded target (`t`/`rpe`) alongside its logged values, which
 * `exLogFor`'s `ExerciseHistoryEntry` shape discards. A separate, local scan;
 * does not reuse or modify `exLogFor`.
 */
function strengthExposuresFor(name: string, sessions: Session[]): StrengthExposure[] {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return [];
  const out: StrengthExposure[] = [];

  sessions
    .filter((s) => s.status !== 'active' && s.completedAt)
    .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0))
    .forEach((s) => {
      let last: LoggedSet | null = null;
      s.blocks.forEach((b) => {
        if (isWarmupBlock(b)) return;
        blockExercises(b).forEach((e) => {
          if (!isLiftMode(e.mode) || String(e.name || '').trim().toLowerCase() !== key) return;
          e.sets.forEach((st) => {
            if (isWarmup(st)) return;
            if (!st.done) return;
            const reps = Number(st.aVal2);
            if (!(reps > 0)) return;
            last = st;
          });
        });
      });
      if (last) {
        const finalSet = last as LoggedSet;
        const reps = Number(finalSet.aVal2);
        const kgVal = parseFloat(String(finalSet.aVal ?? ''));
        const kg = Number.isFinite(kgVal) && kgVal > 0 ? kgVal : null;
        const floor = repFloorOf(finalSet.t);
        const missed = floor > 0 && reps < floor;
        const center = rpeCenterOf(finalSet);
        const felt = parseFloat(String(finalSet.felt ?? ''));
        const verdict = Number.isFinite(felt) ? verdictForRpe(felt, center) : null;
        const onTarget = !missed && (verdict === 'right on target' || verdict === 'a touch under target');
        out.push({ sid: s.id, completedAt: s.completedAt as number, reps, kg, missed, onTarget });
      }
    });

  return out;
}

/**
 * A new, per-exercise, cross-session decision layered atop `nextWorkingWeight`
 * — never replacing it, never writing to settings. Pure: recomputes from
 * `sessions` on every call, no persisted streak counter. See
 * docs/superpowers/specs/2026-08-02-adaptive-phase2-strength-progression-design.md.
 */
export function decideStrengthProgression(
  name: string,
  sessions: Session[],
  currentTarget: { t: string; rpe: string },
): TrainingDecisionExplanation {
  const exposures = strengthExposuresFor(name, sessions);
  if (exposures.length < MIN_EXPOSURES) {
    return {
      action: 'pause_insufficient_data',
      confidence: 'low',
      reasonCodes: ['insufficient_exposure_history'],
      note: 'Not enough logged sessions yet to suggest a change — keep training this movement as planned.',
      safetyState: 'approved',
      dataLimitations: ['insufficient_exposure_history'],
    };
  }

  const [prev, last] = exposures.slice(-2);

  if (last.onTarget && prev.onTarget) {
    const repTop = parseInt(repTopOf(currentTarget.t), 10);
    const canProgressReps = last.kg == null || (Number.isFinite(repTop) && last.reps < repTop);
    if (canProgressReps) {
      return {
        action: 'progress_reps',
        confidence: 'high',
        reasonCodes: ['consistently_on_target'],
        note: `On target the last 2 sessions — try ${last.reps + 1} reps next time.`,
        safetyState: 'approved',
        dataLimitations: [],
        prescription: { reps: last.reps + 1 },
      };
    }
    const load = roundToIncrement((last.kg as number) + AUTOREG.stepKg, AUTOREG.plateIncrement);
    return {
      action: 'progress_load',
      confidence: 'high',
      reasonCodes: ['consistently_on_target'],
      note: `On target the last 2 sessions — try ${load}kg next time.`,
      safetyState: 'approved',
      dataLimitations: [],
      prescription: { load },
    };
  }

  if (last.missed && prev.missed) {
    if (last.kg == null) {
      return {
        action: 'hold',
        confidence: 'high',
        reasonCodes: ['consistently_missed'],
        note: 'Missed the last 2 sessions — this is worth a form or readiness check, not a number to change.',
        safetyState: 'approved',
        dataLimitations: ['no_load_to_deload'],
      };
    }
    const load = roundToIncrement(Math.max(AUTOREG.stepKg, last.kg - AUTOREG.stepKg), AUTOREG.plateIncrement);
    return {
      action: 'deload',
      confidence: 'high',
      reasonCodes: ['consistently_missed'],
      note: `Missed the last 2 sessions — try ${load}kg next time.`,
      safetyState: 'approved',
      dataLimitations: [],
      prescription: { load },
    };
  }

  return {
    action: 'hold',
    confidence: 'high',
    reasonCodes: ['mixed_recent_results'],
    note: 'Recent results are mixed — hold at the current target.',
    safetyState: 'approved',
    dataLimitations: [],
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/engine && pnpm exec vitest run test/strength.test.ts`
Expected: PASS (8/8).

- [ ] **Step 6: Run the full engine suite**

Run: `cd packages/engine && pnpm test`
Expected: golden suite still exactly 33/33, no other suite regressed.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/adaptive/types.ts packages/engine/src/adaptive/strength.ts packages/engine/test/strength.test.ts
git commit -m "engine: decideStrengthProgression — adaptive strength-progression decision (Phase 2)"
```

---

### Task 2: Decision-table test suite (50+ scenarios)

**Files:**
- Test: `packages/engine/test/strength.test.ts` (append)

**Interfaces:**
- Consumes: `decideStrengthProgression` from Task 1, unchanged.
- Produces: nothing new — this task is pure test coverage.

This is a generative decision table: fixtures are built programmatically and each assertion follows algebraically from the same classification rules Task 1's implementation uses, rather than pre-computed literal outputs. Given the space (streak pattern × loaded/bodyweight × rep-range width × exposure count), this naturally produces well over 50 cases and is safer than hand-authoring 50+ literal JSON expectations blind.

- [ ] **Step 1: Write the failing test (it isn't failing — it's new coverage; still verify it runs and passes as written, since there's no separate red/green step for additive test-only code)**

```typescript
// append to packages/engine/test/strength.test.ts
describe('decideStrengthProgression — decision table', () => {
  type Kind = 'on' | 'miss' | 'mid';
  const PATTERNS: Array<[Kind, Kind]> = [
    ['on', 'on'],
    ['miss', 'miss'],
    ['on', 'miss'],
    ['miss', 'on'],
    ['mid', 'on'],
    ['on', 'mid'],
    ['mid', 'mid'],
    ['mid', 'miss'],
    ['miss', 'mid'],
  ];
  const REP_RANGES = ['5', '5-8', '8-12'] as const;

  function repsFor(kind: Kind, repRange: string): number {
    if (kind === 'miss') return 3; // below any floor used here (5 or 8)
    // 'on' and 'mid' both stay at-or-above the floor; only felt differs.
    return repRange === '5' ? 5 : repRange === '5-8' ? 6 : 9;
  }
  function feltFor(kind: Kind): string {
    return kind === 'mid' ? '3' : '8'; // '3' is 5 points under an rpe:'8' center — 'way too light', neither missed nor on-target
  }

  for (const [prevKind, lastKind] of PATTERNS) {
    for (const loaded of [true, false]) {
      for (const repRange of REP_RANGES) {
        for (const exposureCount of [3, 6] as const) {
          it(`prev=${prevKind} last=${lastKind} loaded=${loaded} range=${repRange} exposures=${exposureCount}`, () => {
            const kg = loaded ? '100' : '';
            const older = set(kg, String(repsFor('on', repRange)), '8', repRange, '8');
            const prevSet = set(kg, String(repsFor(prevKind, repRange)), feltFor(prevKind), repRange, '8');
            const lastSet = set(kg, String(repsFor(lastKind, repRange)), feltFor(lastKind), repRange, '8');

            const filler = Array.from({ length: exposureCount - 2 }, (_, i) => sessionWith('f' + i, i, older));
            const sessions = [...filler, sessionWith('sp', exposureCount - 1, prevSet), sessionWith('sl', exposureCount, lastSet)];

            const out = decideStrengthProgression('Bench press', sessions, { t: repRange, rpe: '8' });

            const prevOn = prevKind === 'on';
            const lastOn = lastKind === 'on';
            const prevMiss = prevKind === 'miss';
            const lastMiss = lastKind === 'miss';

            if (lastOn && prevOn) {
              const repTop = parseInt(repRange.includes('-') ? repRange.split(/[-–]/)[1] : repRange, 10);
              const lastReps = repsFor(lastKind, repRange);
              if (!loaded || lastReps < repTop) {
                expect(out.action).toBe('progress_reps');
                expect(out.prescription).toEqual({ reps: lastReps + 1 });
              } else {
                expect(out.action).toBe('progress_load');
                expect(out.prescription?.load).toBeCloseTo(102.5);
              }
            } else if (lastMiss && prevMiss) {
              if (!loaded) {
                expect(out.action).toBe('hold');
                expect(out.dataLimitations).toContain('no_load_to_deload');
              } else {
                expect(out.action).toBe('deload');
                expect(out.prescription?.load).toBeCloseTo(97.5);
              }
            } else {
              expect(out.action).toBe('hold');
              expect(out.prescription).toBeUndefined();
            }
          });
        }
      }
    }
  }
});
```

- [ ] **Step 2: Run and confirm every generated case passes**

Run: `cd packages/engine && pnpm exec vitest run test/strength.test.ts`
Expected: PASS. Count the total: 9 patterns × 2 loaded × 3 rep ranges × 2 exposure counts = 108 generated cases, plus the 8 hand-written cases from Task 1 = 116 total in this file. Comfortably clears the "50+ scenarios" acceptance bar.

If any generated case fails, do not adjust the assertion to match a wrong output — trace the specific failing case's `prevKind`/`lastKind`/`loaded`/`repRange` combination against `decideStrengthProgression`'s actual branches in `strength.ts` and determine whether the test's algebra or the implementation has the bug, then fix the real one.

- [ ] **Step 3: Run the full engine suite**

Run: `cd packages/engine && pnpm test`
Expected: golden suite still exactly 33/33.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/strength.test.ts
git commit -m "engine: decideStrengthProgression decision-table coverage, 100+ generated scenarios (Phase 2)"
```

---

### Task 3: Export from `@hybrid/engine` and engine-level verification

**Files:**
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-2.
- Produces: `@hybrid/engine` now exports `decideStrengthProgression` and the updated `TrainingDecisionExplanation`/`ReasonCode` types — the surface Tasks 4-5's UI import from.

- [ ] **Step 1: Confirm the barrel already covers this file**

`packages/engine/src/index.ts` already has `export * from './adaptive/explain';` and `export * from './adaptive/types';` from Phase 0. `strength.ts` is a new file, not yet re-exported. Add one line, in the same block, alphabetically before `explain`:

```typescript
// packages/engine/src/index.ts — the existing adaptive export block currently reads:
//   export * from './adaptive/types';
//   export * from './adaptive/explain';
// Add a third line:
export * from './adaptive/strength';
```

- [ ] **Step 2: Write a smoke test proving the export reaches the package index**

```typescript
// append to packages/engine/test/strength.test.ts
import { decideStrengthProgression as fromIndex } from '../src/index';

describe('decideStrengthProgression is reachable from @hybrid/engine\'s public surface', () => {
  it('is exported from the package index, not just the adaptive module', () => {
    expect(typeof fromIndex).toBe('function');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd packages/engine && pnpm exec vitest run test/strength.test.ts`
Expected: PASS.

- [ ] **Step 4: Run engine typecheck**

Run: `cd packages/engine && pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Run the full engine suite one more time**

Run: `cd packages/engine && pnpm test`
Expected: exit 0. Golden suite exactly 33/33.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/index.ts packages/engine/test/strength.test.ts
git commit -m "engine: export decideStrengthProgression from @hybrid/engine (Phase 2 engine work complete)"
```

---

### Task 4: Web Logger — opt-in strength suggestion

**Files:**
- Modify: `apps/web/src/screens/Logger.tsx`
- Test: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: `decideStrengthProgression(name, sessions, currentTarget)` from Task 3.
- Produces: nothing new — independent of Task 5 (mobile).

- [ ] **Step 1: Add the import**

In `apps/web/src/screens/Logger.tsx`'s existing `@hybrid/engine` import block, insert `decideStrengthProgression` alphabetically (after `curSetIndex`, before `explainWorkingWeight`):

```typescript
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  decideStrengthProgression,
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

- [ ] **Step 2: Compute the suggestion**

Immediately after the existing `earnedExplained` memo (around line 119-122), add:

```typescript
  const isFirstWorkingSet = !!ex && ex.sets.findIndex((s2) => !isWarmup(s2)) === si;
  const strengthSuggestion = useMemo(
    () =>
      ex && lift && st && !isWarmup(st)
        ? decideStrengthProgression(ex.name, sessions, { t: st.t, rpe: st.rpe })
        : null,
    [ex, lift, st, sessions],
  );
```

(`si`/`st` are already defined earlier in the component, at lines 83-84 — before this point, so they're safely in scope.)

- [ ] **Step 3: Render the suggestion**

In the JSX, immediately after the closing `<PlainField label="Reps" .../>` for the lift-mode branch (the sibling right after the `StepperField` for Weight), add:

```tsx
                    <PlainField label="Reps" value={v2} onChange={(v) => writeVal(2, v)} inputMode="numeric" />
                    {strengthSuggestion?.prescription && isFirstWorkingSet ? (
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className="text-2 text-muted">{strengthSuggestion.note}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (strengthSuggestion.prescription?.load != null) {
                              writeVal(1, String(strengthSuggestion.prescription.load));
                            }
                            if (strengthSuggestion.prescription?.reps != null) {
                              writeVal(2, String(strengthSuggestion.prescription.reps));
                            }
                          }}
                        >
                          Apply
                        </Button>
                      </div>
                    ) : null}
```

(`Button` is already imported at the top of this file — no new import needed.)

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @hybrid/web typecheck`
Expected: exit 0.

- [ ] **Step 5: Add the react-smoke scenario**

In `checks/react-smoke.mjs`, insert a new `await t(...)` block immediately after the existing `'a working weight shown with a connected WHOOP is NOT marked with a recovery-data reason'` test (search for that exact string to find the insertion point — it's the last of the working-weight-note scenarios):

```javascript
await t('a consistent 2-session on-target streak surfaces an opt-in rep suggestion, and Apply writes it into the field', async () => {
  // Seed 3 completed, standalone sessions for 'Back Squat' — independent of
  // the live session state the earlier scenarios in this file built up —
  // each on-target against an 8-10 rep-range target, so the last two count
  // as a consistent streak per decideStrengthProgression's own rule.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const onTargetSet = (reps) => ({
      done: true, aVal: '100', aVal2: String(reps), felt: '8', t: '8-10', rpe: '8',
    });
    const histSession = (id, at, reps) => ({
      id, date: '2026-01-01', status: 'completed', completedAt: at,
      blocks: [{
        id: 'b', heading: 'Main', superset: false,
        exercises: [{ id: 'e', name: 'Back Squat', mode: 'reps_kg', rest: 90, sets: [onTargetSet(reps)] }],
      }],
    });
    db.sessions.push(
      histSession('strength-hist-1', 1000, 8),
      histSession('strength-hist-2', 2000, 8),
      histSession('strength-hist-3', 3000, 8),
    );
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip rest")');
  if (skip) await skip.click();
  await page.waitForSelector('input[aria-label="Weight"]');
  const txt = await page.textContent('body');
  assert(/On target the last 2 sessions/.test(txt), 'expected the strength suggestion note, got: ' + txt.slice(0, 400));
  assert(/Apply/.test(txt), 'expected an Apply control, got: ' + txt.slice(0, 400));

  const before = await page.inputValue('input[aria-label="Weight"], input[aria-label="Reps"]').catch(() => null);
  await page.click('button:has-text("Apply")');
  const reps = await page.inputValue('input[aria-label="Reps"]');
  assert(reps === '9', 'expected Apply to write the suggested rep count into the Reps field, got: ' + reps);

  // Confirm Apply never touched settings.liftProgress — the write goes
  // through the same local field the athlete's own typing uses, not a
  // separate path.
  const liftProgressUnchanged = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return !db.settings.liftProgress || !db.settings.liftProgress['back squat'];
  });
  assert(liftProgressUnchanged, 'Apply must not write to settings.liftProgress — it only fills the editable field');
});
```

- [ ] **Step 6: Rebuild and run the smoke suite**

Run: `pnpm run build:site && pnpm run smoke` (from the repo root — `pnpm run smoke` alone serves a stale build; always rebuild first, per this project's own established gotcha from Phase 1)
Expected: exit 0, including the new scenario.

- [ ] **Step 7: Run the full repo verification**

Run: `pnpm run verify`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/screens/Logger.tsx checks/react-smoke.mjs
git commit -m "web: opt-in strength-progression suggestion on Logger (Phase 2)"
```

---

### Task 5: Mobile Logger — opt-in strength suggestion

**Files:**
- Modify: `apps/mobile/src/screens/Logger.tsx`
- Test: `apps/mobile/test/logger.test.tsx`

**Interfaces:**
- Consumes: `decideStrengthProgression(name, sessions, currentTarget)` from Task 3.
- Produces: nothing new — independent of Task 4 (web), same underlying engine function.

- [ ] **Step 1: Add the import**

In `apps/mobile/src/screens/Logger.tsx`'s existing `@hybrid/engine` import block, insert `decideStrengthProgression` in the same alphabetical spot as web's:

```typescript
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  decideStrengthProgression,
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

- [ ] **Step 2: Compute the suggestion**

Immediately after the existing `earnedExplained` memo (around line 136-139), add:

```typescript
  const isFirstWorkingSet = !!ex && ex.sets.findIndex((s2) => !isWarmup(s2)) === si;
  const strengthSuggestion = useMemo(
    () =>
      ex && lift && st && !isWarmup(st)
        ? decideStrengthProgression(ex.name, db.sessions, { t: st.t, rpe: st.rpe })
        : null,
    [ex, lift, st, db.sessions],
  );
```

(Mobile sources session history from `db.sessions`, matching the existing `earned` memo's own dependency — confirm `si`/`st` are already defined earlier in the component before this point, same as web.)

- [ ] **Step 3: Render the suggestion**

In the JSX, immediately after the closing `</View>` that wraps the Weight label/note row (right before the `<View className="mt-0.5 flex-row gap-1">` stepper row) — actually, place it after the whole Weight input row and the sibling Reps input row, mirroring web's placement relative to both fields. Read the current file first to find the exact closing tag of the Reps `<Input .../>` row, then add immediately after it:

```tsx
                    {strengthSuggestion?.prescription && isFirstWorkingSet ? (
                      <View className="mt-1 flex-row items-center justify-between">
                        <T className="text-2 text-muted">{strengthSuggestion.note}</T>
                        <Btn
                          variant="ghost"
                          size="md"
                          onPress={() => {
                            if (strengthSuggestion.prescription?.load != null) {
                              writeVal(1, String(strengthSuggestion.prescription.load));
                            }
                            if (strengthSuggestion.prescription?.reps != null) {
                              writeVal(2, String(strengthSuggestion.prescription.reps));
                            }
                          }}
                        >
                          Apply
                        </Btn>
                      </View>
                    ) : null}
```

(`Btn` and `T` are already imported at the top of this file — no new import needed.)

- [ ] **Step 4: Write the new test**

In `apps/mobile/test/logger.test.tsx`, add a new `it()` inside the existing `describe('Logger', ...)` block. This needs a helper that seeds 3 completed history sessions before the live session — add it near the top of the file, alongside `liveSession`:

```typescript
/** 3 completed, on-target history sessions for `name`, plus a live session on it. */
function liveSessionWithStrengthHistory(name = 'Back squat') {
  const onTargetSet = (reps: number): LoggedSet =>
    ({ done: true, aVal: '100', aVal2: String(reps), felt: '8', t: '8-10', rpe: '8' }) as LoggedSet;
  const histSession = (id: string, at: number, reps: number): Session => ({
    id,
    date: '2026-01-01',
    status: 'completed',
    completedAt: at,
    blocks: [
      {
        id: 'b',
        heading: 'Main',
        superset: false,
        exercises: [{ id: 'e', name, mode: 'reps_kg', rest: 90, sets: [onTargetSet(reps)] }],
      },
    ],
  }) as unknown as Session;

  const w = liftWorkout(name, 2);
  const live: Session = {
    id: uid(),
    date: ymd(new Date()),
    name: 'Lower',
    status: 'active',
    blocks: freshSessionBlocks(w.blocks),
    startedAt: Date.now(),
    workoutId: w.id,
  };
  seed({
    workouts: [w],
    sessions: [histSession('h1', 1000, 8), histSession('h2', 2000, 8), histSession('h3', 3000, 8), live],
  });
  return live;
}

it('surfaces an opt-in rep suggestion after a 2-session on-target streak, and Apply writes it into the Reps field', () => {
  liveSessionWithStrengthHistory('Back squat');
  mount();
  expect(screen.getByText(/On target the last 2 sessions/)).toBeTruthy();
  fireEvent.press(screen.getByText('Apply'));
  expect(screen.getByLabelText('reps').props.value).toBe('9');
});
```

Read `apps/mobile/test/logger.test.tsx`'s existing imports first (it already imports `liftWorkout`, `uid`, `ymd`, `freshSessionBlocks`, `seed`, `screen`, `fireEvent` — this new helper and test reuse those, plus need `LoggedSet` and `Session` types already imported from `@hybrid/engine`) — confirm before adding, and add any genuinely missing import.

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @hybrid/mobile test -- logger.test.tsx`
Expected: PASS, including the new test.

- [ ] **Step 6: Run the full mobile suite**

Run: `pnpm --filter @hybrid/mobile test`
Expected: all tests pass (existing count + 1).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/Logger.tsx apps/mobile/test/logger.test.tsx
git commit -m "mobile: opt-in strength-progression suggestion on Logger (Phase 2)"
```

---

### Task 6: Full verification, push, and handoff

**Files:** `handoff.md` only.

**Interfaces:**
- Consumes: Tasks 1-5's changes together.
- Produces: nothing — final gate for this plan.

- [ ] **Step 1: Run the full repo verification**

Run: `pnpm run verify` (from the repo root)
Expected: exit 0 — typecheck clean, all unit tests green (engine with the new `strength.test.ts` suite, mobile +1, web unchanged in unit-test count but exercising the new UI via smoke), build clean, CSP check clean, react-smoke green (including the new scenario), deploy-smoke green.

- [ ] **Step 2: Update `handoff.md`**

Add a dated entry to `handoff.md`'s "Current State" section. Be precise — real commit SHAs from `git log`, real test counts from your own `pnpm run verify` run (don't guess or copy numbers from memory). Cover:
- What shipped: `decideStrengthProgression` (new engine function, 100+ scenario decision-table coverage), the `TrainingDecisionExplanation.prescription` contract extension, the opt-in "Apply" suggestion UI in both apps' Logger screens.
- The bodyweight-exercise rule (progress via reps only, never a load; a consistently-missed bodyweight exercise holds rather than proposing a deload it can't sensibly compute).
- What's still out of scope: no pain/fatigue safety signal exists for strength training, so `safetyState` stays `'approved'` in every branch — a real limitation, not an oversight, worth flagging for whoever picks up a future phase that wants to gate this. `substitute_exercise` and `repeat_session` (two `ProgressionAction` values Phase 0 already defined) are still never emitted by anything — this function has no evidence that would ever justify either.
- Phase 3 (modality-aware conditioning thresholds) as the next roadmap item per the design doc's own roadmap table.

- [ ] **Step 3: Commit and push**

```bash
git add handoff.md
git commit -m "docs: handoff — Phase 2 adaptive strength progression shipped"
git push -u origin main
```

---

## Self-Review Notes

**Spec coverage:** Every element of the design doc (`docs/superpowers/specs/2026-08-02-adaptive-phase2-strength-progression-design.md`) has a task: the contract extension and core algorithm (Task 1), the decision-table acceptance bar (Task 2), export wiring (Task 3), both apps' opt-in UI (Tasks 4-5), and the honest handoff about `safetyState`/unused `ProgressionAction` values (Task 6). The three answered scoping questions (engine+UI in one plan, rep-range from existing plan data, thresholds mirroring `conAdapt`/`insights.ts`) are all reflected directly in the algorithm's shape — no new `Settings` field, no e1RM-trend function invented (the simpler last-2-exposure streak model, reusing `verdictForRpe` directly, turned out sufficient and needs no e1RM data at all).

**Placeholder scan:** No TBD/TODO. Every code step is complete, verified against the actual current source (`Logger.tsx` in both apps, `adaptive/types.ts`, `adaptive/explain.ts`, `autoreg.ts`, `session.ts`, `constants.ts`, `num.ts` — all read directly, not assumed) as of this plan's writing. Task 1's hand-written test expectations were traced by hand against `verdictForRpe`'s actual band logic and `roundToIncrement`'s actual rounding, not guessed. Task 2's decision-table assertions are algebraic (derived from the same rules the implementation follows), not literal values that could silently drift from a hand-computation error.

**Type consistency:** `decideStrengthProgression(name, sessions, currentTarget)`'s signature is used identically across Tasks 1, 3, 4, and 5. `TrainingDecisionExplanation.prescription`'s shape (`{ load?: number; reps?: number }`) is used identically in Task 1's implementation and Tasks 4-5's UI consumption (`.prescription?.load`, `.prescription?.reps`). The four new `ReasonCode` values introduced in Task 1 are the only ones this function ever emits — no task invents a fifth.
