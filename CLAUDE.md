# Claude Code operating contract

This repository is THE Hybrid System. It is a pnpm monorepo with two product
build profiles, shared athlete contracts and specialist domain engines. It had
a deterministic Coordinator until 14 August 2026; see "The Coordinator is
deleted" below.

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
- `@hybrid/coordinator` and `@hybrid/coordinator-adapter` are **DELETED**
  (14 August 2026). This line read "owns weekly conflict resolution and
  chooses the final weekly plan for an athlete with no coach", and before
  that "is the only layer allowed to choose the final weekly plan", enforced
  by a database constraint. Nothing arbitrates a week now. See "The
  Coordinator is deleted" below.
- `@hybrid/product-scope` owns the product identities and their capability
  lists. It is a fact table, not a decision layer.
- `@hybrid/auto-coach` owns the autonomy policy and the session resolver. It
  applies whole-athlete-state constraints to one session; it never programs a
  week. ("and never overrides the Coordinator" ended when the Coordinator did;
  the first half is the load-bearing half and is unchanged — this layer decides
  about ONE SESSION, never a week.)
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
- Nutrition never edits a weekly plan. (This read "the Coordinator arbitrates
  TRAINING. It never resolves macros, and nutrition never edits a weekly plan."
  The Coordinator is deleted; the half that constrains NUTRITION is the half
  that still binds, and it binds against the coach's week now.)
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
  the seven above plus `progression`, `review/:weekStart`, `legacy`,
  `day/:date` and `week/:athleteId/:weekStart`. **24 shots, all green.** The
  parameterised ones are addressed with values the seed really contains — a
  route pointed at a missing id renders a not-found state, which has no
  overflow and would pass while proving nothing.

  This read "the seven above plus `author`, `progression`,
  `review/:weekStart`, `legacy`, `day/:date`, `build/:id`, `planner/:id` and
  `roster-plan/:workoutId`. Thirty shots" until 14 August 2026, when
  `author`, `build/:id`, `planner/:id` and `roster-plan/:workoutId` were
  deleted along with the screens behind them (see "The old authoring chain is
  deleted" below). Four routes fewer, four shots fewer, and the claim itself
  is unchanged: EVERY declared `/coach` route is shot at both widths.

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

  The one honest limit that used to sit here is retired, by deletion rather
  than by proof. It read: `roster-plan/:workoutId` is gated `layer3Ready` and
  the seed has no roster, so the shot proved the GATE and not `RosterPlanner`,
  which stayed unproven at phone width. `RosterPlanner` was deleted on
  14 August 2026, so there is no longer an unproven screen behind that gate —
  or a gate. Recorded rather than silently dropped: this is the caveat being
  removed with the thing it described, not a claim that it was ever met.

## Who owns the week (amended 14 August 2026)

This section exists because the sentence it replaces was not a convention. It
was a `check` constraint, and the database physically refused anything else:

```sql
-- 20260804_fitness_ecosystem_contracts.sql, until 14 August 2026
constraint athlete_plan_writer check (writer = 'coordinator'),
```

The owner asked for the TrainHeroic shape — a coach programs a week, presses
Publish, and it appears on the athlete's phone as their week — and chose
"coach wins outright" over two softer options. So the constraint widened to
`in ('coordinator', 'coach')` and `publish_coach_week` writes a coach's week
into an athlete's own row. Design:
`docs/superpowers/specs/2026-08-13-coach-publishes-the-week-design.md`.

**There are now two regimes, and the athlete's device has to know which it is
in.** That is a real increase in the number of states this system can hold,
and it is the accepted price of the product, recorded here rather than
discovered later.

| Concern | Who decides |
|---|---|
| Which sessions, in which order, on which days | **The coach**, for a coached athlete. |
| The same, for an athlete with no coach | **Nobody.** The Coordinator answered this until 14 August 2026; it is deleted. An uncoached athlete has no planned week, and their phone says so. |
| Whether today's session runs at all, given pain or illness | **The safety layer. Unchanged.** |

**Taking the WEEK from the Coordinator did not take the SESSION from the
safety resolver, and must not.** `@hybrid/auto-coach` "applies
whole-athlete-state constraints to one session; it never programs a week" —
a different layer at a different granularity. A pain or illness flag still
holds a coach's session. Removing that would be an injury-safety change
wearing a scheduling change's clothes, and it was never asked for.

A held session is not a silent hole: the athlete is told why, and the coach
must be told which session and that it was a safety flag rather than a skipped
workout. A coach who cannot tell "held for injury" from "ignored me" will stop
trusting the system inside a week.

Three consequences that are easy to get wrong, each already paid for once:

- **A coach publish must step PAST the current revision.** The upsert only
  wins `where revision < excluded.revision`, so a stale revision succeeds as a
  statement, changes nothing, and reports success. The coach is told it landed
  and the athlete never sees it.
- **`athlete_weekly_plans` is `primary key (user_id, week_start)`** — one row
  per week, so a coach publish REPLACES whatever was there. This bullet used to
  add "nothing is lost: the Coordinator recomputes the week on device, offline.
  The fallback was never the row." **There is no fallback now**, on device or
  in the row. Replacing a coach week with another coach week is still safe;
  there is simply nothing underneath it any more.
- **The merge rule is scoped to ONE week** (`chooseWeeklyPlan`, shared-core).
  A coach owns the week they published, not every week forever — otherwise an
  athlete leaving a roster could never reclaim their own weeks, because no
  newer coach write would arrive to be beaten.

## Storage and release rules

The legacy `app_state` JSON row remains a migration bridge. The public
cross-app boundary is the migration in
`supabase/migrations/20260804_fitness_ecosystem_contracts.sql`: RLS-owned core,
domain snapshots, idempotent events, and weekly plans (whose writer constraint
admitted only the Coordinator when this was written). Apply
it in staging before enabling `VITE_HYBRID_ECOSYSTEM_SYNC=1` or
`EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC=1`.

Never remove the legacy read path until old mobile builds have aged out and a
rollback rehearsal proves that no domain can overwrite another domain.

## The athlete web app is PARKED, not deleted (13 August 2026)

The owner asked for the athlete app to stop being reachable in a browser:
"I don't want the athlete's app to be seen again — hide it somewhere, and if
we ever need it again we can pull it out." So `apps/web` serves the coach
workspace and nothing else. `/` and every parked address redirect to `/coach`.

- **Nothing was deleted.** `apps/web/src/screens/` is untouched and its
  colocated tests still run. That is what makes "pull it out" real rather
  than hopeful: the screens are still PROVEN to work, so restoring them is
  re-adding routes in `App.tsx`, not repairing a year of drift.
- **They are dead code, and that is the accepted cost.** Nothing imports
  them, `tsc` still checks them, and they will drift out of step with the
  packages beneath them. If the answer ever becomes "we are not bringing it
  back", delete them — git history keeps them either way, exactly as it kept
  `apps/mobile` between commit `8628060` and its return.
- The nutrition/MacroTrack WEB world is parked with them. It was athlete
  facing too, and it lives in the Android app.
- `checks/screens.mjs`'s athlete `SHOTS` list is empty for the same reason a
  check is ever deleted: those addresses now redirect, so shooting them would
  produce nine identical pictures of the coach bench under athlete filenames.
- The coach rail's "Athlete app" link is GONE. It existed because `/`
  redirected to the bench and a coach would otherwise be stuck; it would now
  point at a route that bounces straight back. **Restoring the athlete app
  means restoring that link too**, or the coach is stuck again for exactly the
  original reason.
- The ANDROID app is the athlete product and is untouched. It is the only
  athlete client now, and it is Android-only — `eas.json` has no iOS profile.
  That is a distribution consequence of this decision, not an oversight.

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

`apps/web/src/coach/authoring/` no longer exists — see the next section. The
crossings were retired by the MOVE, not by the directory, so nothing above is
weakened by the destination being gone a day later.

## The Coordinator is deleted (14 August 2026)

The owner is rebuilding the engine from the ground up and asked for the
Coordinator and everything it does to go. It did. **Nothing in this repository
arbitrates a week any more.**

Deleted outright: `packages/coordinator` (the reconciler, its types, its
tests), `packages/coordinator-adapter`, the proposal boundary in
`@hybrid/strength-engine` and `@hybrid/conditioning-engine`
(`workoutToStrengthProposal`, `strengthProposals`, `conditioningToProposal`
and their option types), `weeklyPlan` from BOTH app stores, and on the bench
`ResolutionPreview`, `WeekReview`, `week-review.ts`, `diff.ts`,
`bench-store`'s `SlimPlan`/`slimPlan`/`setReviewBaseline`,
`AthleteWeekProjection`, `getAthleteWeek` and the `useSelectedAthleteWeek`
seam. The route `/coach/review/:weekStart` went with them.

**What survives, and why each one had to.**

- **`mondayOf` moved to `@hybrid/engine`** (`month.ts`). It is arithmetic on a
  date, not arbitration, and the COACH's week is keyed on a Monday too —
  `arc-coach-week`, `ecosystem.ts`, `sync.tsx` and `ArcCoachWeekCard` all call
  it. Do not confuse it with `coach-week.ts`'s `weekStartOfLocalDate`, which
  answers the LOCAL question; both exist on purpose.
- **The safety layer is untouched.** `@hybrid/auto-coach` resolves ONE session
  against pain and illness, and always did — it never programmed a week, so
  deleting the thing that did takes nothing from it.
- **The Whoop/Concept2 cards and the today-auto-coach panel** were salvaged out
  of `ResolutionPreview` into `AthleteSignals.tsx`. They never read a weekly
  plan; losing them would have been collateral.
- **The database was NOT changed.** `athlete_weekly_plans`, its
  `writer in ('coordinator','coach')` constraint, `publish_coach_week` and
  `get_athlete_week_plan` all still exist exactly as applied. Rows written by
  the Coordinator are still readable, which is why `AthleteWeekSummary` still
  declares a `decisions` shape — it describes what a row may CONTAIN, not what
  anything now produces.

**The consequence, stated plainly: an athlete with no coach has no planned
week.** Mobile Home says "No week has been published for you" instead of
falling back. That is the accepted price, not an oversight — the fallback used
to be the Coordinator recomputing on device, and there is no fallback now.

**Three checks were REPOINTED rather than deleted**, because their principles
outlived the layer:

- `coach-contract` rule 2 now reads as "nothing mints a `writer: 'coordinator'`
  weekly plan" — the value would be a lie about provenance.
- Rule 3 followed the nutrition/training boundary from the Coordinator to
  `@hybrid/auto-coach`, which is the layer that now decides about a session.
- Rule 4 followed the safety reason codes to `@hybrid/whole-athlete-state`
  (`pain_hold_active`, `illness_flag_active`), which is where CLAUDE.md already
  says pain and illness belong. `dropped_interference` was NOT carried over: it
  was a scheduling verdict only the Coordinator could reach, and requiring a
  code nothing can emit is how a check starts failing for being right.

One thing worth knowing about how `screens.mjs` behaved here. Deleting the
route did NOT fail `21-coach-review` — the shot PASSED, against the catch-all
redirect to `/coach`, because its only content pattern was `/Week/i` and the
Command Center contains the word "Week". A screenshot of a different screen
filed under the deleted route's name. That is the exact failure the file's own
header warns about, and it is why a pattern list must name text ONLY the
intended screen shows.

## The old authoring chain is deleted (14 August 2026)

The owner opened `/coach/author`, followed it into the builder, and asked for
all of it to be deleted. Four routes and the screens behind them are gone:

| Route | Screen | Why it went |
|---|---|---|
| `/coach/author` | `CoachAuthoring` | The self-coach half told a coach to "Build the inputs. Let the Coordinator build the week" — the regime a coach publishing a week replaced. |
| `/coach/build/:id` | `GuidedBuilder` + 7 step components | The wizard the owner was dropped into. |
| `/coach/planner/:id` | `Planner` + 4 block cards | The local-only "full editor". |
| `/coach/roster-plan/:workoutId` | `RosterPlanner` | Wrapped `Planner`, so it could not outlive it. |

Gone with them: `authoring.ts`, `authoring-store.ts`, `save-coalescer.ts` and
their tests, and three inbound links — the Library's "Open the session
builder", `SessionDrawer`'s "Full editor" and `ResolutionPreview`'s "Adjust
proposal".

**`library/DayBuilder` is the one authoring surface now**, reached from a
Library calendar day (`/coach/day/:date`) and from the week builder. Do not
add a second one without deciding which is canonical — two builders is the
state this deletion ended.

**What this cost, recorded rather than discovered later:**

- **The roster draft path lost its editor.** `save_workout_draft` and
  `publish_workout_draft` still exist server-side and in the repository
  interface; nothing in the UI calls them. A roster client's draft cannot be
  authored until `DayBuilder` is wired in `RosterPlanner`'s place. This was
  the explicit blast radius of the owner's choice, taken deliberately.
- **`checks/web-touch.mjs` stopped walking.** It drove `/coach/build/w1` four
  clicks deep, because a wizard hides its smallest tap target behind a click
  path. It now measures `/coach/day/:date` flat. Nothing walks into a
  deep-path control any more; if `DayBuilder` grows one, that check is where
  it gets caught.
- **`coach-contract` rule 8 inverted.** It asserted the router still declared
  `build/:id` and `planner/:id`, so a route could not be deleted out from
  under a doorway. It now fails if any of the four is declared again — the
  components are gone, and a route without a screen is the hole that rule was
  always about.

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

## The skill toolchain is written down, not remembered

`skills.md` at the repo root is the SINGLE canonical record of every Claude
skill and plugin this project depends on — source, pinned version and commit,
verify path, what it writes outside its own directory, caveats, removal
command. Read it in a fresh container; `bash scripts/ensure-skills.sh` restores
anything dead and is safe to run when nothing is.

The reason it exists is the same asymmetry that governs everything else here:
`~/.claude/skills/` is user scope and dies with the container, the repo does
not. So markdown-only skills are VENDORED — committed under `.claude/skills/`,
where they need no install at all — and only a toolchain that cannot be a file
in this repo is INSTALLED. Two things qualify: `graphify` and
`claude-obsidian`. Everything else is in the tree.

Two standing prohibitions, both recorded in `skills.md` with their reasons.
`graphify install --project` is never run — it writes PreToolUse hooks into
`.claude/settings.json` and appends a section to THIS file. And `omniroute` is
not installed by the script: it is not a skill, it is a 3.3 GB gateway that
routes prompts to third-party providers, and that is an environment decision
with a human in it.

A skill installed without a row in `skills.md` does not survive. Add the row in
the same commit that does the install.

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
