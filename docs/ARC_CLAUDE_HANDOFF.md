# ARC coach workspace — Claude backend handoff

Status: front-end integration seam implemented 8 August 2026. Read `AGENTS.md`,
`PRODUCT_NOTES.md`, and `docs/COACH_INTEGRATION.md` before changing it.

## What Claude should replace

The coach screens now depend on `CoachWorkspaceRepository` in
`apps/web/src/coach/contracts.ts`. The current implementation is
`MockCoachWorkspaceRepository` in `apps/web/src/coach/mock-repository.ts`.

Replace that repository through `CoachWorkspaceProvider`; do not reconstruct the
screens, import Supabase into JSX, or move domain decisions into React effects.

Repository methods:

- `listClients()` returns safe cross-domain summary projections.
- `listProgramTemplates()` returns versioned Strength or Conditioning templates.
- `saveAssignmentDraft()` persists an input for Coordinator resolution.
- `getSettings()` and `saveSettings()` manage coach-workspace preferences only.

The mock fixtures live in one isolated file, `mock-fixtures.ts`. Screens do not
import that file.

## Important truth boundary

`engine-local` is the only client whose detailed data exists today. All other
clients are visibly labelled `synthetic-fixture`. ARC disables detailed links for
those clients instead of showing the signed-in athlete's records under another
name.

Do not remove that guard until the backend can fetch an authorised, tenant-scoped
projection for the selected client.

## Required backend entities

The existing database has no organisation, coach, coach↔athlete assignment,
program, training block, or program-assignment entity. Add them explicitly:

1. `organizations`
2. `organization_memberships`
3. `coach_athlete_assignments`
4. `program_templates` and immutable `program_template_versions`
5. `training_block_templates`
6. `program_assignments`
7. `assignment_input_versions`
8. immutable `coach_decisions` and `decision_receipts`

Every athlete-facing read and command needs organisation, athlete and role checks.
RLS is defence in depth; application authorization remains mandatory.

## Coordinator boundary

`ProgramAssignmentDraft.preferredWeekdays` expresses coach intent. It does not
place sessions into `WeeklyPlan`. On acceptance, the backend must turn an
assignment into versioned proposals/constraints and ask the deterministic
Coordinator to resolve the week. Preserve every dropped proposal and reason.

Never add `resolvedDates` or a mutable calendar array to the assignment command.

## Strength and Conditioning

- Strength progression must reuse the existing movement history and
  `strength-engine`; increases are proposal-only.
- Conditioning templates reflect the existing formats (`steady`, `intervals`,
  `tempo`, `custom`, `free`) and modalities (`run`, `row`, `ski`, `bike`,
  `air_bike`). Reuse `conPrescription`, `conAdapt`, and `progressionKey`.
- Canonicalise the UI word `moderate` to the engine value `medium` at the adapter.
- Pain, illness, stop requests, restrictions, unknown and contradictory data can
  never produce progression.

## Nutrition

Use `@hybrid/nutrition-adapter` as the only projection. Nutrition is contextual
and never an input directive to the Coordinator. The coach UI requires logging
coverage and exceptions, not barcode scanning.

## Command requirements

Commands need an authenticated actor derived by the server, organisation and
athlete scope, idempotency key, base version, rule-set version/hash, and one
transaction for the domain change plus immutable audit/receipt records. Never
trust actor or organisation identifiers supplied by the client.

## Offline and security boundary

The current repository is local demo persistence, not production offline sync.
For the real adapter:

- private API responses default to `no-store`;
- client records and outbox commands commit atomically in IndexedDB;
- replay re-authorizes and rechecks base versions;
- account switch cannot reveal or replay another user's local records;
- an offline Coordinator result is a provisional preview only;
- approval, publication and policy changes require a connection in v1.

## Acceptance checks

Before handoff, run:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
node checks/coach-contract.mjs
node checks/react-smoke.mjs
node checks/docs.mjs
```

Backend-specific deny tests must prove cross-tenant and cross-athlete reads/writes,
revoked memberships, replayed idempotency keys, role escalation, guessed receipt
IDs and support-role sensitive-field access are rejected without leaking existence.

