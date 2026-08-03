# Fitness Ecosystem — Full Build Plan

**Status:** Draft for external review (ChatGPT second opinion), not yet approved for implementation.

## 1. Vision

Target architecture, as specified by the product owner:

```
fitness-ecosystem/
├── shared-core/
│   ├── athlete profile
│   ├── goals and schedule
│   ├── body metrics
│   ├── life-load
│   ├── recovery state
│   ├── safety flags
│   └── shared event history
│
├── whole-athlete-state-engine/
│   ├── sleep interpretation
│   ├── stress and life-load trends
│   ├── recovery debt
│   ├── readiness estimates
│   ├── illness status
│   └── training constraints
│
├── strength-engine/
│   ├── strength fatigue
│   ├── volume tolerance
│   ├── performance trends
│   └── lifting adjustments
│
├── conditioning-engine/
│   ├── cardiovascular fatigue
│   ├── modality fatigue
│   ├── interval tolerance
│   └── conditioning adjustments
│
├── nutrition-engine/
│   ├── food intake
│   ├── body-weight trends
│   ├── energy availability
│   └── expenditure estimates
│
└── coordinator/
    ├── resolves conflicts
    ├── orders sessions
    ├── reduces total workload
    └── produces the final weekly plan
```

`nutrition-engine` (the "macro app") is being built as a separate effort and is **out of scope for this document**. `strength-engine` and `conditioning-engine` are meant to be genuinely separate, independently deployed apps (own build, own store listing), not modules inside one app — sharing only `shared-core` and, eventually, `coordinator`'s output.

## 2. Current State

One existing codebase, `the-hybrid-engine1` (a pnpm monorepo: `apps/web` — Vite PWA on Netlify; `apps/mobile` — Expo/EAS React Native; `packages/engine` — shared TypeScript domain logic, ~5.8k lines; `packages/design` — design tokens; `packages/guided-flow` — shared step-flow logic). It is today, functionally, `shared-core` + `strength-engine` + `conditioning-engine` fused into one app on each platform, with **no `whole-athlete-state-engine`** and **no `coordinator`** as their own components.

Concretely:
- **~22k lines of product code** across both platforms (web ~8k, mobile ~8.5k, engine ~5.8k). The same 13 screens exist twice — once as React DOM, once as React Native — because the platforms don't share a UI package today.
- **Strength-only code:** ~5k lines / ~25 files (Logger, Exercise/e1RM history, Planner, most of the guided builder; engine: `lift.ts`, `plates.ts`, `autoreg.ts`, `logger.ts`, `adaptive/`).
- **Conditioning-only code:** ~3.9k lines / ~15 files, mobile-heavy (Conditioning screen, Concept2 integration, BLE/FTMS native layer — ~680 lines alone — GPS background location, route map; engine: `conditioning.ts`, `concept2.ts`, `hr.ts`, `geo.ts`).
- **Shared/ambiguous code: ~13k lines, roughly 60% of everything** — Home, Library, History, Recap, Progress, Calendar, Settings, Training, Day screens; the UI primitive library; the local store; cloud sync; and engine core (`types.ts`, `session.ts`, `db.ts`, `cloud.ts`, `insights.ts`, `balance.ts`).
- **Sync model:** one JSON blob per user (`app_state.state jsonb` in Supabase), merged client-side by hand-written TypeScript merge rules (`db.ts`). No server-side schema or API boundary exists today — correctness depends on every client shipping identical merge logic. A version-skew bug in this exact mechanism is already a known, documented issue (`packages/engine/src/cloud.ts:14-26`), independent of anything in this plan.
- **WHOOP integration exists but is shallow:** recovery/strain/sleep/HRV are read live and used inline by several features (HR zone shifting, working-weight easing, conditioning prescription trimming, a "Readiness" display card), but only `{date, recovery, strain}` are actually persisted for trend analysis — HRV, sleep, and resting heart rate are read once and discarded, which the codebase's own `insights.ts` comment flags as blocking drift/trend detection.
- **Nothing today reconciles strength and conditioning into a schedule.** The one piece of cross-modality logic that exists (`balance.ts`'s `loadBalance()`) is explicitly retrospective-only by its own design comment — it notices interference after the fact, it does not prescribe anything.
- **A small, already-shipped step exists in this direction:** this session added an explicit `Workout.kind: 'strength' | 'conditioning'` field and made it impossible to *author* a workout mixing both kinds. That is a data-model correctness fix inside the single fused app — it did **not** split anything into separate apps, and does not materially reduce the scope of section 2's app-split work below.

## 3. Decomposition

This is not one project — it decomposes cleanly into 4 independent-but-dependent pieces (nutrition-engine excluded, per scope):

1. **shared-core** — formalize the athlete's shared state into a real, versioned interface, instead of each screen reading `Settings`/Supabase ad hoc.
2. **whole-athlete-state-engine** — a new derived-state layer: readiness, recovery debt, training constraints, computed from shared-core's raw signals.
3. **strength-engine / conditioning-engine app split** — turn the one fused app into two genuinely separate deployed apps.
4. **coordinator** — the reconciliation layer that turns strength-engine's, conditioning-engine's, and whole-athlete-state-engine's outputs into one weekly plan.

## 4. Per-piece scope

### 4.1 shared-core

**What exists today:** most of the raw data already lives in `Settings` (profile, some safety-adjacent flags buried inside conditioning history, a device-local WHOOP cache), but it is not a formal interface — it is a JSON blob with per-field, hand-written merge rules. Goals/schedule as a first-class concept does not exist (only per-workout `days`/`dates`). Safety flags (pain-stop, injury acknowledgement) exist but live inside conditioning-specific records, the worst possible place for something both future apps need to read.

**Recommendation:** do **not** rebuild this as relational Supabase tables yet. The existing merge semantics (per-field max-wins/newest-wins/union rules) are the hard-won, already-tested asset — a schema rewrite re-litigates every one of those rules for no immediate benefit, since no second app exists yet to demand a real API boundary. Instead: extract a versioned `@hybrid/shared-core` package exposing profile, goals/schedule, body metrics, life-load, recovery state, safety flags (promoted out of conditioning-specific records into their own first-class type), and event history as a real, documented interface — still stored inside the same synced blob, under its own namespaced key with its own merge rules. Defer a true multi-app server API until the app split actually needs it.

**Estimate: 13-19 dev-days**, in four milestones: (1) package skeleton + versioned schema + migration from current `Settings` fields, 3-4d; (2) safety-flag service, lifting pain-hold/acknowledgement out of conditioning-specific storage, 3-4d; (3) new domains — goals/schedule, life-load, recovery-state records, WHOOP data properly typed instead of `unknown`, append-only event history, 4-6d; (4) blob namespacing + dual-read/write migration in both apps' sync layers + tests, 3-5d.

### 4.2 whole-athlete-state-engine

**What exists today:** raw WHOOP reads scattered across ~8 call sites (HR zone shifting, working-weight easing, conditioning trimming, a Home "Readiness" card, working-weight confidence labels). Early, ad hoc pieces of "training constraints" already exist as `mechanicalCompletion: 'pain_stop'` handling, but it only covers conditioning, and a captured `local_fatigue` signal is written but never read anywhere. Life-load, stress trends, recovery debt, and illness status are **100% new concepts** — confirmed via search, nothing resembling them exists today. The app's own internal audit already flagged its current "Readiness" card as mislabeled and safety-readiness as a weak point.

**Recommendation:** a pure function in `packages/engine`, matching the codebase's existing pure-function-plus-golden-test style: `athleteState(inputs) → { readiness, recoveryDebt, constraints, illness, dataQuality }`. Constraints output subsumes and generalizes the existing pain-hold logic (including finally reading the currently-ignored `local_fatigue` signal) rather than replacing it outright. Illness status starts as a manual flag, not inferred. **Prerequisite:** widen what gets persisted from WHOOP (HRV, sleep, resting HR are currently read once and thrown away) — this blocks any real trend/debt computation and has to happen first. Migrating the strength/conditioning engines' *own* inline WHOOP reads to consume this new engine instead is explicitly deferred past v1 — v1 only needs to power a new, honest Home readiness card.

**Estimate: 10-14 dev-days**, in four milestones: (1) contract + widen WHOOP persistence, 2-3d; (2) readiness score + recovery-debt model + tests, 3-4d; (3) constraints output (pain-hold + local-fatigue + manual illness flag), 2-3d; (4) wire the Home readiness card on both platforms + smoke tests, 3-4d.

### 4.3 strength-engine / conditioning-engine app split

**This is the largest single piece of work**, and the one with the most real risk. Roughly 60% of the current codebase (Home, Library, History, Recap, Progress, Calendar, Settings, Training, Day, the entire UI primitive library, the local store, cloud sync) is shared and would need to exist in both new apps or be factored into shared packages — today it exists as two hand-duplicated platform implementations with no shared UI package to begin with, so "extract shared UI" concretely means building *two* new shared packages (web, mobile), not one.

**The hardest, most concrete risk:** cross-modality analytics is the product's stated identity — `balance.ts`'s own header comment states "is one side costing the other? this is the question a hybrid app exists to answer." A clean split kills this capability unless shared-core carries both modalities' data somewhere it can still be compared. Second: two independently-deployed apps writing into **one** Supabase blob must ship byte-identical merge/sanitize code, or the existing version-skew hazard gets meaningfully worse — shared-core needs to partition storage per modality to make this genuinely safe, and that partitioning design has to happen in lockstep with the shared-core work in 4.1, not after it. Third: the previous, smaller split (already shipped this session) deliberately left conditioning results embedded inside session records rather than moving them out, specifically because doing so would have broken the entire Concept2-sync test suite and every History/Recap/Progress render path — that deferred work becomes unavoidable once this real split happens.

**Recommended phasing:** (1) split the engine package three ways — `@hybrid/core`, `@hybrid/strength`, `@hybrid/conditioning` — and finally move conditioning results out of session blocks, coordinating with shared-core's storage partitioning; (2) extract the two shared UI packages; (3) stand up the **conditioning app first**, on both platforms, as a stripped copy — it's the smaller of the two, its native BLE/GPS/Concept2 integration moves wholesale rather than needing surgical removal, and building it first validates the new shared packages before touching the app real users already have installed; (4) strip conditioning out of the original app to become the strength app — keeping the existing Netlify deploy and mobile install so current users aren't orphaned mid-migration; (5) re-home the cross-modality analytics (`balance`/`insights`) on top of shared-core's now-partitioned data, plus a full regression pass on both platforms.

**Estimate: 30-36 dev-days**, in five milestones: (1) engine 3-way split + CondResult migration + sync partitioning, 6-8d; (2) shared UI packages, both platforms, 6-8d; (3) conditioning app — web 3-4d + mobile (new EAS build, BLE/GPS store config) 5-6d; (4) strength app strip-down + existing-install migration, both platforms, 4-5d; (5) cross-modality readout re-home + full dual-platform regression, 5-6d.

### 4.4 coordinator

**What exists today, confirmed by search: nothing.** No cross-modality scheduling or reconciliation logic exists anywhere in the codebase. The closest precedents are `balance.ts`'s retrospective (never prescriptive) comparison, and single-modality daily recovery gates in `lift.ts`/`conditioning.ts` that have no awareness of each other firing. No "weekly plan" object exists today either — scheduling is entirely per-workout (`Workout.days`/`Workout.dates`); the coordinator has to introduce the concept of a first-class weekly plan for the first time.

**Recommendation:** a deterministic, pure function — `(sessionProposals, athleteState, constraints) → WeeklyPlan` — matching the rest of the engine's pure-function, fully-testable style. Given a realistic weekly load (roughly 4-8 proposed sessions into 7 day-slots), a rules-based v1 is genuinely sufficient: sort proposals by a priority score (goal weighting × staleness), place them respecting a weekly fatigue budget, a same-day high-interference block (e.g. no HIIT same day as heavy lower-body lifting), and minimum rest-day rules; drop lowest-priority overflow with an explicit, visible reason. Constraint-solving or ML is not justified at this scale and would be premature. Every accepted or dropped decision carries a reason code, matching the existing `adaptive/` module's explanation-first pattern already in the codebase. The real risk here isn't the algorithm — it's contract discipline: three independently-evolving engines each emitting a stable, versioned `SessionProposal` shape the coordinator can trust.

**Estimate: 13-18 dev-days**, in four milestones: (1) contract + versioned proposal/state/plan types + adapter stubs from the existing strength/conditioning logic, 3-4d; (2) the reconciler core (scoring, placement, caps, drop-with-reason) with heavy unit tests, 4-5d; (3) weekly-plan persistence + projection back into the existing `Workout.days`/`dates` fields, respecting the strict existing merge semantics, 3-4d; (4) reason-code explanations surfaced in a minimal UI (Week strip / Calendar), 3-5d.

## 5. Dependency Graph and Build Order

```
shared-core (must come first — everything else reads/writes through it)
    │
    ├──► app split (strength-engine + conditioning-engine apps)   ─┐
    │      needs shared-core's storage partitioning design         │  run in
    │                                                               ├─ parallel
    └──► whole-athlete-state-engine                                │
           needs shared-core's widened WHOOP persistence          ─┘
                        │
                        ▼
                  coordinator
        (needs all three above to have stable, versioned contracts)
```

## 6. Timeline

| Piece | Dev-days |
|---|---|
| shared-core | 13-19 |
| whole-athlete-state-engine | 10-14 |
| app split (strength + conditioning) | 30-36 |
| coordinator | 13-18 |
| **Total raw work** | **66-87** |

**Critical path** (shared-core, then the larger of {app-split, whole-athlete-state-engine} run in parallel, then coordinator): **≈ 56-73 dev-days.**

Dev-days are raw build effort, not calendar time. At a steady, non-full-time side-project pace, figure roughly 1.5-2x: **≈ 3-5 months** if the parallel pieces genuinely run concurrently, **≈ 5-7 months** if they're picked up serially instead.

## 7. Key Risks (ranked by how directly they threaten data or the product's identity)

1. **Sync partitioning correctness.** Two independently-deployed apps writing into one shared account's data, without a real server-side API boundary, is a data-loss-shaped risk if the merge logic between them ever drifts — and a version-skew bug in the *current single-app* version of this exact mechanism already exists today, unrelated to this plan. This has to be solved as part of shared-core, not bolted on after the app split ships.
2. **Loss of cross-modality analytics.** The one thing the current app's own code explicitly claims is its reason for existing (noticing when strength and conditioning trade off against each other) has no home once the apps are split, unless shared-core is explicitly designed to keep both modalities' data comparable somewhere.
3. **Coordinator contract churn.** Three engines evolving independently, all feeding one arbiter — if `SessionProposal`'s shape isn't versioned and stable from day one, the coordinator becomes the thing that breaks every time any engine changes.
4. **Migrating installed users.** The strength app inherits the existing Netlify deploy and mobile install; the conditioning app is new. Getting existing users' data (and their app-store install) onto the right side of the split without a confusing migration moment is a real, if bounded, UX risk.

## 8. Open Decisions

These need an explicit answer before an implementation plan gets written for any single piece:

1. Does shared-core's phase 1 stay inside the existing single-blob Supabase model (recommended above), or is a real relational schema wanted from the start, accepting the larger up-front cost?
2. Is the parallel timeline (app-split and whole-athlete-state-engine at the same time) actually feasible given who's doing the work, or should this be planned as fully serial?
3. Where does cross-modality analytics (`balance`/`insights`) live once the apps are split — inside both apps reading shared-core, a lightweight third "hub" surface, or deferred until shared-core itself grows a query layer?
4. Confirm the phasing choice: conditioning app first (recommended, de-risks via the smaller app), or strength app first (keeps the flagship experience moving sooner, at higher risk since it's the bigger app to strip down).
