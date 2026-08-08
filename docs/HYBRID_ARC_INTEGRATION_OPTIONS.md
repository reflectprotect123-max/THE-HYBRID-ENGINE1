# Hybrid Engine and Arc — integration options

Written 8 August 2026 against `main` @ `a8ff104`.

## A limitation you need before reading anything below

**Arc is not in this repository.** I checked: no `arc` directory, and every
case-insensitive `\barc\b` hit in source is an SVG progress arc in the Ring
component (`apps/web/src/ui/index.tsx:168`) or a design-token note.

So everything here is analysed from **one side only**. I can state what Hybrid
Engine requires, exposes and forbids, and what each option costs on this side.
I cannot tell you what Arc contains, how close its data model is, or how much of
it survives a given option — and I will not guess, because a handoff that
invents the other half is worse than one that admits the gap.

**To close it**, the useful artifacts are Arc's route list, its data model or
API client, its auth assumptions, and whether it queries per-athlete.

---

## The constraint that decides more than any preference

Every RLS policy on athlete data is `auth.uid() = user_id`. There is no coach
role, no coach↔athlete relationship, and no policy granting one user another
user's rows — verified across all 26 `create policy` statements in
`supabase/migrations/`. The only two `using (true)` policies are on `foods` and
`food_servings`, the shared read-only catalogue.

Two consequences that apply to all three options:

1. **Any true coach product is a backend project before it is a front-end
   one.** Multi-athlete access needs new tables, a relationship model, new
   policies, and an RLS review. None of it exists.
2. **RLS filters rather than raising.** A coach UI querying an athlete it
   cannot see gets an empty result, not an error. Every option must design for
   that failure mode explicitly or it will ship silent blank screens.

A third, from the audit: **the auto-coach receipt ledger is device-local
localStorage** (`apps/web/src/autocoach/ledger.ts:27`), outside every sync
partition. Any option that promises a coach can see what automation did needs
that ledger to become a synced, append-only record first.

---

## Option A — Hybrid Engine athlete app plus Arc coach companion

Two apps, one backend, distinct audiences.

| Dimension | Assessment |
|---|---|
| Shared contracts | Good fit. `@hybrid/shared-core` already exists for exactly this, and the sync envelope (`EcosystemSyncNamespace`) is versioned |
| Authentication | Supabase auth already in both apps' shape. Arc signs in as a coach identity that does not exist yet |
| Organization model | **Does not exist.** Must be built |
| Athlete↔coach assignment | **Does not exist.** Must be built, with RLS |
| Plan publication | Partially present: `athlete_weekly_plans` is Coordinator-writer-only. A coach publishing INPUTS (goals, schedule, constraints) fits the architecture; a coach publishing a PLAN does not |
| Check-ins | Present athlete-side (`CheckIn`, nutrition; `recovery` observations, training) |
| Receipts | Mechanism exists, device-local. Must be synced |
| Week review | Raw material is strong — `WeeklyPlan.decisions[]` with reason codes. No coach-facing surface consumes it yet |
| Synchronization | Reusable. Additive merge, revision-guarded RPCs, proven by `checks/migrations-apply.mjs` |
| Migration effort | **Lowest of the three.** Nothing existing is discarded |

**Risk**: two front ends drift. Mitigated by `@hybrid/design` and
`@hybrid/product-scope` already being shared packages.

## Option B — Arc becomes the unified application

| Dimension | Assessment |
|---|---|
| What must be retained | The engines, non-negotiably: `coordinator`, `strength-engine`, `conditioning-engine`, `whole-athlete-state`, `auto-coach`, `nutrition-engine` (parity-proven), `engine` (merge/sync). These are the product |
| What Arc could replace | Presentation only — the web app's screens |
| Data compatibility | The athlete's slices are `EngineDB` + `NutritionDB` with a documented merge. Any replacement must preserve additive-merge and `deletedAt` semantics or it will lose data across devices — this has cost real data twice |
| User disruption | **Highest.** The Android app is the athlete's actual logging surface. A web-first unification either strands it or forces a rewrite of the mobile client too |
| Implementation effort | Highest. And the mobile app is not optional: `auto-coach` is currently web-only, but real athletes log on the phone |

**The trap**: Arc replacing Hybrid Engine looks like a UI project and is
actually a re-implementation of the merge, sync and world-sealing rules that
took this repo two data-loss incidents to get right.

## Option C — Hybrid Engine progressively refactored into the unified platform

A strangler migration: keep the engines and sync, migrate surfaces route by
route.

| Dimension | Assessment |
|---|---|
| Strangler strategy | Well supported. `/coach/*` is already a lazy chunk of the same SPA (`apps/web/src/App.tsx:33`), so a coach surface can be replaced independently without touching the athlete app |
| Service boundaries | Already drawn and enforced: one owner per decision domain, stated in `CLAUDE.md` and tested by boundary suites |
| Shared design system | `@hybrid/design` exists, with three world palettes and a contrast check (`checks/contrast.mjs`) |
| Route migration | Athlete routes and `/coach` are already separate route trees |
| Risk | Moderate and, importantly, **incremental** — each step is revertible |
| Sequencing | Backend relationship model → synced receipts → coach read surfaces → coach input surfaces |

---

## Recommendation

**Option C, with Option A's shape as the first milestone.**

Separating the evidence from the judgement, as asked:

**Factual, verifiable in this repo:**
- The engines, not the screens, are where this product's value and its hard-won
  correctness live. The merge rules alone carry two documented data-loss
  incidents' worth of scar tissue.
- `/coach` is already an independently replaceable chunk, so a coach surface
  can be swapped without risking the athlete app.
- Multi-athlete access does not exist at any layer, so every option pays the
  same backend cost. That cost is therefore **not** a differentiator between
  options.
- The decision trace the coach surface needs is already emitted and unconsumed.
- The receipt ledger is device-local and must be synced for any coach claim
  about automation to be true.

**Judgement:**
- Option B's apparent appeal is that Arc is newer. What it actually proposes is
  re-implementing the riskiest code in the system for presentational gain. I
  would not take that trade.
- Option A is the cheapest first step and Option C is the honest end state, and
  they are not in conflict: build the coach surface as a separate front end
  against shared contracts (A), then absorb it route by route if and when one
  platform proves better (C). Choosing A first costs nothing that C needs.
- The thing that should actually decide this is a question no one has answered:
  **is the coach a different person from the athlete, or the same person in a
  different mode?** Today the bench is the second — it reads the signed-in
  user's own store. If the answer is the first, the backend work dominates
  every other consideration and the front-end choice barely matters.

**What I would not do**: pick any option before Arc's data and auth assumptions
have been read. If Arc assumes a roster of athletes it can query, that
assumption is invalid against this backend today, and discovering it after the
UI is built is how the last attempt came back wrong.
