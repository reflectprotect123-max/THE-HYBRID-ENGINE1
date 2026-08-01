# Phase 2 — Adaptive Strength Progression (Design)

**Status:** Design, approved decisions below reflect direct answers to three scoping questions (engine+UI in one plan; rep-range derived from existing plan data, not a new settings concept; thresholds mirror `conAdapt`/`insights.ts`'s existing patterns). Everything past those three points is my own best-judgment detail, stated plainly so it can be corrected before the plan is written.

## What this is

Phase 2 of the adaptive-training-engine roadmap (`docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md` §14): "Juggernaut-style decision set as a new per-exercise function layered atop `nextWorkingWeight`; Logger shows an opt-in suggestion, never forces it." This is the project's first genuinely *new* recommendation logic — Phase 0 only wrapped decisions the engine already made; Phase 1 only surfaced one of those wraps in UI. Phase 2 proposes a number nothing in the engine proposed before.

## Non-negotiable framing (from §11/§15 of the parent audit, restated because Phase 2 is exactly where this could go wrong)

- The suggestion is read-only advice. It never writes to `settings.liftProgress` itself, never auto-fills a field without an explicit tap, and manual entry always wins — an athlete typing over a suggested number is not an error condition, there is nothing to reconcile.
- `autoreg.ts`/`lift.ts` are not touched. `nextWorkingWeight` and `computeSetAdjustment` keep deciding exactly what they decide today; Phase 2 is a new, separate, additive function.
- No golden-fixture-pinned function's output changes.

## New file: `packages/engine/src/adaptive/strength.ts`

One exported pure function:

```ts
export function decideStrengthProgression(
  name: string,
  sessions: Session[],
  currentTarget: { t: string; rpe: string },
): TrainingDecisionExplanation
```

`currentTarget` is the exercise's own currently-planned working-set target — the caller (Logger) already has this on hand (it's the same `PlannedSet` the screen is already rendering `target ${targetLine(ex, st)}` from). Nothing new to compute to get it.

**No new `Settings` field.** Every earlier explainer in this project either wraps an already-persisted decision (`conProgress`, `liftProgress`) or reads live inputs. Phase 2 could have added its own persisted miss-streak counter (mirroring `conProgress`'s `{level, miss}` shape) — deliberately not doing that. `sessions` already contains everything needed to recompute the last 3 exposures on every call; a persisted counter would just be a cache with a staleness/drift risk (what happens when a session is edited or deleted after the fact?) for no real benefit, and it would make the acceptance criterion's "deterministic decision-table test suite" harder to write, not easier — a stateful function needs state fixtures; a pure function just needs input/output pairs.

## Contract extension (Phase 0's shared type, additive only)

`packages/engine/src/adaptive/types.ts`'s `TrainingDecisionExplanation` has no field for a *proposed new number* — every existing explainer only explains a decision the engine already made elsewhere. Phase 2 needs to hand the UI something to apply. Add one new optional field:

```ts
export interface TrainingDecisionExplanation {
  action: ProgressionAction;
  confidence: Confidence;
  reasonCodes: ReasonCode[];
  note: string;
  safetyState: SafetyState;
  dataLimitations: string[];
  /** A concrete number to offer, when `action` proposes one. Absent when the
   * action doesn't have a number to propose (hold, pause_insufficient_data). */
  prescription?: { load?: number; reps?: number };
}
```

This is exactly the field the *original* design doc's §10.D contract sketch always had (`prescription?: { sets?, reps?, load?, rpeTarget? }`) — Phase 0 simply didn't need it yet, since its four explainers only annotate numbers the engine had already picked. Adding it now is additive: all four existing Phase 0 explainers return objects without this key, which is legal on an optional field, so nothing about them changes.

New `ReasonCode` values needed (extend the existing closed union in the same file, don't invent a separate one):
- `'insufficient_exposure_history'` — fewer than 3 comparable exposures logged for this exercise.
- `'consistently_on_target'` — the signal behind `progress_load`/`progress_reps`.
- `'consistently_missed'` — the signal behind `deload`.
- `'mixed_recent_results'` — the signal behind `hold`.

## Algorithm

**Exposure extraction.** For the named exercise, scan `sessions` (completed only, same filter `exLogFor` already uses: `status !== 'active' && s.completedAt`, sorted oldest-first) and take, per session, the exercise's *last* completed non-warmup working set (not the heaviest — the last one is closest to the session's actual finishing effort, and it's the set whose own `t`/`rpe` this decision judges against). Unlike `session.ts`'s existing `exLogFor`, this needs the set's *target* fields (`t`, `rpe`) alongside its recorded values (`aVal2`, `felt`) to classify it — `exLogFor`'s `ExerciseHistoryEntry` shape discards `t`/`rpe`, so this is a small, separate, local scan inside `strength.ts`, not a reuse of `exLogFor` and not a change to it. Mirrors its filtering logic; doesn't touch it.

```ts
interface StrengthExposure {
  sid: string;
  completedAt: number;
  reps: number;
  kg: number | null;  // null for a bodyweight exercise — same convention exLogFor already uses
  missed: boolean;     // repFloorOf(t) > 0 && reps < repFloorOf(t) — same rule computeSetAdjustment uses
  onTarget: boolean;   // see exact definition below
}
```

`onTarget` is defined precisely in terms of the verdict `autoreg.ts` already computes, not a new threshold: `!missed && verdictForRpe(felt, rpeCenterOf({ rpe: currentTarget.rpe })) is one of ('right on target', 'a touch under target')`. Those are exactly the two verdict strings that mean "the set was made, and effort was at-or-slightly-under what was asked" — `'easy'`/`'way too light'` mean the target itself was too easy (a different signal, not handled by this v1: an athlete blowing through a target for 3 straight sessions still only reads as "on target" here, which is a conservative-by-omission choice, not a bug — see Testing below for the boundary cases this implies), and `'grindy'`/`'max effort'` mean it was a genuine grind, not a clean on-target hit. Reusing `verdictForRpe` directly means Phase 2's classification can never silently drift from what `computeSetAdjustment` already calls "on target" for the exact same input — one definition, not two.

**Data-sufficiency gate** (mirrors `insights.ts`'s `change()` — `INSIGHTS.minPerWindow: 3`):
- Fewer than 3 exposures → `action: 'pause_insufficient_data'`, `confidence: 'low'`, `reasonCodes: ['insufficient_exposure_history']`, `dataLimitations: ['insufficient_exposure_history']`, no `prescription`.

**Classification** (last 3 exposures, most recent first):
- Last 2 consecutive `onTarget` → the athlete is consistently handling the current target.
  - If the most recent exposure's `kg` is `null` (a bodyweight exercise — nothing external to add load to) → `action: 'progress_reps'`, `prescription: { reps: lastReps + 1 }`, regardless of the rep-range ceiling: a bodyweight movement's only progression axis this function knows about is reps, so the range ceiling that gates loaded exercises doesn't apply here.
  - Else if `repTopOf(currentTarget.t)` is a real number and the most recent exposure's `reps` is still below it → `action: 'progress_reps'`, `prescription: { reps: lastReps + 1 }` (double progression: climb the rep range before adding load).
  - Otherwise (loaded, and already at the top of the range, or the target has no range — a flat number or "max") → `action: 'progress_load'`, `prescription: { load: roundToIncrement(lastKg + AUTOREG.stepKg, AUTOREG.plateIncrement) }`.
- Last 2 consecutive `missed`:
  - If the most recent exposure's `kg` is `null` (bodyweight) → `action: 'hold'` — there is no load to deload and suggesting fewer reps than the movement's own floor makes no sense; a bodyweight movement that's being consistently missed is a form/readiness conversation this function has no signal for, not a number to propose. `dataLimitations: ['no_load_to_deload']`.
  - Else → `action: 'deload'`, `prescription: { load: roundToIncrement(Math.max(AUTOREG.stepKg, lastKg - AUTOREG.stepKg), AUTOREG.plateIncrement) }` — same floor pattern `nextWorkingWeight`'s own recovery-ease already uses, so a deload can never suggest zero or negative weight.
- Anything else (mixed) → `action: 'hold'`, no `prescription`.

This means `progress_load` and `deload` both read `kg` from the MOST RECENT exposure only (`recent[0]`, i.e. `lastExposure`), not an average or a different exposure in the streak — the suggested number is always "one step from what was just lifted," matching `nextWorkingWeight`'s own single-step philosophy (`AUTOREG.stepKg`) rather than inventing a different step size for this new function.

`confidence` is `'high'` whenever the gate passes (3+ real exposures is real signal); `'medium'` is reserved for a future phase with more signal sources — Phase 2 doesn't need the third tier yet, but the type already has it, so this is a real, not simulated, choice: use `'high'` here now, don't invent a fake `'medium'` case just to exercise the enum value.

`safetyState` is `'approved'` in every branch. No first-party pain/fatigue signal exists for strength training today — `mechanicalCompletion`/`pain_stop` is a `CondResult` field (conditioning only); there is nothing analogous on a lift's `LoggedSet`. Reporting anything other than `'approved'` here would be inventing a safety signal that doesn't exist yet, which is exactly the failure mode §15 of the parent audit warns against. This is a real, current limitation, not an oversight — worth a line in `handoff.md` when this ships, since it's the reason Phase 2 can't yet hold a suggestion the way Phase 1's pain-stop wiring holds a conditioning prescription.

## UI: the first opt-in-suggestion element in either app

Confirmed by survey: neither app has any existing "tap to apply a suggestion" affordance — today the Logger's weight field is prefilled and freely editable, with a note explaining its provenance, but there's no separate accept/apply action anywhere. This is genuinely new UI territory, so keeping it as small as possible:

**Where:** `Logger.tsx`, both apps — the same screen already showing `earned.note`. Compute `decideStrengthProgression(ex.name, sessions, { t: st.t, rpe: st.rpe })` once per exercise (memoized alongside `earned`), for the *first non-warmup working set only* (mirrors how `earned`'s note already only shows for non-warmup sets — this stays inside that same established "only show extra context on the first real set" pattern, not a new rule).

**What renders:** only when `action` is `'progress_load'`, `'progress_reps'`, or `'deload'` (the three branches that carry a `prescription`) — `'hold'` and `'pause_insufficient_data'` render nothing new, matching Phase 1's own "silence is the right answer when there's nothing actionable to say" precedent. A single small line beneath the existing weight-field note, e.g. `"Suggested: 107.5kg (2 sessions on target) · Apply"`, where `note` is exactly `explained.note` (the pure text already computed by the engine — no UI-side string composition of the "why," continuing Phase 1's lesson about not discarding the computed reason) and `"Apply"` is a small tap target.

**What "Apply" does:** writes `explained.prescription.load`/`.reps` into the SAME local component state the athlete's own typing already writes to (`v1`/`v2` in both apps) — it is not a separate write path, not a settings mutation, and the athlete can still edit the field further after tapping Apply, exactly as if they'd typed the suggested number themselves. Nothing is recorded as "the suggestion was accepted" — no new field, no telemetry, matching this project's stated no-tracking-beyond-what's-needed discipline throughout Phase 0/1.

## Testing

**Decision-table suite** (the acceptance bar: "50+ scenarios, à la `computeSetAdjustment.json`"): `packages/engine/test/golden/decideStrengthProgression.json` + a loop test in `golden.test.ts`, following the exact convention `computeSetAdjustment.json` already established (672 scenarios, `{in..., out}` pairs, one `for` loop, `toEqual`). This is a NEW fixture file for a NEW function — not touching any existing golden fixture, so the "golden suite untouched" rule for every *other* function stays intact; this suite is additive, for code that doesn't exist yet.

Scenario coverage across: exposure count (0, 1, 2, 3, 5+), consecutive-on-target streak lengths (0, 1, 2, 3+), consecutive-missed streak lengths (same), mixed patterns, rep-range width (flat target, narrow range, wide range, "max"), already-at-rep-top vs mid-range, bodyweight exercises (no `kg`), and boundary cases around the on-target/missed RPE classification band.

**Behavioral tests** (small, named, prose-commented — the `autoreg.test.ts`/`conditioning.test.ts` convention, for the handful of properties a data table doesn't naturally express): the deload floor never goes below `AUTOREG.stepKg`; `prescription` is always absent on `hold`/`pause_insufficient_data`; the function never reads or writes `settings` (proving it's genuinely stateless — pass the same `sessions` array twice, confirm identical output).

**UI tests:** one react-smoke scenario per app-equivalent (web: Playwright; mobile: RNTL, matching Phase 1's split) proving the suggestion line appears with the right text after 2 seeded on-target sessions, and that tapping Apply writes the suggested number into the weight field without touching `settings.liftProgress`.

## Out of scope for this slice

- Any change to `nextWorkingWeight`, `computeSetAdjustment`, or their golden fixtures.
- Any new `Settings` field.
- A pain/fatigue safety signal for strength (doesn't exist yet — separate future work, not silently faked here).
- `substitute_exercise` and `repeat_session` (two `ProgressionAction` values Phase 0 already defined but this decision function has no evidence to ever emit — leaving them unused here is honest, not a gap: nothing in this slice's inputs could justify either).
- Any UI beyond Logger (no Planner surfacing — §14 lists it as optional, Logger alone satisfies "shows an opt-in suggestion").
