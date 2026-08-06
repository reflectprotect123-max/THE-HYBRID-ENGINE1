# Android app merge — one install, two sealed worlds

**Date:** 2026-08-06
**Status:** Approved in brainstorm; awaiting spec review
**Owner packages:** `apps/mobile`, with a corrective touch on `apps/web`

## What this is

The two Android apps — `com.hybridengine.app` (THE Strength System) and
`com.hybridengine.conditioning` (THE Conditioning System) — become **one
installed app** containing both experiences, unchanged, as two sealed worlds.
A switch in Settings moves between them. Nothing else about either experience
changes: no redesign, no new chrome, no merged screens.

The user's constraint, verbatim: *"i want to keep it the same just merged into
one app"* — and, of the two worlds, *"work completely separately without any
crossover."* Crossover is a **view rule**: no screen shows both disciplines.
It is not an engine rule — `@hybrid/coordinator` and
`@hybrid/whole-athlete-state` continue to see both disciplines underneath,
because weekly conflict resolution (heavy squats must not land the day before
hard intervals) is the safety layer whose whole job is seeing both. This
mirrors the decision already taken for the web slice.

## 1. App identity

- **`com.hybridengine.app` survives** and becomes the merged app. Existing
  strength installs update in place; App Links/assetlinks, Play listing and
  EAS project continue unchanged.
- **`com.hybridengine.conditioning` retires.** Its Play listing is wound down
  after a farewell release (§5). Its EAS project (`21f28234-…`) and update
  channels retire with it.
- Conditioning users' server-side data is untouched — they sign into the
  merged app and their data is there via normal sync.

## 2. Structure inside the app

- A runtime **discipline switch** decides which world renders. Port the
  `apps/web/src/discipline.ts` pattern: AsyncStorage key, own store, NOT a
  field on EngineDB (a view preference is not training data and must never
  enter a sync merge). App opens in the last-used world; a fresh install
  opens in Strength.
- Each world renders exactly today's product experience for that discipline.
  All screen-level reads are scoped with the engine's existing
  `restrictToProduct(db, discipline)` (`packages/engine/src/session.ts`).
- **`db` stays whole. Writes are never filtered.** The lesson the 5 Aug
  sync-partition review paid for twice (C1/C2 data-loss bugs): the moment a
  filtered view becomes the thing you write back or merge from, the excluded
  records are silently dropped. Reads scope; writes, Coordinator and
  whole-athlete-state operate on the complete database.
- A live session in the other world stays reachable (the web slice's
  `foreignActiveSession` rule): switching worlds mid-session must never
  strand logged work for `expireStaleSessions` to silently kill.

## 3. The switch (the only new UI)

- One row in Settings: **"Switch to Conditioning →"** / **"Switch to
  Strength →"**, showing the destination world's accent colour as a dot, so
  where you are going is visible before you tap.
- Press feedback (ripple/opacity) per platform norms. **No confirmation
  dialog** — switching destroys nothing, and confirmation is for destructive
  acts. Brief feedback on arrival (the theme change itself is the feedback).
- World identity is signalled by the existing runtime themes — the
  `nativewind-theme-vars` machinery merged on 5 Aug already does this per
  build; the switch re-points it at runtime. Strength keeps brass/gold;
  Conditioning keeps its own accent. No banners, no labels.
- Design-system verdict: the repo's existing tokens ARE the design. The
  generic fitness-app styling suggested by the pattern database (energy
  orange / Barlow / block layout) was considered and rejected — "keep it the
  same" is the brief.

## 4. Sync — the load-bearing change

Today each Android build syncs only its own kind
(`EXPO_PUBLIC_HYBRID_PRODUCT` drives partitioned pull/push,
`apps/mobile/src/cloud/sync.tsx`). The merged app must sync **both** kinds.

- `EXPO_PUBLIC_HYBRID_PRODUCT` stops driving sync filtering. The
  product-partition path in `reconcile`/write-back is removed or bypassed for
  the merged app; `restrictToProduct` becomes a view-layer concern only.
- Push remains additive and unfiltered — that is already the post-C1 state
  and must not regress.
- Writer identity: the merged app writes as a single mobile writer rather
  than `strength:mobile` / `conditioning:mobile`. This must be checked
  against the ecosystem contract
  (`supabase/migrations/20260804_fitness_ecosystem_contracts.sql`) — domain
  snapshot and event rules must still hold, and the Coordinator-only weekly
  plan rule is untouched.
- The known residual from 5 Aug (other-product record authored during an
  in-flight push) disappears naturally once nothing is filtered — verify
  this rather than assume it; the comment in `sync.tsx` documenting the
  residual must be updated or removed truthfully.
- **Every 5 Aug sync integration test re-runs, plus new tests for a
  mixed-kind device**: both kinds locally, both kinds remotely, legacy
  mixed-kind records, upgrade-from-partitioned-install state.

## 5. Farewell release for the conditioning app

The one real data-loss risk in the merge: local, never-synced data on a
conditioning install dies with the app. Mitigation: one final
conditioning release whose job is a prominent, verified **force-sync**
("your data is safe in the cloud — install the merged app") before the
listing winds down. Only after that ships and has had time in the field does
the conditioning EAS project retire.

## 6. Builds and cleanup

- `eas.json`: `conditioning-preview` / `conditioning-production` profiles
  retire (after §5); `preview` / `production` remain.
- `app.config.js`: the `isConditioning` branch is removed **after** the
  farewell release cycle — it is needed to build §5.
- CI references to per-product mobile builds update accordingly.

## 7. Web corrective (small, do first)

The discipline-scoping slice landed on the web branch (`24c2a39`) targeted
the wrong surface — web is the dashboard and must show both disciplines.
Unfixed, the deployed dashboard would silently scope to strength (the
`parseProductId` fallback). Action: revert the store-level scoping in
`apps/web/src/store/db.tsx`; keep `discipline.ts`'s pure helpers and tests
(they port to mobile); keep the `vite.config.ts` manifest fix (a real,
independent bug — `build:strength` produced Dashboard branding).

## 8. Out of scope

- Any visual change beyond the Settings row.
- Auto-coach on mobile (open item in the 6 Aug audit; separate decision).
- The web coach bench, the `/coach` service-worker question, and all other
  6 Aug audit items.
- iOS (the repo targets Android devices today; the config change carries
  over but no iOS-specific work is included).

## 9. Test gate before handoff

1. `pnpm run typecheck`, full Vitest, `pnpm run check:ecosystem`.
2. Mobile sync integration suite (`apps/mobile/test/sync.test.tsx`) extended
   for mixed-kind devices — green.
3. Real-device checks, per the 5 Aug precedent (emulator green ≠ device
   true): merged build shows strength world; switch; conditioning world;
   both kinds sync; an upgrade over an existing strength install preserves
   data; a conditioning-app account sees its data in the merged app.
4. Web dashboard still shows both disciplines (post-§7 revert).

## 10. Estimate and risk ranking

Roughly **1–1.5 weeks**. Sync (§4) is half of it and carries the only real
data-loss risk; it is done test-first against the 5 Aug lessons. Identity
(§1) and the switch (§3) are small. The farewell release (§5) is small but
gates the cleanup (§6) — sequence it early.
