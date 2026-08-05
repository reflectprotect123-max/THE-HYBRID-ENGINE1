# Mobile sync — partition by product

## Problem

Strength and conditioning ship as separately-branded mobile builds (`EXPO_PUBLIC_HYBRID_PRODUCT`), but the sync layer underneath both is one shared blob: every device pulls and pushes the athlete's entire `EngineDB` — every workout and session of both kinds — regardless of which build it is. A conditioning phone ends up carrying the athlete's full strength history on-device, and vice versa. The web app is unaffected by this request: it also ships as two branded builds (`VITE_HYBRID_PRODUCT`), but that flag only drives theming there (confirmed: `apps/web/src/App.tsx` uses `PRODUCT_ID` solely for a `data-product` attribute and `aria-label`). Web's Planner/Library/Home have no data-layer product filter today, so whichever branded build you open, it already shows and edits both kinds — it is already the "sees both, program from here" surface. It needs no changes.

## Goals

- A conditioning-build phone syncs (pulls and pushes) only conditioning-kind workouts and sessions. A strength-build phone syncs only strength-kind. Neither can see the other's session data on-device after this ships.
- A workout/session with no `kind` set (never had a block authored — `isCondWorkout` already treats this as not-conditioning) syncs as strength, matching its existing default treatment everywhere else in the codebase.
- Already-installed phones, which today hold both kinds locally (no filter ever existed), converge to holding only their own kind on their next sync after this ships — without deleting the other kind's data server-side.
- Web (either branded build) keeps syncing and displaying everything, unchanged.

## Non-goals

- Not touching `settings`, `core`, or `ecosystem` (the disabled domain-snapshot layer). Only the `workouts` and `sessions` arrays are partitioned.
- Not enabling or modifying the `ECOSYSTEM_SYNC_ENABLED` domain-snapshot system (`buildProductSyncNamespace`/`applyProductSyncNamespace`, the `athlete_core`/`athlete_domain_snapshots`/`athlete_weekly_plans` tables). That system is disabled pending a staging SQL migration, and even enabled it does not isolate anything — `applyProductSyncNamespace` merges *both* domains' partitions into every device by design (it exists for write-safety across two writers, not privacy). It is unrelated to this request and stays as-is.
- Not restricting what a mobile build lets you *author* (Planner/guided builder already restrict mixing kinds within one workout; this spec doesn't add product-based authoring restrictions — only sync visibility).
- Not touching cross-modality analytics (`balance.ts`'s `loadBalance`, shown on mobile `Progress.tsx`). It already returns `null` when it lacks both sides' data (confirmed at `packages/engine/src/balance.ts`'s doc comment and its call site, `Progress.tsx:88`), so on a filtered phone that card silently stops appearing instead of erroring. This is an accepted, graceful consequence of the isolation this spec asks for — it stays available on web, where both kinds remain visible.

## Design

### New engine primitive: `restrictToProduct`

A single pure function, colocated with `isCondWorkout` in `packages/engine/src/session.ts`, becomes the one predicate every direction of this feature shares (push, pull, and local pruning all call it — so the "which records belong to this product" rule can't drift between them):

```ts
export function restrictToProduct(db: EngineDB, domain: 'strength' | 'conditioning'): EngineDB {
  const conditioning = domain === 'conditioning';
  return {
    ...db,
    workouts: db.workouts.filter((w) => isCondWorkout(w) === conditioning),
    sessions: db.sessions.filter((s) => (s.kind === 'conditioning') === conditioning),
  };
}
```

`settings`, `core`, and `ecosystem` pass through untouched on the returned object — only `workouts`/`sessions` are narrowed. This deliberately does **not** reuse `ecosystem.ts`'s existing `productData()`, which also narrows `settings` down to a small per-domain subset (e.g. `conProgress` for conditioning, `liftProgress` for strength) — that subset was designed for a different purpose (a minimal payload mirrored into a per-domain Supabase row) and excludes shared fields like profile/WHOOP data that haven't all been migrated into `core` yet. Reusing it here would silently drop those shared settings fields from a filtered device. `restrictToProduct` only ever touches the two arrays.

A workout/session with no `kind` set: `isCondWorkout` returns `false` for it, so `false === conditioning` is `true` exactly when `domain === 'strength'` — it survives filtering for strength, is dropped for conditioning. Matches the existing "no kind reads as not-conditioning" convention.

### Wiring into `apps/mobile/src/cloud/sync.tsx`

Two call sites change, both already reading `PRODUCT_ID` from `../product`:

- **`pushNow`**: before building `state = buildPushState(source, existing)`, replace `source` with `restrictToProduct(source, PRODUCT_ID)`. The push can now only *contribute* this device's own kind. `buildPushState`'s existing union-merge (`mergeEngines(local, exEngine)`) means the other kind's records already sitting in `existing` (the remote row) pass through untouched — they're simply not present on the `local` side of the union, so there's nothing to overwrite them with.
- **`reconcile`**: before `applyPull(dbRef.current, remote)`, replace both arguments: `applyPull(restrictToProduct(dbRef.current, PRODUCT_ID), remote ? restrictToProduct(remote, PRODUCT_ID) : null)`. Filtering `dbRef.current` here is what prunes an already-installed phone's wrong-kind leftovers — they're simply excluded from the merge input, so the merged result the phone writes back to its own storage no longer contains them.

Web's `apps/web/src/cloud/sync.tsx` is untouched — it keeps calling `applyPull`/`buildPushState` with the full, unfiltered db.

### Why pruning locally can't delete the other product's data remotely

Confirmed in `packages/engine/src/db.ts`: deletion is tombstone-based (`deletedIds`), never inferred from a record's absence — merges are additive/union outside of an explicit tombstone. Excluding the other kind's records from the merge *input* on a conditioning phone means that phone simply never re-asserts them; it does not tell the server they're gone. A strength phone (or web) still has them, still pushes them, and nothing here writes a tombstone for them. This is the property that makes local pruning safe without a migration flag or a one-time-only guard — `restrictToProduct` can run on every single sync, unconditionally.

## Testing

- Unit tests for `restrictToProduct` in `packages/engine`, alongside existing `isCondWorkout`/session tests: strength domain keeps strength + kind-less, drops conditioning; conditioning domain keeps only conditioning; `settings`/`core`/`ecosystem` are the same object reference (untouched) on the output.
- A merge-safety test exercising the existing `applyPull`/`buildPushState` functions with a `restrictToProduct`-filtered local side against a mixed-kind remote, asserting the other kind's remote records survive in the merged/pushed result (regression guard for the "pruning is never a delete" claim above).
- No changes expected to existing web sync tests (they call the same functions unfiltered, as before).

## Manual verification

This is a native sync path against real Supabase state — not something a jest run can prove end-to-end. Step required before calling this done: install both a conditioning-preview and a strength-preview build signed into the *same* account, log one session of each kind, and confirm each phone's Library/History only ever shows its own kind after a sync round-trip, while the web app (either branded build) still shows both.
