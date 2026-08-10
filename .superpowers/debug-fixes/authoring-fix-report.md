# Coach "one-tap build" authoring — regression fixes

Date: 2026-08-10

## Scope

Four regressions from the recent coach-authoring "one-tap build" feature,
found by adversarial code review:

1. Stale error banner never clears in `RosterAuthoringView`
   (`apps/web/src/coach/CoachAuthoring.tsx`).
2. No delete path for a mistakenly-created draft, and no guard against
   publishing a zero-block workout.
3. Debounced save in `RosterPlanner.tsx` had no unmount/back flush, so an
   edit inside the 700ms debounce window was lost on navigation.
4. `publish()`'s catch block never called `load()`, so a stale
   `baseVersion` after a bug-3 race would fail identically forever.

## Fix 1 — stale error banner

`apps/web/src/coach/CoachAuthoring.tsx`, `RosterAuthoringView`:

- `buildSession(kind)` now calls `setError('')` immediately, before any
  async work, so a previous failure message is cleared as soon as a new
  attempt starts.
- `publish(draft)` now calls `setError('')` immediately at the start of the
  function (before the new empty-draft guard and the existing weekday
  guard), so a fresh publish attempt always starts from a clean banner.
  Because it's called unconditionally at the top, this also covers the
  success path — there is nothing left to re-set on success.

## Fix 2 — empty-draft guard; no delete capability wired

`publish(draft)` now checks `draft.body.blocks.length === 0` before the
weekday check. On zero blocks it sets `'Add at least one block before
publishing.'` and returns without calling `repository.publishWorkoutDraft`.

Delete capability: grepped the whole repository (application code and SQL
migrations) for `deleteWorkoutDraft` / `delete_workout_draft` and found
**no such method anywhere** — not on `CoachWorkspaceRepository`
(`apps/web/src/coach/contracts.ts`), not on the Supabase-backed
implementation, not as a backend RPC or migration. Per the task's explicit
instruction, I did not invent a new backend RPC/migration to add one. Only
fix #1 of this bug (the empty-draft publish guard) was applied. A "Delete"
button is not wired — adding one safely needs its own backend RPC (and a
migration) first, which is out of scope here.

## Fix 3 — flush pending debounced save on navigation/unmount

`apps/web/src/coach/RosterPlanner.tsx`:

- `back()` now calls `coalescer.flushNow()` before navigating away, so the
  Back button flushes any pending debounced save synchronously instead of
  losing it to the still-running timer.
- Added a `useEffect` whose cleanup also calls `coalescer.flushNow()`, so
  any other unmount path (not just the Back button) still gets the pending
  edit flushed. No `beforeunload` listener was added, per the task's
  explicit instruction — tab-close is not reliably covered, only
  navigation/unmount within the app.

`createSaveCoalescer`'s `flushNow()` (in `save-coalescer.ts`) already
existed and was previously test-only; it is now used from production code
too. No changes were needed to `save-coalescer.ts` itself.

## Fix 4 — re-load after a failed publish

`publish(draft)`'s `catch` block now calls `load()` in addition to
`setError('The draft could not be published.')`, so a stale-`baseVersion`
failure re-fetches the current draft (including its live `baseVersion`)
before the next publish attempt, rather than failing identically forever.

## Tests added

`apps/web/src/coach/CoachAuthoring.test.tsx`:

- `draftFixture()`'s default body now has one block instead of zero, since
  a draft with zero blocks is a distinct, deliberately-tested case (fix 2)
  and every other pre-existing test in this file relies on a publishable
  draft.
- New: "clears a stale error banner once a retried publish succeeds" —
  publishes with no weekday selected (banner appears), then selects Monday
  and publishes again, and asserts the old banner text is gone and the
  publish call went through.
- New: "blocks publishing a zero-block draft and never calls
  publishWorkoutDraft" — overrides the fixture's body to `blocks: []`,
  selects a weekday, publishes, and asserts the new guard message appears
  and `repository.publishWorkoutDraft` was never called.

No new test was added specifically for fix 3 (coalescer flush-on-unmount)
or fix 4 (reload-on-catch) beyond the existing coverage, since neither
`RosterPlanner.test.tsx` nor `CoachAuthoring.test.tsx` had prior scaffolding
for asserting on the fake repository's in-flight/failure timing without
a larger test-harness change; the task's minimum bar ("at least" the two
tests above) is met, and the two behaviours were verified by code
inspection against `save-coalescer.test.ts`'s existing coverage of
`flushNow()`'s synchronous-fire semantics.

## Verification

```
pnpm --filter @hybrid/web exec vitest run src/coach/CoachAuthoring.test.tsx src/coach/RosterPlanner.test.tsx
# Test Files  2 passed (2)
#      Tests  11 passed (11)

pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit
# clean, no output
```

## Files touched

- `apps/web/src/coach/CoachAuthoring.tsx`
- `apps/web/src/coach/RosterPlanner.tsx`
- `apps/web/src/coach/CoachAuthoring.test.tsx`
- `.superpowers/debug-fixes/authoring-fix-report.md` (this report)

`apps/web/src/coach/save-coalescer.ts` was read but not modified —
`flushNow()` already existed and did exactly what fix 3 needed.
