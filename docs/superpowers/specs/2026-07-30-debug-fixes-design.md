# Source-verified functional fixes — audit round 2 (design)

**Status:** drafted from the adversarially-confirmed list (`scratchpad/debug/verified.md`)
· **Date:** 2026-07-30 · **HEAD:** `20db49b`

Twenty-seven source-verified defects: **3 Critical + 24 Important**, grouped
engine / persistence / coach / athlete exactly as `verified.md` groups them.
Every one either crashes a surface, destroys or corrupts an athlete's or coach's
data, or records the wrong training number. Nothing here is polish. The
Refuted/downgraded findings in `verified.md` are explicitly out of scope.

Several fixes land in `packages/engine`, which no earlier task this session
touched. `packages/engine/test/golden.test.ts` pins the output of
`computeSetAdjustment`, `sessionRpe`, `detectPRs`, `sessionVolume`, `condEffort`
and `sanitizeDB` against vectors harvested from the deleted vanilla app — those
vectors are the only surviving record of the original training maths. **No fix
below regenerates a golden fixture.** Each engine fix is scoped so it changes
behaviour only for inputs the golden vectors do not sample (verified against the
fixture files), so the golden suite must stay green after each change — a green
run is the proof the change did not alter the ported maths. Where a fix is a
genuine new behaviour on an un-sampled input (the on-target hold, §Engine E5),
the plan adds a NEW unit test in a non-golden file rather than touching the
golden JSON.

---

## CRITICAL

### C1 · A `__proto__` key in imported/synced settings wipes every workout and session (persistence P1)

`JSON.parse` materialises a backup's `"__proto__"` as an *own* enumerable data
property; `sanitizeDB` (`packages/engine/src/db.ts:81`) passes `settings`
through by reference, `mergeSettings`'s `Object.assign` then invokes the
`__proto__` setter, and `mergeEngines` reads `settings.deletedIds` through the
poisoned prototype so `notTombstoned` filters out every record — locally and, on
the next push, in the cloud. `sanitizeDB` is documented as "the app's single
trust boundary for shape"; `settings` is the hole in it.

**Fix.** `sanitizeDB` rebuilds `settings` from its own enumerable keys, dropping
`__proto__` / `constructor` / `prototype`, so no poisoned prototype can survive
the boundary. Expected: a merge-restore of the hostile file adds nothing and
keeps the existing library intact. Golden `sanitizeDB` vectors all resolve
`settings` to `{}` and contain no `__proto__`, so rebuilding is a no-op for
them.

### C2 · A legacy `kind:'cond'` block with a missing/unknown `fmt` white-screens the coach app (coach C1 = engine I11 = persistence L6)

`migrateBlock` (`apps/coach/src/model.ts:199-207`) assigns
`cb.condFmt = b.fmt` with no `CON_FORMATS` check, overwriting the valid
`'intervals'` default `newCondBlock()` just supplied. `App.preview`
(`App.tsx:361`) and `cellSummary` (`builder/grid.ts:19`) then read
`CON_FORMATS[b.condFmt].name` unguarded and throw on load — blank document on
home *and* plan views, no in-UI recovery.

**Fix.** `migrateBlock` validates `b.fmt` with `Object.prototype.hasOwnProperty.call`
and keeps `newCondBlock()`'s `'intervals'` when it is absent or unknown (the
engine-shape path at `:154-155` drops the block; keeping the block but
defaulting its format preserves the coach's finisher and is the friendlier of
the two acceptable outcomes named in the finding). The two summary read-sites
are hardened to `CON_FORMATS[b.condFmt]?.name ?? b.condFmt`, matching the guard
`ReviewScreen` already uses at `GuidedFlow.tsx:394`. (An error boundary at
`main.tsx` is noted as optional hardening, not required by this fix.)

### C3 · A movement logged in two blocks banks the lighter block's weight (engine EC1)

`liftMoves` (`packages/engine/src/lift.ts:68-99`) pushes one `LiftMove` per
exercise with no dedupe, and `liftAdapt` writes each with the same `at`, so a
60 kg back-off block's move overwrites the 100 kg main lift's — next session
prefills 65 kg and Recap shows two contradictory rows for one movement.

**Fix.** `liftMoves` dedupes by lowercased name keeping the FIRST working
occurrence, mirroring `sessionOpeners` (`lift.ts:204-217`) — in ordinary
programming the main working movement is authored before its back-off/burnout
block, so first-seen is the working effort. (Judgement call surfaced to the
human: if a coach places a back-off block *before* the main lift, first-seen
picks the back-off; the alternative is heaviest-`from`.) Folded in with the same
traversal: **engine E6** — a set with `reps <= 0` earns no progression, matching
`exLogFor`/`sessionVolume`/`epley`, so a 0-rep AMRAP can no longer drive the
weight. `liftMoves`/`liftAdapt` are not golden-pinned.

---

## ENGINE (Important)

### E1 / E2 / E4 · Warm-up BLOCK sets contaminate three readers

`sessionRpe` (`session.ts:188-205`), `bestE1rmByLift` (`:403-433`) and
`rpeGapInfo` (`:357-364`) lack the `isWarmupBlock(b)` skip every sibling opens
with, so a rated warm-up block enters the felt-RPE mean, the estimated 1RM, and
the Home readiness gap. `rpeGapInfo` additionally lacks even the per-set
`isWarmup(st)` guard.

**Fix.** Add `if (isWarmupBlock(b)) return;` to each; add the per-set
`isWarmup(st)` skip to `rpeGapInfo` too. Golden `sessionRpe` fixtures contain no
warm-up *block* (only a warm-up *set*, already handled), so the guard is a no-op
there and the suite stays green; `bestE1rmByLift`/`rpeGapInfo` are not pinned.

### E3 · `detectPRs` dedupes by name before scanning, missing a PR in a later block

`session.ts:311-314` runs `seen.add(key)` before computing the per-set best, so
only the first exercise with a given name is examined — a heavy single in a
later block never fires the PR banner while the Progress chart jumps.

**Fix.** Accumulate the best qualifying set per name across ALL non-warm-up
blocks, then emit one PR per name. The golden `detectPRs` fixtures have no
name repeated across blocks, so the output is byte-identical and the suite stays
green.

### E5 · On-target sets still move the bar and are labelled `bad`

`computeSetAdjustment` (`autoreg.ts:66-76`) applies `roundToIncrement`
unconditionally, so a set that hit its target exactly (`center − eff === 0`)
still snaps a manually-entered non-plate weight (101 → 100), prints a red
"−1 kg" for a perfect set, and banks the moved number.

**Fix.** When the effort equals the target (the multiplier is exactly 1, so the
raw new weight equals the input weight), hold the weight instead of rounding.
`cls` then reads `'good'` automatically because `delta` is 0. This changes output
ONLY for `center === eff` with a non-2.5-multiple weight; every golden
`computeSetAdjustment` vector has a plate-multiple weight (so rounding was
already a no-op there) and the "right on target / bad" vectors all sit at
`|center − eff| = 0.5` (a genuine move that stays a genuine move), so the 672
vectors stay green. A new unit test in a non-golden file pins the on-target-hold
case.

### E6 · A zero-rep AMRAP set moves the working weight up

Folded into C3 (engine): `liftMoves` skips `reps <= 0`, and the two Loggers'
in-session hint/prefill (`Logger.confirmSet`) gate on `reps > 0` so a 0-rep
AMRAP no longer produces a "+kg" hint or prefills the next set. The golden
function `computeSetAdjustment` is deliberately NOT modified (no golden vector
samples `reps: 0`; the guard lives at the call sites, consistent with every
other reps-gated reader).

### E7 · A metcon-only session is forever 0 % and a ticked metcon never counts

`sessionProgress` (`logger.ts:230-245`) counts conditioning as one unit but lets
text blocks fall through `blockExercises → []`, so a ticked metcon adds nothing
to done/total and the finish button always reads "Finish session early".

**Fix.** Count a text block as one unit, done when `b.done` — matching
`hasLoggedWork` (`session.ts:236-238`). Not golden-pinned; covered by the engine
logger tests.

### E8 · A strapless conditioning run is scored as a failed session (engine, = athlete I3)

`conAdapt` (`conditioning.ts:280-310`) treats `zsec {0,0,0}` (no HR data) the
same as "failed the target": `workSec 0` → miss, and two misses deload the
earned level. Every strapless web run and every mobile strap failure walks
progression backwards on sessions the app never measured.

**Fix.** When no zone time was banked at all (`zoned <= 0`), return early with no
change — neither earn nor deload. A run with HR data that simply stayed out of
zone still counts as a miss. Not golden-pinned; a new test pins the no-data case.
Paired with athlete A3 (web minimum-duration) which stops a 1-second mis-tap
from reaching `conAdapt` in the first place.

### E9 · A prototype-named `effort` crashes Home (engine, downgraded from Critical)

`condEffort` (`conditioning.ts:125-130`) indexes `CON_EFFORTS[e]` with a plain
lookup, so `effort:'constructor'` resolves through the prototype chain to the
`Object` constructor (truthy) and `rpeGapInfo` then throws — a persistent Home
white screen. Reachable only via a crafted/foreign backup, hence Important not
Critical, but the import path is user-facing and the crash survives reloads.

**Fix.** Guard the `CON_EFFORTS` / `ZONE_TO_EFFORT` lookups with
`Object.prototype.hasOwnProperty.call`, falling back to `CON_EFFORTS.medium` as
the docstring promises. The golden `condEffort` fixtures include no prototype
key, so behaviour is unchanged for every sampled input and the suite stays green.

---

## PERSISTENCE (Important)

### P2 · A failed pre-push read becomes a truncating cloud overwrite (= H2)

Both push paths (`apps/web/src/cloud/sync.tsx:103`,
`apps/mobile/src/cloud/sync.tsx:130`) destructure only `{ data }` from the
pre-push read, so a network blip / 500 / RLS refusal is indistinguishable from
an empty row and `buildPushState(local, {})` upserts a truncated state,
destroying another device's records and all unrelated `state` keys.

**Fix.** Destructure `error` and treat a read error as fatal for that push
(`if (e) throw e`), exactly as `reconcile` already does at `sync.tsx:186`.

### P3 · The web logger re-serialises the whole database on every keystroke (= H3)

Web `update()` (`store/db.tsx:95-104`) `structuredClone`s the entire DB and
`saveDB`s it synchronously on every character typed via `Logger.writeVal`, and
the push effect body (`cloud/sync.tsx:245`) runs a second full `JSON.stringify`
via `cloudFp(db)` per render — ~228 ms/keystroke at 300 sessions. Mobile solved
this with `updateSession` (clone one session) but web never got it.

**Fix.** Add web `updateSession(id, fn)` mirroring the mobile store — it carries
every other session by reference and clones only the edited one — and route the
logger's hot paths (`writeVal`, `confirmSet`, the metcon/`ssNext` toggles)
through it. Remove the per-render `cloudFp(db)` guard from the push effect body;
`pushNow`'s own fingerprint check already dedupes the network call, so the guard
only cost a stringify. Web's synchronous no-debounce save is deliberately kept
(the verified-clean list confirms web has no loss window and needs no unload
flush); the residual per-keystroke cost is the single `saveDB` stringify, which
is the accepted price of crash-safe synchronous persistence.

### P4 · Inline HR/GPS traces push a normal account past the localStorage quota (= H4)

`CondResult.trace`/`route` are stored on the session block and nothing prunes or
slims them (~78 % of the blob; over the ~5 MiB budget by 300 sessions), after
which every `saveDB` fails forever and `SaveAlert` tells the athlete to "free
some space" with no control that does.

**Fix.** A new engine helper strips `trace`/`route` from the conditioning
results of all but the most recent N sessions (keeping recent runs' maps intact
for Recap/History), invoked on boot in both stores alongside
`expireStaleSessions`, and again as a recovery pass when a `saveDB` returns false
(prune, then retry the write). This bounds the blob without moving traces out of
the single store. New engine function → not golden-pinned.

---

## COACH (Important)

### C-chain (C2) · Deleting the middle of a superset chain re-routes it

`onDeleteExercise` (`GuidedFlow.tsx:223-237`) clears `ssNext` only on the new
last row, so deleting B from A→B→C leaves A chained to whatever slid into B's
slot — an A1/A2 superset the coach never authored, shipped to the athlete with
no rest between the two.

**Fix.** On delete, also clear `ssNext` on the row immediately *before* the
removed one (it was linked to the row that is now gone), in addition to the
existing last-row clear. Deleting a chain member breaks the chain there.

### C-warmup (C3) · Authoring a warm-up BLOCK forces a meaningless RPE

`stepsFor` (`flowSteps.ts:26-30`) drops the RPE step only for a warm-up *set*
(`isWarmupSet`), never for a warm-up *block* (`blockKind === 'warmup'`), so a
warm-up block walks the full lift sequence and `canAdvance` makes the RPE
mandatory — a target the engine ignores everywhere, which then contaminates
`sessionRpe`/`rpeGapInfo` (the very E1/E4 above).

**Fix (pure, TDD).** `stepsFor` skips `'rpe'` when `blockKind === 'warmup'` too;
`commitBlock` writes an empty RPE for a warm-up block. `FlowState` already
carries `blockKind`, so the pure `flowSteps` change is unit-tested directly.

### C-cue (C4) · Abandoned draft text leaks onto the next block's cue

Backing out of Metcon's note step to the block-type picker and choosing Lift
commits `cue: draft.note` (`GuidedFlow.tsx:123`) — the metcon prose renders on an
unrelated exercise's card — because the draft is reset only on commit and the
picker back-out, not when a new block kind is picked.

**Fix.** `BlockTypeStep.onPick` resets to `{ ...EMPTY_DRAFT, blockKind: kind }`
instead of spreading the stale draft, so picking a block kind starts clean.

### C-edit (C5) · Editing an exercise flattens every set to set 1's target/RPE

`onEditExercise` (`GuidedFlow.tsx:205-219`) pre-fills from `sets[0]` plus a
count, and `commitBlock` (`:118-119`) rebuilds N identical sets — a no-op
walk-through of a ramp (`W5/W3/5/3/1 · RPE 7→9`) becomes `5×5 @8`.

**Fix (judgement call).** On an edit commit, if the coach did not change the
set-shaping fields (count, reps, RPE, warm-up flag) from what the row started at,
keep the ORIGINAL `sets` array (heterogeneity preserved) and update only
name/rest/tempo/mode/cue; rebuild uniform sets only when they genuinely
re-specified reps/RPE/count. This closes the data loss without building a
per-set editor (which the earlier round's Global Constraint deliberately
excluded). Surfaced to the human as the one behavioural judgement in the batch.

### C-metcon (C6) · An empty metcon makes an empty session publishable

`MoreStep`'s Done has no `disabled`, `commitBlock` commits an empty `TextBlock`,
and `assertPublishable` only counts `blocks.length` — combined with E7 the
athlete gets a 0/0-forever session.

**Fix.** `MoreStep`'s Done is disabled for a metcon with an empty body, so an
empty metcon can no longer be authored. (Legacy already-empty metcons are a
separate LOW finding, out of scope.)

### C-publish (C7 + C8) · No-date send, and hand-written messages flattened to "check your connection"

`PublishStep` (`steps/PublishStep.tsx:10,51`) enables Send with an empty
`scheduled_date`, producing a guaranteed round trip to a date-typed column whose
error surfaces as a connection problem. And `humanizeError`
(`apps/coach/src/errors.ts`, `apps/web/src/errors.ts`) has no branch for
`assertPublishable`'s "Nothing in this session yet…" or `restoreDb`'s two
messages, so a purely local problem is misdiagnosed as a network one.

**Fix.** Disable Send until a date is set (`|| !date`); add pass-through branches
to both humanizers for the engine's hand-written sentences.

---

## ATHLETE (Important)

### A1 · Training's Start has no inside-write guard: two live sessions

`startWorkout` (`apps/web/src/screens/Training.tsx:47-51`,
`apps/mobile/…:49-53`) pushes a session with no active-session check — a distinct
site from the Home guard already fixed at HEAD. Two workouts scheduled today
render two Start buttons, so a single tap on each deterministically creates a
second, invisible, unfinishable session that then enters the sync merge.

**Fix.** Guard *inside* the write, mirroring `Home.tsx:143-146`:
`if (draft.sessions.some((x) => x.status === 'active')) return false;` — the
render-scope `activeSession` is stale within one frame.

### A2 + A3 · Web conditioning loses its sink on re-entry, and banks 1-second mis-taps

The live run survives navigation in the module-level `RUN`, but the result sink
(`block`/`bi`) is read from the URL every render (`Conditioning.tsx:79-82`), so
re-entering through Home's door (which carries no query) leaves `finish()`
banking into standalone history — the block stays forever unlogged and Training
re-offers work already done. And web has no `MIN_LOGGABLE_SEC` guard, so a
Start→Finish mis-tap banks a 1-second run (which, with E8, costs a level).

**Fix.** Capture the sink onto `RUN` at `start()` and resolve it from `RUN` in
`finish()` (with the `>= 0` sentinel guard mobile already uses, closing the
latent M7 too). Add `MIN_LOGGABLE_SEC = 20` matching mobile: a shorter run is
discarded, not banked.

### A4 · Mobile silently discards a live run to the hardware back / swipe gesture

Run state is component state/refs, the unmount cleanup tears down strap + GPS,
and only the in-app back arrow is hidden while live — Android's hardware back and
the enabled swipe-back both pop the screen and lose the clock, HR samples and GPS
route with no warning.

**Fix.** A `beforeRemove` navigation listener (which fires for both hardware back
and the swipe gesture) prevents the pop while `live` and confirms before
discarding, tearing down strap/GPS only on an explicit Discard. No new
dependency.

### A5 · Standalone conditioning runs never reach the coach (= persistence M8)

`coachDigest` (`packages/engine/src/cloud.ts:213`) filters
`settings.conditioning` on a `date` field `CondResult` does not declare, so
`'' >= cut` drops the whole array while inline block results pass — a coach sees
some conditioning and cannot tell runs are missing. `slim()` also emits
`date: undefined`.

**Fix.** Window standalone runs on `startedAt` (an epoch ms cutoff), like every
other reader; derive `date` from `startedAt` in `slim()` so the coach dashboard's
date column is populated. `coachDigest` is exercised by `cloud.test.ts` on the
inline path only; a new test pins the standalone path, and the inline assertions
(length/hrr/zsec) are untouched by an additive `date`.

---

## Out of scope

The Refuted / downgraded section of `verified.md` is left entirely: engine I7
(done-without-felt), I10 (`customFmtBase` rest 0→80), coach I8 / athlete M6
(shared library ids — latent, re-mint on the next reload), the engine
prototype-`in` MINORs (M1), and all persistence MEDIUM/LOW/Minor findings
(M1–M17 / L1–L15 not promoted here). C1's `main.tsx` error boundary is optional
hardening, not part of the crash fix.

## Testing

Every engine fix and every pure-logic fix is TDD: the failing test is written
first, and for the crash/data-loss bugs (P1, C1, E8, A5) the failing test IS the
`verified.md` repro. Golden (`packages/engine/test/golden.test.ts`) is run after
each engine change and MUST stay green with no fixture regenerated — see the
header note; the on-target-hold gets its own non-golden unit test. Coach flow
logic (`flowSteps`) is unit-tested; the coach app stays desktop-only and its
editing flows get the existing react-smoke coverage. Web store/sync gains no test
harness beyond what exists (web has no unit suite); web changes are typecheck +
build + a throwaway Playwright drive. Mobile changes run the jest suite.
