# Claude Code operating contract

This repository is THE Hybrid System. It is a pnpm monorepo holding TWO
products over one engine and one Supabase project: `apps/mobile`, the Android
athlete app, and `apps/web`, the coach workspace. Scope was cut to those two on
15 August 2026 and everything outside them was deleted — see the deletion
sections below, which are kept rather than tidied away because each records a
decision and its price.

Read the **authoritative checkpoint at the top of `handoff.md`** before making
changes. It records the current local rebuild commit, the fact that GitHub's
standard ChatGPT connector could not publish it, and the exact Android build
boundary. The older sections of `handoff.md` and `docs/HANDOFF.md` are historical
records; do not follow a stale statement that the rebuild has not started.

## Product ownership

- `@hybrid/shared-core` owns shared facts and compatibility contracts only.
- `@hybrid/whole-athlete-state` interprets recovery/life context and emits
  constraints. It is not a diagnosis engine and does not prescribe workouts.
- `@hybrid/conditioning-engine` and `@hybrid/ai-prescription` are **DELETED**
  (15 August 2026). Both owned lifting and conditioning progression until
  14 August, when the Coordinator's deletion took their proposal boundaries;
  what remained was a shell that nothing imported. Conditioning progression
  lives in `@hybrid/engine` (`conditioning.ts`) and always did the arithmetic
  there.
  **`@hybrid/strength-engine` MOVED to `reflectprotect123-max/strengthside`
  (21 August 2026, Task 2 of the repo split —
  `docs/superpowers/plans/2026-08-19-strength-repo-split.md`).** It had come
  back on 18 August as Phase A of the strength rebuild; the split gave
  strength its own repository against the SAME Supabase project, with its own
  coach web app and its own mobile app. `Block<S>` in `@hybrid/engine`'s
  `types.ts` is back to `CondBlock | TextBlock`, the five strength
  migrations, `embed-coaching-note` and the parity harness went with the
  package, and this repo's apps never render strength again. See "Strength is
  excised" below and the shared-Supabase contract it binds.
- `@hybrid/coordinator` and `@hybrid/coordinator-adapter` are **DELETED**
  (14 August 2026). This line read "owns weekly conflict resolution and
  chooses the final weekly plan for an athlete with no coach", and before
  that "is the only layer allowed to choose the final weekly plan", enforced
  by a database constraint. Nothing arbitrates a week now. See "The
  Coordinator is deleted" below.
- `@hybrid/product-scope` owns the product identities and their capability
  lists. It is a fact table, not a decision layer.
- `@hybrid/auto-coach` is **DELETED** (14 August 2026). This line read "owns
  the autonomy policy and the session resolver. It applies whole-athlete-state
  constraints to one session; it never programs a week", and before that
  carried "and never overrides the Coordinator", which ended when the
  Coordinator did. Nothing resolves a session now, and nothing holds one. See
  "The auto-coach is deleted" below.
- `@hybrid/nutrition-core` owns the nutrition data model, its sanitiser and
  its merge. Data only — it decides nothing.
- `@hybrid/nutrition-adapter` is the one projection from the athlete's
  `NutritionDB` slice to everything that reads it — the phone app's nutrition
  world and the coach bench. It exports reads
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
  the pillar screens plus `progression`, `day/:date` and
  `week/:athleteId/:weekStart`. **Nine routes, 18 shots, all green.** The
  parameterised ones are addressed with values the seed really contains — a
  route pointed at a missing id renders a not-found state, which has no
  overflow and would pass while proving nothing.

  THE COUNT HAS BEEN WRONG TWICE, AND BOTH TIMES THE SAME WAY: a route was
  deleted and the number was not. It read "…`build/:id`, `planner/:id` and
  `roster-plan/:workoutId`. Thirty shots" until the old authoring chain went
  (four routes fewer), then "24 shots" until `review/:weekStart` went with the
  Coordinator on 14 August 2026, then "22" until `legacy` went with CoachShell
  hours later, then "20" until `/coach/strength` MOVED to
  reflectprotect123-max/strengthside with Task 2 of the repo split
  (21 August 2026 — corrected in the same commit as the deletion, the count
  rule's third correction). It is 18 now — and the "22" miss was caught by a
  CHECK rather than by a reader, because `checks/docs.mjs` derives the number
  from `COACH_SHOTS` since the second miss. The way to check is
  `node checks/screens.mjs`, whose last line reports the number it actually
  wrote. Quote that rather than this paragraph.

  The claim itself has survived both corrections unchanged: EVERY declared
  `/coach` route is shot at both widths.

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
-- 20260804_fitness_ecosystem_contracts.sql, until 13 August 2026
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
| Whether today's session runs at all, given pain or illness | **The athlete.** Nothing else. See below. |

**That third row said "The safety layer. Unchanged." for one day.** The
paragraph beneath it read: "Taking the WEEK from the Coordinator did not take
the SESSION from the safety resolver, and must not… A pain or illness flag
still holds a coach's session. Removing that would be an injury-safety change
wearing a scheduling change's clothes, and it was never asked for."

It was asked for, later the same day, and knowingly. The owner was told in
plain terms that deleting `@hybrid/auto-coach` deletes the pain and illness
stop, was offered the option of keeping the ~10-line hard-constraint check and
moving it into `@hybrid/whole-athlete-state`, and chose to delete all of it.
So the warning above is kept rather than erased — it is accurate about what was
given up, and the decision reads as a decision only if the argument against it
is still legible.

The paragraph that followed is also worth keeping, because it describes a
promise the system no longer makes: "A held session is not a silent hole: the
athlete is told why, and the coach must be told which session and that it was a
safety flag rather than a skipped workout." Nothing is held, so nothing is
reported. A coach seeing a missed session cannot tell injury from indifference,
because the system no longer knows either.

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

## The athlete web app is DELETED (15 August 2026)

This section has moved three times in three days, and the whole path matters
because each step was a real decision:

1. **13 August — PARKED.** "I don't want the athlete's app to be seen again —
   hide it somewhere, and if we ever need it again we can pull it out." Every
   athlete route came out of `App.tsx`; `src/screens/` stayed on disk.
2. **15 August, morning — PULLED OUT**, for one build. A branded conditioning
   product on its own site, gated `IS_SCOPED_BUILD`, with no Train tab.
3. **15 August, afternoon — DELETED.** The owner cut scope to two products, the
   Android APK and the coach bench, and everything outside them went.

**What went**: `apps/web/src/screens/` entire (the athlete app AND the whole
nutrition web world), `src/native/` (BLE heart rate, GPS, wake lock, camera,
barcode, label OCR — every one used only by those screens), `discipline.ts`,
the athlete chrome (`BottomNav`, `NutritionBottomNav`, `RestChip`,
`WorldSwitch`), `UpdateBanner`, `store/rest`, `store/startFresh`,
`lib/session`, `cloud/catalogue`, and the branded-build machinery added that
morning (`scripts/deploy-site.mjs`, the conditioning arm of the deploy, the
athlete shots in `checks/screens.mjs`, the conditioning scenarios in
`checks/react-smoke.mjs`).

**NOTHING IS LOST, and that is a claim about `apps/mobile`, not about git.**
Every one of those surfaces exists on Android — that is the athlete product,
and it always was after 13 August. Git history holds the browser versions the
same way it held `apps/mobile` between `8628060` and its return.

**`apps/web` is the coach workspace and nothing else.** `/` and every other
address redirect to `/coach`, carrying the query string (both OAuth callbacks
return to `/?integration=…`, and dropping the params makes a cancelled
authorization indistinguishable from "never connected").

**One thing survived that looks athlete-shaped and is not.**
`NutritionProvider` stays in `App.tsx`: the bench's Nutrition pillar reads the
athlete's nutrition slice through it, at six call sites under `coach/`.
`RestProvider` and `UpdateBanner` did NOT stay — nothing under `coach/`
referenced either.

**The coach rail's "Athlete app" link stays GONE.** It existed because `/` once
redirected to the bench. There is no athlete app on this origin to link to.

**Deployment is one site again.** `netlify.toml` runs `build:site` inline, as
it did before the branded build existed. If a second web site is ever wanted,
read the deployment section of the README first — the subdirectory-`netlify.toml`
approach is documented by Netlify, was implemented here, and cannot be selected
in their UI.

## The athlete and the coach never faced each other — and now there is only one

This section enforced a rule with `checks/lane-contract.mjs` (`pnpm run
check:lanes`): `apps/web`'s athlete lane and coach lane could share the floor —
`packages/*`, `store/`, `cloud/`, the design system — but never import each
other. It was a GRAPH check rather than a text scan on purpose, resolving every
relative import into an edge so it could not pass while the thing it guarded
was broken.

**The check is DELETED (15 August 2026), because one of the two lanes is.**
`apps/web/src/screens/` and the athlete `components/` are gone, so `LANES`
named a directory that does not exist and the rule asserted nothing. A guard
that cannot fail is the decorative-guard shape this repository has paid for
repeatedly; keeping it would have been worse than deleting it.

**The history is kept because it is the useful part.** `ALLOWED` started at
fourteen crossings and only ever shrank — a crossing not on the list failed,
and so did a list entry that no longer happened, so a fixed crossing had to be
deleted rather than leaving budget behind.

Eleven of the fourteen were one shape: `autocoach/policy.ts`, `ledger.ts`,
`coach/progression.ts` and `coach/progression-store.ts` were shared code
wearing a lane's directory name — misfilings, not violations. They moved to
`store/` and `lib/progression.ts` and the crossings went with them.

The last two were genuine: the bench rendered the athlete's `Planner` and
`GuidedBuilder`. The plan on record was a package extraction. That is not how
it ended — on 13 August the owner parked authoring on athlete web, both screens
`git mv`'d into the bench's own tree, and the crossings closed by deletion from
the list exactly as the check's own comment always said they would.

**If a second lane ever returns to `apps/web`, restore the check from git
before writing the first import across it.** It is easier to keep a ratchet
than to rebuild one.

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
- **The safety layer is untouched.** This said `@hybrid/auto-coach` "resolves
  ONE session against pain and illness, and always did — it never programmed a
  week, so deleting the thing that did takes nothing from it." True of the
  Coordinator's deletion, and overtaken hours later by the auto-coach's own.
- **The Whoop/Concept2 cards** were salvaged out of `ResolutionPreview` into
  `AthleteSignals.tsx`. They never read a weekly plan; losing them would have
  been collateral. The third panel salvaged with them — today's session
  resolved through the auto-coach — did not outlive that layer.
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
  `@hybrid/auto-coach`, and then — the same day, when that went too — to
  `@hybrid/whole-athlete-state`, the last layer that interprets context into
  anything training-shaped. Its only `@hybrid` dependency is `shared-core`, so
  nutrition reaches it as DATA and never as a package it can call.
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

## The auto-coach is deleted (14 August 2026)

The owner asked for `@hybrid/auto-coach` to go the way of the Coordinator.
**Nothing adapts a session now, and nothing stops one.**

**THE SAFETY STOP WENT WITH IT, DELIBERATELY.** This is the part to read before
changing anything here. `resolveSession` did two jobs that happened to share a
package: it ADAPTED a session (RPE caps, swaps, volume trims, proposals,
receipts, shadow mode, the ledger) and it STOPPED one when
whole-athlete-state raised a hard constraint — pain or illness. The owner was
told, before any code was touched, that deleting the package deletes the stop;
was offered the alternative of keeping the ~10-line hard-constraint check and
moving it into `@hybrid/whole-athlete-state`, which already produces the flags;
and chose to delete all of it.

So the rule that stood here for one day — "a pain or illness flag still holds a
coach's session… removing that would be an injury-safety change wearing a
scheduling change's clothes" — is not quietly gone. It is quoted in "Who owns
the week" above, with the decision that overrode it. **The flags are still
raised** (`pain_hold_active`, `illness_flag_active` in
`@hybrid/whole-athlete-state`). Nothing consumes them.

Deleted outright: `packages/auto-coach` (the resolver, its types, its golden
vectors); `apps/web/src/autocoach/` entire; `apps/web/src/store/policy.ts` and
`ledger.ts`; on the bench `Simulate`, `DecisionTrace`, `trace.ts`,
`ExceptionHistory`, `PolicyInspector` and their tests; on mobile
`autocoach/{policy,ledger,consent,pendingProposal,applyResolution,SessionReceipt,ModeSwitcher}`;
and `apps/mobile/src/cloud/arc-held-receipt.ts`.

**What survives, and why each one had to.**

- **`ArcCoachWeekCard` and `ArcAssignmentCard` stay.** They render the COACH's
  week and a coach's assignment. Neither was ever auto-coach; they sat in the
  same directory. The week card lost its held-session panel and its closing
  line no longer promises that a flag stops a session — a card that keeps
  promising a stop nothing performs is the worst available state.
- **`AthleteSignals` keeps two of its three panels.** Whoop/Concept2 and
  `AthleteStatus` read wearables and `athleteState`. The third resolved today's
  session and could not outlive the resolver. That file has now survived two
  deletions; see its header.
- **`plannedForToday` lost its ledger argument, in both apps.** It subtracted
  "superseded" workouts because approving an adjustment for a recurring
  template wrote a one-off FORK dated today, and a plain filter matched both —
  showing the session twice with Start on the un-adjusted original. Nothing
  forks a workout now, so the correction is gone with the case it corrected.
- **The database was NOT changed.** `push_autocoach_receipt` still exists and
  still accepts `'applied'`, `'undone'` and `'held'`. Nothing calls it. Rows
  already written stay readable.
- **The receipt sanitiser's RULE is written down** in `arc-athlete-sync.ts`
  even though the function is gone: `before`/`after` carried interpolated
  exercise NAMES, so they were dropped rather than pattern-stripped. If
  anything pushes a receipt again, rebuild that first.

**Two checks moved rather than dying.** `coach-contract` rule 3 followed the
nutrition/training boundary from the Coordinator to auto-coach and then to
`@hybrid/whole-athlete-state` — twice in one day, and the third home is the
stable one, because that package is now the last layer that interprets context
into anything training-shaped. And the file gained a guard it should always
have had: a scan directory listed and missing is now a named FAILURE, because
`apps/web/src/autocoach` disappearing made `readdirSync` throw ENOENT and kill
the process before it could report anything — the same crash-instead-of-fail
shape this repository has now hit three times.

**One repair that was not ours.** Deleting the Coordinator left
`@hybrid/strength-engine` and `@hybrid/conditioning-engine` with NO test files,
and `vitest run` exits 1 on "No test files found" — so `pnpm run test` died at
the first of them and never reached the rest. Fixed with real tests over what
those packages still own, not with `--passWithNoTests`: that flag would make
"a test that stops being collected does not fail, it silently disappears"
permanently true of both.

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

## The conditioning lab is deleted (15 August 2026)

`apps/lab` existed for a few hours on 15 August: a Vite bench that pushed a
synthetic rig through `@hybrid/engine`'s real conditioning functions so a
person could see whether progression moved. The owner deleted it the same day
while cutting scope back to two products — the Android athlete APK and the
coach bench — and it went because it was neither.

**It answered its question before it went, and the answer is the thing to
keep.** Recorded here rather than in the deleted app's own header:

- Conditioning progression is REAL, unlike strength's. `conAdapt` earns levels
  0→20 and `conPrescription` spends them on rotating levers — `+1 round`, then
  `+5s work`, then `−5s rest`. Contrast `liftProgress`, which stored
  `{kg, at, reps}` and read back only `kg`, so a `10,8,6` → `9,7,5` wave moved
  no weight at all. **That gap is CLOSED as of Stage 1 of the RPE progression
  design, 16 August 2026** (`docs/superpowers/specs/2026-08-16-rpe-
  progression-design.md`): `LiftState` gained `e1rm?: number`, the e1RM
  `anchorFor` already computed inside a session and previously discarded
  between them. `liftAdapt` banks it alongside the flat kilo; `openingLoadFor`
  re-prices it against whatever today's plan asks for via `plannedKg`, so a
  scheme change re-derives the opener instead of re-offering the same number
  regardless of the rep target. A record banked before this change carries no
  `e1rm` and takes the exact path it always did — this is additive, not a
  migration.
- It WAS invisible without a chest strap, and that is FIXED as of 16 August
  2026. The finding stands as the lab reported it: `conAdapt` returns at
  `if (zoned <= 0) return none;`, so a session with no zone seconds earned
  nothing AND was not counted as a miss — and most sessions are strapless, so
  most sessions were invisible to progression. That was the honest answer to
  "why doesn't conditioning ever move", and it is the best thing the lab
  produced before it was deleted.

  The owner's fix, in his words: a strapless session "asks for RPE at the end
  of the session and adds up to the minutes in that easy/medium/hard areas."
  `withFeltZones` credits the whole duration to the zone the rated effort
  names, using the RPE bands `CON_EFFORTS` already carried. A rating is ONE
  number about a WHOLE session, so it lands in one zone rather than pretending
  to resolve minute by minute.

  **`zsrc: 'felt'` marks a derived distribution and must not be removed.**
  Without it, self-reported effort is indistinguishable from a chest-strap
  trace in every chart and export downstream. Measured data always wins — a
  record that already has zone seconds is returned untouched.
- Only `steady`, `intervals` and `tempo` progress at all. `custom` is the
  athlete's own numbers by definition and `free` has no target to miss.

**Nothing was lost from the engine.** The lab computed nothing itself — every
number came back from `conPrescription`, `CON_FORMATS[...].build`, `paramsFor`,
`conAdapt` or `cardioCompletionFor`, all of which the Android app still runs.
Deleting the viewer did not touch the model.

**One thing worth carrying if a bench is ever rebuilt**: it must not
reimplement the maths. A lab that did would agree with itself and disagree with
the phone, which is worse than having no lab. The one mirror it was allowed —
an English restatement of `conAdapt`'s gates — was fenced by a test asserting
that "every gate passed" meant exactly "conAdapt returned delta 1".

**And a deployment lesson that cost real time**: `apps/lab/netlify.toml` made
Netlify's monorepo detection offer `apps/lab` as a selectable PROJECT when
linking a repository, so the bench kept appearing in the site-creation picker
beside the real apps. A config file in a subdirectory is not inert — it
advertises that directory as deployable.

## Strength is excised — moved to its own repository (21 August 2026)

Task 2 of the repo split
(`docs/superpowers/plans/2026-08-19-strength-repo-split.md`), executed after
Task 1's tree was live and pushed at `reflectprotect123-max/strengthside`.
This is a MOVE, not a deletion: everything below exists and is maintained in
that repository, against the SAME Supabase project. What left this tree:

- **`packages/strength-engine`** — copied to the strength repo verbatim at
  `34dfab4` (its two config divergences are documented in that repo's
  handoff), then deleted here. History stays in this repo's git, like every
  other deletion.
- **The five strength migrations** (`20260818_strength_rebuild`,
  `20260819_phase_e_pain_metric`, `20260819_phase_f_knowledge_base`,
  `20260820_strength_hardening`, `20260821_strength_rls`) and
  **`supabase/functions/embed-coaching-note`** with its workspace membership.
  The migrations are already applied-or-pending against the shared project;
  they moved unrenamed because the filename timestamps are the shared
  ordering.
- **`Block<S>`'s strength member**: the union is `CondBlock | TextBlock`
  again. The strength branches left `cleanBlock`, `duplicateWorkout`,
  `freshSessionBlocks`, `sessionProgress` and `expireStaleSessions`
  (`hasStrengthPrescription` deleted with its caller), each site carrying a
  pointer comment. `sanitizeDB` now filters the Phase A `kind: 'strength'`
  items shape exactly like the legacy `exercises` shape — the clean cut means
  nothing here can render either, and `db.test.ts` pins the filtering.
- **The coach bench's strength surface**: the Command Center tile, the
  `/coach/strength` route and the placeholder pillar. `CoachProgression`'s
  self-coach redirect lands on `/coach/conditioning` now.
  `checks/screens.mjs` drops to nine routes / 18 shots (count corrected in
  this file in the same commit — the count rule's third outing).
- **`StrengthRebuilding` and the parity apparatus**: the mobile stub and its
  `Logger` route, `apps/mobile/parity/`, `src/root.web.tsx`, `checks/parity/`,
  the three parity gate scripts, their package.json entries and ci.yml's
  commented-out step. The gates' restore condition — "Phase C ships the new
  logger" — belongs to the strength repo, which keeps a reference copy of the
  harness under its `docs/reference/parity-harness/`.
- **`checks/migrations-apply.mjs`'s strength assertions and the pgvector
  KNOWN ENVIRONMENT GAP machinery** — no remaining migration mentions vector
  (verified by grep), so the gap allowance had nothing left that could
  trigger it. CI's pgvector install step went with it.
- **The strength docs** (specs, plans, the strength-adaptive-engine-v2
  research, the TrainHeroic teardown package) were COPIED to the strength
  repo before this excision; the originals remain here as history.

**The shared-Supabase contract — binds BOTH repos from this day:**

- The strength repo owns exactly twelve tables — `metric`, `equipment`,
  `exercise`, `strength_block_item`, `prescribed_set`, `prescribed_target`,
  `assigned_session`, `performed_set`, `performed_measurement`,
  `working_max_event`, `pr_event`, `coaching_note` — plus their RLS and
  `embed-coaching-note`.
- This repo owns everything else, including `auth`, the coach–athlete
  relationship model and `coaches_athlete_anywhere`.
- Neither repo writes a migration against the other's tables. Not "prefers
  not to" — a migration here touching a table in that list is a contract
  violation.
- A change to `coaches_athlete_anywhere`'s SIGNATURE is a breaking change for
  the strength repo's RLS and must be coordinated by hand. There is no
  automated guard; the shared database will not warn you.
- Migration filename timestamps are the shared ordering. Do not renumber, and
  never rename a migration that has been pushed.

A `'strength'` DOMAIN STRING is not a strength table: the ARC workspace
tables this repo owns (`workout_library`, coach-week bodies, progression
proposals) still store `'strength'` as a discipline value, because strength
coaches publish through the same shared ARC infrastructure. Those rows are
data ABOUT strength programs; the strength DATA lives in the twelve tables
above.

## Where a test goes

Tests are COLOCATED: `src/lift.ts` is tested by `src/lift.test.ts`, in the same
directory. A test that covers a contract across several modules — a parity
suite, a boundary check, a merged-world sync test — sits with the module it
mostly exercises, named for the contract rather than the file.

EVERY test is colocated — there are no exceptions, including the coach bench
and the `SB_E2E`-gated live backend round trip, which sits with the sync
provider it drives.

`test/` still exists and holds only things that are NOT tests: fixtures and
golden vectors (`packages/engine/test/golden`,
`packages/nutrition-engine/test/fixtures`, and `apps/mobile/test`'s harness and
mocks). `packages/auto-coach/test/fixtures` was a fourth until 14 August 2026.
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
   and the relevant web/mobile build before handoff. **CI runs EVERY check
   under `checks/`**, with one exception: `check:parity-harness`, which drives
   the committed prototype HTML that no commit here can change.

   THIS SENTENCE HAS BEEN WRONG TWICE, THE SAME WAY BOTH TIMES, and each
   correction cost a live defect.

   Until 15 August 2026 it excluded `screens`, `pwa-update` and
   `mobile-touch`, which ran nowhere. Wiring them in immediately caught two:
   two raw `<Pressable>` in the mobile logger under the touch minimum, and a
   service worker publishing updates to nobody after `UpdateBanner` was
   deleted.

   Until 16 August 2026 it excluded the two MOBILE PARITY gates, on the
   grounds that they need an Expo export first. They had been failing for a
   day: `RunningSession` grew a `useDb()` call, the parity harness mounts
   `SessionLogger` without the `DbProvider` the app's own route has, and the
   screen threw on mount — so both gates walked into a blank page and died
   reporting a missing selector, which reads like a broken driver rather than
   a crashed screen. Nothing else in CI drives the phone logger end to end.
   They are in `.github/workflows/ci.yml` now.

   **And back OUT as of 19 August 2026**, as a dated exclusion rather than a
   silent one: the strength logger both gates proved was deleted on the 17th,
   the parity harness mounts the `StrengthRebuilding` stub, and the gates die
   driving a deleted screen's hooks. The commented-out step in the workflow
   carries the reason and the restore condition (Phase C ships the new
   logger); the harness, driver, script and baselines stay in-tree.

   A check that exists and does not run is worth very little; if you add one,
   add it to `.github/workflows/ci.yml` in the same commit. And if you exclude
   one, the exclusion is a claim that ages — say why in the workflow, and
   expect to be wrong.

   **A check that runs in CI and NOT in `verify` is the same trap from the
   other side**, found on 16 August 2026. `checks/docs.mjs` is CI's first step
   and was not in `verify`, so it sat RED on main from 14 August — the README
   named six deleted packages and two deleted exports — while every local
   `pnpm run verify` came back green and said nothing. It is in `verify` now.
   The two lists should agree; where they cannot, the difference is a claim
   that needs a reason written beside it.

   **The visual parity baselines are the APP's own since 16 August 2026, not
   the prototype's.** The app deliberately moved past the prototype — the
   weight field now prices its opener from history, and the finish card
   carries a session time the prototype has no row for — and the owner
   confirmed the app is the standard in both. The cost, stated in
   `checks/parity-visual.mjs` itself: that gate now catches an ACCIDENTAL
   visual change and no longer measures drift away from the design.
   Re-recording is a decision to take out loud, never a way to turn a red run
   green.
5. Never run production migrations, EAS submissions, Netlify deploys, or
   destructive data operations without an explicit approval and rollback plan.

## Useful commands

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run check:ecosystem
pnpm run verify              # everything CI runs that needs no browser/emulator
                             # install; the full list and each exclusion's
                             # reason live in .github/workflows/ci.yml (this
                             # line claimed "everything CI runs" until
                             # 19 August 2026 — it never was, and the gap is
                             # now stated instead of denied)
pnpm run build:site          # assemble the coach site into apps/web/dist
```
