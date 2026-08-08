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

### R2 · Progression applied without approval
`apps/web/src/screens/Training.tsx:86` banks `liftProgress` at session
completion. No approval step exists anywhere.
**Contradicts** "progression may be proposed but requires explicit coach
approval". Note the mitigating context: there is no coach in the system today,
and the athlete approves by performing the set. Under any coach model this
becomes the largest required behavioural change.

### R3 · Automation receipts are device-local
`apps/web/src/autocoach/ledger.ts:27` — `hybrid-auto-coach-ledger-v1` in
localStorage, in no sync partition
(`packages/engine/src/ecosystem.ts:172`). A coach on another device cannot see
that the system adjusted a session, and the athlete loses the record on
reinstall.
*Disposition*: synced, append-only, before any coach surface claims otherwise.

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

### R7 · `/coach` fails offline in a PWA
`apps/web/vite.config.ts:79` excludes `/coach` from `navigateFallback`, with a
comment asserting the coach is "a different app at the same origin". It is a
lazy chunk of the same SPA (`apps/web/src/App.tsx:33`). Known open; directly in
the path of any coach PWA work.

### R8 · Coach bench has no render tests
~2,700 lines of UI covered only by `checks/react-smoke.mjs`. Its logic is
unit-tested; its rendering is not.

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
  - Still open: `coach_decisions.actor_user_id` is `on delete restrict`, so
    deleting a COACH's `auth.users` row is blocked outright. Erasing a coach
    therefore needs a decided policy — anonymise the actor, or transfer it —
    and that decision has not been made.

## Gaps in this register

- Restore/import destructiveness was not traced end to end.
- WHOOP and Concept2 ingestion were inventoried, not audited.
- No accessibility audit was run for this document; see
  `docs/ACTUAL_UX_AUDIT.md`.
