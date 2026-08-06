# Duplicate Workout — design

## Problem

Authoring a new week's workout from scratch through the guided builder, when it's really "last week's workout with a few numbers changed," is unnecessary friction. No duplicate/clone action exists anywhere in Library today.

## Design

### `duplicateWorkout(w)` — new pure function, `packages/engine/src/session.ts`

Mirrors the existing `duplicateExercise()` precedent (`session.ts:113-121`) one level up: shallow-copy the record, mint fresh ids, deep-copy mutable nested state, clear anything that was positional/contextual to the original.

```typescript
export function duplicateWorkout<S extends AnySet>(w: Workout<S>): Workout<S> {
  return {
    ...w,
    id: uid(),
    name: (w.name || 'Session') + ' copy',
    blocks: w.blocks.map((b) => ({
      ...b,
      id: uid(),
      ...(('exercises' in b) ? { exercises: b.exercises.map((ex) => ({ ...ex, id: uid(), sets: ex.sets.map((s) => ({ ...s })) })) } : {}),
    })),
    days: undefined,
    dates: undefined,
    updatedAt: Date.now(),
    _rev: undefined,
    sample: undefined,
  };
}
```

Decisions worth calling out (confirm at plan-writing time against the real `Block`/`StrengthBlock`/`CondBlock`/`TextBlock` shapes — the sketch above is illustrative, not final):

- **Fresh ids all the way down** (workout, each block, each exercise), not just the top-level workout id. Blocks/exercises are addressed by array index in every editor mutation surveyed (`Planner.tsx`'s `edit()`, `GuidedBuilder.tsx`'s `commitBlock()`), so a same-run id collision within the same array wouldn't corrupt anything functionally — but ids are still used as React keys and the sync layer's per-record identity, so regenerating them is cheap hygiene, matching `duplicateExercise`'s own precedent.
- **`days`/`dates` cleared.** A clone shouldn't silently inherit the original's scheduled slot(s) — that would double-book the same weekday with two workouts until the athlete manually re-assigns. The clone starts unscheduled.
- **`_rev`/`sample` cleared, `updatedAt` refreshed.** `_rev` is sync-layer bookkeeping specific to the original record; `sample` is an unused flag today but shouldn't be silently inherited if ever populated later. `updatedAt: Date.now()` matches `addWorkout()`'s existing pattern for brand-new records.
- **Name gets a " copy" suffix**, not left identical — otherwise two identically-named cards are indistinguishable in the Library list until expanded.

### UI — "Duplicate" button on each Library row, both apps

Alongside the existing Edit/Delete affordances (`Library.tsx`, both apps — `Card` row rendering around line 150-208 web / 143-201 mobile). On tap:

```typescript
function duplicate(w: Workout) {
  const copy = duplicateWorkout(w);
  update((draft) => { draft.workouts.push(copy); });
  nav(`/planner/${copy.id}`); // mobile: nav.navigate('Planner', { id: copy.id })
}
```

Routes straight to **Planner**, not GuidedBuilder — confirmed via survey that GuidedBuilder can't be opened pre-populated with existing content (append-only wizard), while Planner already loads and free-form-edits a full existing Workout, including its name field. This is the flow that actually delivers "clone Week 3, tweak the numbers into Week 4."

## Scope

**In scope:** the pure function, one button per Library row per app, routing to Planner.

**Out of scope:** no engine contract change, no new `Workout` field — the type already supports everything a duplicate needs. No change to Planner or GuidedBuilder themselves; both consume ordinary Workout records already.

## Files touched (expected, confirmed at plan-writing time)

- Modify: `packages/engine/src/session.ts` (new `duplicateWorkout`)
- Modify: `packages/engine/src/index.ts` (export)
- Modify: `apps/web/src/screens/Library.tsx` (button + handler)
- Modify: `apps/mobile/src/screens/Library.tsx` (button + handler)
- Test: engine unit test for `duplicateWorkout` (id freshness, deep-copy independence from original, days/dates cleared); a smoke/RNTL scenario per app (tap Duplicate, land on Planner with the cloned content, edit doesn't touch the original).

## Sequencing note

Queued behind Phase 2 (`Logger.tsx` isn't touched by this plan, but keeping one feature branch's SDD cycle finished before starting the next avoids stacking uncertain background work). Also behind the set-timer plan, in whichever order they're picked up — the two don't conflict with each other (timer touches `Logger.tsx`, this touches `Library.tsx`), so their relative order doesn't matter, only that both wait for Phase 2's merge to `main` first.
