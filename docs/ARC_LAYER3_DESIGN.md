# ARC layer 3 — built

Status: 8 August 2026. This started as a design-only document — a mapping
pass over the 7 remaining self-coach screens, three independent backend
proposals, a synthesis, and an adversarial design-stage critique, the same
review the layer-2 migration got, applied one stage earlier. **The entire
backend it describes is now built.**

- **§6 (`get_athlete_workout_library`)** —
  `supabase/migrations/20260808_arc_workout_library.sql`. Every finding from
  its critique fixed; the cross-athlete leak (finding 2) and the
  private-template RLS leak (finding 3) proven able to fail by mutation.
  Deny suite: `checks/migrations-apply.mjs`, "ARC — the coach workout
  library".
- **§§1–5 (progression proposals, athlete trends, nutrition review, week
  plan, session detail)** —
  `supabase/migrations/20260808_arc_progression_review.sql`. Every finding
  in §4 fixed; the idempotency domain-scoping fix (finding 2) and the
  nutrition dual-gate fix (finding 6) proven able to fail by mutation. Deny
  suites: `checks/migrations-apply.mjs`, "ARC — progression proposals,
  trends and nutrition review" and "ARC — the read-only week plan and
  session detail". Sign-offs 3–7 were built to their stated defaults; sign-off
  8 was closed by inspection — see the migration's header comment for the
  citation.

**What is NOT built**: the frontend wiring. `apps/web/src/coach/*.tsx` still
read the signed-in account's own local stores for every screen except the
workout library repository plumbing added alongside layers 1–2
(`apps/web/src/cloud/coach-repository.ts`). Every RPC above exists and is
tested against real Postgres; none of them has a caller in the UI yet.

Context: `docs/ARC_CLAUDE_HANDOFF.md`, `docs/HANDOFF_2026-08-08_ARC_IMPORT.md`,
`docs/RISK_REGISTER.md`, `apps/web/src/coach/ClientDetailGate.tsx`. Layers 1–2
(`supabase/migrations/20260808_arc_coach_workspace.sql`) are built, tested,
and had their own security review — see `RISK_REGISTER.md` and the commit
`e89d51c` — before this document existed.

## 1. The mechanism decision that unblocks everything else

**Progression approval never lets a backend RPC write `liftProgress` /
`conProgress`.** `@hybrid/strength-engine` and `@hybrid/conditioning-engine`
own that math and it stays client-side, per CLAUDE.md.

The athlete's device pushes an immutable copy of a proposal it already
computed (`push_progression_proposal`, SECURITY DEFINER, `auth.uid() =
athlete_user_id` checked in the body — **not** a bare RLS `INSERT` policy,
see finding 1 below). The coach calls `decide_progression_proposal(org,
athlete, proposal_id, decision, idempotency_key)`, which follows
`create_program_assignment`'s exact shape: `coaches_athlete()` first, then
one transaction writing `coach_decisions` + `decision_receipts` only. On its
next sync the athlete's device reads its own receipt, revalidates the
proposal's stored `before` value against its current local baseline, and
only then calls the existing, unmodified `applyApprovedProposal()`. A
mismatch (the athlete retrained since the push) refuses rather than
overwriting.

## 2. New tables — four, everything else reuses layer 1–2

| Table | Purpose |
|---|---|
| `progression_proposal_snapshots` | Immutable, device-pushed proposal copy for coach review. |
| `athlete_trend_snapshots` | Pre-reduced trend arrays (top-K e1RM, one erg series, hard-count/budget) — engine math stays client-side; this is the already-computed output only. |
| `nutrition_read_grants` | Athlete-controlled, revocable consent gating the raw nutrition detail tier. |
| `coach_read_audit` | Athlete-visible log of privileged *reads* (nutrition window, session detail) — separate from `coach_decisions` because a read is not a decision. |

Reused unchanged: `athlete_domain_snapshots`, `athlete_weekly_plans`,
`coach_decisions`, `decision_receipts`, `program_templates`(+versions),
`program_assignments`, `assignment_input_versions`,
`create_program_assignment`.

## 3. Per-screen build plan

- **CoachProgression** — new: the two tables/RPCs above.
- **CoachAuthoring** — `program_templates`/`create_program_assignment`
  already covers "assign a program." The live-tuning mode (editing a
  client's own workout library) has no proposed backend — default is
  retirement for roster clients (sign-off 1).
- **CoachNutrition** — two tiers: a summary RPC (adherence %, trend
  direction, estimate confidence — no raw values, gated by `coaches_athlete`
  alone, extending the counts-only precedent) and a raw-window RPC gated by
  `nutrition_read_grants` **and** a live `coaches_athlete()` check (see
  finding 6 — the first draft omitted the AND).
- **WeekReview** — new `get_athlete_week_plan`: entries/decisions/session
  summaries, no block/set detail. Per-session detail is read-only in v1
  (sign-off 5); an edit path is not built.
- **AthleteStatus** — new `athlete_trend_snapshots` + a read RPC, gated by
  `coaches_athlete` alone (same tier as counts).
- **DecisionTrace / ExceptionHistory** — **out of scope.** Both re-resolve
  ephemeral local device state in real time; there is nothing persisted to
  serve remotely. `ClientDetailGate` keeps blocking these for roster clients.
- **OnboardingPanel** — **out of scope**, self-coach-only. Stays
  `engine-local`.

## 4. Design-stage critique — fix these when the migration is actually written

Six findings, same review posture as the layer-2 security pass, applied to
the design before any SQL exists:

1. **HIGH — "no INSERT policy" contradicted.** The synthesis's own per-table
   notes describe `progression_proposal_snapshots` and
   `athlete_trend_snapshots` as athlete-writable by a bare `auth.uid() =
   athlete_user_id` RLS policy — exactly the direct-client-write shape layer
   1–2 forbids everywhere else, and nothing stops an athlete device from
   setting `organization_id` to an org it isn't enrolled in as `'athlete'`.
   Both must be `push_*` SECURITY DEFINER functions with an
   `is_org_member(org, array['athlete'])` check, not policies.
2. **HIGH — idempotency key omits `domain`.** Stated key:
   `(organization_id, athlete_user_id, subject, source_at)`. In
   `progression.ts`, `source_at` is session-level (shared by every move in a
   session) and `subject` is a free-text display string — a strength and a
   conditioning proposal from the same athlete can share both and collide.
   The identical bug class the `coach_decisions` idempotency comment already
   documents. Add `domain` (and the real progression `key`, not the display
   `subject`) to the uniqueness scope.
3. **HIGH — the "client-minted uuid" doesn't match what the code mints.**
   Real local ids are deterministic strings like
   `` `strength:${session.id}:${move.key}:${at}` ``, not UUIDs, and not
   proven globally unique across athletes. Either the server mints `id` via
   `gen_random_uuid()` on push and returns it for the device to store, or the
   match is on the natural key from finding 2 — not a `uuid` column expecting
   the device's own string.
4. **MEDIUM-HIGH — `decide_progression_proposal` doesn't validate
   `proposal_id` against the snapshot.** As specified it writes the decision
   and receipt without joining `progression_proposal_snapshots` to confirm
   the id belongs to `(org, athlete)` or to source the real `subject`/
   `before`/`after` for the receipt. A coach-supplied id and summary text
   would go unchecked against what the athlete's engine actually produced.
   Must `select … where id = p_proposal_id and organization_id = … and
   athlete_user_id = …`, erroring if not found, and build the receipt from
   that row.
5. **MEDIUM-HIGH — no `hard`/`direction` column.** The design promises the
   constraint `reason` string is stripped to a boolean at push time, but the
   column list has nowhere to put it. Without a real `hard boolean not null`
   column, the coach cannot be told a proposal is a pain/illness-blocked
   `review` case at all — the same failure shape (a safety signal silently
   not reaching the reviewer) as the snapshot-crash finding in the layer-2
   review, this time by omission rather than crash.
6. **MEDIUM — nutrition raw-window gate may not be AND'ed with
   `coaches_athlete()`.** If `nutrition_read_grants.granted_to` is null
   (org-wide, open per sign-off 2) or a grant outlives a later-revoked
   assignment, a same-org coach who does not coach this athlete could still
   read raw macros/weight. Require both checks together, the same
   belt-and-braces the layer-2 review added to `coaches_athlete()` itself.

Holds up, per the critique: engine-math ownership stays client-side and
unmodified; nothing here lets nutrition data reach the Coordinator or feeds
`whole-athlete-state` a target instead of a fact. Also flagged as needed but
not yet specified: `get_athlete_week_plan` and the trend RPC will need the
same defensive jsonb-shape guards `get_athlete_training_summary` needed for
`athlete_domain_snapshots`/`athlete_weekly_plans` — both are unconstrained,
client-written JSON.

## 5. Sign-offs

Numbered for reference. 1 and 2 are decided (8 August 2026); the rest are
defaults stated explicitly so silence is not mistaken for approval.

1. **DECIDED — CoachAuthoring live-tuning mode gets a real backend.**
   Not retired. `get_athlete_workout_library` is designed and reviewed —
   see §6. One critique finding (a cross-athlete content leak through the
   unmodified `create_program_assignment`) must change the plan, not just
   the SQL, before this is built.
2. **DECIDED — nutrition consent is per-coach, immediate revocation.**
   `nutrition_read_grants.granted_to` is `not null` — a specific coach id,
   never org-wide. The raw-window RPC checks `revoked_at is null` as a live
   read on every call (not a cached/synced flag), so there is no window
   after revocation where a removed coach still reads raw macros or weight;
   the very next call simply fails the grant check. Default grant duration:
   none stated by the user — until explicitly revoked, matching how
   `coach_athlete_assignments.status` itself has no expiry today.
3. **Progression sanitization** — is `hard: boolean` sufficient in place of
   `constraint.reason` (default: yes, matches `has_safety_flag`), or does
   coaching need a coarser reason category as a middle ground?
4. **SessionDrawer scope** — read-only in v1 (default above), or build
   `propose_session_edit` too, and if so how the athlete-device diff-apply
   is verified against drift?
5. **Trend snapshot cadence** — push-on-open only (default; the view may be
   briefly stale) vs. a new push trigger?
6. **Read-receipt UX** — is a nutrition-window/session-detail read surfaced
   live to the athlete via `coach_read_audit`, and can they revoke access
   mid-session?
7. **Retention/expiry** — for `progression_proposal_snapshots` and
   `athlete_trend_snapshots`: kept forever like `coach_decisions` (default),
   or pruned once superseded/applied?
8. **`explanation`/`reasonCode` string audit** — not a decision, a task:
   confirm today's decision-explanation templates don't already interpolate
   raw `constraint.reason` before `get_athlete_week_plan` ships, since that
   would leak the same detail sign-off 3 is deciding to withhold.

## 6. `get_athlete_workout_library` — BUILT (resolves sign-off 1)

Migration: `supabase/migrations/20260808_arc_workout_library.sql`. Deny
suite: `checks/migrations-apply.mjs`, "ARC — the coach workout library".
Every finding below is fixed in the shipped SQL, not deferred; findings 2
and 3 additionally have a mutation-proven test — the deny check was
confirmed to fail when the fix is reverted, the same standard applied to
every other check in this migration set.

Same process as §§1–4: two independent proposals, a synthesis, an
adversarial critique. The critique found a genuinely serious hole the
synthesis's own prose had papered over — recorded here so it cannot be
missed when this becomes SQL.

**The central question, resolved.** A published draft becomes a real
`program_assignment`, through the *existing, unmodified*
`create_program_assignment` — not a second, parallel intent channel.
Publishing: (1) snapshots the draft into an immutable
`program_template_versions` row, (2) calls `create_program_assignment`
against that version, in the same transaction. The assignment lands in its
existing `draft → ready-for-coordinator → accepted` state machine; the
Coordinator places it exactly like any templated program. The coach never
writes a session or a date.

**New table**, `coach_workout_drafts` — the mutable head a coach live-tunes
before publishing: `id, organization_id, athlete_id, coach_id` (last
editor), `workout_id` (client-minted, matches the real `Workout.id` used in
`EngineDB.workouts`), `template_id` (FK `program_templates`, nullable,
created lazily on first save), `kind`, `body jsonb` (the real `Workout`
shape — `name`, `blocks`, `days`, `dates`, `folderIds` — opaque to Postgres,
no progression math in SQL), `base_version`, `updated_at`, `updated_by`.
`program_templates` gains a nullable `athlete_user_id` for a private,
single-athlete template.

**RPCs**, same SECURITY DEFINER + `coaches_athlete()`-first + one-transaction
shape as everything else: `get_athlete_workout_library` (read),
`save_workout_draft` (optimistic concurrency on `base_version`, conflict on
mismatch, never silent overwrite), `publish_workout_draft` (snapshots,
assigns, all in one transaction).

**Conflict handling** — one mechanism: `base_version` optimistic concurrency
for coach-vs-coach; for coach-vs-athlete, there is no shared row to race on,
since a draft only ever reaches the athlete's device via an explicit
`accepted` assignment.

### Critique — fix these before this becomes SQL

1. **The proposed `program_templates.athlete_user_id` CHECK constraint is
   invalid SQL.** It puts a subquery inside a `CHECK`, which Postgres
   forbids — the existing migration already hit and documented this exact
   mistake for `preferred_weekdays` (`<@` was the fix there). Enforce the
   athlete/org pairing in `save_workout_draft`'s body, not in a constraint.
2. **CRITICAL — a cross-athlete content leak through the unmodified
   `create_program_assignment`.** That RPC only checks
   `coaches_athlete(org, p_athlete_user_id)`; it never checks that
   `template_version_id` belongs to that athlete or to no athlete. A coach
   who coaches both athlete A and athlete B can take a
   `template_version_id` snapshotted from B's *private* draft and call the
   existing RPC with `p_athlete_user_id = A`, assigning B's private workout
   content to A. The synthesis's claim that "the RPC layer forbids this" is
   prose only — no such check exists, and the design insists
   `create_program_assignment` stay unmodified. **This is the one finding
   that must change the plan, not just the SQL**: either add an ownership
   check inside `create_program_assignment` itself (a real modification of
   the already-audited function), or forbid private-athlete templates from
   ever reaching the generic assignment path at all and only assign them
   through `publish_workout_draft`'s own gated snapshot-and-assign call.
3. **Private templates leak through every existing template-listing
   surface.** `program_templates` RLS today is org-scoped
   (`is_org_member`), built for shared reference material. Adding
   `athlete_user_id` without touching RLS means any coach in the org sees
   every athlete's private drafts through whatever already lists templates
   by organisation. RLS must exclude `athlete_user_id is not null and not
   coaches_athlete(organization_id, athlete_user_id)`, and every existing
   template-listing query needs auditing against this new row shape.
4. **`coach_decisions.kind` doesn't have the value this needs, and the
   design contradicts itself on audit volume.** The existing enum has no
   `workout_draft_saved`; `save_workout_draft` as specified would fail on
   insert. Separately, §"Immutability/audit" says drafts are unaudited
   "no row-per-keystroke," while the RPC section has `save_workout_draft`
   writing a decision row on every save — a row-per-keystroke audit trail,
   contradicting the stated intent. Resolve to: no decision row on save,
   only on publish.
5. **No uniqueness on `workout_id` scoped to (org, athlete).** Two
   concurrent first-saves for the same `workout_id` can each pass a
   check-then-insert race and produce two `program_templates` rows for one
   client-side `Workout.id`. Needs `unique (organization_id, athlete_id,
   workout_id)` and an `insert ... on conflict` lazy-create, not
   check-then-insert.
6. **Unspecified: `Workout.dates` (one-off dates) has no mapping to
   `program_assignments.preferred_start_date`/`preferred_weekdays`.**
   `Workout` supports arbitrary one-off dates as an alternative to a
   recurring weekday set; `program_assignments` only models the latter.
   `publish_workout_draft` needs an explicit rule — reject a dates-based
   workout, or a real mapping — not silent dropping.

Holds up: the Coordinator-placement principle itself, once finding 2 is
fixed — publish never writes a date, only calls the existing intent RPC.
Idempotency scoping matches the audited pattern. `Workout` carries no
safety-flag-shaped field, so the layer-2 snapshot-crash class doesn't recur
here as-is.
