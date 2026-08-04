# Handoff

## 1) Goal

Ship the conditioning-evidence-based upgrade end to end, clear the pre-existing bug
backlog, remove the half-dead coach system, wire up the one first-party safety signal
the app was capturing and discarding (`pain_stop`), and get Concept2 Logbook + Echo
Bike V3 verified against real accounts/hardware. On top of that, a full audit was run
to scope a Juggernaut/MacroFactor-style adaptive training-decision layer — that audit
is written up but **awaiting your review before any implementation starts.**

## 2) Current State

**2026-08-03 — Full fitness-ecosystem build plan written, committed, sent to you,
and now in an iterative external-review loop — NOT approved, nothing beyond this
document exists.** You laid out the target architecture directly (shared-core,
whole-athlete-state-engine, strength-engine, conditioning-engine, nutrition-engine
[being built separately, out of scope here], coordinator) and asked for a full
start-to-finish scope with a real time estimate, built via four parallel research
agents (model `fable`, per your instruction) each scoping one piece read-only against
this actual codebase — no code written, no implementation started. Doc:
`docs/superpowers/specs/2026-08-03-fitness-ecosystem-build-plan.md`, committed and
pushed at `72e8887`, also handed to you directly as a file so you can paste it to
ChatGPT. **You explicitly asked to keep iterating on this doc across rounds of your
ChatGPT feedback until I actually endorse it — that loop has not started yet, this
is round one.**

What the four scoping passes found, synthesized in the doc: shared-core formalization
(13-19 dev-days, recommends staying inside the existing Supabase blob-merge model
rather than a relational rewrite — the hand-written merge rules are the real asset);
whole-athlete-state-engine (10-14 dev-days, genuinely new — confirmed no
life-load/stress/recovery-debt concept exists anywhere today, and found a real gap
worth fixing regardless of this plan: WHOOP HRV/sleep/resting-HR are read once and
discarded before persistence, which already blocks trend detection); coordinator
(13-18 dev-days, confirmed 100% new — nothing today reconciles strength and
conditioning into a schedule, the closest precedent (`balance.ts`'s `loadBalance`) is
explicitly retrospective-only by its own header comment; a rules-based v1 — priority
score + workload caps + rest-day rules — is judged sufficient, constraint-solving/ML
ruled unjustified at this scale); and the real strength/conditioning **app split**
(30-36 dev-days, the largest single piece — ~60% of the current 22k-line codebase is
shared UI/screens duplicated per platform with no shared package today, the hardest
identified risk being that two independently-deployed apps writing one Supabase blob
need byte-identical merge code or the sync layer's already-documented version-skew bug
gets worse, and that the product's own stated cross-modality-tradeoff analytics
(`balance.ts`) has no home once the apps are split unless shared-core is explicitly
designed to keep both datasets comparable). Critical path (shared-core first, then
app-split and whole-athlete-state-engine in parallel, then coordinator):
**≈56-73 dev-days, ≈3-5 months at a steady non-full-time pace.** Four open decisions
flagged in the doc rather than silently picked: Supabase blob vs relational schema for
shared-core v1; whether the parallel phase is actually feasible given who's doing the
work; where cross-modality analytics lives post-split; conditioning-app-first vs
strength-app-first phasing.

Separately: `reflectprotect123-max/thehybridsystem` (a **different** GitHub repo from
this one) was cloned to `/workspace/thehybridsystem` at your mention that the macro
app is "already building" there — confirmed it currently holds nothing but one stale
`APPROVAL_CHECKLIST.md` file (itself pointing back at this repo as its own "work
location"). No macro-app code exists there yet as of this check; flagging in case it's
actually living somewhere else. Not touched, not my concern per your explicit
instruction — this note exists only so the discrepancy is on record.

**2026-08-03 — Strength/conditioning split shipped, merged to `main`, and pushed
(fast-forward `a3957f1..d2db0e9`).** Full brainstorm → spec → plan → 6-task SDD
cycle → final whole-branch review → one fix wave → scoped re-review → merge, on
branch `sdd/strength-conditioning-split` (deleted post-merge, worktree cleaned up).
Spec: `docs/superpowers/specs/2026-08-03-strength-conditioning-split-design.md`
(includes a mid-authoring "Correction" section — the shipped design deliberately
narrowed from the spec's original ambition once research found no migration
mechanism exists in this repo at all, and that moving `CondResult`'s storage location
would have broken the entire `concept2.test.ts` suite for no benefit anyone asked
for). Plan: `docs/superpowers/plans/2026-08-03-strength-conditioning-split.md`.

**What shipped:** `Workout`/`Session` gained a stored `kind: 'strength' | 'conditioning'`
field; `isCondWorkout()` was redefined to read it instead of scanning block contents
(same name/signature — zero call-site changes needed at `Home.tsx`/`Library.tsx`,
either platform). The Planner's block-add toolbar and the guided builder's block-type
choices (both platforms, both) now refuse to let a workout mix a conditioning block
with strength/warmup/metcon blocks — the old "finisher tacked onto a lift day" pattern
can no longer be authored. `CondBlock` remains a fully valid `Block` union member;
`session.ts`'s aggregation functions, History/Recap/Progress, and Concept2 sync are
untouched by design and verified untouched by the final reviewer directly against the
diff, not taken on the spec's word. `sanitizeDB` gained an idempotent
`splitMixedWorkout`/`splitMixedSession` pass that backfills `kind` on old data and
splits any already-existing mixed-block workout/session into two clean siblings on
load — this is the actual migration, folded into the app's existing per-load shape
boundary rather than new infrastructure, since none existed to hook into.

**The final whole-branch review (most capable model) caught two real Critical bugs
before merge, both reproduced with a live repro, not theorized:** (1) the migration
minted a fresh id for the conditioning sibling on every run, and `pickWorkout`/
`pickSession`'s existing merge-tie-breaking rules kept resurrecting a stale un-split
remote copy, which got re-split on every pull — unbounded duplicate "— Conditioning"
workouts, forever, for any cloud-sync user with a legacy mixed workout. (2) a
currently-`active` mixed session split into two active sessions, breaking the app's
one-active-session invariant mid-workout. Both fixed in one authorized fix wave
(commits `62630c1`/`1141d5e`/`6db48cc`): sibling ids are now derived deterministically
from the source record so re-splitting the same raw input twice yields the same id;
the split now skips any session that is currently active; a related live bug the
reviewer also caught (`splitMixedWorkout` was unconditionally overwriting an
already-stored `kind` — deleting a conditioning workout's last block via the Planner's
per-block ✕ permanently mis-stamped it back to `'strength'` with no UI to undo it) was
fixed by preferring the stored `kind` over the inferred one, which let the guided
builder's earlier `blocks.length`-based workaround gate revert cleanly back to the
plan's simpler original `!kind` gate on both platforms. One narrow residual was
adjudicated and parked rather than triggering a second fix wave (process explicitly
allows only one): a legacy mixed *session* whose conditioning half was already logged,
syncing against a stale un-migrated server copy, won't fully converge server-side,
because `pickSession` ranks logged-work-count above recency and `buildPushState` never
re-sanitizes before push — confirmed bounded and non-corrupting (no unbounded growth,
no data loss, local app state fully correct), the one-line fix was found and verified
working but deliberately withheld since it changes what every push writes app-wide,
and is now documented directly in a code comment on `buildPushState`
(`packages/engine/src/cloud.ts`, commit `d2db0e9`) for whoever next touches that
function, rather than left to be rediscovered.

Full repo `pnpm run typecheck && pnpm run test` re-run fresh on merged `main` before
push: **clean** — engine **574/574**, guided-flow **15/15**, web **7/7**, mobile
**108/108**, typecheck clean across all 6 workspace projects. `pnpm run smoke`: both
new scenarios pass; the 8 pre-existing failures already on `main` before this branch
started (a fix-wave implementer root-caused them to a date-staleness bug in
`checks/react-smoke.mjs`'s fixed seed dates, unrelated to this work, introduced
pre-branch) are unchanged.

**2026-08-02 — % of 1RM + rep ranges: brainstormed and spec'd, NOT yet planned
or built.** Design doc committed and pushed at `1b4064d`:
`docs/superpowers/specs/2026-08-02-pct-1rm-rep-ranges-design.md`. Covers a new
optional `PlannedSet.pct1rm?: { lo: number; hi: number }` field (purely
additive, no migration), generalizing `t`'s existing range-parsing
(`"20-30s"` today, seconds-mode only) to `reps_kg` mode too so rep targets can
be ranges ("8-12"), and a 1RM source decision (auto, off the engine's
existing `bestE1rmByMovement` — no manually-entered training max). The
distinctive piece: a `%1RM` **range** (e.g. "60-65%") ramps automatically
across an exercise's sets by where each set's own authored RPE falls between
that exercise's lowest and highest RPE — `pct(set) = lo + (rpe(set) - rpeMin)
/ (rpeMax - rpeMin) * (hi - lo)`, ceiling if all RPEs match — so a coach never
types a % per set, only the range once. Builder gets a 4-way selector (Reps /
Seconds / % flat + reps / % range + reps); Logger prefills the computed kg
(via the same `roundToIncrement`/`AUTOREG.plateIncrement` rounding
`nextWorkingWeight` already uses), fully editable, same suggestion-not-lock
contract as today. Concept art (Builder radio group + per-set %1RM badges,
Logger target card) approved by you before the doc was written — an Artifact,
not committed to the repo. **Open question the spec explicitly carries
forward rather than deciding: whether the guided step-by-step builder gets
this in the same pass or later** (its append-only shape doesn't fit a
radio-plus-conditional-fields well). **Awaiting your go-ahead to turn this
into an implementation plan — nothing beyond the spec has been built.**

**2026-08-02 — Full real-workout verification, both platforms, zero app
defects found.** Not a request from the roadmap — you asked for a genuine
end-to-end check after the folders work below. Web: a hand-driven Playwright
script (`checks/_chromium.mjs`'s launcher, ad hoc — not part of the
`checks/` suite) walked Home → Library → create a folder → drag a workout
into it → start a session → log a warm-up set → log two rated working sets
(rest timer, felt-RPE confirm) → a seconds-mode hold (Start/Stop) → a
conditioning finisher (Start, felt RPE, completion rating, banked) → finish
the session → Recap → History → confirm the folder still holds the workout
after the full session. 17/17 steps green on the first run that used correct
selectors; every earlier failure across several iterations was a wrong
assumption in the *script* (warm-up detection keys on a `"W"` prefix in `t`,
not an `rpe:'easy'` string; rest fires after every set, not once; the last
set of an exercise shows a completion summary rather than auto-navigating;
`addInitScript` re-seeds on every `page.goto` unless guarded, the exact trap
the real `react-smoke.mjs` already comments on) — never the app itself.
Numbers cross-checked consistent between Recap and History (1,025kg volume,
felt RPE 7.6, Back Squat 123kg e1RM as a new PR, next-session bump to
110kg). Mobile: an equivalent RNTL probe (`apps/mobile/test/tmp-full-workout
.test.tsx`, deleted after the run — throwaway, not a permanent addition)
mounted the real multi-screen navigator (Tabs + Logger + Conditioning +
Recap + History, minus fonts/Sync/Whoop/Concept2 providers, matching this
repo's existing test-harness precedent) and drove the identical flow via
real `fireEvent` taps, asserting the final numbers straight off `storage`
rather than trusting on-screen text. Passed once two script bugs were fixed
(missing `SafeAreaProvider initialMetrics` blocks the whole tree from
rendering in the RNTL environment; mobile's weight/reps inputs are
labelled `"kg"`/`"reps"`, not `"Weight"`/`"Reps"` like web). No code changes
resulted from either run — this was verification, not a fix pass.

**2026-08-02 — Library folders shipped on branch `library-folders`
(range `5faba51..18417e9`), verified, merged to `main`, deployed, and
confirmed live by you.** Full brainstorm → spec → plan → 6-task SDD cycle,
including a final whole-branch review that caught one real Critical bug
before merge. Spec: `docs/superpowers/specs/2026-08-02-library-folders-
design.md`. Plan: `docs/superpowers/plans/2026-08-02-library-folders.md`.

**What shipped:** user-created, user-named folders in Library's Sessions
tab, both platforms. A workout can belong to zero, one, or several folders;
deleting a folder never deletes a workout, only strips that folder's id from
`Workout.folderIds`. New engine surface: `Folder` type, `Settings.folders`,
`Workout.folderIds`, a union-with-tombstone merge rule for both (mirroring
the existing `mobility`/`days`/`dates` union precedent in `mergeSettings`/
`pickWorkout`), and two pure helpers (`workoutsInFolder`,
`ungroupedWorkouts` — the second guards against a stale `folderId` surviving
a sync race and stranding a workout invisible in neither the folder nor the
flat list). Web assigns a workout to a folder via native HTML5 drag-and-drop
(a deliberate, confirmed choice — no picker fallback on web, even though it
means phone-browser users can create/rename/delete folders there but can
only actually file a workout into one from the mobile app). Mobile assigns
via a "Folders" checklist picker (`Modal` + `Chip` multi-select) since touch
drag-and-drop was ruled out up front. Both platforms: collapsed-by-default
folder headers, create/rename/delete, ungrouped workouts still list flat
below.

**The Critical bug the final review caught (fixed pre-merge, commit
`3d5a309`):** `removeFolder` on both platforms spliced the folder out of
`settings.folders` and stripped the id from every workout's `folderIds`, but
never wrote a `settings.deletedIds` tombstone — the exact mechanism
`mergeSettings` already had correct, unit-tested logic to honor, but nothing
in the app ever populated it for a folder delete. On a cloud-synced device
this meant deleting a folder was silently undone on the next sync — the
folder *and* every workout tag it had just stripped both revived. The origin
was the plan's own `removeFolder` code snippet, not an implementer
deviation — missed by three task-scoped reviews because each one correctly
verified its own task's code matched the plan text, and the plan itself was
wrong. Fixed by adding the tombstone write (mirroring the existing
`removeWorkout`/`remove` pattern exactly) plus a new regression test that
replicates the *actual app write path* object-for-object and runs it through
the real `mergeEngines` against a stale remote — closing the precise gap a
hand-built `deletedIds` map in the pre-existing tests couldn't catch. Also
fixed in the same wave (commit `18417e9`): the mobile Folders picker Modal
had no `ScrollView`, so with enough folders "Done" went off-screen and
became unreachable (fixed with `maxHeight`, input/Done kept outside the
scroll region so they're always reachable); web's remove-from-folder ✕ had
a sub-44px tap target and a broken flex layout; a picker-state leak where
creating a folder from inside the picker also mounted a duplicate, uncommitted
create-input in the accessibility-hidden background; `apps/mobile/jest.config
.js` was missing `restoreMocks: true`, a standing test-isolation foot-gun a
prior task had to work around manually rather than fix at the root.

Two operational notes worth knowing for next time, not code issues: (1) a
background implementer agent twice replied with a vague "waiting on a
background monitor" instead of a real status line, both times while the
actual work was either incomplete (once) or fully committed (once) — caught
both times by checking the worktree's real git state directly rather than
trusting the reply, per this project's own established practice. (2) the
Netlify deploy command returned `403 Forbidden` on three consecutive manual
attempts after this branch merged, with fresh proxy tokens each time — the
dashboard's own deploy list showed it had actually gone out and published
successfully regardless (`main@18417e9`, "Published", ~30s build), so the
403s were either stale-token noise or a dashboard-vs-API discrepancy, not a
real blocker. If you see the feature not showing up after a push in future,
check the Netlify dashboard's deploy list before assuming the deploy failed
— the PWA's service worker caching an old bundle is also a likely cause (a
full app close-and-reopen, or a hard refresh, fixed it here).

Full repo `pnpm run verify` re-run fresh at the merged tip (`18417e9`,
matching independent numbers a scoped re-reviewer reproduced separately, not
just the implementer's own report): **exit 0** — typecheck clean across all
6 workspace projects, engine **549/549** (was 546 immediately post-merge-base,
+3 from this fix wave: the tombstone regression test and a
`duplicateWorkout`-inherits-`folderIds` test), guided-flow unchanged, web
**7/7**, mobile **104/104** (was 102 before this fix wave), react-smoke
**53/53**, deploy-smoke **11/11**. Remote branch delete failed with the same
403/disconnect this repo has shown all session — harmless, doesn't affect
the already-completed merge.

**2026-08-02 — Delete added to Home's "Today's plan" cards, shipped and
pushed directly to `main`** (commit `d6385a9`, small enough not to warrant
a full SDD cycle — same tombstone `removeWorkout`/`remove` pattern Library
already had, just a second call site). Confirm-gated identically to
Library's delete on both platforms (native `confirm()` on web, `Alert.alert`
on mobile, same wording). Deletes everywhere, not just off the Home card —
this was a direct answer to your question about that same day. New smoke/RNTL
coverage added for both platforms in the same commit.

---

**2026-08-02 — Calendar day-jump shipped on branch `calendar-day-jump`
(tip `2cf6416`), verified, not yet merged — this SDD execution merges to `main` only
after a separate final whole-branch review.** Seven tasks, seven commits:
`9376633` (Calendar's `Cell` carries `workoutId`/`sessionId` instead of collapsed
booleans, both apps), `1dd81da` (`resolveDayTarget` — recap/today/preview resolution,
added alongside `sessionFrom` in both apps' session helper, with tests), `65abc4f` /
`c5bad5d` (new read-only Day preview screen, web then mobile), `59b4043` (Calendar's
day-cell tap wired to `resolveDayTarget`, both apps), `9ae319a` (fix wave — see below),
`2cf6416` (Home's WeekStrip per-day tap wired the same way, both apps).

**What shipped:** Calendar's day cells and Home's week strip both now route to the
tapped day's actual content instead of just opening a generic Calendar view. Tap a day
that has a completed session with logged work and it opens that session's Recap; tap
today and it opens Training; tap any other day (future, rest, or planned-but-not-yet-
trained) and it opens a new read-only Day preview screen showing the matched workout
(or "Nothing scheduled" if none). The mechanism enabling this: `Cell`'s data shape
changed from two collapsed booleans (`planned`/`trained`) to the actual ids
(`workoutId`/`sessionId`) behind them, so the tap handler has something to navigate to
instead of just a yes/no dot. `resolveDayTarget` is a small pure function, one per app,
that takes those ids plus the date and returns which of the three destinations wins —
a session id always wins (a completed session that happens to be today still shows its
Recap, not a "start" prompt), otherwise today wins over preview.

**Explicit scope cut:** the Day preview screen is look-only — no Start button, no
write path of any kind, no retroactive logging and no future pre-loading. Starting a
workout stays anchored to today exactly as it already was; this feature only changes
where a *tap* lands, not what dates can be trained.

**Two real bugs a review caught and fixed mid-plan, both in `9ae319a`:** (a) converting
Calendar's day cell from a bare `<div>` to a real `<button>` (needed for the tap
handler) triggered the design system's `pointer: coarse` 44px minimum touch-target
rule in `tokens.css` — right for an ordinary button, wrong for one cell in a 7-column
month grid, so on phones ≤390px wide the grid overflowed its column track sideways.
Fixed with a targeted `min-h-0` override (utilities layer ships after `base`, so it
wins the cascade), verified with real Playwright viewport measurements at 320/360/390px
in `checks/web-touch.mjs`, which also gained a permanent regression guard — three new
"Calendar's month fits its column track at Npx on touch" checks — so this can't
silently regress again. (b) The new `aria-label` on the day-cell button overrides
everything nested inside it, which silently dropped the trained/planned state that was
previously visible to a screen reader via a `title` span on the dot — fixed by
appending `, trained` / `, planned` to the label itself in both apps, so the
accessible name carries the state instead of relying on a child element the label now
shadows.

**Bonus fix in Task 6:** Home's WeekStrip "trained" dot didn't check `hasLoggedWork`
the way Calendar's `buildMonth` did — it just checked session status, so a session that
existed but had no actual logged sets could show as "trained" on Home while Calendar
correctly showed it as not-yet-trained for the same date. Now both screens use the
same `status !== 'active' && hasLoggedWork(s)` filter, so a day that looks trained on
one screen looks trained on the other, and a tap on either lands on the same Recap.

Full repo `pnpm run verify` re-run fresh at the tip (`2cf6416`): **exit 0** —
typecheck clean (all 6 packages/apps), engine **522/522**, guided-flow **15/15**, web
**7/7**, mobile **94/94**, react-smoke **46/46** (includes the new Day-preview and
day-jump-routing scenarios for both Calendar and Home's week strip), deploy-smoke
**11/11**. `checks/web-touch.mjs` (Playwright-driven, not part of the `verify` chain,
run separately since it needs a browser) also re-confirmed clean: all touch-target
checks pass, including the three new Calendar-overflow regression guards at
320/360/390px.

---

**2026-08-02 — Set timer shipped on branch `set-timer`, verified (including a
final-whole-branch-review fix wave), and merged to `main`.** Five tasks, plus a final
whole-branch review that found 1 Critical and 2 Important real bugs, all fixed in one
wave (commit `c0f21c1`) and confirmed by a scoped re-review before merge.

**What shipped:** a live countdown timer for `seconds`-mode Logger sets (stretches,
planks, holds) in both apps. `seconds`-mode fields render a `SecondsTimerField` with a
Start control that arms a countdown against the set's `t` target (parsed via the
existing `repTopOf`, so range/suffixed targets like `"20-30s"` arm correctly); while
running, the field shows the live countdown and locks against manual typing; on
completion it buzzes and fills the field with the held duration; Stop ends the hold
early and writes the actual elapsed seconds. Driven by a new `useSetTimer` hook /
`SetTimerProvider` in each app, a sibling of the existing `useRest`/`RestProvider`
(end-timestamp persisted to storage, survives reload/backgrounding), kept separate from
`useRest` since rest and a hold are different concerns with different completion
behavior. Mobile's rest timer schedules a native background alarm; the set timer
deliberately doesn't (an athlete holding a stretch is watching the screen).

**The final whole-branch review caught real bugs the task-level reviews missed:**
(1) **Critical** — tapping "Finish Set" while the countdown was still running logged
the *target* duration, not what was actually held (verified live: 10s target, 4s held,
screen read "6", disk recorded "10"). Fixed by stopping the timer on the Finish Set tap
itself, mirroring the Stop button, threaded through a ref (not state) so it survives
`confirmSet` running in the same render tick. (2) **Important** — a timer that finished
while its own field was unmounted (rest phase, RPE phase, athlete moved on) would write
its held duration onto whatever *different* seconds-mode field mounted next. Fixed by
adding ownership tracking (`start(sec, owner)`, a persisted `-set-timer-owner` key, and
`key={setKey}` on `SecondsTimerField` to force a real remount on set change) that gates
both the completion-write and the running-display/Stop-button rendering — the second
gate wasn't in the original brief but was needed, since a Stop button visible on an
unrelated field could itself write the wrong value. (3) **Important** — range/suffixed
targets left Start permanently disabled (`Number("20-30")` is `NaN`); fixed by using
`repTopOf` instead of raw `Number()`, matching how every other target-parsing call site
in these files already works.

**Heart rate is deliberately NOT part of this** — stays exactly where it already lives
(the Conditioning screen); nothing about `seconds`-mode strength sets reads or displays
heart rate. **"Per side" needs no data-model change** — authored as two ordinary
consecutive sets, each carrying its own `t` target; the timer just runs twice.

Full repo `pnpm run verify` re-run fresh at the fix-wave tip (`c0f21c1`): **exit 0** —
typecheck clean, engine **511/511** (unchanged — no engine code touched), guided-flow
**15/15**, web **3/3**, mobile **80/80** (was 75/75 before this branch; the final +5
across the branch and its fix wave cover natural-completion, early-stop, cross-set
ownership, and range-target arming), react-smoke **37/37** (was 32/32; the final +5
mirror the mobile cases), deploy-smoke **11/11**.

---

**2026-08-02 — Duplicate Workout shipped on branch `duplicate-workout`, verified
(including a final-whole-branch-review fix wave), and merged to `main`.** Four tasks,
four commits: `6c602b9`
(engine — `duplicateWorkout(w)` added to `packages/engine/src/session.ts`, plus a new
`describe('duplicateWorkout', ...)` block in `packages/engine/test/session.test.ts`),
`858d9df` (web — a Duplicate button on Library workout cards in
`apps/web/src/screens/Library.tsx`, plus a new `checks/react-smoke.mjs` scenario),
`0801a70` (mobile — the same Duplicate button on Library workout cards in
`apps/mobile/src/screens/Library.tsx`, plus a new case in
`apps/mobile/test/screens.test.tsx`), and this doc-only commit on top.

**What shipped:** `duplicateWorkout` is a new, pure `packages/engine` function that
clones a `Workout` end to end — the workout itself, every block, and every exercise
within each block all get a fresh `uid()`, mirroring `duplicateExercise`'s own
reasoning (a shared id would let an edit to the copy reach back into the original,
directly or via a sync-layer merge keyed on that id), and sets are copied by value for
the same reason. `days`/`dates` are cleared rather than copied (inheriting the
original's scheduled slot would silently double-book that weekday until the athlete
manually reassigns it), `_rev` is cleared as sync bookkeeping specific to the original
record, `sample` is cleared, `updatedAt` is refreshed to `Date.now()` like any new
record, and a `CondBlock` carrying a `condResult` has it stripped so a template
doesn't inherit another session's logged result. The clone's name gets a " copy"
suffix (a nameless original becomes `'Session copy'`) so two cards aren't visually
identical in the collapsed Library list. Both apps got a matching Duplicate button on
Library workout cards, styled as a plain secondary action rather than the brass
"Edit" treatment, that calls `duplicateWorkout`, pushes the clone into the store, and
routes to **Planner** — `/planner/:id` on web, `nav.navigate('Planner', { id })` on
mobile — never to GuidedBuilder, because GuidedBuilder is append-only and cannot be
opened pre-populated with existing content (confirmed by survey before Task 1 was
written).

**One Minor parked from Task 2's review, not fixed in this pass:** the web
react-smoke scenario (`checks/react-smoke.mjs`, `'Duplicate clones a workout and
lands on Planner with independent content'`) seeds a scratch workout directly into
`localStorage` and, after duplicating it and asserting the clone is independent,
never removes either the seeded original or the clone it creates — unlike this
file's established teardown convention elsewhere (see the `f29b0f7` entry above,
where the Phase 2 react-smoke scenario was retrofitted with exactly this cleanup
after it was flagged for leaking state into later scenarios). Confirmed currently
harmless: the scenario runs last among the Library-focused tests and its seeded
name (`'Dup Source'`) doesn't collide with any other scenario's seed data, so nothing
downstream is affected today. Worth tidying in a future pass so the file stays
consistent and doesn't bite a later test that happens to run after it.

Full repo `pnpm run verify` re-run fresh at `0801a70` (the branch tip, before this
doc-only commit): **exit 0** — typecheck clean across all 6 workspace projects
(packages/config, packages/design, packages/engine, packages/guided-flow, apps/mobile,
apps/web), engine **520/520** across 20 test files (was 511/511 before this task; the
new `duplicateWorkout` describe block in `session.test.ts` added the other 9), guided-flow
**15/15** (unchanged), web **3/3** unit tests (unchanged — this task's web coverage lives
in the react-smoke scenario, not a unit test), mobile **76/76** (was 75/75 before this
task; the +1 is the new Duplicate case in `screens.test.tsx`), `build:site` clean,
`check:csp` clean, react-smoke **33/33** (was 32/32 before this task; the +1 is
"Duplicate clones a workout and lands on Planner with independent content"),
deploy-smoke **11/11** (unchanged). A final whole-branch review afterward found 2 more
Minor issues, both fixed in one pass (commit `aaf454a`): the Library action row clipped
"Delete session" at ≤320px viewports once the Duplicate button was added (fixed with
`flex-wrap`, matching the codebase's existing convention), and `duplicateWorkout`'s
`updatedAt`-refresh and `sample`-clearing behavior — both already correct — had no test
coverage (added, proven non-vacuous via mutation testing).

**2026-08-02 — Phase 2 (adaptive strength progression) shipped on branch
`phase2-strength-progression`, verified, and pushed to that branch (not merged to
`main` — a separate final whole-branch review still has to happen first).** Six tasks,
seven commits: `5a65ab3` (engine — `decideStrengthProgression` core algorithm, correct
`completedAt` handling, hand-written TDD tests), `331aec4` (engine — decision-table
acceptance suite, 100+ generated scenarios added to `packages/engine/test/strength.test.ts`),
`6230c9a` (engine — export `decideStrengthProgression` from `@hybrid/engine`'s package
index), `990f5fa` (web — opt-in "Apply" suggestion UI on `apps/web/src/screens/Logger.tsx`
plus a new `checks/react-smoke.mjs` scenario), `f29b0f7` (test — fully tear down the
seeded strength-history sessions the new react-smoke scenario plants, so it doesn't leak
state into later scenarios), `e1230ee` (mobile — the same opt-in suggestion UI on
`apps/mobile/src/screens/Logger.tsx` plus a new case in `apps/mobile/test/logger.test.tsx`).

**2026-08-02 — final whole-branch review, one fix wave applied (commit `7fbb082`, now the
tip of `phase2-strength-progression`; still NOT merged to `main`).** The review found
three real logic defects in the shipped Phase 2 code, all of the same family — the
decision proposed numbers without asking what the Logger was already showing:

1. **`progress_reps` could never raise the Reps field.** `prefillSecondary` opens that
   field at `repTopOf(t)` — 10 on an `8-10` target — while the branch only fired when
   `lastReps < repTop`, so it prescribed 9 and Apply *wrote 9 over the 10 already there*.
   Every branch is now gated on beating the value the field would already show, and
   returns a `hold` with no `prescription` (new reason codes `'already_at_rep_target'` /
   `'already_at_earned_load'`) when it would not. Silence is the right answer when the
   prefill is already the better number.
2. **`deload` could propose MORE weight than the prefill.** A missed set already costs
   ~6.25% through `computeSetAdjustment`, so 100 → 95 → 90 earned, against which a flat
   `lastKg - 2.5` "deload" of 92.5 was an increase — on the same card as the "earned 90kg
   last time" note. The deload is now clamped to `Math.min(lastKg - stepKg, earnedKg)`,
   where `earnedKg` is read from `lift.ts`'s own `liftMoves` rather than recomputed.
3. **The wrong exposure was recorded when a movement appears twice in a session.** The
   scan kept the LAST match, so a 70kg back-off block written after a 100kg working set
   recorded the exposure as 70kg. It now follows `liftMoves`'s first-occurrence-wins rule.

Also in that wave: both Logger suggestion memos are short-circuited on `isFirstWorkingSet`
before they touch the sessions array (the array identity changes on every keystroke, so
the history scan was re-running per character typed on the gym-floor screen); the design
doc's `onTarget` line was corrected to match the shipped code (`rpeCenterOf(exposureSet)`,
not `currentTarget.rpe`) and amended with both algorithm changes; the unread
`StrengthExposure.sid`/`.completedAt` fields were dropped; and the engine suite gained
verdict-band boundary rows, statelessness/non-mutation tests and first-occurrence-wins
tests. This entry is written immediately after `7fbb082`, which is the code commit it
describes; this doc-only commit sits on top of it.

**What shipped:** `decideStrengthProgression(name, sessions, currentTarget)` — a new,
pure `packages/engine` function that needs at least 3 logged exposures of the exercise
before it will say anything, then judges the most recent 2 of them to decide whether to
progress the load, progress the reps, hold, or (after a genuine miss streak) propose a
deload, reusing `verdictForRpe`'s existing RPE-band logic rather than inventing a new
one and needing no e1RM-trend data at all. It's backed by a generated decision-table
suite (`packages/engine/test/strength.test.ts`) crossing streak pattern × load kind
(heavy/light/bodyweight) × rep-range shape × exposure count, plus hand-written rows
walking every one of `verdictForRpe`'s seven verdict bands and its non-numeric-`felt`
guard, the first-occurrence-wins exposure rule, and statelessness (same array twice,
same answer; the caller's array is never reordered). `TrainingDecisionExplanation.prescription` (`{ load?: number; reps?: number }`)
is a small, additive extension to Phase 0's existing explain contract, used identically
by both apps' Logger screens to render the suggestion. Both Logger screens (web and
mobile) got the same opt-in UI: a suggestion strip that appears only when
`decideStrengthProgression` has something to propose, with an explicit "Apply" action
that writes the proposed load/reps into the field — nothing is ever auto-applied.

**The bodyweight-exercise rule:** a bodyweight exercise (no external load, e.g.
push-ups/pull-ups/dips as logged in this app) progresses via reps only — the function
never proposes a load value for one, since there's no meaningful load number to
compute a deload percentage against. When a bodyweight exercise is consistently
missed, the function holds rather than fabricating a deload it has no sensible way to
compute (there's no load to reduce by a percentage) — this is a deliberate branch, not
a gap, and is one of the decision-table suite's covered scenarios.

**Deliberately out of scope, stated plainly rather than silently deferred:** no
pain/fatigue safety signal exists for strength training the way `painHoldFor` exists
for conditioning — `decideStrengthProgression` has no readiness/pain input at all, so
`safetyState` on every `TrainingDecisionExplanation` it returns is hardcoded
`'approved'` in every branch. This is a real limitation, not an oversight: whoever
picks up a future phase that wants to gate strength progression on pain/fatigue will
need to design that signal from scratch (there is no strength-side equivalent of the
conditioning `mechanicalCompletion: 'pain_stop'` field to read from yet). Separately,
`substitute_exercise` and `repeat_session` — two `ProgressionAction` union members
Phase 0 already defined — are still never emitted by anything in this codebase after
this phase; `decideStrengthProgression` has no evidence (no substitution catalog, no
session-repeat trigger) that would ever justify emitting either, so both remain
theoretical values on the type until some future phase gives a function a reason to
return them.

Full repo `pnpm run verify` re-run fresh at `7fbb082` (after the fix wave): **exit 0** —
typecheck clean (packages/config, packages/design, packages/engine,
packages/guided-flow, apps/mobile, apps/web), engine **511/511** across 20 test files
(was 323/323 before this phase and 440/440 at `e1230ee`; `strength.test.ts` is now 188
of that total, up from 117), golden suite untouched inside that total, guided-flow
**15/15** (unchanged), web **3/3** unit tests (unchanged count, as the plan predicted —
this phase's web coverage lives in the react-smoke scenario, not a unit test), mobile
**75/75** (was 73/73 before the phase, 74/74 at `e1230ee`; the extra case proves the
suggestion stays SILENT when it would write a smaller number than the field shows),
build clean, CSP check clean, react-smoke **32/32** (was 31/31 before the phase — the
+1 is "a consistent 2-session on-target streak surfaces an opt-in load suggestion, and
Apply writes it into the field"), deploy-smoke **11/11** (unchanged).

**Next roadmap item, per the design doc's own roadmap table**
(`docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md`):
**Phase 3 — modality-aware conditioning thresholds.** Per this project's standing
per-phase review gate, Phase 3 has NOT been started and awaits its own go-ahead before
any implementation plan is written for it. This branch (`phase2-strength-progression`)
also still awaits its final whole-branch review and merge to `main` before Phase 3
work should begin.

**2026-08-01 — Phase 1's working-weight confidence indicator (the UI slice) shipped,
verified, and pushed.** `origin/main` is at `ef8f6e1`. Two app-code commits, both
already on `main`/`origin/main` before this entry was written: `f6cd95f` (web —
`apps/web/src/screens/Logger.tsx` + a new `checks/react-smoke.mjs` scenario) and
`ef8f6e1` (mobile — `apps/mobile/src/screens/Logger.tsx` + a new case in
`apps/mobile/test/logger.test.tsx`), both verified by `git show --stat` against the
real commit objects this session, not assumed from memory. Both apps consume Phase
0's existing `explainWorkingWeight(earned, rec)` (no engine change — `packages/engine`
was not touched by this slice) and append a literal `' · estimate'` to the
already-existing working-weight note string, gated on
`earnedExplained?.confidence === 'low'`. This is the task-3 (final) gate for the
`2026-08-01-adaptive-phase1-confidence-ui` plan: full verification plus the
by-inspection high-confidence-identical guarantee, documented below since no test
harness here can simulate a connected WHOOP without deeper provider mocking.

Full repo `pnpm run verify` re-run fresh at `ef8f6e1` this session (run twice,
identical results both times, second run's exit code captured directly): **exit
0** — typecheck clean (packages/config, packages/design, packages/engine,
packages/guided-flow, apps/mobile, apps/web), engine **323/323** (19 test files,
**unchanged** from the last Phase 0 entry — this slice added no engine tests), golden
suite still exactly 33/33 inside that total, guided-flow **15/15** (unchanged), web
**3/3** unit tests (unchanged — `apps/web` has no unit test for this slice; the new
scenario is exercised only through react-smoke), mobile **73/73** (was 72/72 before
this slice — the +1 is `apps/mobile/test/logger.test.tsx`'s new confidence-tag case),
build clean, CSP check clean, react-smoke **30/30** (was 29/29 — the +1 is "a working
weight shown with no WHOOP data connected is marked as an estimate"), deploy-smoke
**11/11** (unchanged). The handful of `console.warn([error] ...)` lines visible in the
mobile-test output are expected stderr fixtures from the pre-existing
`apps/mobile/test/errors.test.ts` error-message-formatting suite, not failures — no
`FAIL` line appears anywhere in either verify run's output.

**By-inspection confirmation of the "byte-for-byte identical when confidence is high"
guarantee (task-3 brief's Step 2, not independently testable in this harness):** both
`Logger.tsx` files append the identical expression
`(earnedExplained?.confidence === 'low' ? ' · estimate' : '')` to the pre-existing note
string. `Confidence` (`packages/engine/src/adaptive/types.ts`) is the closed union
`'low' | 'medium' | 'high'`, so every value other than the literal `'low'` — including
`'medium'`, `'high'`, and `earnedExplained` itself being `null` (which only happens
when `earned` is `null`, and in both files the note block that reads
`earnedExplained` only renders when `earned` is truthy, so `earnedExplained` is
non-null whenever this expression actually runs) — falls through to the `: ''`
branch, a no-op string concatenation. Read `packages/engine/src/adaptive/explain.ts`'s
`explainWorkingWeight`: it returns `confidence: 'low'` in exactly one branch (the
`hold`-action/no-`dailyAdj`-reduction case when `rec` — today's WHOOP recovery — is
`undefined` or `null`) and `confidence: 'high'` in every other reachable branch
(`dailyAdj < 0`, or `hold` with recovery data present). So for any athlete with a
connected WHOOP supplying today's recovery number, the rendered note text is
provably, structurally identical to the pre-Phase-1 string — not just believed to be
by manual spot-check.

**Deliberately out of scope for this slice, left open for later:** the other three
Phase 0 explainers — `explainSetAdjustment`, `explainConPrescription`, and
`explainConAdapt` — still have no UI consumer in either app. Wiring one or more of
them into a screen is available as a future Phase 1 continuation slice, or can be
folded into Phase 2, whenever wanted. Per the design doc's own roadmap table
(`docs/superpowers/specs/2026-08-01-adaptive-training-engine-audit-design.md`), the
next roadmap phase after this is **Phase 2 — adaptive strength progression**, which
still awaits its own go-ahead per this project's standing per-phase review gate before
any implementation plan is written for it.

**2026-08-01 — Final whole-branch review of Phase 1 landed a follow-up fix wave,
verified, and pushed, at `97d7c7f`.** The review's core finding: the `' · estimate'`
suffix shipped above was a confidence badge, not the "why" text the parent design
doc's Phase 1 acceptance bar actually asks for — `explainWorkingWeight` already
computes the real reason (`dataLimitations: ['no_recovery_data']`) but it was being
discarded before it reached either screen. Fixed by changing the copy itself
(`' · estimate'` → `' · no recovery data today'`, byte-for-byte identical in both
`Logger.tsx` files, same `earnedExplained?.confidence === 'low'` gate, unchanged),
which also closed out three more Important findings from the same review in one
commit: the web smoke assertion was loosened to a bare `/estimate/` regex — tightened
to one assertion on the full composed string, and the test renamed to describe the
reason rather than the adjective; the mobile unit test's assertion string was updated
to match; and a genuinely missing high-confidence smoke test was added to
`checks/react-smoke.mjs` (route-intercepted WHOOP connect, mirroring
`checks/screens.mjs`'s existing ~12-line pattern), immediately followed by a
`page.unroute` cleanup verified not to leak into the later "Settings offers cloud
sign-in and a WHOOP connect" scenario. Full repo `pnpm run verify` re-run fresh at
`97d7c7f`: **exit 0** — typecheck clean, engine 323/323 (unchanged — no engine code
touched), guided-flow 15/15 (unchanged), web 3/3 (unchanged — this slice's web
coverage lives in react-smoke, not unit tests), mobile **73/73** (unchanged count —
the fix updated an existing test's assertion, it did not add one), build clean, CSP
check clean, react-smoke **31/31** (was 30/30 — net +1: the low-confidence test was
tightened in place, and the new high-confidence test is the addition), deploy-smoke
11/11 (unchanged).

**Two inaccuracies in this handoff entry's own text, above, are corrected here rather
than edited in place, to keep the historical record of what was actually said at ship
time intact:**
- The paragraph above claiming "no test harness here can simulate a connected WHOOP
  without deeper provider mocking" was **false** — `checks/screens.mjs` already did
  exactly this, with plain Playwright route interception, before this slice ever
  shipped. The high-confidence path is no longer just documented by inspection: it is
  now covered by a real, passing `react-smoke.mjs` test (see above).
- The paragraph above claiming `explainWorkingWeight` "returns `confidence: 'low'` in
  exactly one branch" was **false** — reading `packages/engine/src/adaptive/explain.ts`
  directly, it returns `'low'` in **two** branches: the `!w` null-guard
  (`action: 'pause_insufficient_data'`) and the no-recovery-data hold branch. The
  by-inspection conclusion itself (byte-for-byte identical rendered text whenever
  confidence is not `'low'`) still holds — both `Logger.tsx` files call
  `explainWorkingWeight` only when `earned` is already truthy, so the `!w` branch is
  unreachable from either screen — but the sentence describing the function itself was
  wrong about the function, not just imprecise.

**Honest remaining scope, stated plainly rather than silently deferred:** the parent
design doc's Phase 1 acceptance criterion (§14 — "'why' text renders for at least one
existing decision per app") is now more fully met than it was before this fix wave:
the copy change surfaces the actual computed reason (`no_recovery_data`, one of
`TrainingDecisionExplanation.dataLimitations`) instead of a bare confidence adjective.
It is **not** fully met in the broader sense implied by the contract's shape — this
still surfaces exactly ONE derived limitation string, hand-written into the JSX rather
than read from `earnedExplained.reasonCodes` or `earnedExplained.note` (both of which
`explainWorkingWeight` already computes and neither of which the UI touches), and the
other three Phase 0 explainers (`explainSetAdjustment`, `explainConPrescription`,
`explainConAdapt`) still have zero UI consumers in either app, exactly as noted above.
This is real remaining scope for a future slice — not a gap this entry is trying to
paper over.

**2026-08-01 — Phase 0 (adaptive-decision contracts) shipped, verified, and pushed.**
`origin/main` is at `598a1e8`. Five tasks, eight commits (Task 1 needed one fix-round
commit after its own task review caught an action/verdict contradiction; Tasks 2-5
landed clean in one commit each; two more docs-only commits corrected this handoff
entry itself after the fact):
`671b085` (types + `explainSetAdjustment`), `cd4d873` (fix a verdict/action
contradiction near the on-target band caught during Task 1's own review — pre-push,
no golden impact), `e2d0c13` (`explainWorkingWeight`), `befd450`
(`explainConPrescription`), `6577276` (`explainConAdapt`), `b61c507` (export
`./adaptive/types` and `./adaptive/explain` from `@hybrid/engine`'s `src/index.ts`,
plus a smoke test proving the export is reachable via the package index, not just the
internal module path), `d8470f1` (this handoff entry, first written), and `598a1e8`
(docs-only follow-up fixing this same entry's self-contradictory "five tasks, one
commit each" claim, which was immediately followed by six SHAs — Task 1's fix-round
commit meant Tasks 1-5 landed across six code commits, not five). All four wrapped
functions (`explainSetAdjustment`, `explainWorkingWeight`, `explainConPrescription`,
`explainConAdapt`) are read-only reshapers around already-computed results
(`SetAdjustment`, `WorkingWeight`, `Prescription`, `CondResult`/`AdaptResult`) — none
of them recompute or alter the underlying training math. Full repo `pnpm run verify`
re-run fresh at HEAD this session: **exit 0** — typecheck clean
(engine/guided-flow/config/design/mobile/web), engine suite **320/320** (was 304
before Phase 0; +16 new: 15 from Tasks 1–4's `adaptive.test.ts` plus 1 index-export
smoke test from Task 5), **golden suite exactly 33/33, unchanged**, guided-flow 15/15,
web 3/3, mobile 72/72, build clean, CSP check clean, react-smoke 29/29, deploy-smoke
11/11. Zero UI touched — only `packages/engine/src/index.ts` and
`packages/engine/test/adaptive.test.ts` changed in Task 5; Tasks 1–4 touched only
`packages/engine/src/adaptive/{types,explain}.ts` and the same test file. **Phase 1's
remaining piece — surfacing a "why" string in at least one screen per app, per the
roadmap's Phase 1 acceptance criteria — is next, and per this project's standing
per-phase review gate, has NOT been started and is awaiting your go-ahead.**

**2026-08-01 — Final whole-branch review of Phase 0 landed a follow-up fix wave,
verified, and pushed, at `0ffd951`.** The review found five Important findings, all
now fixed in one commit on top of `598a1e8`: (1) `explainConAdapt` was mislabeling
real, non-simulated `custom`/`free`-format sessions as `conditioning_level_held`
instead of recognizing those formats never carry progression at all — fixed with a
new early branch (`!rec.fmt || !isProgressedFmt(rec.fmt)`) returning
`conditioning_session_excluded`; (2) `explainWorkingWeight` and
`explainConPrescription`'s default hold-branch `note` could be `''` in the
overwhelmingly common case (non-red-day / baseline-format), violating the contract's
own "safe to render directly" doc comment — both now fall back to a real sentence,
and the doc comment on `TrainingDecisionExplanation.note` now says explicitly "never
empty"; (3) `explainWorkingWeight` reported `confidence: 'high'` with no way to know
whether WHOOP recovery data existed, disagreeing with `explainConPrescription` under
the identical no-device condition — it now takes an optional second `rec` parameter
and matches `explainConPrescription`'s low-confidence/`no_recovery_data` handling when
omitted (this function had zero consumers yet, so the signature change is free); (4)
`explainSetAdjustment`'s `action` (derived from delta) and `reasonCodes`/`note`
(derived from verdict) can still look like a contradictory pairing for a rounding
artifact — documented with a code comment, not new branching logic, since the
underlying `action` value is correct; (5) this handoff entry itself had drifted (stale
SHA, "all five" wrapped functions when only four exist) — corrected above. TDD used
throughout: 4 new/changed tests in `packages/engine/test/adaptive.test.ts` written and
watched fail for the right reason before the corresponding fix landed. Full repo
`pnpm run verify` re-run fresh at `0ffd951`: **exit 0** — typecheck clean, engine
**323/323** (golden **33/33** unchanged), guided-flow 15/15, web 3/3, mobile 72/72,
build clean, CSP check clean, react-smoke 29/29, deploy-smoke 11/11. Only
`packages/engine/src/adaptive/{types,explain}.ts` and
`packages/engine/test/adaptive.test.ts` changed — zero UI touched. Full report:
`.superpowers/sdd/2026-08-01-adaptive-training-phase0/final-review-fix-report.md`.

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

**Most current, from this session's tail end:**

1. **Fitness ecosystem build plan — mid external-review loop, awaiting your
   ChatGPT round-trip.** Doc sent to you and committed at
   `docs/superpowers/specs/2026-08-03-fitness-ecosystem-build-plan.md`. You
   asked to keep iterating across rounds of ChatGPT feedback until this
   session actually endorses the plan, not just produces a draft — bring back
   whatever ChatGPT says and the loop continues from there. Nothing beyond
   this document exists; no implementation of any of the four pieces
   (shared-core, whole-athlete-state-engine, app split, coordinator) has
   started.
2. **Strength/conditioning split (the small, in-app version) is done** —
   merged to `main`, verified, pushed. This is NOT the same thing as the app
   split scoped in item 1's plan (own deploy, own codebase) — that's still
   fully unbuilt and is item 1's biggest single piece (30-36 dev-days).
3. **% of 1RM + rep ranges — still awaiting your go-ahead to write the
   implementation plan.** Spec is written, committed, and pushed
   (`docs/superpowers/specs/2026-08-02-pct-1rm-rep-ranges-design.md`); nothing
   has been built. One open question the spec deliberately left for
   plan-writing time rather than deciding: whether the guided step-by-step
   builder gets this feature in the same pass as the dense Planner editor, or
   as a follow-up.
4. **Phase 3 (modality-aware conditioning thresholds) is still explicitly
   parked, not merely unapproved.** You redirected effort earlier toward
   Library folders and the %1RM feature instead ("park all that for the
   moment, as I've changed my direction with my training"), then this
   session's direction moved again toward the ecosystem plan. The roadmap doc
   and its evidence-bundle citation are unchanged and still valid whenever you
   want to pick this back up — nothing about Phase 3 itself needs
   re-deciding, only re-prioritizing.
5. Everything below this point (the §19 approvals, Supabase schema-side coach
   removal, Echo Bike hardware test, housekeeping) is unchanged from the
   prior handoff and still open — see below.

---

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
