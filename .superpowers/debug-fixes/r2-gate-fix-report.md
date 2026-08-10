# R2 self-coach approval gate — adversarial-review fixes

Date: 2026-08-10
Scope: `apps/web/src/autocoach`, `apps/mobile/src/autocoach`, both `screens/Home.tsx`.

Five bugs found by adversarial review of the R2 "propose, then decide" gate.
All five are fixed, with tests. Everything below was verified against the real
code before writing — the shapes named here are the ones in the repo, not
assumed ones.

## What the code actually looks like (established first)

- `AutonomyPolicy['mode']` (`packages/auto-coach/src/types.ts:47`) is
  `'shadow' | 'assisted' | 'auto_daily'`. `DEFAULT_POLICY.mode` is `'shadow'`.
- `AutoCoachConsent` (`consent.ts`, same shape on both platforms) is
  `{ schemaVersion, version, proposalsConsent: ConsentRecord | null,
  autoApplyConsent: ConsentRecord | null, comprehensionPassed: boolean }`,
  where `ConsentRecord` is `{ accepted, at, textVersion }`. Revocation keeps
  the record and flips `accepted`, so the meaningful test is
  `consent.proposalsConsent?.accepted === true`, never `!= null`.
- `highestAllowedMode` already encodes the intended ladder: no accepted
  `proposalsConsent` ⇒ `shadow`. The receipt simply never consulted it.
- Mobile's `update` (`apps/mobile/src/store/db.tsx:154`) returns `void` and
  abandons the entire write when the draft callback returns `false`. Web's
  `update` has the same contract. There is no return value to capture, so
  success has to be recorded from inside the callback.
- A forked workout carries **no** back-pointer to its source — `planApply`'s
  `ForkPlan` produces an ordinary dated `Workout`. The only link is the ledger
  entry: `workoutId` = source, `forkedWorkoutId` = copy.

## Bug 1 (critical) — Approve worked in shadow mode with zero consent

`showDecide` was `pending?.status === 'pending'` and nothing else; the only
other gate was the card returning `null` on `policy.status === 'revoked'`. On
a fresh install — shadow mode, no consent, no comprehension quiz — the Approve
button rendered and wrote the resolved change into the store, directly
contradicting its own adjacent copy and `ModeSwitcher`'s.

Fix, both platforms, belt and braces:

- New exported pure predicate `approvalAllowed(mode, proposalsAccepted)` in
  each `SessionReceipt.tsx`: `mode !== 'shadow' && proposalsAccepted`. Mode
  alone is not enough — policy and consent are separate stores with separate
  keys and either can be restored or migrated independently.
- Render gate: `showDecide = pending?.status === 'pending' && canDecide`.
  Approve **and** Decline are withheld together — with no ability to apply
  there is nothing to decide, and a lone Decline would invite the athlete to
  "decide" something that was never going to happen.
- Handler gate: `handleApprove` re-checks via the non-hook `getPolicy()` /
  `getConsent()` reads, so a stale closure or a UI bug elsewhere cannot get
  past it. `getPolicy`/`getConsent` already existed on mobile; `getPolicy` was
  added to web's `policy.ts` and `getConsent` to web's `consent.ts` (both
  additive, mirroring the mobile files).

Chosen UI treatment: **hide, and explain**, matching this screen's existing
grammar — every other gated state here degrades by withholding a control
(`revoked` returns null, `showUndo`, `showDecide`) rather than showing a
disabled one. The footer line already carried the mode explanation, so the
explanation goes there:

- shadow: "Shadow mode — shown, never applied. The plan itself is unchanged.
  Turn on Assisted below/in Settings to approve changes."
- live but no consent: "Approving needs your consent — turn on Assisted
  below/in Settings."

("below" on web, where `ModeSwitcher` is on Home itself; "in Settings" on
mobile, where it lives on the Settings screen.)

Proposals are still raised and still displayed in shadow mode — that is
exactly what shadow mode is for. Only the ability to apply one is withheld.

## Bug 2 (mobile, and web — same code) — `recordApply` ran on an aborted write

The mutate branch returns `false` when the target is not in `draft.workouts`,
abandoning the write, but `recordApply` and `decidePending('approved')` ran
unconditionally. A workout deleted from Home or tombstoned by a sync between
render and tap produced a ledger entry and an "Applied — undo available" card
for a change that was never written, with the day's proposal burned.

Fix: a `wrote` flag set at the end of the draft callback (which never runs
after an early `return false`), checked before recording. On failure the
proposal is left `pending` — retryable — and an error line is shown.

Deviation from the brief, noted deliberately: the brief scoped this to mobile,
but web's `SessionReceipt.tsx` has the identical code and the identical bug, so
it was fixed there too. There is no existing failure-message pattern on this
screen, so a minimal one was added (`text-bad` line, same slot as the "Applied"
line). Note that in the common case the card unmounts on the next render
anyway — its workout is gone — so the message is a fallback for failures where
it survives; the load-bearing part of the fix is that nothing is recorded.

## Bug 3 (mobile only) — same-day cross-world mixup

`useDb().workouts` is scoped per world via `trainingScope(world)`, but the
pending-proposal store held **one** record and the ledger lookup matched on
date alone. With a Strength and a Conditioning session on the same day, each
world's receipt read and wrote the other's decision.

Fix, mobile only (web is single-world and was left untouched):

- `pendingProposal.ts` now holds a map keyed by `pendingKey(date,
  sourceWorkoutId)` instead of a single record. `usePendingProposals()`
  returns the whole map (referentially stable for `useSyncExternalStore`);
  `getPendingProposal(key)`, `decidePending(key, status)` and
  `withdrawPending(key)` take the key. `proposePending` prunes every record
  from another date, so the map cannot grow.
- `schemaVersion` bumped 1 → 2; a persisted v1 blob is discarded on load. Cost
  of the migration is at most one day's undecided proposal, which is
  re-proposed on the next render.
- Ledger read side scoped to `e.date === today && (e.workoutId === workout.id
  || e.forkedWorkoutId === workout.id)`. The `forkedWorkoutId` arm matters:
  after a fork apply, today's workout becomes the fork, whose id is not the
  entry's `workoutId` — without it the "Applied — undo available" state would
  vanish the moment the apply succeeded. No ledger *schema* change was needed
  (`workoutId`/`forkedWorkoutId` were already recorded), so nothing that reads
  the ledger cross-file — web's coach bench, `arc-athlete-sync` — is affected.

All call sites of the changed key shape were traced: `pendingProposal.ts` is
imported only by mobile's `SessionReceipt.tsx` and its own tests.

## Bug 4 (both) — an approved fork left two cards for one session

`planned` matched on `dates.includes(today) || days.includes(dow)`. Approving
a receipt for a *recurring* session forks a one-off copy dated today, so both
matched: two cards, and "Start today's session" attached to index 0 — usually
the un-adjusted original, silently defeating the approval.

Fix: the filter is extracted into an exported pure `plannedForToday(workouts,
ledger, today, dow)` on each platform (mirroring the existing exported
`showZonesCard` pattern) and consults the ledger, the only place the
fork↔source link exists. Walking the newest-first ledger, the first entry
naming a source workout decides its state, so an `undone` fork correctly stops
superseding and the original comes back. A ledger entry naming a fork that is
no longer in `workouts` is ignored, so a deleted fork cannot hide the original.

## Bug 5 (mobile, and web — same code) — `WeekStrip` memo dependency

`days` derived `start` and every date key from `new Date()` with deps
`[workouts, sessions]`. Left open across a week boundary, the strip kept the
old week until an unrelated store write invalidated it. Fixed by adding
`today` — the same dependency the `planned` memo above it already carries.
Web's `WeekStrip` is character-for-character the same and was fixed too.

## Tests

- `apps/web/src/autocoach/SessionReceipt.test.tsx` — `approvalAllowed` truth
  table; fresh install (shadow, no consent) offers no Approve/Decline and
  nothing reaches the store; live mode with consent revoked offers no Approve;
  Approve becomes functional once mode is live AND consent is recorded; an
  aborted write records no ledger entry and leaves the proposal pending. The
  suite's `beforeEach` now records proposals consent, since mode alone no
  longer unlocks Approve.
- `apps/mobile/src/autocoach/SessionReceipt.test.tsx` — the same gate cases,
  plus one the web suite cannot reach through its harness: revoking consent
  between render and press, proving the **handler** refuses and not just the
  button. Plus the aborted-write case, plus three same-day two-world cases
  (each world raises its own proposal; declining Strength leaves Conditioning
  decidable; approving Strength does not make Conditioning look applied). The
  `update` mock was reshaped to read the store through a getter so a test can
  make the target vanish between render and press, which is the real race.
- `apps/mobile/src/autocoach/pendingProposal.test.ts` — rewritten for the
  keyed store, including a `same-day, two worlds` block and a load() case
  proving a persisted v1 single-record blob is discarded rather than
  half-read.
- `apps/web/src/screens/Home.test.tsx` and new
  `apps/mobile/src/screens/Home.test.tsx` — `plannedForToday`: fork replaces
  original, undone fork restores it, other-date entry ignored, missing fork
  keeps the original, in-place apply unaffected. Constructing a fork fixture
  turned out to be cheap once the helper was pure, so no test was skipped.

## Verification

- `pnpm --filter @hybrid/mobile exec jest src/autocoach src/screens/Home.test.tsx` — 8 suites, 95 tests, pass.
- `pnpm --filter @hybrid/web exec vitest run src/autocoach src/screens/Home.test.tsx` — 6 files, 61 tests, pass.
- `pnpm --filter @hybrid/mobile exec jest` (full) — 33 suites, 350 tests, pass.
- `pnpm --filter @hybrid/web exec vitest run` (full) — 42 files, 281 tests pass, 2 skipped (`SB_E2E`-gated live sync).
- `pnpm run typecheck` — clean across all packages and both apps.
- `pnpm run check:ecosystem` — all static contract checks pass.
- `pnpm --filter @hybrid/web build:strength` — builds.

## Notes for whoever picks this up

- Nothing here touches the Coordinator, the specialist engines, or
  `EngineDB`. The policy, consent, pending-proposal and ledger stores remain
  additive, device-local, outside the training fingerprint.
- The mobile pending store's schema bump is the only persisted-format change.
  It is forward-only and self-healing.
- Web's `pendingProposal.ts` was deliberately **not** converted to the keyed
  map. Web is single-world; converting it would be churn on a contract that
  the coach bench and sync also live near.
