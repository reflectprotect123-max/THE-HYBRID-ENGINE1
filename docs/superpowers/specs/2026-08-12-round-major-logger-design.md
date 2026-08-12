# Round-major logger and guided builder

**Date:** 12 August 2026
**Status:** design approved, implementation not started
**Prototype:** `https://claude.ai/code/artifact/08c70f5e-f2af-488a-a9b6-48671966b761`

## What this replaces

The athlete's session authoring and logging screens, in both apps, plus the
coach bench's two crossings into them. The prototype is the target: the app
must come back as a mirror of it, proven by check rather than by eye.

Deleted, each in the same commit that switches its callers over:

| App | Files |
| --- | --- |
| `apps/web` | `screens/Logger.tsx`, `screens/Planner.tsx`, `screens/planner/*`, `screens/guided/*` |
| `apps/mobile` | `screens/Logger.tsx`, `screens/Planner.tsx`, `screens/guided/*` |
| `apps/web/src/coach` | `CoachAuthoring.tsx`'s imports of `Planner` and `GuidedBuilder` |

There is never a commit in which the app cannot log a set. Old screen and new
screen coexist for exactly the length of one commit's diff, never across one.

## Why a package, and what can actually be shared

`apps/web` is React DOM. `apps/mobile` is React Native under Expo 54. **UI
cannot be shared between them** — a `<div>` does not render on Android and a
`<View>` does not render in a browser. Any design that claims to share screens
is wrong before it starts.

What *can* be shared is `react` itself, which both apps already depend on.
Hooks contain no JSX and touch no DOM, so a hook is portable where a component
is not.

So: **one engine, two bodies.** The engine is a hook. The bodies are per-app
screens that render what the hook returns.

### `@hybrid/session-authoring`

New package. Pure TypeScript. Depends on `react` and `@hybrid/engine`, and on
nothing that resolves to `react-dom` or `react-native`.

It owns:

- the block model — prep blocks (warm-up, cool-down), strength blocks (single
  movement or superset)
- the round queue — which set is live, in which order, across a superset's
  interleaved rounds
- superset rotation — see below
- the coaching fold — plan-anchored e1RM, adjustment, the message shown on the
  live card
- draft state — the weight, reps and RPE being entered but not yet logged

Its public surface is one hook:

```ts
useSession(session: Session): {
  hot: { exercise, setIndex, coach } | null,
  rounds: RoundView[],
  rest: { left, total, kind } | null,
  draft: Draft | null,
  setDraft(patch: Partial<Draft>): void,
  logSet(): void,
  rotate(blockId: string): void,
  skipSet(): void,
  addSet(exerciseId: string): void,
  goToBlock(index: number): void,
  finish(): void,
}
```

That is the whole surface. Anything an app needs that is not on this list is a
change to the package, not a local workaround in a screen.

No component, no style, no string of UI copy that is not data.

This is the "shared authoring package" that `checks/lane-contract.mjs` names as
the retirement path for both of its remaining `ALLOWED` crossings. When the
coach bench renders its own screens on this hook instead of importing the
athlete's `Planner`, both entries are deleted and the list is empty — at which
point the athlete/coach rule becomes absolute and the list goes with it.

## Storage

`Session` and `Block<LoggedSet>` in `packages/engine/src/types.ts` are kept
exactly as they are. The nutrition and coach partitions are untouched.

Two additions to the block model:

- a piece list on prep blocks — name plus seconds or reps, so "90 s cardio of
  choice" is expressible
- a per-round order on superset blocks, recording which movement led each round

### The wipe

Existing logged sessions are **deleted**, on device and in Supabase. This is an
explicit product decision taken on 12 August 2026: the old sessions are not
worth carrying and no back-compat path is built for them.

Consequences, stated plainly because they are irreversible:

- training history is destroyed for every athlete, on every device
- e1RM anchors and progression history start from zero, so the first session
  after the wipe has no coaching memory to work from
- there is no rollback; a restore would need a Supabase point-in-time recovery
  taken before the release

Mechanically it reuses the existing "Start fresh" clear, which already handles
both the training records and the sync scaffolding (commits `9829e6c`,
`52401bc`), rather than a new destructive migration. It runs once, on first
launch of the new version.

Because nothing old is read, `sanitizeDB` gains no compatibility branch for the
previous block shapes, and none should be written "just in case".

## Superset rotation

A superset's pair order is a fact about each **round**, not about the block.

- Grab the partner movement's grip in the round you are on, pull up ~22px, and
  the pair rotates.
- Rotation applies to every round that has **not started**.
- A round with at least one set already logged keeps the order it happened in.
  That is history, not a preference, and it is not editable.
- The grip is a real button: tap and keyboard Enter both rotate. A drag-only
  affordance is unreachable without a pointer.

Everything else is untouched by a rotation — the ladder, the targets, each
movement's own opener, increment and rest.

## Carried over from the old Logger

These are not dropped. They are re-implemented against the new screens:

- screen wake lock
- the per-set timer
- the affordances row — swap, skip, add set
- the sets table
- session stats and progress

## Testing

Tests are colocated, per the repo rule: `src/x.ts` is tested by `src/x.test.ts`.

The package carries the real coverage, because it holds the real logic:

- round queue across supersets with unequal set counts
- rotation: un-started rounds move, started rounds do not
- the coaching fold — hold, back-off, one jump, full correction, `max` sets
- draft state and the log transition

Each app carries one smoke test proving its screen drives the hook.

## The greenlight gates

Nothing ships on inspection by eye. Three gates, run against every surface the
new screens reach. There are three such surfaces, not four: the coach bench is
web-only and there is no native coach app to test, per the coach-workspace rule
in `CLAUDE.md`.

| Surface | Where |
| --- | --- |
| Athlete app | `apps/web` |
| Athlete app | `apps/mobile` |
| Coach bench | `apps/web` only |

1. **Behaviour parity.** One script drives the prototype and the built app
   through an identical sequence of taps and asserts identical results: the
   same logged sets, the same coaching messages, the same rotation outcomes.
2. **Visual parity.** Screenshots of prototype and app in the same states at
   412px, diffed pixel-wise.
3. **Repo gates.** `pnpm run typecheck`, the full test run,
   `pnpm run check:ecosystem`, `checks/screens.mjs`, and `check:lanes` passing
   with an **empty** `ALLOWED` list.

A failing gate is never waived. The cause is found, the cause is fixed, the
gate is re-run. "Probably fixed" is not a state that exists — the check says so
or it does not.

## No placeholders

Shipped code carries no `TODO`, no stub screen, no mock data, no
"wire this up later". A thing is either built or it is not in the diff.

## Out of scope

- the exercise catalogue behind the movement-name field
- editing a block after it is added (the builder reopens it as a fresh add)
- conditioning, which is not a block kind here and stays with the conditioning
  engine
