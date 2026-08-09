# Claude Code operating contract

This repository is THE Hybrid System. It is a pnpm monorepo with two product
build profiles, shared athlete contracts, specialist domain engines, and a
deterministic Coordinator.

Read the **authoritative checkpoint at the top of `handoff.md`** before making
changes. It records the current local rebuild commit, the fact that GitHub's
standard ChatGPT connector could not publish it, and the exact Android build
boundary. The older sections of `handoff.md` and `docs/HANDOFF.md` are historical
records; do not follow a stale statement that the rebuild has not started.

## Product ownership

- `@hybrid/shared-core` owns shared facts and compatibility contracts only.
- `@hybrid/whole-athlete-state` interprets recovery/life context and emits
  constraints. It is not a diagnosis engine and does not prescribe workouts.
- `@hybrid/strength-engine` owns lifting progression and Strength proposals.
- `@hybrid/conditioning-engine` owns modalities, intervals and Conditioning
  progression.
- `@hybrid/coordinator` owns weekly conflict resolution and is the only layer
  allowed to choose the final weekly plan.
- `@hybrid/coordinator-adapter` is the app projection from existing workouts to
  Coordinator proposals.
- `@hybrid/product-scope` owns the product identities and their capability
  lists. It is a fact table, not a decision layer.
- `@hybrid/auto-coach` owns the autonomy policy and the session resolver. It
  applies whole-athlete-state constraints to one session; it never programs a
  week and never overrides the Coordinator.
- `@hybrid/nutrition-core` owns the nutrition data model, its sanitiser and
  its merge. Data only — it decides nothing.
- `@hybrid/nutrition-adapter` is the one projection from the athlete's
  `NutritionDB` slice to everything that reads it — the phone app's nutrition
  world, the web dashboard and food log, and the coach bench. It exports reads
  only, and it is where the nutrition FACTS that whole-athlete-state is allowed
  to see are separated from the targets it is not.

## Nutrition (amended 7 August 2026)

This rule used to read "nutrition is intentionally outside this repository's
prescription logic", written when nutrition lived in a separate app. The
MacroTrack rebuild brings it in, so the wall moves — the principle it existed
to protect does not. One owner per decision domain, still:

- Nutrition prescription — targets, adaptive calories, macro splits — will
  live in `@hybrid/nutrition-engine` and nowhere else. Do not scatter macro
  maths into screens or into the training engines.
- The Coordinator arbitrates TRAINING. It never resolves macros, and nutrition
  never edits a weekly plan.
- `@hybrid/whole-athlete-state` may read nutrition FACTS — energy
  availability, adherence — as context that shapes constraints. It must not
  read a nutrition target as an instruction.
- Pain and illness flags outrank every nutrition-derived suggestion, exactly
  as they outrank a readiness score.
- Nutrition athlete data is its own slice and its own sync partition. It is
  never a field on `EngineDB`, and a nutrition write must never be able to
  dirty the training fingerprint.

Scope and phases: `docs/superpowers/specs/2026-08-07-macrotrack-rebuild-scope.md`.

Do not move recovery, pain or illness logic into a specialist engine. Do not
use HRV as a pain, injury or illness gate. Pain and illness are safety flags,
not ordinary readiness penalties.

## The coach workspace is desktop-first, mobile is open for exploration (amended 9 August 2026)

This rule used to read "WEB ONLY" — never ported, never designed at a phone
viewport, full stop. That was true because it was never asked; it stops being
true once a coach without a desktop is a real scenario. The wall moves, the
principle behind it does not: judge the workspace at desktop width until a
mobile design is actually approved, and don't let one surface's constraints
leak into the other's code.

- `1440px` is still the build target and the default review width for every
  route under `/coach`, `CoachWorkspaceRepository` and everything that
  consumes it. Nothing here changes that.
- A phone layout for the coach workspace is now in scope to explore — design,
  mock up, and review at phone width — but it is exploration until a design is
  explicitly approved for implementation. Do not port `CoachWorkspace`,
  `CoachCommandCenter`, `CoachAccess`, `ArcCoachFrame` or any route under
  `/coach` into `apps/mobile`, and do not wire up a live mobile build, without
  that explicit approval.
- `checks/screens.mjs` still shoots the athlete app only at 420px; do not add
  coach routes to it until a mobile coach surface is actually approved and
  built. (`apps/mobile/src/screens/nutrition/Coach.tsx` remains unrelated — the
  athlete's own nutrition coach, not the coach bench.)
- When a mobile design is approved, treat it the same as any other product
  decision here: update this section with the real boundary (what ships on
  mobile, what stays desktop-only, e.g. Nutrition's macro table and
  WeekReview's ledger) rather than leaving the old absolute wording standing.

## Storage and release rules

The legacy `app_state` JSON row remains a migration bridge. The public
cross-app boundary is the migration in
`supabase/migrations/20260804_fitness_ecosystem_contracts.sql`: RLS-owned core,
domain snapshots, idempotent events, and Coordinator-only weekly plans. Apply
it in staging before enabling `VITE_HYBRID_ECOSYSTEM_SYNC=1` or
`EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC=1`.

Never remove the legacy read path until old mobile builds have aged out and a
rollback rehearsal proves that no domain can overwrite another domain.

## Where a test goes

Tests are COLOCATED: `src/lift.ts` is tested by `src/lift.test.ts`, in the same
directory. A test that covers a contract across several modules — a parity
suite, a boundary check, a merged-world sync test — sits with the module it
mostly exercises, named for the contract rather than the file.

EVERY test is colocated — there are no exceptions, including the coach bench
and the `SB_E2E`-gated live backend round trip, which sits with the sync
provider it drives.

`test/` still exists in four projects and holds only things that are NOT tests:
fixtures and golden vectors (`packages/engine/test/golden`,
`packages/auto-coach/test/fixtures`, `packages/nutrition-engine/test/fixtures`)
and the mobile Jest setup and stubs. If you find a `*.test.ts` under `test/`,
it is in the wrong place.

Both trees are collected — `include`/`testMatch` name `src/**` AND `test/**` in
every project. Do not "tidy" either half away: a test that stops being collected
does not fail, it silently disappears, and the suite still reports green.

Two consequences worth knowing. A colocated test is inside the package's
compiled scope, so `tsc` checks it — which is the point, and which immediately
surfaced a type error in a `packages/design` test that had never been checked.
And nothing test-shaped reaches a shipped artefact: Metro and Vite both build
from the entry graph, so an unimported `*.test.ts` is not reachable. That was
verified with canary markers before the move and again after, against both the
Android bundle and the web dist.

## Safe workflow

1. Start with a read-only audit and preserve unrelated worktree changes.
2. Work in a dedicated Git worktree for a phase; see `docs/WORKTREES.md`.
3. Keep decision logic pure and add a test before changing a rule.
4. Run `pnpm run typecheck`, focused Vitest tests, `pnpm run check:ecosystem`,
   and the relevant web/mobile build before handoff.
5. Never run production migrations, EAS submissions, Netlify deploys, or
   destructive data operations without an explicit approval and rollback plan.

## Useful commands

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run check:ecosystem
pnpm --filter @hybrid/web build:strength
pnpm --filter @hybrid/web build:conditioning
pnpm --filter @hybrid/mobile typecheck
```
