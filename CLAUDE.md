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

## Storage and release rules

The legacy `app_state` JSON row remains a migration bridge. The public
cross-app boundary is the migration in
`supabase/migrations/20260804_fitness_ecosystem_contracts.sql`: RLS-owned core,
domain snapshots, idempotent events, and Coordinator-only weekly plans. Apply
it in staging before enabling `VITE_HYBRID_ECOSYSTEM_SYNC=1` or
`EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC=1`.

Never remove the legacy read path until old mobile builds have aged out and a
rollback rehearsal proves that no domain can overwrite another domain.

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
