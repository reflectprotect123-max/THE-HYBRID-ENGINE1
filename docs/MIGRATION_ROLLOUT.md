# Ecosystem migration and rollback runbook

This is the release gate for the separate Strength and Conditioning
products. The migration is additive and the legacy `app_state` row remains the
rollback bridge.

## 1. Stage it

1. Create a Supabase staging project or use a disposable branch of the existing
   project.
2. Apply `supabase-schema.sql` if the project is empty, then apply
   `supabase/migrations/20260804_fitness_ecosystem_contracts.sql`.
3. Confirm the four new tables have RLS enabled and that anonymous requests
   cannot select or execute ecosystem writes.
4. Create two test accounts and install both product builds.

## 2. Exercise compatibility

Run this matrix before enabling the feature flag for real users:

| Scenario | Expected result |
|---|---|
| Strength writes while Conditioning is offline | Conditioning data is unchanged when it reconnects |
| Conditioning writes while Strength is offline | Strength data is unchanged when it reconnects |
| The same event is retried | One `athlete_events` row remains |
| An older snapshot arrives after a newer one | The lower revision is ignored |
| A workout is deleted in one product | Its tombstone prevents resurrection in the other product |
| Legacy app opens after ecosystem writes | It still reads the legacy `app_state` bridge |
| App is deleted and reinstalled | Authenticated server data can be pulled back |
| A sync read is denied or fails | No client performs a destructive overwrite |

The static checks cover the contract shape. These scenarios require a staging
round-trip with real authenticated users and are not simulated by local unit
tests.

## 3. Enable the canary

Set the flag only in a staging/canary deployment:

```text
VITE_HYBRID_ECOSYSTEM_SYNC=1
EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC=1
```

Keep the legacy `app_state` read and dual-write path enabled. Monitor sync
errors, duplicate events, stale-revision rejections and missing records for a
complete offline/online cycle before expanding the cohort.

The Coordinator remains the only writer of persisted weekly plans. Do not
publish a plan from a product client until the approved canonical writer or
Coordinator service is in place.

## 4. Rollback

If a canary shows data loss, unexpected duplication or a migration error:

1. Turn off both ecosystem feature flags and release the configuration change.
2. Keep the new tables intact; do not drop them while diagnosing the issue.
3. Confirm the legacy `app_state` row is still being read and dual-written.
4. Export affected accounts before attempting repair.
5. Compare the legacy row, domain snapshots and event keys. Restore only with
   an explicit backup and a user/account-level review.
6. Re-enable the ecosystem flag only after the failing compatibility scenario
   has a regression test and a staging rehearsal.

Rollback is a configuration change, not a destructive database migration.
There is no `drop table` step in this runbook.

## 5. Production release gate

Production requires all of the following:

- Staging RLS and authenticated RPC round-trips pass.
- Old mobile builds cannot erase newer fields or domain partitions.
- Conditioning BLE, GPS, Concept2, permissions and deep links pass on real
  devices.
- Separate EAS project IDs and signing credentials exist for Conditioning.
- Account deletion/reinstall and offline conflict tests pass.
- A rollback owner and monitoring window are named.
- Clinical/product review has approved the pain and illness UX language.

Do not treat a green TypeScript build as approval to apply the migration or
submit either app to a store.
