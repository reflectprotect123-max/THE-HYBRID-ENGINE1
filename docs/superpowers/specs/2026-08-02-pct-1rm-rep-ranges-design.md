# % of 1RM + rep ranges — design

## Problem

The Planner/Builder has no way to prescribe a weight — weight is entirely the
athlete's own entry at log time, with `nextWorkingWeight`/autoregulation
(`packages/engine/src/lift.ts`) only ever *suggesting* a number from history.
A coach who wants to write "work up to 65% of your 1RM" or "ramp 60→65%
across these sets" has no field for it. Rep targets (`PlannedSet.t`) are
similarly always a single number for `reps_kg` mode — a rep RANGE (e.g.
"8-12") only exists today for `seconds`-mode holds ("20-30s"), never for reps.

## What this is

Two additions to how a strength exercise's sets can be authored:

1. **Rep ranges for `reps_kg` mode** — `PlannedSet.t` can be a range
   ("8-12"), not just a flat number, using the exact same `"-"`-split parsing
   `seconds` mode already has. "On target" for autoregulation purposes means
   the logged rep count is `>= lo` — hitting anywhere in the range counts,
   there is no separate "hit the ceiling" gate.
2. **% of 1RM as a weight prescription** — a new optional field,
   `PlannedSet.pct1rm?: { lo: number; hi: number }`. A flat percentage (e.g.
   "always 65%") is `{ lo: 65, hi: 65 }`; a range (e.g. "60-65%") is
   `{ lo: 60, hi: 65 }`. Computed against the engine's *existing*
   `bestE1rmByMovement` (`packages/engine/src/session.ts:521`) — the best
   logged e1RM for that movement, Epley-derived. No new "1RM" or
   "training max" field anywhere in `Settings`; nothing to keep manually
   updated.

## The RPE → % ramp

A flat `%1RM` (`lo === hi`) applies the same number to every set in the
exercise. A **range** ramps: across that exercise's rated sets (warm-ups —
any set whose `t` starts with `"W"` — are excluded entirely, same as every
other place in this app a warm-up never touches working-weight logic), find
the lowest and highest authored `rpe`. The set with the lowest RPE gets the
range's floor; the set with the highest RPE gets the ceiling; every other
rated set's % is linearly interpolated by where its own RPE falls in that
spread. If every rated set shares the same RPE (nothing to spread), they all
get the ceiling.

```
pct(set) = hi                                          if rpeMax === rpeMin
pct(set) = lo + (rpe(set) - rpeMin) / (rpeMax - rpeMin) * (hi - lo)   otherwise
```

Worked example: range 60-65%, three sets at RPE 7 / 8 / 9 → 60% / 62.5% / 65%.

This is a deliberate choice: the coach authors the range and the per-set RPE
(already a required field today), and the % ramp falls out of that
automatically — no third number to type per set. This matches how this
app's own real programs already write ascending RPE across a lift's working
sets (7 → 8 → 9 is the exact shape used throughout the FBB PUMP LIFT
program already imported into this app).

## Data model

`packages/engine/src/types.ts`, `PlannedSet`:

```ts
export interface PlannedSet {
  t: string;
  rpe: string;
  /** Weight prescription as a percentage of the movement's best logged
   *  e1RM. Absent means "no prescription — athlete's own call", same as
   *  today. lo === hi is a flat percentage; lo < hi ramps across this
   *  exercise's rated sets by where each set's RPE falls between the
   *  exercise's own lowest and highest authored RPE. */
  pct1rm?: { lo: number; hi: number };
}
```

Purely additive — no existing `PlannedSet` needs to change, no migration.
`t`'s range-parsing (already shared with `seconds` mode) is generalized to
apply when `Exercise.mode === 'reps_kg'` too; nothing about `Exercise.mode`
itself changes — this is not a new mode, it's a new optional field usable
whenever the mode is `reps_kg`.

## Builder UI

One mutually-exclusive selector per exercise (mirrors the concept art
already approved): **Reps** / **Seconds** / **% flat + reps** / **% range +
reps**. Under the hood this maps onto the fields above — the selector is a
UI convenience, not a new stored field:

- **Reps**: `Exercise.mode = 'reps_kg'`, no `pct1rm` on any set.
- **Seconds**: `Exercise.mode = 'seconds'` (unchanged from today).
- **% flat + reps**: `Exercise.mode = 'reps_kg'`, one Low/High % pair
  entered once for the exercise, written as `{ lo: pct, hi: pct }` onto
  every rated set.
- **% range + reps**: `Exercise.mode = 'reps_kg'`, one Low/High % pair
  entered once, written as `{ lo, hi }` onto every rated set (same object on
  every set — the ramp is computed at read time from each set's own RPE, not
  stored pre-computed per set).

Each set row keeps its existing Reps and RPE fields, unchanged, plus (only
when a `%` mode is selected) a read-only `%1RM` badge showing that set's
computed percentage — recalculates immediately if the set's RPE is edited.
Switching away from a `%` mode clears `pct1rm` from every set in that
exercise.

## Logger

When a set carries `pct1rm`, the target line shows the authored reps/RPE
*and* the computed percentage (e.g. "5 reps @ RPE 8 · 62.5% of 1RM"), with a
sub-line naming the source ("from your best e1RM · Back Squat 140kg"). The
Weight field prefills with that computed kg — `pct1rm × bestE1rm`, run
through the same `roundToIncrement(kg, AUTOREG.plateIncrement)`
(`packages/engine/src/lift.ts`) `nextWorkingWeight` already rounds its own
suggestion with — but stays fully editable, identical to how today's
autoregulation prefill already works: a suggestion, never a lock.

**No history for this movement yet:** `bestE1rmByMovement` has nothing to
compute from. The target line shows the reps/RPE/% as authored but the
Weight field starts blank rather than guessing — same "nothing to suggest"
behavior the app already has for a brand-new movement's first-ever set.

## Scope

**In scope:** the `pct1rm` field and its RPE-ramp computation (engine), the
four-way mode selector and per-set `%1RM` badge (Planner/Builder, both
platforms), the Logger's computed-kg prefill and target-line display (both
platforms).

**Explicitly out of scope:** a manually-entered training max (the earlier
"both, manual overrides auto" option was considered and dropped — auto-only
was the explicit choice). Rep-range "must hit the ceiling to progress" logic
(explicitly rejected — anything in range counts). Any change to how
`nextWorkingWeight`/autoregulation computes a suggestion for a *non*-`pct1rm`
set — this feature adds a new prescribed-weight path, it does not touch the
existing suggested-weight path.

## Open question carried into the plan

Whether the guided step-by-step builder (`packages/guided-flow`,
`apps/{web,mobile}/…/guided/`) gets this feature in the same pass or as a
follow-up — the guided flow is append-only, one field at a time, and a
4-way radio plus a conditional %-range pair is a different shape than its
existing steps. Worth deciding explicitly when writing the implementation
plan rather than assuming either way here.
