# Sync / concurrency fix group — report

Date: 10 August 2026
Scope: `apps/mobile/src/cloud/{sync.tsx,ecosystem.ts,whoop.tsx}`,
`apps/web/src/cloud/{sync.tsx,ecosystem.ts}`, `apps/mobile/test/syncHarness.tsx`,
`apps/mobile/src/cloud/sync-merged.test.tsx` (reworked),
`apps/mobile/src/cloud/whoop.test.tsx` (new).

All five bugs were fixed. No fix turned out to need a rewrite of the sync
protocol; the largest change is the push serialisation (bug 5), which is
contained to one ref and one wrapper around the existing push body.

---

## Bug 1 — nutrition's local revision base never advanced after a push

**What the code actually does.** `pushEcosystem` builds `outbound` — the
namespace WITH the nutrition partition, whose revision is derived from
`nutrition.base?.partitions.nutrition` — pushes it, and returns `namespace`,
which is the training-only copy. The comment above it is correct about *why*:
the caller stores the return value in `EngineDB.ecosystem` and `cloudFp` hashes
that, so a nutrition partition in there would push the whole training blob on
every meal. So the constraint on the RETURN-INTO-EngineDB path is real.

The locally-cached "what the server holds" value is `remoteNamespace.current`,
a ref — not part of `EngineDB`, not hashed by anything. It was written in
exactly one place: the pull, in `reconcile`. The training partitions do not need
this because their revisions live in `EngineDB.ecosystem`, which the push
already refreshes via `update((draft) => { draft.ecosystem = pushed; })`.

**Fix.** `EcosystemPushResult` gained a third field, `nutrition?:
VersionedSnapshot<unknown>` — the nutrition snapshot the push actually put on
the wire. It is deliberately NOT merged into `namespace`, so the EngineDB /
`cloudFp` constraint is untouched. `runPush` records it onto
`remoteNamespace.current` (ref only) when the write was accepted, i.e. when
`stale` does not name `nutrition`. Same change, same shape, in the web file and
its `ecosystem.ts`.

**Correction to the bug report's failure description.** The report says the
server "silently refuses every subsequent nutrition write". Traced against
`supabase/migrations/20260807_nutrition_domain.sql`, the guard is

```sql
where revision < excluded.revision
   or (revision = excluded.revision and client_updated_at <= excluded.client_updated_at)
```

so a second same-session push at the *same* revision with a *later*
`client_updated_at` is ACCEPTED, not refused. The real observed failure is
therefore:

* the nutrition revision stops advancing for the whole foreground session
  (5 → 6 → 6 → 6 …), which disables the optimistic-concurrency guard and
  degrades it to a whole-snapshot last-timestamp-wins overwrite; and
* it *does* become an outright refusal (`stale` → the bug-2 path) as soon as any
  other writer lands the same revision with a later stamp.

The second is the data-loss case — a cross-device whole-blob overwrite — and it
is what the fix removes. Post-fix, revisions climb strictly (test asserts
5 → 6 → 7).

## Bug 2 — refused push stamped `syncedAt`

`setSyncedAt(Date.now())` inside the `if (stale.length)` branch is gone.
`Settings.tsx:526/533` already renders `syncedAt` as "Last synced …" and `error`
as a live-region error line, so the existing `error` state is what the refusal
now uses (`REFUSED_PUSH`). No new UI state was invented.

`pushNow` now returns `Promise<boolean>` (false = the server refused part of the
snapshot). `reconcile` gates its own trailing `setSyncedAt` on that, otherwise
the refusal message would have appeared next to a fresh "Last synced" stamp
anyway. Callers that used `void pushNow(...)` are unaffected.

## Bug 3 — schema mismatch was caught on read, not on write

`reconcileNutrition`'s `catch` returned `false` ("no push owed"), but the push
arms independently off `nfp !== lastNutritionFp.current` and `carryNutrition`,
which is true whenever a remote partition exists. So the older local slice was
still pushed, on the newer remote partition's revision.

**Fix.** A `nutritionSchemaBlocked` ref, set in that `catch`, cleared on any
clean merge (and when the server has no partition at all), reset on sign-out.
`carryNutrition` is `&&`-ed with `!nutritionSchemaBlocked.current`, so
`pushEcosystem` is called with no nutrition payload at all and the push loop
skips the domain (`if (!domain) continue`) — the nutrition row is not written in
any revision. The athlete gets `NUTRITION_SCHEMA_MISMATCH` ("This app version
can't read a newer nutrition update — update the app to sync nutrition again").
Training sync around it is unaffected, as before.

Note the block is *sticky for the session* until a merge succeeds — a later meal
in the same session does not re-open the path. That is covered by its own test.

## Bug 4 — a WHOOP poll dirtied the training fingerprint

`recordDaily` now compares the incoming shared-core row against the stored one
field by field (`sameWhoopRow`) and returns before `draft.core = { …,
updatedAt: Date.now() }` when nothing changed. Field-wise rather than
`JSON.stringify`, because the stored row has been through `sanitizeSharedCore`
(explicit `null`s, `source` defaulted to `'whoop'`) while the freshly built row
can carry `undefined` — a structural compare would call that a change on the
first poll after a cold start.

The `draft.settings.whoopDaily` write above it is left as it was: `cloudFp`
already excludes `settings.whoopDaily`, so it cannot arm a push, and touching
that line was outside the fix.

## Bug 5 — debounced push racing a reconcile's push

`reconcile` had an in-flight guard; `pushNow` had none, and the 900 ms debounce
calls it directly.

A "drop it if one is running" flag is the wrong shape here: dropping the
debounced push loses an athlete's write that nothing re-arms, and dropping the
reconcile's push loses the one that must land. So `pushNow` is now a thin
wrapper that chains onto `pushQueue.current` (a ref holding the previous push,
rejection-scrubbed so the queue itself can never reject — the failure still
reaches the caller that asked for that push). The push body moved to `runPush`,
and every read of local state (`cloudFp(dbRef.current)`, `nutritionFp(...)`, the
fingerprint short-circuit) happens inside it — so a push that waited its turn
sends what the app holds when it *runs*, including whatever a reconcile merged
in while it waited.

Consequences checked: `reconcile` awaits `pushNow` while holding its own
`inFlight` flag, and the queue is linear, so there is no deadlock; a queued push
whose content is already recorded no-ops on the fingerprint check instead of
double-pushing; `buildPushState(source, knownRemote)` with a slightly stale
`knownRemote` cannot lose unrelated `app_state` keys, because the earlier push
in the queue was written from the same base plus `hybridEngine`.

---

## Tests

`apps/mobile/src/cloud/sync-merged.test.tsx` no longer mocks `./ecosystem`. The
old mock (`pullEcosystem: async () => null`, hardcoded `stale: []`) hid every
line the bugs above lived on. It now runs the real module with
`EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC=1` against a fake server in
`apps/mobile/test/syncHarness.tsx` that adds `athlete_core`,
`athlete_domain_snapshots`, `athlete_weekly_plans` and the three RPCs —
including `upsert_athlete_domain_snapshot`'s real monotonic predicate and its
boolean return. `resetServer()` also wipes the device now: jest gives a registry
per FILE, not per test, so the MMKV shim leaked one test's meals into the next.

New/changed tests, each verified to FAIL with its fix reverted and pass with it:

| Test | Reverted fix it catches |
| --- | --- |
| advances the nutrition base after a push … | bug 1 (asserts revision 5→6→7, no refusals, both meals on the server) |
| does not claim a sync when the server refused the push | bug 2 (`syncedAt === 0`, error shown) |
| a nutrition schema mismatch blocks the nutrition PUSH, not just the merge | bug 3 |
| keeps the nutrition push blocked for later writes in the same session | bug 3 (stickiness) |
| serialises pushes, so a debounced push cannot overlap a reconcile's own | bug 5 |
| whoop: does not touch core — or the sync fingerprint — when the poll learns nothing new | bug 4 |

The four pre-existing merged-app tests were kept; the one that asserted the
writer identity off the mock now reads it off the fake server's accepted rows.

### Where the test rigour was reduced, and why

* **Bug 1** is driven through the 900 ms debounce with fake timers, on purpose:
  `syncNow` would refresh the base from the server and hide the very thing under
  test. A refusal was NOT asserted, because (see the correction above) the real
  guard accepts the stale-revision re-push on the timestamp tiebreak; the
  assertion is on the revision sequence and on the merged content.
* **Bug 2** puts the refusal in front of the client with an explicit
  `mockEcosystem.refuse` set rather than by constructing revision arithmetic
  that loses. The arithmetic is exercised for real in the bug-1 test; this test
  is about the client's handling of a `false` return.
* **Bug 5** asserts the *serialisation property* (`push:start` /
  `push:state-written` never interleave in the server log), not the data loss.
  The data-loss variant is not reproducible from outside the provider: both
  pushes read `dbRef`/`nutritionRef` when their turn comes, so once they are
  ordered they necessarily carry the same merged slice, and before the fix the
  gated push resumed holding the already-merged ref too. The overlap itself is
  what the guard exists to prevent and is what is asserted; the test does also
  assert the other device's entry is still on the server afterwards.

### Verification run

* `pnpm --filter @hybrid/mobile exec jest src/cloud` — 13 passed (2 suites).
* `pnpm --filter @hybrid/mobile exec jest` — 328 passed (32 suites).
* `pnpm --filter @hybrid/web exec vitest run src/cloud` — 36 passed, 2 skipped
  (`sync-e2e.live.test.ts` is `SB_E2E`-gated).
* `pnpm run test` — whole workspace green.
* `pnpm run typecheck` — clean.
* `pnpm run check:ecosystem` — all static contract checks pass.
* `pnpm --filter @hybrid/web build:strength` — built.

Nothing was pushed and no migration was run.
