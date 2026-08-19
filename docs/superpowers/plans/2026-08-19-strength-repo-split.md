# Strength repo split — THE-STRENGTH-ENGINE1

**Owner decisions (19 August 2026, all explicit):** strength moves to a new
repository `reflectprotect123-max/THE-STRENGTH-ENGINE1`, pointing at the SAME
Supabase project; the new repo gets ITS OWN coach web app and ITS OWN mobile
app; the split is a CLEAN CUT — the hybrid apps never render strength again;
the strength migrations MOVE with the code.

The repo does not exist yet — the GitHub integration cannot create
repositories (403), so the owner creates it (private, empty) and grants the
Claude app access. Until then the new tree is assembled locally and the hybrid
excision is prepared but the push waits.

## Why a clean cut is coherent one day after wave 1 taught the engine
StrengthBlock

Wave 1 fixed `cleanBlock`/`duplicateWorkout`/`freshSessionBlocks` so the
hybrid engine would stop DESTROYING strength blocks. The split does not make
those fixes wasted work — it makes them the reference implementation the new
repo starts from, and the hybrid side of them is then deleted because the
type they protect leaves the union. Deleting correct code because the product
moved is this repository's normal (see every deletion section in CLAUDE.md);
shipping the split with the old bug still latent would not have been.

## Task 1 — assemble THE-STRENGTH-ENGINE1 locally

Working dir: the session scratchpad, `strength-repo/`. A pnpm monorepo in the
hybrid repo's image (same conventions: source-exported packages, colocated
tests, checks/ + ci.yml mirroring `verify`):

- `packages/strength-engine/` — copied verbatim from the hybrid repo at
  `3cfdc1f` (provenance recorded in the new repo's handoff; history stays in
  the hybrid repo's git, same as every other deletion there).
- `supabase/migrations/` — the five strength migrations
  (`20260818_strength_rebuild`, `20260819_phase_e_pain_metric`,
  `20260819_phase_f_knowledge_base`, `20260820_strength_hardening`,
  `20260821_strength_rls`), unchanged: they are already applied-or-pending
  against the shared project and renaming applied migrations breaks the
  migration ledger.
- `supabase/functions/embed-coaching-note/` — moved whole, with its workspace
  member config.
- `checks/migrations-apply.mjs` — a strength-scoped copy. The shared project
  means shared runtime objects the new repo does not own: `auth.users`,
  `coaches_athlete_anywhere` (20260813), the grants convention. The check
  gains a PRELUDE that stubs exactly those (documented list, each line naming
  the hybrid migration that really owns it) so the five migrations apply on a
  scratch cluster. pgvector stays a KNOWN ENVIRONMENT GAP, same wording.
- `apps/web/` — minimal Vite + React scaffold: auth against the shared
  Supabase project, one routed screen ("Strength bench — Phase B builds
  here"), the design tokens copied from `packages/design`'s strength palette.
  No features — Phase B's plan owns those.
- `apps/mobile/` — minimal Expo scaffold, same idea, Phase C builds here.
- `CLAUDE.md` — the strength-relevant rules carried over (one owner per
  decision domain; pain/illness are safety flags; test colocation; check
  honesty rules; the shared-Supabase contract: this repo owns the strength
  tables and NOTHING else — a migration touching a non-strength table is a
  contract violation both repos' docs name).
- `handoff.md` — checkpoint: where everything came from (hybrid `3cfdc1f`),
  what Phase B/C are, the two open runtime notes (stale-approval semantics,
  `EMBED_WEBHOOK_SECRET` deploy step).
- `.github/workflows/ci.yml` — typecheck, test, check loop, migrations check.

## Task 2 — excise strength from the hybrid repo

On `main`, after Task 1's tree is pushed (never before — the copy source must
outlive the deletion):

- Delete `packages/strength-engine`, the five migrations, the edge function +
  `supabase/functions` workspace membership (restore `pnpm-workspace.yaml`).
- `Block<S>` union back to `CondBlock | TextBlock`; remove the strength
  branches from `cleanBlock`, `duplicateWorkout`, `freshSessionBlocks`,
  `hasStrengthPrescription`, `expireStaleSessions`' strength promotion,
  `sessionProgress`'s skip, and their tests — each with a comment pointing at
  THE-STRENGTH-ENGINE1 rather than a silent hole.
- Coach bench: Strength pillar tile + `/coach/strength` route + placeholder
  screen deleted; `checks/screens.mjs` drops to nine routes / 18 shots (the
  count rule in CLAUDE.md gets its THIRD correction, this time in the same
  commit — `checks/docs.mjs` derives it, which is why this is safe).
- Mobile: `StrengthRebuilding.tsx` and its route deleted; parity
  harness/driver/baselines deleted WITH their commented-out ci.yml step
  (the restore condition "Phase C ships the new logger" now belongs to the
  other repo, so keeping the dead gate would be a decorative guard).
- `checks/migrations-apply.mjs`: drop `STRENGTH_TABLES`, the coaching_note
  assertion, and the pgvector KNOWN ENVIRONMENT GAP handling if no remaining
  migration needs vector (verify: grep).
- CLAUDE.md + handoff.md: dated sections in the house deletion style — what
  moved, where, why, and that `@hybrid/strength-engine` in product ownership
  now reads "MOVED to THE-STRENGTH-ENGINE1 (19 August 2026)".
- Full `pnpm run verify` + the browser checks locally before push.

## The shared-Supabase contract (binds BOTH repos)

- Strength repo owns: the 12 strength tables, their RLS, `embed-coaching-note`.
- Hybrid repo owns: everything else, including `auth`, the coach-athlete
  relationship model, `coaches_athlete_anywhere`.
- Neither repo writes a migration against the other's tables. A change to
  `coaches_athlete_anywhere`'s SIGNATURE is a breaking change for the strength
  repo's RLS and must be coordinated by hand — both CLAUDE.md files name this.
- Migration filename timestamps are the shared ordering; the strength repo
  prefixes nothing and renames nothing that has ever been pushed.
