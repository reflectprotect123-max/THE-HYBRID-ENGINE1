# The coach builder authors engine types

**Status:** design, approved in outline · **Date:** 2026-07-29
**Sub-project C of five.** See "Where this sits" at the end.

---

## The problem

`apps/coach/src/model.ts` (427 lines) defines a second, parallel description of
what a training session is — `CoachSession` / `CoachBlock` / `CoachEx`, with
short keys (`h`, `ex`, `ss`) inherited from before the migration — and converts
it to the engine's types at publish time.

The cost is not the conversion. It is that **the copy has fallen behind the
original**, and every gap is a thing the athlete app can express and the coach
builder cannot:

| Missing from the builder | Evidence in `model.ts` |
|---|---|
| Warm-up blocks | no reference to `warmup` |
| Text blocks (metcons) | no reference to `'text'` |
| Per-exercise supersets (`ssNext`) | no reference; only the block-level `ss` flag |
| Explicit exercise `mode` | "The coach never picks a mode — it is inferred from what they wrote" |
| `tempo` | no field on `CoachEx` |

The block-level flag is the sharpest illustration. The engine's own comment on
`ssNext` says a single all-or-nothing flag cannot express "bench paired with
dips, then three straight sets" — which is why per-exercise linking was added.
The coach builder never got it.

This gap widens on its own. Every future engine field is one more thing the
builder silently cannot author, and nothing fails when that happens — the
session simply arrives at the athlete missing something the coach believed they
had written.

## What we are building

The coach builder authors **engine types directly**. After this, anything the
athlete app can log, the builder can plan.

### What `model.ts` keeps

It does not disappear. The engine has no concept of a *programme* — that
scaffolding is legitimately coach-only and stays:

```ts
CoachLib   { programs: CoachProgram[]; sel: { p, w, d } }
CoachProgram { id, name, weeks: { days: (Workout | null)[7] }[] }
```

What goes is the parallel *session* shape. A day slot holds an engine `Workout`
(whose `blocks` are engine `Block`s), not a `CoachSession` of `CoachBlock`s.

### What `sessionToWorkout` becomes

Near-identity: stamp `id`, `name`, `dates`, return the blocks unchanged. This is
the point of the change — a translation layer is exactly where "the coach wrote
it but the athlete never got it" bugs live, and there is no longer a translation
to get wrong.

**The emit boundary does not move.** `emit.ts` and `FORBIDDEN_SET_KEYS` still
reject a planned set carrying logged fields. That guard is not made redundant by
this work; it is the thing that stays true while the shapes converge.

### `PlannedSet` stays exactly `{ t, rpe }`

A prescribed **load** still has no field of its own and still lives in `cue`.

This is deliberate and is the main thing this design declines to do. Giving load
a real field means changing `PlannedSet`, which two suites and
`FORBIDDEN_SET_KEYS` exist to hold, because the moment a coach-authored set can
carry an `aVal`, publishing a plan can overwrite an athlete's logged work. That
is a contract change with a migration, and it deserves its own spec — not a
side-effect of a refactor.

### Migration

`migrateLib` already runs on every load and already sanitises defensively. It
gains one shape conversion: old short-key `{ h, ex, ss }` → engine
`StrengthBlock`.

It is **best-effort and lossy by permission**. There is no coach programme data
worth preserving (confirmed with the owner), so the rule is: convert what
parses, drop what does not, never throw. A malformed blob returns `emptyLib()`,
exactly as today.

## Components

| File | Change |
|---|---|
| `apps/coach/src/model.ts` | Session half deleted; programme scaffolding kept; `migrateLib` gains shape conversion |
| `apps/coach/src/editor/ExerciseCard.tsx` | Gains `mode` select, `tempo`, `ssNext` toggle |
| `apps/coach/src/Editor.tsx` | Gains warm-up block toggle and a text-block card |
| `apps/coach/src/store.tsx` | Unchanged shape of responsibility; stores engine-shaped objects |
| `apps/coach/test/model.test.ts` | Repointed from translation to migration + emit contract |

The athlete Planner already renders every one of these controls. Its patterns
are the reference; this is not new interaction design.

## Data flow

Unchanged. Coach library → `localStorage` (`hybrid-coach-v1`) → publish →
`assignments` row → `materializeAssignment` → athlete. The only difference is
that the object in `localStorage` is engine-shaped.

Coach programmes still do not sync. That is sub-project B and explicitly out of
scope here.

## Error handling

- `migrateLib` must never throw. Malformed input → `emptyLib()`.
- `sanitizeDB` remains the athlete-side trust boundary for shape; nothing about
  this change relaxes it.
- A published session still passes the emit contract or is rejected outright,
  rather than being quietly stripped.

## Testing

`apps/coach/test/model.test.ts` currently pins the translation layer. Those
assertions are repointed rather than deleted — the behaviours they protect
(a logger-owned field cannot reach an athlete; a session survives a round trip)
remain true and still need holding.

New coverage, one test per newly-authorable thing:

1. A coach-authored **warm-up block** publishes, and on the athlete side
   contributes nothing to tonnage, e1RM or earned working weight — asserted
   through the engine's existing guarantees, not re-implemented.
2. A **text block** publishes with its body intact and contributes nothing
   measurable.
3. **`ssNext`** survives publish, and `ssGroups` chains the pair on the athlete
   side.
4. **`mode`** is now carried explicitly rather than inferred.
5. **`tempo`** survives publish.
6. `migrateLib` converts a legacy short-key blob, and returns `emptyLib()`
   rather than throwing on a corrupt one.

Plus the standing gate: a planned set still cannot carry logged fields.

## Risks

- **Editor components are the real surface**, not `model.ts`. `Editor.tsx` is
  455 lines and `ExerciseCard.tsx` 254; the block-kind branching lands there.
- **Silent authoring loss during the cutover.** If a field is dropped in
  conversion, nothing fails — the session just arrives thinner than written.
  Test 1–5 above exist for exactly this, and each asserts arrival at the
  *athlete*, not merely that the coach object holds the field.
- Publishing to real athletes is not yet possible (sub-project B), so blast
  radius today is one browser.

## Where this sits

Sub-project C of five, chosen first because the owner's answer was "me now,
other athletes later" — structural duplication is cheapest to remove while there
is one user and no synced coach data.

| | Sub-project | Status |
|---|---|---|
| A | Pace & distance in the data model | later |
| B | Coach as a real multi-athlete product (sync, RLS, roster) | designed-not-built |
| **C** | **Coach authors engine types** | **this spec** |
| D | Insights maturation; move the 3 untested Dashboard note rules into the engine | later |
| E | Widen the stored WHOOP row (RHR/HRV/sleep) to unlock the detector §4 could not build | later |
