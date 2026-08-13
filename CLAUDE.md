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

## The coach workspace is desktop-first, phone is a supported viewport (amended 11 August 2026)

This rule used to read "WEB ONLY" — never ported, never designed at a phone
viewport, full stop — then, on 9 August, loosened to "mobile is open for
exploration": a phone layout could be designed and reviewed, but nothing
built on it was approved yet, and `checks/screens.mjs` stayed athlete-only on
purpose so a still-unapproved surface could not quietly grow a real check.
The coach-workspace redesign
(`docs/superpowers/specs/2026-08-11-coach-workspace-redesign-design.md`) is
that exploration's outcome: the owner approved a phone layout for `/coach` on
11 August 2026, stage 1 shipped it, and this section itself warned against
leaving stale wording standing once the thing it described stopped being
true. So the wall moves again — the principle behind it does not: everything
under `/coach` is still composed and judged at desktop width first, and a
phone claim is only real once a check, not a screenshot someone eyeballed
once, can catch its regression.

- `1440px` remains the width the workspace is composed at and the default
  review width for every route under `/coach`, `CoachWorkspaceRepository` and
  everything that consumes it. Phone is a supported second viewport, not the
  primary one — nothing here reverses that ordering.
- **A coach on a phone can ask for the desktop layout** (13 August 2026).
  `useDesktopView` rewrites the viewport meta to `width=1440`, which is the
  only lever that can talk CSS media queries out of their answer — nothing
  inside the page can. Consequences that are part of the rule, not
  incidental: it is a WHOLE-DOCUMENT switch, so the hook restores the
  original tag on unmount and the control lives in `ArcCoachFrame`, which
  only mounts under `/coach`; `maximum-scale=1` is dropped with it, or the
  coach cannot zoom into what they just asked for; and the control is
  `fixed`, NOT in the `sm:hidden` phone bar, because turning it on takes the
  viewport above `sm` and would hide the only way back. This does not soften
  the phone-support requirement above — a route must still hold at 420px on
  its own.
- Phone-width support is per-route, proven by `checks/screens.mjs`, not
  claimed for the whole bench at once. As of stage 1 (11 August 2026) it
  shoots five `/coach` routes at 420px and fails on horizontal overflow:
  `/coach` (the Command Center launcher) and the four pillar screens,
  `/coach/readiness`, `/coach/strength`, `/coach/conditioning`,
  `/coach/nutrition`. All five hold at 420px with no overflow and no
  screen-specific carve-out — the mockup's own responsive rules in
  `coach-redesign.css` covered every pillar; the one repair this stage needed
  was in `ArcCoachFrame.tsx` itself (a CSS Grid row-stretch bug inflating the
  mobile hamburger bar into ~200px of dead space), not the mockup.
  Stage 3a (11 August 2026) adds a sixth: `/coach/library`, which holds at
  420px. (That stage originally read "with its Programs and Calendar tabs";
  the owner deleted the Programs tab in the same stage, so the Library IS the
  calendar and there are no tabs to hold.) The Calendar needed one repair
  the mockup could not have shown — it reveals an empty day's actions on
  `:hover` only, which does not exist on a phone, so the day carries a real
  tap target and an opened panel is shown regardless of pointer
  (`.cal-cell-tap` and `.cal-cell.empty .cal-hover.open` in
  `coach-redesign.css`, the only two rules in that file not ported from the
  mockup). Stage 2 (13 August 2026) adds a seventh:
  `/coach/settings`, which holds at 420px with **no repair at all** — the
  mockup's own phone block (`coach-redesign.css:688`) already collapsed the
  grid to one column, wrapped the tab column into a row and took a row's
  select full width, and every one of those rules did its job the first time
  it was asked to. Stage 2 added no CSS whatsoever, which is the strongest
  form this claim comes in: the layout is the mockup's, unamended, and the
  check proves it.
  **Stage 4 (13 August 2026) closes the set.** `checks/screens.mjs` now
  shoots EVERY `/coach` route at **both** widths — 1440px first, then 420px:
  the seven above plus `author`, `progression`, `review/:weekStart`,
  `legacy`, `day/:date`, `build/:id`, `planner/:id` and
  `roster-plan/:workoutId`. Thirty shots, all green. The parameterised ones
  are addressed with values the seed really contains — a route pointed at a
  missing id renders a not-found state, which has no overflow and would pass
  while proving nothing.

  **The 1440px pass is new, and its absence was the real hole.** This section
  has asserted since 11 August that 1440px is "the default review width for
  every route under `/coach`", and until stage 4's close-out the check only
  ever opened a 420px window. Every stage was proving the SECONDARY claim
  while the primary one — about the desktop dashboard a coach actually works
  on, which is a browser surface and is not in the Android app — went
  unwatched. Both widths fail on horizontal overflow now, and they mean
  different things: at 420px a phone needing a sideways swipe, at 1440px a
  layout that has outgrown the width it was composed at.
- **Nothing under `/coach` is desktop-only.** Not "not yet" — every route is
  now shot at 420px and every one passes. The spec named two candidates it
  expected to fail, both wide tables: the Library calendar and WeekReview's
  ledger. BOTH PASSED, so both guesses are retired here rather than left
  standing as hedges.

  Stage 4 found two real defects instead, neither of them a table:
  `CoachShell`'s header laid a title and ten controls in one non-wrapping row
  — 775px inside a 420px viewport, the whole PAGE scrolling sideways — and
  `BlockTypeStep`'s brass option pills had a fixed `!h-9`, so "Warm-up /
  Cooldown" and "Metcon / notes" wrapped to a second line that rendered
  outside the pill. Both are fixed. Worth keeping in mind next time: the
  screens that were feared were fine, and the damage was in a toolbar and a
  button height nobody had thought about.

  `ProgramGrid`'s week table is the pattern to copy — it has always had its
  own `overflow-x-auto`, so wide content scrolls INSIDE its container and the
  page never does. If a future screen genuinely cannot work at phone width,
  it is named here explicitly with the reason, exactly as this rule requires
  — but no screen has earned that yet.
- Phone support here means the responsive WEB bench — `apps/web`'s own
  `/coach` routes rendering usably down to a phone-width viewport. This bullet
  used to add "there is no native mobile app in this repository to port into"
  — `apps/mobile` had been deleted (commit `8628060`, "the PWA now covers
  everything it did"). That is no longer true: `apps/mobile` is back, and as
  of 13 August it ships the round-major session logger. So the directory this
  approval could leak into DOES exist now, which makes the boundary matter
  rather than retire it — nothing under `/coach` has a native counterpart,
  and none is authorised by this section. If a native coach surface is ever
  proposed again, that is its own product
  decision requiring its own explicit approval — this amendment does not
  imply or grant one.
- Every route is covered, so the standing instruction changes shape rather
  than retiring: a NEW `/coach` route joins `checks/screens.mjs` in the same
  commit that adds it. The coverage list above is now a claim about the whole
  bench, and a route that ships without a shot silently makes it false.

  One honest limit on that claim. `roster-plan/:workoutId` is gated
  `layer3Ready` and the seed signs in a local account with no roster, so what
  that shot proves usable at 420px is the GATE, not `RosterPlanner` itself.
  The planner behind it stays unproven at phone width until there is a roster
  fixture to reach it with. That is written in `checks/screens.mjs` beside
  the shot as well, so the next reader finds it there rather than here.

## Storage and release rules

The legacy `app_state` JSON row remains a migration bridge. The public
cross-app boundary is the migration in
`supabase/migrations/20260804_fitness_ecosystem_contracts.sql`: RLS-owned core,
domain snapshots, idempotent events, and Coordinator-only weekly plans. Apply
it in staging before enabling `VITE_HYBRID_ECOSYSTEM_SYNC=1` or
`EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC=1`.

Never remove the legacy read path until old mobile builds have aged out and a
rollback rehearsal proves that no domain can overwrite another domain.

## The athlete and the coach never face each other

They are one repo, one deploy and one bundle, and they are SUPPOSED to share —
both stand on `packages/*`, on `store/`, on `cloud/`, on the design system.
What neither may do is depend on the OTHER. Sharing a floor is collaboration;
importing each other is a knot that cannot be split later without unpicking
both surfaces at once.

`checks/lane-contract.mjs` (`pnpm run check:lanes`) enforces it, and it is a
GRAPH check rather than another text scan on purpose: it resolves every
relative import under `apps/web/src` into an edge and asserts the property
directly, so it cannot pass while the thing it guards is broken — the failure
mode that made five earlier guards decorative.

The rule is now absolute, and `ALLOWED` is empty. It was a ratchet on the way
here, not a wall: real crossings existed and were listed with the reason each
one was there and what would retire it — a crossing not on the list failed,
and so did a list entry that no longer happened, so a fixed crossing had to be
deleted from the list rather than leaving budget behind. The list only ever
shrank. This section stays, empty list and all, because the point of it was
always to record the path, not just the destination.

The list started at fourteen crossings. Eleven of them were one shape:
`autocoach/policy.ts`, `autocoach/ledger.ts`, `coach/progression.ts` and
`coach/progression-store.ts` were shared code wearing a lane's directory name —
not violations, misfilings. They now sit where they belong (`store/` for the
three stores, `lib/progression.ts` for the pure proposal logic) and the
crossings went with them.

The last two were the genuine case: the bench rendered the athlete's `Planner`
and `GuidedBuilder`, real shared UI permitted by coach-contract rule 8. The
plan on record for retiring them was a package extraction — promote both
screens into a shared authoring package. That is not how it happened. On 13
August 2026 the owner parked session authoring and logging on athlete web
entirely: the athlete web app no longer authors or logs a session at all, so
there was no longer an athlete screen for the coach to reach into, and no
shared package to extract to either. `Planner`, its `planner/` block cards,
and `GuidedBuilder` with its step components moved — `git mv`, history
intact — from `apps/web/src/screens/` into `apps/web/src/coach/authoring/`
and became the bench's own code, importable without crossing a lane because
they are no longer on the other side of one. The athlete logger
(`screens/Logger.tsx` and `screens/logger/`) was deleted outright, and its
routes (`/log/:bi/:ei`, `/planner/:id`, `/build/:id`) came out of
`apps/web/src/App.tsx` along with the athlete-side controls that navigated
into them. Both crossings closed the same way the comment in
`checks/lane-contract.mjs` always said the list would end: by deletion from
the list, not by raising the budget.

## Where a test goes

Tests are COLOCATED: `src/lift.ts` is tested by `src/lift.test.ts`, in the same
directory. A test that covers a contract across several modules — a parity
suite, a boundary check, a merged-world sync test — sits with the module it
mostly exercises, named for the contract rather than the file.

EVERY test is colocated — there are no exceptions, including the coach bench
and the `SB_E2E`-gated live backend round trip, which sits with the sync
provider it drives.

`test/` still exists in three projects and holds only things that are NOT
tests: fixtures and golden vectors (`packages/engine/test/golden`,
`packages/auto-coach/test/fixtures`, `packages/nutrition-engine/test/fixtures`).
If you find a `*.test.ts` under `test/`, it is in the wrong place.

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
```
