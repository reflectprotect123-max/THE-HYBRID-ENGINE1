# Orientation for an external reviewer

You have the full source of THE Hybrid System with no history. This file is the
map: what the pieces are, how they talk, which rules are load-bearing, and what
is already known to be broken so you do not spend your run rediscovering it.

Written 7 August 2026, against `main`. If a claim here disagrees with the code,
the code wins and the disagreement is itself worth reporting.

## What the product is

An athlete's training system, in three parts that share one engine:

- A **React Native / Expo Android app** (`apps/mobile`) — where training is
  actually logged, offline-first.
- A **React web app** (`apps/web`) — a dashboard over the same data, plus a
  coach's bench at `/coach`.
- A **Supabase/Postgres backend** — sync and a shared food catalogue.

The phone app contains three sealed **worlds**: Strength, Conditioning and
Nutrition. One install, switched in Settings, each with its own colour theme
and its own tab bar. Worlds are a VIEW concept — the database is never
filtered.

## The dependency graph, and what it means

```
shared-core          (facts, contracts; depends on nothing)
  └── engine         (training data model, merge, sync primitives)
        ├── strength-engine        \
        ├── conditioning-engine     |  specialist domains
        ├── whole-athlete-state     |  (recovery/life context -> constraints)
        ├── coordinator             |  weekly conflict resolution
        ├── coordinator-adapter     |  app projection
        └── auto-coach             /   one-session autonomy

nutrition-core       (nutrition data model — depends on NOTHING)
nutrition-engine     (adaptive calorie/macro maths — depends on NOTHING)
  └── nutrition-adapter  (the ONE projection from NutritionDB to every reader)

product-scope -> design   (identities, palettes)
config, guided-flow       (leaf utilities)
```

Two things to notice, both deliberate:

1. **`nutrition-core` and `nutrition-engine` import nothing from `@hybrid/*`.**
   Nutrition cannot reach into training, and no training package depends on a
   nutrition package. If you find an import that breaks this, it is a real
   finding.
2. **`auto-coach` is a dependency of `apps/web` only, not `apps/mobile`.** That
   is a KNOWN GAP, not a bug you found — see "Known open" below.

## Ownership rules — the operating contract

From `CLAUDE.md`, which is binding and worth reading in full. One owner per
decision domain:

| Layer | Owns | Must never |
|---|---|---|
| `whole-athlete-state` | Interpreting recovery/life context into constraints | Diagnose, or prescribe workouts |
| `strength-engine` / `conditioning-engine` | Their own progression and proposals | Touch recovery, pain or illness logic |
| `coordinator` | Weekly conflict resolution — the ONLY layer that picks the final weekly plan | Resolve macros |
| `auto-coach` | Applying constraints to ONE session, within an athlete-set policy | Program a week, or override the Coordinator |
| `nutrition-engine` | Nutrition prescription — targets, adaptive calories, macro splits | Anything training |
| `nutrition-adapter` | The one projection from `NutritionDB` to its readers | Export a writer (it is reads-only by construction) |

**Safety rules that outrank everything:** pain and illness are safety flags,
not readiness penalties. No nutrition signal, readiness score or wearable
metric may outrank them. HRV must never be used as a pain, injury or illness
gate.

## How data moves

Three separate local slices, three separate storage keys, and the separation is
load-bearing:

| Slice | Key | Syncs? |
|---|---|---|
| `EngineDB` (training) | `hybrid-engine-v1` | Yes — `app_state` blob + a domain partition |
| `NutritionDB` | `hybrid-nutrition-v1` | Yes — its own `nutrition` partition |
| Scan corpus (OCR diagnostics) | `hybrid-label-scan-corpus-v1` | **No, ever** |
| Active world | `hybrid-active-discipline-v1` | No — a view preference |

**The rule that has cost this project real user data twice:** merges must be
ADDITIVE in both directions. A record that exists on only one device must
survive. Reads may be scoped by world; writes are never filtered. Deleting is a
`deletedAt` stamp, never a splice — a spliced record returns from the other
device on the next sync.

`cloudFp(EngineDB)` is the training fingerprint. A nutrition write must never
change it. There are tests asserting this in both directions; if you break the
isolation they fail.

## Server-side contracts

`supabase/migrations/` — read in filename order.

- `20260804_fitness_ecosystem_contracts.sql` — RLS-owned core, domain
  snapshots, idempotent events, Coordinator-only weekly plans.
- `20260807_nutrition_domain.sql` — widens the domain allow-list to admit
  `nutrition`. **The domain list appears in THREE places**: the check
  constraint, and the plpgsql bodies of `upsert_athlete_domain_snapshot` and
  `record_athlete_event`. The RPCs are the only supported write path, so
  widening only the constraint produces a migration that applies cleanly and
  then rejects every write with `invalid domain`. That mistake was made and
  caught here.
- `20260807_macrotrack_food_catalogue.sql` — 18 tables for the food catalogue.
  The shared catalogue (`foods`, `food_servings`) is read-only to clients;
  everything else is owner-only. `anon` is granted nothing.

## The check suite is the specification

`checks/` holds executable invariants. These are more authoritative than any
prose, including this file:

| Check | Proves |
|---|---|
| `migrations-apply.mjs` | Every migration applies to a REAL throwaway Postgres, and RLS actually isolates two athletes — including six cross-owner reference writes |
| `ecosystem-contract.mjs` | Static contract assertions on the SQL |
| `contrast.mjs` | Every ink/surface pair in every palette clears WCAG |
| `react-smoke.mjs` | Real Chromium journeys, including the coach bench |
| `web-touch.mjs` / `mobile-touch.mjs` | Touch-target floors; mobile-touch FAILS if it reaches no nutrition screen |
| `docs.mjs` | Every path and symbol named in README resolves |
| `pentest.mjs` | 20 attacks against the deployed CSP and functions |

Run them. `pnpm run test` covers units; the browser checks need Chromium.

**Mobile tests are Jest with injected globals — no runner import.** Web and
packages are Vitest. Mixing them up is the most common failure when adding a
test here.

## Known open — do NOT report these as discoveries

1. **Six defects inherited from the adaptive engine's Python reference**, fully
   documented as data in `packages/nutrition-engine/src/defects.ts`. They are
   carried UNFIXED on purpose: parity with the Python reference is a proven
   contract (fixtures generated by running it), and a silent divergence would
   be worse than a known bug. The two athlete-visible ones are surfaced in the
   UI rather than smoothed over. **A fix means updating engine, fixtures and
   reference together — not a one-line change.**
2. **`auto-coach` is web-only.** The mobile app does not depend on it. Real
   athletes use the phone. This is a scope decision awaiting the owner.
3. **The food catalogue is empty.** Its seed rows live in a retired repository.
   Barcode lookups will miss; that path routes to "create the food" by design.
4. **The `/coach` service worker denylist** (`apps/web/vite.config.ts`) excludes
   `/coach` from `navigateFallback` with a comment saying the coach is "a
   different app at the same origin". It no longer is — it is a lazy chunk of
   the same SPA. Effect: `/coach` works online, fails offline. Known.
5. **The coach bench has no render tests.** Its logic is unit-tested; the
   ~2,700 lines of UI are driven only by `react-smoke.mjs`.
6. **Label OCR quality is unverified.** The scanner is wired and bundles, but
   no one has photographed a real packet yet. The parser is well tested; the
   camera path is not proven in the field.

## Where the interesting bugs would be

If you are hunting, these are the load-bearing, historically fragile places:

- `apps/mobile/src/cloud/sync.tsx` — the merge and push ordering. Read its
  comments; two data-loss bugs were fixed here and the reasoning is recorded
  inline. The most valuable thing you could find is a third.
- `packages/nutrition-core/src/db.ts` — `sanitizeNutritionDB` and
  `mergeNutrition`. Contract: never throw, never fabricate, additive both ways.
  An earlier version clamped an out-of-range weight instead of dropping it,
  which fed the trend model a weigh-in that never happened.
- `packages/engine/src/ecosystem.ts` — partition building. The nutrition
  partition is deliberately stripped from what lands in `EngineDB.ecosystem`,
  which is what makes the fingerprint isolation structural.
- `packages/nutrition-engine/src/numeric.ts` — Shewchuk exact summation and
  Python-compatible half-even rounding, both load-bearing for parity. Naive
  summation diverges in the last ulp, multiplied by 7700 kcal/kg.
- Anywhere a screen holds a record id: it must look that record up in the WHOLE
  database, not the world-scoped view, or switching worlds strands it.

## Verifying you have not broken anything

```bash
pnpm install
pnpm run typecheck        # 17 projects
pnpm run test             # all suites
pnpm run check:ecosystem
node checks/docs.mjs
node checks/contrast.mjs
node checks/migrations-apply.mjs   # needs a local postgres; skips without one
pnpm run build                     # web
pnpm --filter @hybrid/mobile bundle  # Metro — catches what tsc cannot
```

That last one matters more than it looks: TypeScript resolves happily through
pnpm symlinks that Metro rejects outright. Four bugs invisible to `tsc` were
caught only by running the real bundler.

## What is not in this bundle

`node_modules`, build output, `.git`, and the vendored `.claude/skills`
directory (1.9 MB of third-party design databases, irrelevant to debugging).
Everything else — source, tests, checks, migrations, specs, plans, and the full
`handoff.md` history — is included.
