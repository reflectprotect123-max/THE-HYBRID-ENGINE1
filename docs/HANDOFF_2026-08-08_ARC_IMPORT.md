# Session handoff — 8 August 2026, ARC import

Written for whoever picks this up next, in this repository or another one. It
records what a fresh session **cannot** work out by reading the code, and
nothing that it can.

---

## 1. Where the code is

| Ref | Commit | What it is |
|---|---|---|
| `main` | `e497eab` | Current. The ARC snapshot plus the web-only rule. |
| — | `cf4e80c` | The import itself, 302 files. |
| — | `762e22e` | The previous checkpoint, before the import. |
| — | `4b37736` | A Python service, far back in history. Not related to this work. |

`cf4e80c` was a **fast-forward** onto `762e22e`. Nothing was force-pushed and no
history was rewritten.

## 2. This repository is the only place the ARC workspace exists

The snapshot arrived as a zip, not as a merge, and the session that produced it
was working in **`reflectprotect123-max/THE-HYBRID-ENGINE1`**. That invited the
assumption that the zip was a copy of something already pushed there.

It is not. The two repositories were compared file by file on 8 August 2026,
`the-coach-brain@cf4e80c` against `THE-HYBRID-ENGINE1@71b14b2` (its `main`, the
merge of PR #25). **The ARC work was never pushed back to `THE-HYBRID-ENGINE1`.**

| | Files |
|---|---|
| Tracked in `the-coach-brain` | 684 |
| Tracked in `THE-HYBRID-ENGINE1` | 656 |
| Present only here | 30 |
| Present only there | 2 — both renames, no lost work |
| Differing content | 22 |

Everything present only here is the coach workspace itself:
`CoachCommandCenter`, `ArcCoachFrame`, `CoachWorkspaceContext`, `contracts.ts`,
`mock-repository.ts`, `progression`, `week-review`, `authoring`,
`nutrition-review`, `CoachLibrary`, `CoachSettings`, `CoachNutrition`,
`CoachAuthoring`, their tests, `vite.single-html.config.ts`, `tooling/`, and
`docs/ARC_CLAUDE_HANDOFF.md`.

The two files present only there are renames this work performed:
`WeeklySummary.tsx` → `WeeklySummaryPanel.tsx` (byte-identical) and
`Onboarding.tsx` → `OnboardingPanel.tsx` (identical but for one reworded
sentence, improved here).

Across all 22 differing files, `THE-HYBRID-ENGINE1` holds exactly **two lines**
that do not exist here, and their removal was deliberate — the auto-apply pair in
`apps/web/src/screens/Logger.tsx` that `coach-contract` rule 7 now forbids. Its
copy of `checks/coach-contract.mjs` has only six rules and would not catch them.

**Conclusion: `the-coach-brain` is strictly ahead. There is nothing to recover
from `THE-HYBRID-ENGINE1`, and no merge to perform.**

### What needs to be done

1. **Treat `the-coach-brain@main` as the single source of truth.** It is ahead on
   every axis. No other repository needs consulting before starting work.
2. **Do not resume feature work in `THE-HYBRID-ENGINE1`.** There is an idle
   session pointed at it whose last summary reads *"Arc is new coach dashboard;
   settled scope; handoff bundle ready on main"*. Anything built there now starts
   from a base that predates the entire coach workspace, and its weaker contract
   check would let the rule 7 violation back in silently.
3. **Decide that repository's fate and record it.** Either archive it, or push
   this work to it and keep one of the two read-only. Leaving both writable is
   how the next divergence starts. Whichever is chosen, put a line in its README
   naming the live repository — the trap here was a plausible assumption about
   where code lived, and only a written pointer prevents it recurring.
4. **`reflectprotect123-max/THEhybridsystem` has not been examined.** It carries
   the Macro+ / MacroTrack work and two archived sessions. Whether any of it is
   still needed — the retired catalogue's 471 seeded rows are noted in
   `handoff.md` as living there — is an open question nobody has answered.

## 3. What is verified green at `e497eab`

Everything the repository knows how to check, run on this commit:

- `pnpm run typecheck` — 17/17 projects
- `pnpm run test` — **1,393 passing**, 2 live-gated and skipped
  (engine 594, mobile 243, nutrition-engine 175, nutrition-core 127, web 120,
  nutrition-adapter 35, auto-coach 34, guided-flow 15, shared-core 13,
  whole-athlete-state 13, design 11, coordinator 6, coordinator-adapter 3,
  product-scope 2, strength 1, conditioning 1)
- `pnpm run verify` — the full chain, including `react-smoke` and `deploy-smoke`
- `docs`, `coach-contract`, `contrast`, `migrations-apply`, `web-touch`,
  `mobile-touch`, `screens`
- Metro bundle builds at 5.07 MB

The two skipped web tests need real Supabase credentials and skip without them.
That is expected, not a gap.

## 4. Things that cost this session time

Each of these will cost the next session the same time if it is not read.

### `/coach` fails closed

The coach bench redirects to `/` unless `VITE_COACH_USER_IDS` names the
signed-in user. A default build cannot show it at all. To see it, build with that
variable set and hand the browser a matching stored session — `checks/react-smoke.mjs`
does exactly this and is the working example to copy.

### `checks/coach-contract.mjs` reads source directly, and it is right

Rule 7 forbids the web Logger from assigning `adj.newWeight` onto a future set.
A completed set is an **actual**; turning an actual straight into the next
prescription collapses actual, proposal and coach decision into one invisible
mutation. Increases are approval-only in v1.

This session restored two lines that do exactly that, believing it was fixing a
regression, because `apps/mobile/src/screens/Logger.tsx:381-382` still has them.
The check caught it and the change was reverted. **Treat a `coach-contract`
failure as the specification talking, not a broken check.**

Note the open question that surfaced from it: the contract lists only the three
web files as targets, so the mobile Logger still auto-applies. Either mobile is a
later phase or it is an oversight — nobody has decided.

### One check in the delivered snapshot was stale

`checks/react-smoke.mjs` arrived driving `/coach` for a nutrition modal that had
moved to `/coach/legacy`, and asserting the auto-apply behaviour rule 7 forbids.
Both were corrected in `cf4e80c`. The check now asserts the intended behaviour:
the proposal is shown to the athlete, and the next set is left untouched.

### The archive was zipped on Windows

All 532 text files arrived CRLF and were normalised to LF. If another zip is
handed over the same way, expect the same. `.claude/skills` was deliberately kept
from this repository rather than the archive — the archive's vendored CSVs lost
their UTF-8 in the round trip.

### The coach workspace is web only

Written up in `CLAUDE.md`. Every route under `/coach` is a desktop surface, must
never be ported to `apps/mobile`, and must never be judged at a phone viewport.
`checks/screens.mjs` is athlete-only at 420px and should stay that way.

## 5. The backend work, if that is what is next

The repository already contains its own specification: **`docs/ARC_CLAUDE_HANDOFF.md`**.
Read it rather than re-deriving it. In short:

The coach screens depend on `CoachWorkspaceRepository` in
`apps/web/src/coach/contracts.ts`. The live implementation is
`MockCoachWorkspaceRepository` in `mock-repository.ts`. Replace it through
`CoachWorkspaceProvider`. Do not rebuild the screens, import Supabase into JSX,
or move domain decisions into React effects.

Five methods: `listClients`, `listProgramTemplates`, `saveAssignmentDraft`,
`getSettings`, `saveSettings`.

Constraints that are not negotiable:

- The database has **no** organisation, coach, or coach↔athlete entity yet.
  `ARC_CLAUDE_HANDOFF.md` lists the eight tables to add.
- Application-layer authorization is mandatory on every athlete-facing read and
  command. RLS is defence in depth. RLS **filters rather than raising**, so an
  unauthorised fetch returns an empty screen, not an error — the worst failure
  mode to debug.
- `engine-local` is the only client whose detailed data exists. Every other
  client is labelled `synthetic-fixture` and its detailed links stay disabled
  until the backend can serve a tenant-scoped projection. Do not remove that
  guard to make a demo look fuller.
- `preferredWeekdays` is coach intent, not placement. On acceptance the backend
  turns an assignment into versioned proposals and asks the Coordinator to
  resolve the week. Never add `resolvedDates` or a mutable calendar array to the
  assignment command.

Acceptance, from the handoff doc:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
node checks/coach-contract.mjs
node checks/react-smoke.mjs
node checks/docs.mjs
```

Plus deny tests proving cross-tenant and cross-athlete reads/writes, revoked
memberships, replayed idempotency keys, role escalation and guessed receipt IDs
are all rejected without leaking existence.

## 6. Reading order for a fresh session

1. `AGENTS.md` — shortest, and the one that prevents building the wrong thing.
2. `CLAUDE.md` — the operating contract, including the web-only rule.
3. This file, including section 7 before committing to any estimate.
4. `docs/ARC_CLAUDE_HANDOFF.md` — only if the task is the backend.

## 7. How big the wiring job actually is

Measured from the code on 8 August 2026. The headline: **the brief in section 5
describes roughly a quarter of the work**, and the gap is structural rather than
a matter of detail.

### The named job is small

`MockCoachWorkspaceRepository` is **41 lines**, five methods, backed by
`localStorage`. `contracts.ts` is 104. Replacing it with a Supabase-backed
implementation is a few hundred lines and a couple of days.

### The repository is not the seam

**Seventeen files under `apps/web/src/coach/` call `useDb()`, `useNutrition()`,
`useLedger()` or `useProgressionLedger()`** — the *signed-in user's own* local
stores. Every live figure on the bench comes from there, not through
`CoachWorkspaceRepository`:

| File | Local-store call sites |
|---|---|
| `CoachCommandCenter.tsx` | 4 |
| `NutritionPanel.tsx` | 4 |
| `WeekReview.tsx` | 3 |
| `ArcCoachFrame.tsx`, `CoachProgression.tsx`, `ResolutionPreview.tsx` | 2 each |
| 11 further files | 1 each |

This is why the bench currently renders the signed-in athlete's own training data
under the label "Alex Morgan", and why `engine-local` is the only client whose
detailed links are enabled. `ARC_CLAUDE_HANDOFF.md` names that guard but does not
size removing it. Removing it is the job.

### Four layers

| | Work | Estimate |
|---|---|---|
| 1 | Replace the mock — five methods against Supabase | 1–2 days |
| 2 | Eight tables, RLS, application authorization, and the mandated deny suite | 1–2 weeks |
| 3 | **Rewire seventeen files from "me" to "this athlete"** | 2–4 weeks |
| 4 | Offline boundary — outbox, replay re-authorization, account-switch isolation | 1–3 weeks |

**Roughly 5–11 ideal engineer-weeks** for one experienced developer. Layer 3
carries essentially all of the variance; layers 1 and 2 are well-specified and
predictable.

For calibration on layer 2: `supabase/migrations/20260804_fitness_ecosystem_contracts.sql`
is 247 lines for four tables, eight policies and five functions. Eight versioned
tables with immutable audit and receipt records lands nearer 600–900 lines, and
the deny tests — cross-tenant, cross-athlete, revoked membership, replayed
idempotency keys, role escalation, guessed receipt IDs — are the bulk of the care
rather than the schema itself.

### Two things that make it cheaper than it sounds

- **473 lines of projection logic are already pure and tested**:
  `week-review.ts` (120), `nutrition-review.ts` (135), `progression.ts` (176) and
  `authoring.ts` (42). Each takes data in and returns a projection; none assumes
  "me". Layer 3 is therefore plumbing, not re-deciding any rule.
- **`buildWeeklyPlanFromProposals` already exists** in `@hybrid/coordinator-adapter`,
  added by this work specifically as the coach's boundary. The Coordinator side is
  prepared and does not need a second weekly-plan writer.

### The risk worth budgeting for

RLS **filters rather than raises**. A layer 3 mistake does not throw — it renders
an empty screen, or worse, renders the coach's own records under a client's name.
That second failure is precisely what the `synthetic-fixture` guard exists to
prevent today, and it will not announce itself. Budget real time for tests that
assert *whose* data was rendered, not merely that something rendered.
