# Handoff

## 1) Goal

Ship the conditioning-evidence-based upgrade end to end, clear the pre-existing bug
backlog, remove the half-dead coach system, wire up the one first-party safety signal
the app was capturing and discarding (`pain_stop`), and get Concept2 Logbook + Echo
Bike V3 verified against real accounts/hardware. On top of that, a full audit was run
to scope a Juggernaut/MacroFactor-style adaptive training-decision layer — that audit
is written up but **awaiting your review before any implementation starts.**

## 2) Current State

**2026-08-02 — Set timer shipped on branch `set-timer`, verified, and pushed to that
branch (not merged to `main` — a separate final whole-branch review still has to
happen first).** Five tasks, six commits: `1f99fa1` (web — new `SetTimerProvider`/
`useSetTimer` in `apps/web/src/store/setTimer.tsx`, mirroring `rest.tsx`'s
end-timestamp/localStorage-survival pattern, mounted in `App.tsx`), `cd82e5c` (mobile —
the same store shape in `apps/mobile/src/store/setTimer.tsx`, adapted to mobile's own
patterns: the `storage` wrapper instead of raw `localStorage`, `buzz()` from
`../native/capabilities` instead of `navigator.vibrate`, and the zero-effect keyed off
`running` the way `rest.tsx` already does rather than off `ends`), `750447e` (web —
`SecondsTimerField` wired into `Logger.tsx`'s `seconds`-mode branch, plus two new
`checks/react-smoke.mjs` scenarios), `9e82655` (docs — the implementation plans this
branch and the duplicate-workout branch both execute against), `f44aa81` (mobile — the
same `SecondsTimerField` wired into `apps/mobile/src/screens/Logger.tsx`, plus two new
cases in `apps/mobile/test/logger.test.tsx`). All four build tasks (Tasks 1-4) were
reviewed clean before this final task started.

**What shipped:** a live countdown timer for `seconds`-mode Logger sets (stretches,
planks, holds) in both apps. `seconds`-mode fields now render a `SecondsTimerField`
with a Start control that arms a countdown against the set's `t` target; while running,
the field shows the live count-down and locks against manual typing; on completion it
buzzes (`navigator.vibrate` on web, `buzz()` on mobile) and fills the field with the
held duration; Stop ends the hold early and writes the actual elapsed seconds instead
of `0` or the full target. The timer is driven by a new `useSetTimer` hook backed by a
`SetTimerProvider` in each app — a direct sibling of the existing `useRest`/`RestProvider`,
built the same way (an end-timestamp persisted to storage, not a plain in-memory
countdown, so it survives a reload or the browser reclaiming a backgrounded tab) but
kept as a genuinely separate provider rather than folded into `useRest`: rest and a
set-hold are different concerns that can be live at different points in the same flow
and complete differently (rest expiring just buzzes; a set timer finishing has to hand
back the seconds held so the Logger can write them into the set). Mobile's rest timer
additionally schedules a native background-notification alarm so it still buzzes if the
app is backgrounded mid-rest; the set timer deliberately skips that — an athlete holding
a stretch is watching the screen, unlike resting between heavy sets — so it's in-app
buzz only, no alarm scheduling.

**Heart rate is deliberately NOT part of this.** Live BPM/zone stays exactly where it
already lives — the Conditioning screen — and this timer has no HR input or output at
all. Nothing about `seconds`-mode strength sets (planks, holds, stretches) reads or
displays heart rate; that was never in scope for this feature and nothing here changes
the existing Conditioning-only HR surface.

**"Per side" needs no data-model change.** A per-side hold (e.g. a single-arm plank)
is authored as two ordinary consecutive sets in the plan, exactly like any other
multi-set exercise — the existing `t`/`rpe` target fields on each of those two sets
carry the per-side split (e.g. each set's own `t` target is the per-side duration).
The timer control itself has no notion of "sides" at all; it just runs once per set,
so doing a per-side hold means pressing Start twice, once per set, the same as doing
any other two-set exercise.

**One parked finding from Task 3's review, flagged as a known limitation rather than
fixed here.** The set timer is session-wide and singular, exactly like `useRest` —
starting it only arms the countdown, and the countdown's zero-write lands on whichever
`seconds`-mode field happens to be mounted when it completes or is stopped (this is
documented behavior, not a bug: see `docs/superpowers/specs/2026-08-02-set-timer-design.md`).
The corner case this leaves open: if an athlete starts a hold, navigates away before it
finishes, and then starts typing a hand-edited value into a *different* `seconds`-mode
set before the original timer completes, the timer's completion write can land on and
overwrite that hand-edit — because the write always targets "whatever `seconds`-mode
field is on screen right now," not "the field that started the timer." This is narrow
(it requires navigating away mid-countdown AND hand-editing a different seconds field
before the first timer finishes) and is the same shape of trade-off `useRest` already
accepts today for rest periods, so it's being carried forward as a known limitation for
a future pass rather than blocking this ship.

Full repo `pnpm run verify` re-run fresh at `f44aa81`: **exit 0** — typecheck clean
(packages/config, packages/design, packages/engine, packages/guided-flow, apps/mobile,
apps/web), engine **511/511** across 20 test files (unchanged — this feature touches no
engine code), guided-flow **15/15** (unchanged), web **3/3** unit tests (unchanged —
this feature's web coverage lives in react-smoke, not a unit test), mobile **77/77**
(was 75/75 before this branch; the +2 are "running a seconds-mode set to zero fills the
field with the held duration" and "stopping a seconds-mode timer early writes the
actual elapsed time, not 0 or the full target" in `apps/mobile/test/logger.test.tsx`),
build clean, CSP check clean, react-smoke **34/34** (was 32/32 before this branch; the
+2 are "a seconds-mode set shows a Start control, and letting it run to zero fills the
field" and "stopping a seconds-mode timer early writes the actual elapsed time"),
deploy-smoke **11/11** (unchanged).

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
