# Handoff

## 1) Goal

Ship the conditioning-evidence-based upgrade end to end, clear the pre-existing bug
backlog, remove the half-dead coach system, wire up the one first-party safety signal
the app was capturing and discarding (`pain_stop`), and get Concept2 Logbook + Echo
Bike V3 verified against real accounts/hardware. On top of that, a full audit was run
to scope a Juggernaut/MacroFactor-style adaptive training-decision layer — that audit
is written up but **awaiting your review before any implementation starts.**

## 2) Current State

**2026-08-01 — Phase 0 (adaptive-decision contracts) shipped, verified, and pushed.**
`origin/main` is at `b61c507`. Five tasks, one commit each:
`671b085` (types + `explainSetAdjustment`), `cd4d873` (fix a verdict/action
contradiction near the on-target band caught during Task 1's own review — pre-push,
no golden impact), `e2d0c13` (`explainWorkingWeight`), `befd450`
(`explainConPrescription`), `6577276` (`explainConAdapt`), and `b61c507` (export
`./adaptive/types` and `./adaptive/explain` from `@hybrid/engine`'s `src/index.ts`,
plus a smoke test proving the export is reachable via the package index, not just the
internal module path). All five wrapped functions (`explainSetAdjustment`,
`explainWorkingWeight`, `explainConPrescription`, `explainConAdapt`) are read-only
reshapers around already-computed results (`SetAdjustment`, `WorkingWeight`,
`Prescription`, `CondResult`/`AdaptResult`) — none of them recompute or alter the
underlying training math. Full repo `pnpm run verify` re-run fresh at HEAD this
session: **exit 0** — typecheck clean (engine/guided-flow/config/design/mobile/web),
engine suite **320/320** (was 304 before Phase 0; +16 new: 15 from Tasks 1–4's
`adaptive.test.ts` plus 1 index-export smoke test from Task 5), **golden suite
exactly 33/33, unchanged**, guided-flow 15/15, web 3/3, mobile 72/72, build clean, CSP
check clean, react-smoke 29/29, deploy-smoke 11/11. Zero UI touched — only
`packages/engine/src/index.ts` and `packages/engine/test/adaptive.test.ts` changed in
Task 5; Tasks 1–4 touched only `packages/engine/src/adaptive/{types,explain}.ts` and
the same test file. **Phase 1's remaining piece — surfacing a "why" string in at
least one screen per app, per the roadmap's Phase 1 acceptance criteria — is next,
and per this project's standing per-phase review gate, has NOT been started and is
awaiting your go-ahead.**

**ALL CODE WORK THROUGH COACH REMOVAL AND PAIN-STOP WIRING IS COMPLETE, VERIFIED, AND
PUSHED.** Only Echo Bike's physical hardware test and the items in §6 below remain
open. (Phase 0 above proceeded from a written, reviewable implementation plan per this
project's standing process — Phase 1 itself still needs its own explicit go-ahead
before any of its work starts.)

- Working directory: `/workspace/the-hybrid-engine1`, branch `main`, in sync with origin.
- **Status checklist created** on branch `claude/status-check-iuiycq` (commit `b763ffe`):
  summary of the five §19 approval items that must be decided before Phase 0 plan writing.
- Everything from the prior handoff (conditioning plan, backlog batch, epley ruling,
  Concept2 live-verified OAuth fix at `f0aa3a1`) is unchanged — see that handoff's text
  further down this file's git history, or `git log`.
- **Coach system removed (app-code half — approved decision, no invite-flow rebuild):**
  `Workout.origin`/`assignmentId`/`note`, `reconcileAssignments`/`coachDigest`/
  `materializeAssignment` are gone from `packages/engine`; both apps' Settings lost the
  "Your Coach" invite-code card, Library lost the "from your coach" filter/section,
  Planner's read-only coach-session gate collapsed, Home/Training/Logger lost their
  coach labels/notes. `checks/supabase-contract.mjs` was recalibrated for the now-smaller
  app-side query surface (its schema-side RLS assertions are untouched).
  **Not done, and intentionally not part of this: the Supabase schema half**
  (`coach_library`, `coach_athletes`, `claim_invite()`, `programs`, `assignments`,
  `athlete_feed` + their RLS policies) — that's a separate, irreversible, hand-run SQL
  action against production that only you should trigger, on your own timing.
- **`pain_stop` is read for the first time.** New pure engine function `painHoldFor()`
  checks whether the most recent conditioning result in a given format+modality bucket
  ended in a self-reported pain stop; both apps' Conditioning setup screen now shows a
  banner and hides Start until the athlete explicitly acknowledges ("I'm ready to
  continue"), scoped per-format so it never bleeds across modalities. This was the
  single highest-leverage, same-day-shippable fix identified by the audit (§11/§15/§16
  of the new design doc) and is now shipped, not just proposed.
- **Adaptive-training-engine audit & design doc produced and committed this session:**
  `docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md`. Five
  parallel read-only research agents plus a live baseline run audited the whole repo
  (progression engine internals, safety/readiness signals, device integrations, data
  architecture, docs/CI). Verdict: the app is a mature, well-tested, honestly-engineered
  local-first training app (product maturity 7/10, engine 6.5/10) but safety-readiness
  is the weak dimension (2.5/10) — the pain-stop fix above was the first concrete step
  out of that. The doc lays out a 7-phase roadmap (Phase 0 contracts → Phase 1 done-above
  → Phase 2 adaptive strength → Phase 3 modality-aware conditioning thresholds → Phase 4
  device/data-quality integration → Phase 5 constrained AI-explains-only layer → Phase 6
  production hardening) and is explicit that **no further code should be written against
  it until you approve the 5 items in its §19** (sequencing, tech-debt scoping, pain-stop
  UX confirmation — the last one is now moot since it already shipped, modality-threshold
  evidence sourcing). **Status: awaiting your review. Nothing beyond the pain-stop slice
  has been built from it.**
- Also handed you a copy-paste prompt (in-chat, not a file) for an external LLM to compile
  a peer-reviewed/coaching-methodology evidence bundle for the specific adaptive-layer
  claims that currently have no sourcing (RPE/RIR autoregulation validity, deload/
  repeated-failure thresholds, minimum-data-before-trusting-a-trend, HRV/recovery-based
  modulation, return-to-training-after-a-layoff, pain-vs-fatigue distinction), mirroring
  the format of the existing `docs/research/conditioning-evidence-bundle/`. **Not run by
  me — you're taking it to ChatGPT yourself.** If/when it comes back, it should land as
  `docs/research/adaptive-engine-evidence-bundle/` following the same convention, and
  Phase 2/3 of the roadmap above should cite it.
- Verification at HEAD, re-run fresh this session (not assumed from commit messages):
  `pnpm run verify` exit 0 — typecheck clean, engine **304/304** (golden **33/33**
  untouched), mobile **72/72**, web **3/3**, guided-flow **15/15**, build clean, CSP
  check clean, react-smoke **29/29**, deploy-smoke **11/11**. Contract/pentest suite:
  supabase-contract, concept2-contract, pentest (20/20 held), supabase-auth,
  mobile-touch, web-touch, contrast all green. `whoop-contract` still fails on the
  **same pre-existing, non-blocking issue as before** — two real token literals in
  gitignored `.superpowers/sdd/2026-07-31-conditioning-evidence-based-upgrade/`
  scratch docs (`task-10-brief.md`, `task-10-report.md`). Unchanged from the last
  handoff; still needs the rotate-and-scrub housekeeping in §6 below.
- This container is ephemeral: everything not pushed (including claude-mem's memory)
  dies with it. Both the audit doc and this handoff are committed and pushed as of
  this update.

## 3) Active Files

Conditioning plan + backlog batch + Concept2 OAuth-outcome fix: unchanged from the prior
handoff.

New this round:
- `packages/engine/src/types.ts`, `cloud.ts` — dropped `Workout.origin`/`assignmentId`/
  `note`, `reconcileAssignments`/`coachDigest`/`materializeAssignment`,
  `AssignmentRow`/`ReconcileResult`.
- `apps/{web,mobile}/src/screens/Settings.tsx`, `Library.tsx`, `Planner.tsx`,
  `Home.tsx`, `Training.tsx`, `Logger.tsx`, `cloud/sync.tsx` — coach-linking UI, filters,
  labels, and sync callbacks removed on both platforms.
- `checks/react-smoke.mjs` — removed the coach-assigned-read-only scenario; renamed an
  unrelated cue-related test that had "coach" in its name but tested a general field.
- `checks/supabase-contract.mjs` — recalibrated static assertions for the smaller
  app-side query surface.
- `packages/engine/src/conditioning.ts` (or adjacent adaptive module — see `painHoldFor`)
  — new pure function reading `mechanicalCompletion: 'pain_stop'` back for the first
  time, partitioned by the same `progressionKey` bucket `conAdapt` already uses.
- `apps/{web,mobile}` Conditioning setup screens — pain-hold banner + acknowledgement
  gate wired to `painHoldFor`, writing `settings.conditioningAck`.
- **New:** `docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md`
  — the audit/design doc described above.

## 4) Changes Made

Everything through the prior handoff (`f0aa3a1`) is unchanged — see that handoff's
section 4 or `git log`.

New this round (`f0aa3a1..e712ad7`):
- `9c37e5a` — engine: remove coach-assignment sync, coach digest, and
  `Workout.origin`/`assignmentId`/`note`. Golden suite untouched (33/33).
- `c59c780` — mobile: remove coach-linking feature (invite code, coach-assigned
  sessions). Typecheck clean; RNTL 69/69 at the time.
- `ea43ee8` — web: remove coach-linking feature. Typecheck/test/build clean;
  react-smoke 27/27 at the time.
- `6a9de1c` — engine: `painHoldFor()` reads `mechanicalCompletion:pain_stop` back for
  the first time. Additive only; engine suite 304/304 (was 295, +9 new), golden 33/33.
- `46676ea` — web: gate the Conditioning setup screen on an unacknowledged pain stop.
- `078f8b3` — mobile: gate the Conditioning setup screen on an unacknowledged pain stop.
- `e712ad7` — checks: recalibrate `supabase-contract.mjs` for the removed coach queries
  (expected red→green fix, not a new bug; schema/RLS text itself untouched).
- (this session, uncommitted until now) `docs/superpowers/specs/2026-08-01-adaptive-...
  -audit-design.md` — the audit/design doc, plus this `handoff.md` update.

## 5) Failed Attempts

Unchanged from the prior handoff (epley clamp reverted against golden, Task 13/14
first-pass bugs caught by review, react-smoke guided-builder flake, this container's
network policy blocking `netlify.app`/`ollama.com`).

Nothing new failed this round — every commit above landed clean on its first attempt,
and the full re-run of `pnpm run verify` plus the contract/pentest suite at HEAD came
back green (with the one known, pre-existing, non-blocking `whoop-contract` exception
carried over unchanged).

## 6) Next Steps

**BLOCKING ON YOUR FIVE §19 APPROVALS (approval checklist in branch `claude/status-check-iuiycq`):**

1. **Your approval of the five §19 items** from the adaptive-training-engine audit/design doc:
   - Overall sequencing (Phase 0/1 before strength/conditioning logic; AI to Phase 5)
   - Pain-stop wiring approach (hold-until-acknowledged, already shipped — confirm UX)
   - Confidence-scoring approach (what signals feed it; what gets surfaced)
   - Data-sufficiency gating (e.g., "need 3 comparable sessions before progressing")
   - Phase 6 tech-debt bundling (backup/restore unification, duplicate-workout guard, secret rotation — now or defer?)
   
   **Once approved:** Phase 0 implementation plan (writing-plans format) will be written and presented for review before code starts.

2. **Your review of the adaptive-training-engine audit/design doc** (§19 of
   `docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md`) —
   refer to the approval checklist for the five specific decisions needed.
2. **Supabase schema-side coach removal** — `coach_library`, `coach_athletes`,
   `claim_invite()`, `programs`, `assignments`, `athlete_feed` + their RLS policies in
   `supabase-schema.sql` and the live production tables. This is a separate, irreversible
   action for you to run yourself in the Supabase SQL Editor, on your own timing — not
   bundled with the app-code removal above and not something I'll execute or schedule
   without a distinct go-ahead at the time.
3. **Echo Bike V3 physical test (still the only remaining item from the conditioning
   upgrade):** Chrome/Edge or the Android app → Conditioning → "Connect Echo Bike"
   (console awake, nothing else connected, no OS pairing). Report any wrong numbers,
   disconnects, or missing fields for parser fixes.
4. **If/when the ChatGPT evidence-compilation prompt comes back:** land it as
   `docs/research/adaptive-engine-evidence-bundle/` matching the existing conditioning
   bundle's format, then it can be cited directly by Phase 2/3's implementation plan.
5. **Housekeeping (carried over, still open):** rotate the Concept2 client secret in the
   Concept2 developer portal + update the Netlify env var; scrub and rotate the two
   WHOOP token literals in `.superpowers/sdd/2026-07-31-conditioning-evidence-based-
   upgrade/task-10-{brief,report}.md` that `whoop-contract.mjs` still (correctly) flags.
6. **Concept2 real-account deeper-validation checklist** (optional, carried over) —
   `docs/research/concept2-logbook-bundle/KNOWN_GAPS.md`.
7. **Deferred minors** (all ruled OK-to-defer, unchanged): react-smoke flake
   stabilization, `useSyncExternalStore` migration for the RUN pending-state pattern,
   named `DeviceInfo` type, `felt: 0` explicit test for `sessionRpe`.
8. **Optional:** the two unrelated OTA-workflow commits (`800ed79`/`6f39123`) from the
   prior handoff are still unreviewed by this thread if the mobile release pipeline
   needs a look.
9. **Once you approve the adaptive-engine doc:** the next step per the doc's own
   instruction is a `writing-plans`-style, task-by-task implementation plan for
   **Phase 0 only**, reviewed again before Phase 1's remaining pieces (Phase 1's
   pain-stop slice is already done) or any later phase begins.
