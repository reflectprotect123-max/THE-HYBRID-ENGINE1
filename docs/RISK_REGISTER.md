# Risk register

Written 8 August 2026 against `main` @ `a8ff104`. Ordered by severity.
Severity: **S4** blocks or creates serious risk · **S3** major · **S2**
meaningful · **S1** cosmetic.

Two notes on method. Twenty defects were found and fixed in an adversarial
debug on 7 August; this register is what remains, not a history. And "no
finding" is recorded where I verified something and it held, because a risk
register that lists only problems cannot be distinguished from one that never
looked.

---

## S4 — blocks completion or creates serious risk

### R1 · Automatic load increase with no confirmation and no receipt
`apps/web/src/screens/Logger.tsx:296-297` (and the mobile equivalent) writes an
adjusted weight — which can be an increase — into the next set's field.
Guarded to an untouched set, overwritable, but silent and unrecorded.
**Contradicts** "do not automatically increase load" and "any meaningful
automated change requires an inspectable receipt".
*Disposition*: make the pre-fill an explicit accept, or mark it visually as a
proposal.

### R2 · Auto-Coached session adjustment applied without approval — RESOLVED (9 August 2026)
**Scope note, read this first:** this entry, and its RESOLVED status, cover
only `SessionReceipt.tsx`'s Auto-Coached adjustment (`resolveSession()` →
propose → Approve/Decline → `LedgerEntry`). `Training.tsx:86`'s per-set
`liftProgress` banking at session completion — the smaller,
session-in-progress case this entry originally also described — is
**untouched and remains open**. No approval step exists for it. Do not read
this header as closing that path too.

`apps/web/src/screens/Training.tsx:86` banks `liftProgress` at session
completion. No approval step exists anywhere.
**Contradicted** "progression may be proposed but requires explicit coach
approval". Note the mitigating context that existed at the time: there is no
coach in the system for a self-coached athlete, and the athlete approved by
performing the set.

Design: `docs/superpowers/specs/2026-08-09-self-coach-approval-gate-design.md`.

Built: a propose-then-decide gate, the same shape `CoachProgression.tsx`'s
`RosterProgressionView` already used for a human coach, now applied to the
self-coached majority case. New file
`apps/web/src/autocoach/pendingProposal.ts` — its own `localStorage` key
(`hybrid-auto-coach-pending-v1`, additive, never a field on `EngineDB`, no
sync partition, same idiom as `ledger.ts`/`policy.ts`/`consent.ts`), holding
at most one `PendingProposal` (`date`, `sourceWorkoutId`,
`sourceWorkoutUpdatedAt`, the frozen `AutoCoachResolution`, and
`status: 'pending' | 'approved' | 'declined'`), read via
`useSyncExternalStore` (`usePendingProposal`) and a non-hook
`getPendingProposal()` for use outside render. `SessionReceipt.tsx` was
rewritten (`apps/web/src/autocoach/SessionReceipt.tsx`): an eligible
resolution now proposes itself automatically on render
(`canApply(r)` and no existing record for today), rendering a card with
`[Approve]` `[Decline]` instead of applying. Today's as-authored session
stays fully trainable while a proposal sits undecided — the design's
explicit decision that ignoring the card is always safe. Approve applies the
**frozen** resolution captured at propose time, not a fresh re-resolve, via
the same unchanged `planApply → update → recordApply` sequence Apply always
used; Decline marks the record `declined` and mutates nothing. A day
boundary is a plain `date !== today` read-time check, matching the
convention `SessionReceipt` already used for `appliedEntry` — no expiry job,
nothing carries forward. The unconditional hard-safety gate in
`resolveSession()`/`canApply()` — a pain/illness constraint has always made a
resolution un-appliable — is unchanged and is still the thing that actually
keeps a hard constraint from being banked; the approval click is a pause
point on top of it, not a replacement for it.

**Two real bugs surfaced across two review rounds on the first implementation
commit (`2633dd7`), each fixed and committed separately.** Round 1
(`46d5a83`) was a genuine data-loss path: the original effect and
`handleApprove` re-checked only `r.state === 'safety_stop'` before applying,
never whether the *source workout itself* had changed since the proposal was
frozen — so an athlete who edited today's workout after a proposal was
raised, then clicked Approve, would have the frozen (now-stale) blocks
silently overwrite their edit. Fixed by adding
`pending.sourceWorkoutId !== workout.id ||
pending.sourceWorkoutUpdatedAt !== (workout.updatedAt ?? 0)` to both the
withdrawal effect and `handleApprove`'s defence-in-depth backstop, withdrawing
the proposal silently (per the design's decision on silent withdrawal)
instead of applying stale content. Round 2 (`1951695`) found that fix itself
introduced a spurious propose/withdraw loop: comparing the raw
`pending.sourceWorkoutUpdatedAt !== workout.updatedAt` is asymmetric for a
workout with no `updatedAt` field, since one side normalizes through
`?? 0` at propose time and the other did not at re-check time, so a freshly
proposed record could immediately compare unequal to itself and
withdraw-then-repropose in a loop. Fixed by applying the same `?? 0`
normalization on both sides of both comparisons. This second fix was
mutation-tested by reverting the comparison to its pre-fix asymmetric form —
the test didn't just fail an assertion, it reproduced the literal reported
symptom live: React's "Maximum update depth exceeded", thrown from inside
`withdrawPending`'s `persist()` → `listeners.forEach` notify call — about as
direct a confirmation as a mutation test gets. Restored exactly (verified via
`git diff` showing only the intended two-line change) and reconfirmed
passing.

The staleness re-check itself (added in round 1) was separately
mutation-tested by disabling just the new staleness condition while keeping
the pre-existing `safety_stop` check: confirmed the test then failed for the
right reason (the stale proposal survived instead of being withdrawn), then
restored exactly and reconfirmed passing. The original withdrawal branch
(pain/illness re-check) was mutation-tested the same way when first written:
temporarily replaced with a no-op, confirmed `-t "withdraws"` then failed
because `getPendingProposal()` stayed `'pending'` instead of becoming
`null`, then restored and reconfirmed. All three mutation tests, in other
words, proved the assertions they guard are load-bearing rather than
vacuously passing.

Copy that described the old immediate-apply behavior was updated so athletes
aren't consenting to language that no longer matches what happens:
`ModeSwitcher.tsx`'s `auto_daily` mode description and its auto-apply
consent paragraph now say changes are suggested and apply only once
approved; `consent.ts`'s `CONSENT_TEXT_VERSION` was bumped 1 → 2 so an
athlete who accepted the old wording is distinguished from one accepting the
new wording. A follow-up review caught that `consent.ts`'s own module-level
doc comment for `autoApplyConsent` still asserted the old "applies without a
per-instance confirmation" behavior — fixed to describe suggestion, not
unasked application (`1907b07`).

New tests: `pendingProposal.test.ts` (8, store logic — create/read, status
transitions via `decidePending`, `withdrawPending` clearing the record, a
fresh `proposePending` replacing any existing record even a decided one, and
localStorage persistence; the store itself has no date concept — per its own
docstring, "date-matching against 'today' is the caller's job", so it never
filters by date) and `SessionReceipt.test.tsx` (7, `apps/web`'s first
render-level test for this component, using the
`@testing-library/react`/jsdom harness R8 added) — propose without mutating,
approve re-checks safety then runs the existing apply sequence, decline marks
declined without mutating, a new hard constraint withdraws silently on the
next render, a source-workout edit withdraws silently, a workout with no
`updatedAt` does not spuriously self-withdraw (the round-2 regression test),
and — the one test that does exercise the date boundary — a new day proposes
fresh, ignoring a stale-dated declined proposal from a prior day. Full
`apps/web` suite (`pnpm --filter
@hybrid/web exec vitest run`): 220 passed, 2 skipped (unrelated,
`SB_E2E`-gated live backend round trip), 0 failed. `pnpm run typecheck`:
17/17 projects. `node checks/docs.mjs && node checks/coach-contract.mjs &&
node checks/ecosystem-contract.mjs`: all green, unaffected as expected since
none touch `apps/web/src/autocoach/**`.

Ported to `apps/mobile` (2026-08-09): the same propose-then-decide gate,
policy, consent and ledger now exist on mobile
(`apps/mobile/src/autocoach/*`), independently persisted (mobile and web
keep separate storage — this was never a shared/synced concept on either
platform) but structurally identical and covered by the same test
discipline.

### R3 · Automation receipts are device-local — RESOLVED (8 August 2026)
`apps/web/src/autocoach/ledger.ts:27` — `hybrid-auto-coach-ledger-v1` in
localStorage, in no sync partition
(`packages/engine/src/ecosystem.ts:172`). A coach on another device cannot see
that the system adjusted a session, and the athlete loses the record on
reinstall.
*Disposition*: synced, append-only, before any coach surface claims otherwise.

Built: `supabase/migrations/20260808_arc_receipts_autocoach.sql` —
`autocoach_receipts` (append-only, RLS-gated, no client INSERT/UPDATE/DELETE
policy — write only through `push_autocoach_receipt`, a SECURITY DEFINER
command, same shape as every other ARC push), `get_athlete_autocoach_receipts`
(coach-only, `coaches_athlete()`-gated). The local ledger itself, and undo,
stay entirely local and untouched — this only mirrors a read-only summary.
Deliberately excludes `LedgerEntry.beforeBlocks` (block/set detail) and
`forkedWorkoutId`, matching the boundary every other roster tier draws.
Pushed best-effort from `apps/web/src/cloud/arc-athlete-sync.ts`
(`pushAutocoachReceipts`) in `SyncProvider`'s reconcile cycle; read in
`CoachProgression.tsx`'s roster view, "What the system adjusted for
{clientName}". Deny suite: `checks/migrations-apply.mjs`, "ARC — autonomous
adjustment receipts" — cross-tenant, cross-athlete-relationship and idempotent
replay all mutation-tested (the `coaches_athlete()` gate was removed and both
denial tests confirmed to fail, then restored).

**A real HIGH-severity finding survived to the first commit, caught by an
independent adversarial-critique pass before this went further.** The first
draft's own header comment claimed `ResolutionOperation.before`/`after` were
always "short structured strings" and safe to forward as-is. False:
`packages/auto-coach/src/resolve.ts`'s `cap_intensity` branch interpolates
the raw EXERCISE NAME into both fields — block/set-level content this roster
tier exists to withhold, and reachable for any roster athlete's real
workout, already wired end-to-end (pushed, read, rendered) by the time the
critique ran. Fixed by stripping `before`/`after` entirely at the source
(`sanitizeReceiptOperations`, colocated-tested and mutation-tested) — a
coach now sees only `type`/`targetPath` (block/exercise INDICES, never
content)/`reasonCode`/`materiality`. Because `push_autocoach_receipt` is
callable directly (not only through the sanitised client path), the same
shape is re-validated server-side against the closed `ActionType`/
`Materiality` vocabularies, and `reason_codes` against every real code
`resolve.ts` emits (verified by reading the source, not assumed) — both
paths mutation-tested. Two lower-severity findings from the same pass were
also closed: `occurred_at`/`session_date` plausibility bounds, and a UI copy
line that misattributed the change to `whole-athlete-state` instead of
`@hybrid/auto-coach`, the package that actually owns the autonomy decision
per this file's package-ownership rule.

### R4 · Silent empty screens if a coach surface queries per-athlete
Every RLS policy is `auth.uid() = user_id`; RLS **filters** rather than raising.
A coach UI fetching another athlete gets an empty result, not an error.
*Disposition*: any multi-athlete work must design this failure mode explicitly.
Documented in `docs/COACH_INTEGRATION.md`.

## S3 — major

### R5 · Composite readiness blends athlete report with vendor score
`packages/whole-athlete-state/src/state.ts:62-70` averages WHOOP recovery and
sleep with self-reported soreness, energy and stress into one number. The stated
constraint is that direct athlete input **outranks** wearable information; in
the maths neither outranks the other. The `source` tag is retained, so a surface
can show provenance — none currently must.

### R6 · Unsourced thresholds presented as bands
Readiness `>= 70` / `>= 45` (`state.ts:19`) and `recoveryBand`'s good/watch/low
(`packages/engine/src/hr.ts:54-60`) carry no documented rationale. The names
imply physiological authority the inputs do not support.
*Disposition*: relabel, or document provenance as explicitly as
`nutrition-engine/src/defects.ts` does for its known flaws.

### R7 · `/coach` fails offline in a PWA — RESOLVED
`apps/web/vite.config.ts` used to exclude ALL of `/coach` from
`navigateFallback`, with a stale comment asserting the coach is "a different
app at the same origin". It is a lazy chunk of the same SPA
(`apps/web/src/App.tsx`).
Fixed with a real per-route answer, not a blanket unblock: the three
read-oriented ARC layer-3 routes (`review`, `nutrition`, `progression`)
reopen offline from the precached shell; every mutation-heavy `/coach/*`
route stays online-only until a real offline outbox exists, and a NEW
mutation route is denylisted by default. See `docs/COACH_INTEGRATION.md`,
"The PWA trap".

### R8 · Coach bench has no render tests — RESOLVED (8 August 2026)
~2,700 lines of UI covered only by `checks/react-smoke.mjs`, which drives
exactly one legacy route (`/coach/legacy`) in a real browser and never
touched any ARC layer-3 screen. Its logic was unit-tested; its rendering
was not.

`apps/web` had no `@testing-library/react` before this — the one prior
render test (`ClientDetailGate.test.tsx`) deliberately used
`renderToStaticMarkup` specifically to avoid needing it, by testing a pure
presentational sub-component rather than the hook-wired screen, which
doesn't reach real screens calling `useCoachWorkspace()`/`useEffect`
directly. Added `@testing-library/react`, `@testing-library/jest-dom` and
`jsdom` as devDependencies (dev-only); `vitest.config.ts`'s global
`environment: 'node'` is untouched — each consuming file opts in via the
standard `// @vitest-environment jsdom` per-file directive.

`apps/web/src/coach/coach-test-harness.tsx`: `FakeCoachWorkspaceRepository`
(every `CoachWorkspaceRepository` method implemented and independently
settable) and `renderCoachScreen()`/`rosterClient()`. 8 screens now covered
— `ArcCoachFrame`, `CoachProgression`, `RosterPlanner`, `CoachAuthoring`,
`CoachNutrition`, `WeekReview`, `AthleteStatus`, `CoachCommandCenter` —
every one mutation-tested (a real behavioral bug seeded into the component,
confirmed the specific test catches it, reverted). A real testing-pattern
trap surfaced and is documented in the harness: `CoachWorkspaceProvider`
populates `clients`/`selectedClient` via an async `useEffect` that resolves
after `render()` returns, so an absence assertion run immediately after
`render()` can pass for the wrong reason; every test flushes with
`await act(async () => {})` first.

Two things this pass caught that were NOT test-writing bugs:
- `CoachAuthoring.test.tsx`'s generating agent left behind an unrelated,
  incorrect edit to `CoachAuthoring.tsx` itself (reverting
  `PUBLISH_WEEKDAYS`'s Sunday from `0` back to `7` — the exact bug fixed
  earlier the same session) despite its own test correctly asserting `0`.
  Caught by diffing every production file before committing, not just
  running tests; reverted before it ever reached `main`.
- **RESOLVED**: `CoachProgression.tsx`'s `RosterProgressionView` Approve
  button disabled only on `proposal.direction === 'review'`, never checking
  `proposal.hard` directly. `hard` and `direction` are independent fields on
  `AthleteProgressionProposal`, and the self-coach view on the same screen
  already gated on both (`hardSafety.length > 0` alongside its own
  direction check) — only the roster view was missing the second gate. Now
  `disabled={proposal.direction === 'review' || proposal.hard || busyId ===
  proposal.id}`, matching the self-coach view's posture and CLAUDE.md's
  "pain and illness flags outrank every other signal." Mutation-tested: a
  `hard: true` proposal paired with a non-review direction (the exact case
  the old code would have left clickable) is now confirmed disabled.

### R9 · Label OCR unverified against real packets
The parser is well tested (38 tests) and the camera path bundles, but no one has
photographed a real label. The dangerous failure is a **plausible wrong digit**
— 3.2 read as 8.2 looks exactly like success. Mitigated by design: nothing is
written without explicit confirmation.

## S2 — meaningful

### R10 · Ecosystem sync is flag-gated and not yet exercised in production
`VITE_HYBRID_ECOSYSTEM_SYNC` / `EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC`. The web
merge defect that made this unsafe was fixed on 7 August, so the flag is now
safe to enable — but the path has not run against production traffic.

### R11 · Legacy `app_state` blob still the live read path
Documented as a deliberate migration bridge; `CLAUDE.md` forbids removing it
until old mobile builds age out and a rollback rehearsal proves domain
isolation. Risk is in the eventual removal, not today.

### R12 · Empty food catalogue makes barcode scanning look broken
Every lookup misses and routes to "create the food". Correct by design,
indistinguishable from a bug to a user.

### R13 · `staleness` influence unquantified
`SessionProposal.staleness` raises a long-unscheduled session's standing. It
adds no volume and caps still apply, so "no make-up debt" holds in the sense
that matters — but I did not trace the weighting magnitude, so the claim is
unverified rather than proven.

### R15 · Nutrition consent-gate regression test deleted with `CoachNutrition` — dormant, not live
`apps/web/src/coach/CoachNutrition.test.tsx` (~217 lines, one of the 8 screens
R8's 8 August pass mutation-tested) covered the two-tier consent boundary
`RosterNutritionView` enforced: a no-consent SUMMARY tier (`getNutritionSummary`)
and a raw-detail tier gated on `granted && window_ &&` — the athlete's own
revocable `hasNutritionGrant` consent, on top of `getNutritionWindow` returning
non-null. It caught exactly one bug class: a gate-inversion that renders raw
macros/weight/check-in whenever the window happens to be non-null, without
ALSO checking consent — leaking an athlete's raw nutrition data to a coach who
was never granted it.

Deleted 11 August 2026 alongside `CoachNutrition.tsx` itself, as part of the
Stage-1 coach redesign's accepted roster-nutrition regression (see
`docs/superpowers/sdd/2026-08-11-coach-redesign-stage1/task-6-report.md`): the
Nutrition pillar that replaces it (`apps/web/src/coach/pillars/Nutrition.tsx`)
reads local stores only and is BLOCKED for a roster client by
`ClientDetailGate`, so `hasNutritionGrant`/`getNutritionWindow` are composed by
no UI today — `apps/web/src/cloud/coach-repository.ts` still implements both,
they are simply unreachable from any screen. *Disposition*: not a live risk —
there is no reachable render composing the two calls for a gate-inversion bug
to hide in. It becomes one the moment roster nutrition is restored on the
pillar: that work must restore gate-inversion coverage (a mutation-proven
test, same shape `CoachNutrition.test.tsx` used) alongside the feature, not
ship the feature first and the test later.

## S1 — cosmetic / hygiene

### R14 · Two checks not wired into CI
`checks/pwa-update.mjs` and `checks/screens.mjs` are manual-only. `screens.mjs`
is a screenshot tool, not a test — correctly excluded. `pwa-update.mjs` is a
genuine gap.

---

## Verified and NOT a risk

Each of these was checked rather than assumed:

- **Secrets in the repository**: no service-role key, no private key, no
  password, no `.env` tracked. Every `*_SECRET = '...'` found is a
  self-labelled test fixture in `checks/` (`'contract-test-secret'`,
  `'local-fixture-secret-not-the-real-one'`). Each `service_role` hit is either
  a SQL comment explaining that the role bypasses RLS, or a test signing a fake
  token.

  **One qualified exception, stated precisely rather than waved through** —
  `packages/config/src/index.ts:24-27` carries a real production Supabase
  project URL and a real `anon` JWT as fallback defaults. Decoded, its claims
  are `role: anon`, ref `orysjncrksmdfabpuftd`, expiring 2036.

  An anon key is *designed* to be public: it ships in every browser bundle and
  is what RLS exists to constrain — and RLS here is proven to isolate two
  athletes against a real Postgres. So this is **not a credential leak**, and
  handing over the repo does not expose anything the deployed site does not.
  It is nonetheless a live pointer at a real project, and whether that goes to
  an outside party is the owner's call, not a mechanical one. Rotating it is
  cheap if the answer is no.
- **Account leakage**: RLS proven to isolate two real athletes against a live
  Postgres, including six cross-owner write attempts
  (`checks/migrations-apply.mjs`).
- **Data loss on merge**: additive both directions, deletes are tombstones, and
  the nutrition slice cannot move the training fingerprint. Asserted in tests on
  both sides.
- **History rewriting**: log entry macros are snapshotted at log time and never
  re-derived; a hand edit now carries the snapshot with it and stamps
  `manual_macro_edit`.
- **Missing data becoming "normal"**: explicitly `'unknown'`, and a missing
  recovery score is a no-op on load.
- **HRV as a safety gate**: not found anywhere.
- **Destructive restore**: not audited in depth this pass — see gaps below.

## ARC coach workspace — accepted residual risks

`supabase/migrations/20260808_arc_coach_workspace.sql` was reviewed
adversarially on 8 August 2026. Nine findings were raised; the boundary breaks
are fixed and covered by mutation-proven tests in `checks/migrations-apply.mjs`.
Two things were decided rather than fixed, and they are recorded here because
they are real.

- **The table owner reads everything.** No coach table carries
  `force row level security`, so the owner is exempt from its own policies.
  That exemption is not an oversight — it IS the write path. There is no INSERT
  policy anywhere in the file; every write goes through a `SECURITY DEFINER`
  command that runs as the owner and performs its own organisation, athlete and
  role checks. Forcing RLS would break those commands, and the only repair
  would be to add INSERT policies, which is precisely the direct-table-write
  surface the commands exist to remove. **Consequence: the service-role key is
  a full read of every athlete's coaching data. It must never reach a client
  bundle, a log, a CI variable that is echoed, or a chat window.**
- **Audit records are deletable by cascade, and only by cascade.** A direct
  `delete` or `update` on a decision or receipt is refused by trigger. A
  deletion of the organisation or the athlete cascades and is allowed, because
  a record that can never be removed makes an erasure request impossible to
  satisfy. The discriminator is that the parent row is already gone by the time
  the trigger fires. Both halves are tested.
  - RESOLVED (8 August 2026): `coach_decisions.actor_user_id` was
    `on delete restrict`, blocking deletion of a coach's `auth.users` row
    outright. Decided: anonymise the actor, never transfer it — the decision
    row and its receipt belong to the ATHLETE's history, which needs to keep
    knowing WHAT happened and WHEN, not WHO, once that identity is erased.
    Built in `supabase/migrations/20260808_arc_erasure_actor.sql`:
    `actor_user_id` is now nullable with `on delete set null`, and
    `coach_decisions`'s immutability trigger is replaced with a narrower
    function (`deny_coach_decision_mutation`, `deny_mutation` itself and
    every other table using it are untouched) that permits EXACTLY one
    UPDATE shape — the actor moving to null, every other column unchanged,
    checked via a schema-generic `to_jsonb(new) - 'actor_user_id' =
    to_jsonb(old) - 'actor_user_id'` diff. That diff replaced a first draft
    that enumerated all 10 other columns by name — an independent
    adversarial critique caught that a hand-enumerated allowlist is a latent
    trap (unlike `deny_mutation()` itself, which refuses every UPDATE
    unconditionally and needs no such list, this fork's safety would have
    depended on the list staying exhaustive against every future `alter
    table coach_decisions add column`, with nothing tying the two
    together). The same critique also independently reproduced the
    FK-auto-name assumption from a clean `initdb` and confirmed it correct
    (and confirmed, by hand-forcing a wrong name, that the deny suite would
    have caught it if it weren't). Mutation-tested: a hand-crafted UPDATE
    smuggling a `kind` change, a `payload` change, or an actor
    REASSIGNMENT (to a different living coach, not a null) alongside the
    erasure is refused in every case.
  - RESOLVED (8 August 2026): the three columns this entry originally named
    as still open (`organizations.created_by`, `program_templates.created_by`,
    `program_template_versions.published_by`), plus two more in the same
    shape this note had not yet named (`training_block_templates.created_by`,
    `program_assignments.created_by`) and one already-open dependant
    (`assignment_input_versions.created_by`) — six columns total, all
    `on delete restrict` against `auth.users` — are now all `on delete set
    null`, same "anonymise, never transfer" policy as the actor fix. Built in
    `supabase/migrations/20260808_arc_erasure_creators.sql`. Four of the six
    columns (`organizations`, `program_templates`, `training_block_templates`,
    `program_assignments`) sit under no immutability trigger at all, so
    widening the column and the FK action was the whole fix. The other two
    (`program_template_versions.published_by`,
    `assignment_input_versions.created_by`) sit behind `deny_mutation()` and
    each got its own narrow escape-hatch function
    (`deny_template_version_mutation`, `deny_assignment_input_version_mutation`),
    same schema-generic-diff shape as `deny_coach_decision_mutation` —
    permitting exactly one UPDATE shape (that table's own actor column moving
    to null, nothing else changing). A shared `TG_ARGV`-parameterised
    function was considered and rejected: a novel mechanism this codebase
    doesn't otherwise use, for two call sites. Mutation-tested: disabling
    each escape hatch's diff check was confirmed to let a smuggled
    `rule_set_version` / `proposals` change ride along with the erasure, then
    restored and reconfirmed refused. `checks/migrations-apply.mjs` proves,
    in one pass, that erasing a single coach who created one row on every
    affected table nulls all six columns and loses none of the six rows.

## Gaps in this register

- Restore/import destructiveness was not traced end to end.
- WHOOP and Concept2 ingestion were inventoried, not audited.
- No accessibility audit was run for this document; see
  `docs/ACTUAL_UX_AUDIT.md`.
