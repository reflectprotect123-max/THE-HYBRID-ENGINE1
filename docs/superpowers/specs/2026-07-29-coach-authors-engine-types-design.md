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

## Interface design

Five new controls land in an editor that is already dense: `Editor.tsx` is 455
lines and `ExerciseCard.tsx` 254. Adding five fields to every card would be the
single most likely way to make this change a downgrade.

**Audit result first.** The existing coach editor was checked against the
ui-ux-pro-max ruleset — accessibility, forms, React, dark-mode contrast,
touch targets, motion. It found **nothing to fix**. Every placeholder-carrying
input already has an `aria-label`; list keys are stable movement names, not
indices; `:focus-visible` draws a 2px gold outline and
`prefers-reduced-motion: reduce` collapses transitions to 0.01ms, both in
`tokens.css`. The rules below are therefore the standard the *new* controls
must meet, not repairs to old ones.

### Progressive disclosure, because the card is already full

The common path stays primary: a set is a target and an RPE, and that is what
the card shows. `mode` and `tempo` are per-exercise and rarely changed, so they
live behind a disclosure on the exercise header rather than as two more cells in
every set row. The rule this follows is the ruleset's own — *progressive
disclosure; do not overwhelm upfront* — and it is also why `mode` was
originally inferred rather than asked for. Making it explicit must not make it
loud.

### The superset control is a link, not a field

`ssNext` is rendered **between** two exercise cards, not as a checkbox inside
one. This is not a style preference: it is what the data means. The engine's
comment on `ssNext` describes a chain from one movement to the *next*, and this
repo already learned the distinction once — commit `eee00f0`, "Superset is a
chain BETWEEN two movements, not a row inside one". A checkbox inside a card
would reproduce exactly the model the block-level flag already got wrong.

The control therefore sits in the gap between cards, is absent after the last
card (a link from the final exercise points at nothing), and reads as a join
rather than a property.

### Warm-up and text blocks

A warm-up toggle belongs on the **block**, not the exercise, because that is
where `warmup` lives in the engine and because the rule it carries — nothing
inside counts toward anything earned — is a block-level truth.

A text block has no sets, so its card is a heading and a textarea. It must not
borrow the exercise card's chrome, which would imply structure the block
deliberately does not have.

### Standing constraints these must not break

- Every new input carries an `aria-label`, matching the house convention the
  audit confirmed is already universal here.
- A warm-up set's RPE cell already renders `—` rather than an editable RPE. New
  controls follow the same disabled-state clarity: if it does not apply, it does
  not look editable.
- Touch targets stay ≥44px on coarse pointers. `checks/web-touch.mjs` measures
  this under both pointer emulations and will fail the build if a new control
  regresses it, so this needs no vigilance — only no exemptions.
- No emoji as icons.

### One thing the tool got wrong, recorded so nobody re-runs it

Its `--design-system` generator returned "Webinar Registration" as the pattern
and "Exaggerated Minimalism" — a fashion and agency-landing-page style — with a
generic slate/green palette. That output is for greenfield marketing pages and
would fight `packages/design` directly. It was discarded. Use the tool here for
targeted rule queries (`--domain ux`, `--stack react`) and for its pre-delivery
checklist; do not use it to generate a design system for this app, which
already has one.

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
