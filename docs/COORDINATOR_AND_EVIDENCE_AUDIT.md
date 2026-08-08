# Coordinator and evidence audit

Every rule that reads a physiological signal or changes training, traced to
source. Written 8 August 2026 against `main` @ `a8ff104`.

**Method.** Each rule below was read in the code, not recalled. Where I state
that something is advisory or applied, I traced the call site. Where I could
not establish something, it says so.

**The standard applied.** A formula existing in code is not evidence that it is
valid. This repository carries golden vectors proving the code matches its
ORIGIN (a prior vanilla app, and a Python reference for nutrition) — that is
provenance, not validation. Nothing here has been checked against the
literature, and the repo makes no such claim.

---

## Summary: where the app contradicts the provisional constraints

| # | Constraint | Status | Where |
|---|---|---|---|
| 1 | Do not automatically increase load | **CONTRADICTED** | `apps/web/src/screens/Logger.tsx:296-297`, `apps/mobile/src/screens/Logger.tsx` |
| 2 | Progression requires explicit coach approval | **CONTRADICTED** | `apps/web/src/screens/Training.tsx:86` |
| 3 | Meaningful automated change requires a receipt | **PARTIAL** | ledger exists but is device-local: `apps/web/src/autocoach/ledger.ts:27` |
| 4 | Missing information stays unknown | **COMPLIES** | `packages/whole-athlete-state/src/state.ts:19,22`; `packages/engine/src/lift.ts:175` |
| 5 | Direct athlete input outranks wearable | **COMPLIES (training plan)** / **UNVERIFIED (lift gate)** | `packages/coordinator/src/types.ts:53-61`; see rule 3 below |
| 6 | Pain/illness route to hold | **COMPLIES** | `dropped_pain_safety`, `dropped_illness_safety` |
| 7 | No automatic make-up debt | **COMPLIES, with a caveat** | `staleness` on `SessionProposal`; see rule 6 |
| 8 | History not silently rewritten | **COMPLIES since 7 Aug** | `packages/nutrition-core/src/log.ts` `applyManualMacroEdit` |

---

## Rule 1 — `computeSetAdjustment` (in-session load adjustment)

- **Source**: `packages/engine/src/autoreg.ts:57`
- **Inputs**: reps performed, RPE felt, rep floor for the set type, current
  weight, RPE centre for the set.
- **Missing data**: the caller guards. `Logger.tsx:281` requires
  `weight > 0 && reps > 0`; `lift.ts:94` returns early unless `reps > 0`, and
  `:99` returns unless `felt` is finite. A 0-rep AMRAP used to read as reps 0
  and move weight UP — the comment at `lift.ts:91-93` records that bug.
- **Output**: `{ delta, newWeight, verdict, cls }`.
- **Advisory or applied**: **BOTH, and this is the finding.** It renders a hint
  (`nextHint`, `Logger.tsx:292`) — advisory. Then:

  ```js
  const nx = dex.sets[si + 1];
  if (!isFinal && nx && !nx.done && !nx.aVal) nx.aVal = String(adj.newWeight);
  ```
  `apps/web/src/screens/Logger.tsx:296-297`

  It **writes the adjusted weight into the next set's field**, and `adj.delta`
  can be positive. Guarded to a set that is not done and has no value yet, and
  the athlete can overwrite it before lifting.
- **Does it change training**: yes — it changes the number in front of the
  athlete for the next set.
- **Evidence in repo**: golden vectors at `packages/engine/test/golden/computeSetAdjustment.json`
  pin behaviour against the vanilla app it was ported from. No physiological
  citation anywhere.
- **Risk**: an athlete who logs a genuinely easy set is handed a heavier next
  set with no confirmation step and no receipt. Warm-ups are excluded
  (`isWarmup`, `Logger.tsx:277`), which removes the worst false positive.
- **Disposition**: **retain but require confirmation.** Keep the hint; make the
  pre-fill an explicit accept, or mark the pre-filled value visually as a
  proposal. Contradicts "do not automatically increase load" as written.

## Rule 2 — `liftAdapt` (cross-session progression banking)

- **Source**: `packages/engine/src/lift.ts` (`liftAdapt`), called at
  `apps/web/src/screens/Training.tsx:86`:
  ```js
  draft.settings.liftProgress = liftAdapt(ds, draft.settings).liftProgress;
  ```
- **Trigger**: session completion.
- **Missing data**: a movement with no completed working set produces nothing —
  skipping a lift or logging only warm-ups earns nothing (`lift.ts:66-68`).
- **Advisory or applied**: **APPLIED, automatically, at session end.** No
  approval step exists.
- **Does it change training**: yes — it sets the working weight offered next
  session.
- **Disposition**: **require human approval**, if the coach-approval constraint
  is to hold. Today there is no coach in the loop at all; the athlete IS the
  approver by virtue of performing the set. Under a coach model this is the
  single biggest behavioural change required.

## Rule 3 — `nextWorkingWeight` daily recovery gate

- **Source**: `packages/engine/src/lift.ts:168-186`
- **Inputs**: banked `liftProgress`, WHOOP recovery score.
- **Missing data**: `if (rec == null || recoveryBand(rec) !== 'low')` returns
  the earned weight unchanged (`:175`). **Missing recovery is a no-op, not a
  "clear".** Complies with constraint 4.
- **Thresholds**: `recoveryBand` (`packages/engine/src/hr.ts:54-60`) —
  `>= RECOVERY_BANDS.good` → good, `>= RECOVERY_BANDS.watch` → watch, else low.
- **Direction**: **one-directional.** Only a `low` band adjusts, and only
  downward by one `AUTOREG.stepKg` (`:179`), floored so it cannot go below one
  step. It can never raise load.
- **Precedence**: this gate reads WHOOP only. It does **not** read pain or
  illness. Because it can only ease, that is not a safety hazard — but it means
  a pain flag does not reduce prescribed weight through this path. Whether pain
  reduces load at all is handled by the Coordinator dropping the session
  entirely (rule 5), not by easing it.
- **Evidence in repo**: the thresholds are asserted in tests but no rationale
  or source is documented for the band values.
- **Disposition**: **retain, relabel.** The mechanism is conservative and
  honest. The band names ("good"/"watch"/"low") imply more physiological
  authority than a vendor recovery score supports.

## Rule 4 — `deriveAthleteState` readiness composition

- **Source**: `packages/whole-athlete-state/src/state.ts`
- **Inputs** (`:62-70`), each added only when present: WHOOP recovery score,
  WHOOP sleep performance, manual sleep duration, sleep quality, energy,
  soreness, reported stress, life stress, physical work load.
- **Missing data**: `band(null)` → `'unknown'` (`:19`); `capacity(null)` →
  `'unknown'` (`:22`). **Explicitly unknown, never "normal".** Complies.
- **Mixing**: manual athlete-reported signals and wearable signals are combined
  into one score, each tagged with `source` (`whoop` / `manual` / `life_load`).
  The tag is retained, so a surface CAN show provenance.
- **Thresholds**: readiness `>= 70` high, `>= 45` moderate, else low (`:19`).
  No rationale documented for 70/45.
- **Does it change training**: indirectly — it feeds the Coordinator's
  `AthleteStateSnapshot`.
- **Risk**: **the composite is the weak point.** A single number blending a
  vendor's proprietary recovery score with self-reported soreness reads as more
  precise than its inputs. Constraint 5 says direct athlete input outranks
  wearable information; here they are averaged into one figure, so neither
  outranks the other.
- **Disposition**: **retain but relabel, and consider weighting.** If athlete
  input is to outrank the wearable, that ordering has to exist in the maths,
  not only in the docs. Flagged as a genuine ambiguity, not a proven bug.

## Rule 5 — Coordinator weekly resolution

- **Source**: `packages/coordinator/src/coordinator.ts:103` `reconcileWeeklyPlan`
- **Inputs**: `CoordinatorInput` — proposals, athlete state, goals, schedule,
  locked entries (`packages/coordinator/src/types.ts:41-49`).
- **Output**: `WeeklyPlan` with `entries` and `decisions: PlanDecision[]`
  (`:82-90`).
- **Safety precedence**: `dropped_illness_safety` and `dropped_pain_safety` are
  distinct reason codes (`:53-61`), separate from capacity codes. Pain and
  illness remove a session rather than scaling it. Complies with constraint 6.
- **Advisory or applied**: **applied** — it is the sole authority on the weekly
  plan, by design (`CLAUDE.md`).
- **Auditability**: every proposal gets a decision with a `reasonCode` and a
  human `explanation`. This is the strongest evidence surface in the system.
- **Disposition**: **retain.** This is the part of the system most aligned with
  the stated product values.

## Rule 6 — `staleness` on proposals

- **Source**: `packages/coordinator/src/types.ts` (`SessionProposal.staleness`)
- **Question it raises**: does a missed session create make-up debt?
- **What I established**: `staleness` raises a proposal's standing so a
  long-unscheduled session competes better next week. It does **not** create a
  duplicate or add volume — the weekly and domain caps still apply
  (`dropped_domain_cap`, `dropped_weekly_cap`).
- **Assessment**: complies with "no automatic make-up debt" in the sense that
  matters — nothing is owed or added. **Caveat**: I did not trace the full
  staleness weighting, so I cannot state the magnitude of its influence. Marked
  unverified rather than asserted.
- **Disposition**: **retain; verify the weighting** before relying on the
  no-debt claim in coach-facing copy.

## Rule 7 — `auto-coach` session resolution and its receipt

- **Source**: `packages/auto-coach/src/index.ts` (`resolveSession`); ledger at
  `apps/web/src/autocoach/ledger.ts`
- **Advisory or applied**: applied to ONE session, within an athlete-set
  policy, and undoable (`canUndo`, `:92`).
- **Receipt**: `recordApply` (`:78`) writes a ledger entry, and
  `SessionReceipt.tsx` renders it. **But the ledger key is
  `hybrid-auto-coach-ledger-v1` in localStorage (`:27`) and is not in any sync
  partition** — `SYNCED_SNAPSHOT_DOMAINS` is `['strength','conditioning','nutrition']`
  (`packages/engine/src/ecosystem.ts:172`).
- **Consequence**: the receipt is **device-local**. A coach on another device
  cannot see that the system adjusted a session. For a coach product this is a
  material gap, not a cosmetic one.
- **Disposition**: **retain the mechanism; the ledger must become a synced,
  append-only record** before any coach surface claims to show what automation
  did.

## Rule 8 — nutrition engine (six inherited defects)

- **Source**: `packages/nutrition-engine/src/defects.ts` — all six documented as
  data, with a test preventing decay.
- **Status**: carried UNFIXED deliberately; parity with the Python reference is
  a proven contract and silent divergence was judged worse. Two are
  athlete-visible and surfaced in the UI rather than smoothed over.
- **Most safety-relevant**: `ewma-gap-carry-flattens-slope` — sparse weigh-ins
  flatten the trend, understating expenditure and handing the athlete a LOWER
  calorie target than intended, worst exactly when data is thinnest.
- **Disposition**: **retain, already disclosed.** This is the repository's best
  example of honest handling of a known flaw. It should be the template for how
  rules 1, 2 and 4 are disclosed.

## Rule 9 — HRV

- **Constraint in `CLAUDE.md`**: HRV must never be used as a pain, injury or
  illness gate.
- **What I found**: HRV is persisted (`whoopDaily.hrvMs`,
  `packages/shared-core/src/core.ts`) and displayed. I found no gate keyed on
  HRV. `recoveryBand` reads `recoveryScore`, not HRV.
- **Disposition**: **complies**, on the evidence inspected.

---

## What could not be established

- The magnitude of `staleness` weighting (rule 6).
- Whether any rule was ever validated against evidence external to this
  codebase. Nothing in the repository claims so, and I found no citations.
- Concept2 and WHOOP ingestion paths were inventoried but not traced end to
  end for this audit.
