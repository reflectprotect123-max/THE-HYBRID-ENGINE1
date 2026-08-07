# MacroTrack Phase 0 — Contracts & Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (this phase is being executed in-session by its author; later phases may use subagent-driven-development). Checkboxes track steps.

**Goal:** The `nutrition` domain exists in every contract layer — SQL, shared-core types, ecosystem namespace, product scope — plus a `@hybrid/nutrition-core` package holding the ported athlete-data model, with nothing user-visible yet.

**Spec:** `docs/superpowers/specs/2026-08-07-macrotrack-rebuild-scope.md`
**Reference:** `/workspace/reflectprotect123-max/thehybridsystem` @ `079b356` (read-only clone; MacroTrack is FROZEN as of Phase 0 start).

## Global constraints

- The applied migration `20260804_fitness_ecosystem_contracts.sql` is never edited — `nutrition` arrives via a NEW migration altering the check constraints (`athlete_domain_name`, `athlete_event_source`). Staging first, rollback SQL included, per CLAUDE.md storage rules.
- `ProductId` ('strength' | 'conditioning') is a TRAINING concept and does not grow. The world switch gets a wider `WorldId = ProductId | 'nutrition'` when Phase 3 needs it — nothing in Phase 0 touches the mobile/web switch.
- Snapshot-at-log-time invariant carries over verbatim from MacroTrack: a log entry's calories/macros are copied at log time and never re-derived, so editing a food never rewrites history.
- All suites + `check:ecosystem` green at every commit.

### Task 1: `nutrition` in shared-core + a constraint-widening migration
- `packages/shared-core/src/types.ts`: `ProductDomain` gains `'nutrition'`; `core.ts`'s sourceDomain allow-list follows.
- New `supabase/migrations/20260807_nutrition_domain.sql`: `alter table … drop constraint athlete_domain_name; add constraint … check (domain in ('strength','conditioning','athlete_state','coordinator','nutrition'))`; same for `athlete_event_source`; header comment carries the rollback statements.
- Tests: shared-core sanitizer accepts a nutrition-sourced event; `check:ecosystem` extended if it asserts the domain list.

### Task 2: `@hybrid/nutrition-core` package
- Ported athlete-data types from MacroTrack's models, TypeScript-native: `FoodLogEntry` (snapshot fields + the nutrients-at-source-basis caveat as a doc comment, verbatim in spirit), `WeightEntry`, `MacroProgram`/`MacroProgramDay`, `CheckIn`, `DayStatus`, `EntryKind`/`Meal` unions.
- `NutritionDB` root: `{ logEntries, weightEntries, program, checkIns, dayStatus, settings }` + `emptyNutritionDB()`, `sanitizeNutritionDB()` (foreign-input hardening, same posture as `sanitizeDB`), `mergeNutrition(a, b)` (by-id, last-write-wins on `updatedAt`, additive — the C1/C2 posture from day one).
- Vitest: sanitize rejects garbage without throwing; merge is additive both ways; snapshot fields survive a merge unchanged.

### Task 3: nutrition partition in the sync namespace
- `packages/engine/src/ecosystem.ts` (or shared-core, wherever partition builders live): `buildMergedSyncNamespace` learns to carry a `nutrition` partition when handed a `NutritionDB`; `applyProductSyncNamespace` round-trips it. Engine's `EngineDB` itself is UNTOUCHED.
- Mobile/web `pushEcosystem`/`pullEcosystem`: upsert loop already iterates domains — extend the list; RPC contract unchanged (the new constraint admits the domain).
- Tests: engine ecosystem tests get nutrition round-trip cases; the live sync-e2e test gains a nutrition partition assertion (still `SB_E2E`-gated).

### Task 4: storage slice (no UI)
- Mobile + web: `nutrition` slice persisted under its own storage key (`hybrid-nutrition-v1`), loaded/saved beside EngineDB, included in push/pull. Not a field on EngineDB.
- Tests: slice survives reload; sync carries it; EngineDB fingerprint unaffected when only nutrition changes (and vice versa — the isolation is the point).

### Task 5: CLAUDE.md amendment + handoff
- CLAUDE.md: nutrition boundary rewritten per the scope doc (`@hybrid/nutrition-engine` will own prescription; facts-as-context allowed; Coordinator/pain/illness supremacy restated). Product-ownership list gains `@hybrid/nutrition-core` (and the audit's old gap: `@hybrid/auto-coach`, `@hybrid/product-scope`).
- Handoff checkpoint notes Phase 0 done, staging-migration status, Phase 1 next.

### Gate
Full suites, `check:ecosystem`, docs check, web build; staging migration applied + rollback rehearsed (user-run or CI, NOT from this sandbox — egress blocks Supabase); PR to main.
