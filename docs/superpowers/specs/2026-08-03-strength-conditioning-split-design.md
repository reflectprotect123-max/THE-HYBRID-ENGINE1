# Strength / conditioning full split — design

## Problem

Today one `Workout`/`Session` type holds an ordered `blocks[]` array that can
freely mix strength blocks and a conditioning block together (the "finisher
tacked onto a lift day" pattern). Nothing marks a workout's kind up front —
`isCondWorkout()` infers "conditioning day" only when *every* block happens
to be a `CondBlock`. When a conditioning block is embedded inside a strength
session, its result (`CondResult`) is written onto that same session record
rather than living anywhere separate. This is the seam the user wants
removed, as part of splitting this into two standalone pieces of the wider
"ecosystem" (hub + independent spokes) rather than one fused engine.

## Decision: full separation, mixed blocks removed

A workout is now **one kind, decided at creation, never mixed**:

- `Workout.kind: 'strength' | 'conditioning'` — required, replaces the
  inferred `isCondWorkout()` check everywhere.
- A `'strength'` workout's `blocks[]` may contain `StrengthBlock`/`TextBlock`
  only — `CondBlock` can no longer appear inside it. The Planner's
  "+ Conditioning" block-add button is removed from the strength editor
  entirely.
- A `'conditioning'` workout is a single conditioning prescription, not a
  block array — it holds the same fields `CondBlock` has today
  (`condFmt`, `effort`, `targetZone`, `minutes`, `targetDistanceM`,
  `modality`, `device`) directly on the workout. Authored through its own
  short builder (reuses `CondBlockCard`'s fields, not the strength editor).
- `Session` mirrors `Workout.kind` the same way.

## History: one place for every conditioning result

`settings.conditioning: CondResult[]` (already exists for the standalone
case) becomes the **only** place a conditioning result is ever written,
whether the run was started from a scheduled conditioning workout or
launched ad hoc. Each entry gains an optional `sessionId` so
History/Recap can still show "this run belonged to this scheduled session."
`Session.blocks[i].condResult` is deleted — conditioning sessions carry
`condResult?` directly on the `Session`, written to both the session record
*and* `settings.conditioning` in one write (matching how strength sessions
already write to both `sessions[]` and per-exercise history today).

## Migration

Existing data may already have mixed-block workouts/sessions (a coach could
already have built a lift day with a finisher). A one-time migration, run at
DB-open time (same place existing migrations already run in
`packages/engine/src/store.ts`), splits any legacy mixed workout into two
sibling records: the original strength blocks keep the workout's name and
`days`/`dates`; the `CondBlock` becomes a new `'conditioning'`-kind workout
named `"<original name> — Conditioning"`, scheduled on the same `days`/
`dates`. A migration-version stamp on `Settings` ensures this runs exactly
once. Any existing session-embedded `condResult` is copied into
`settings.conditioning` (with its `sessionId`) as part of the same pass.

## Screens affected (both platforms)

- **Planner**: block-add toolbar drops "+ Conditioning" inside a strength
  workout; a separate "New conditioning workout" entry point (Library's
  "+ New" menu) opens the short conditioning-only builder.
- **Guided-flow builder**: `kind` becomes the very first question asked when
  creating a new workout (strength vs conditioning), not a per-block choice —
  `BlockTypeStep` inside a strength flow keeps `lift`/`warmup`/`metcon` only,
  drops `cond`.
- **Training.tsx**: no more `isCond(b)` branch inside the block list — a
  session is either the strength set-logging flow, or (kind ===
  'conditioning') the app goes straight to the `Conditioning` screen instead
  of showing a block list at all.
- **Home / Library**: `isCondWorkout(w)` inference replaced by a direct
  `w.kind === 'conditioning'` check.
- **History / Recap / Progress**: read `settings.conditioning` as the single
  conditioning source (already partly true for Progress); Recap's per-session
  view joins in any `settings.conditioning` entry matching the session's id.

## Scope

**In scope**: `types.ts` (`Workout`/`Session`/`CondResult` shape changes),
`session.ts` (drop `isCondWorkout`/mixed-block aggregation branches, keep
`isCond`/`isText` guards only where still meaningful), one-time migration in
`store.ts`, Planner/Training/Home/Library/History/Recap/Progress on both web
and mobile, the guided-flow builder's `BlockTypeStep` (drop 'cond' as a
per-block choice inside a strength flow; conditioning-only stays a top-level
workout-kind choice instead).

**Out of scope**: any change to the conditioning *runtime* itself (BLE/FTMS,
Concept2, GPS, the `Conditioning.tsx` screen's own logic) — this is purely a
container/scheduling split, not a rewrite of how a conditioning effort is
logged.

## Risk

This touches the same core types the existing header comment in `types.ts`
already flags as a load-bearing contract across web, mobile, and the
builder. Full regression pass (both platforms) and the same
migration-safety care as the Library-folders tombstone fix are required
before merge.

---

## Correction — scope narrowed during plan authoring (2026-08-03)

Research done while writing the implementation plan
(`docs/superpowers/plans/2026-08-03-strength-conditioning-split.md`) found two
things that change the shape above, not the outcome:

1. **No migration mechanism exists.** There is no `packages/engine/src/store.ts`
   and no version-stamp field anywhere in `Settings` — this doc's "Migration"
   section referenced infrastructure that was never built. `sanitizeDB`
   (`packages/engine/src/db.ts`) is the app's actual one-time-per-load shape
   boundary; the split is folded into it directly (idempotent — a no-op once
   no mixed-block record remains — so no version stamp is needed).

2. **Moving `CondResult` out of `session.blocks[i].condResult` and into
   `settings.conditioning` (the "History" section above) is dropped from this
   change entirely.** It is far bigger than it looked: `packages/engine/test/
   concept2.test.ts`'s entire suite (matching/importing synced erg/Concept2
   results) is built around a block-embedded `condResult`, as is every
   History/Recap/Progress render path on both platforms. None of that was
   part of what the user actually asked to split apart — the ask was "pull
   strength and conditioning apart," not "move where a conditioning result is
   stored." Doing it anyway would have multiplied the blast radius for no
   requested benefit. `CondResult` keeps living exactly where it does today.

**What ships instead, same outcome:** `Workout`/`Session` gain a stored
`kind: 'strength' | 'conditioning'` field. `isCondWorkout()` is redefined to
read it instead of scanning blocks (same name, same call sites, same
callers — Home/Library need no changes). "Never mixed again" is enforced at
the two places a workout is actually authored — Planner's block-add toolbar
and the guided builder's block-type choices — rather than at the type level;
`CondBlock` remains a valid `Block` union member, so `session.ts`'s
aggregation functions, History/Recap/Progress, and every `concept2.test.ts`
test are untouched. `sanitizeDB` gets a `splitMixedWorkout`/
`splitMixedSession` pass that backfills `kind` on old data and splits any
already-existing mixed-block record into two siblings, once, on load. The
"Screens affected" and "Scope" sections above describe the ambition; the
plan is the accurate source of truth for what actually ships.
