# Coach bench — design spec

**Date:** 6 August 2026
**Status:** phases 1–3 implemented (commits b8979e0, 807edcf, and the
phase-3 commit); athlete-zero onboarding added beyond the original phasing.
Phase 4 (multi-athlete) remains design-gated.
**Inputs:** brainstorming session (10 answered questions),
`docs/superpowers/research/2026-08-06-coaching-platform-research-results.md`
(market research against the v2 brief in the same directory).

## What this is

A desktop-first coaching front end — "the coach's bench" — inside the
existing web app, where the coach authors multi-week strength +
conditioning programs. It ships on the same Netlify site at `/coach/*`,
gated to the coach's login, and changes nothing that would force updates
to shared contracts, mobile builds, storage migrations, or the athlete
experience.

The research's market verdict, which this design adopts as its thesis:
the category is not short on features — it is short on a reliable,
reversible way to evolve a plan without the coach wondering what changed,
why, or whether intent was lost. The wedge is an **evolution-safe bench**,
not a bigger builder. Premium and simple are the same goal.

## Fixed constraints (not revisitable inside this project)

1. **The Coordinator keeps final authority** over the weekly plan
   (`CLAUDE.md`). The coach proposes; the system resolves. The bench's job
   is to make that relationship legible and empowering — never to bypass it.
2. **Additive only.** No changes to `@hybrid/shared-core`, the engines,
   the Coordinator, the mobile app, Supabase migrations, `netlify.toml`,
   `scripts/build-site.mjs`, the service worker, or athlete routes.
3. **Zero new data shapes in v1.** Coach-authored weeks are plain
   `Workout` objects — the shape the athlete Planner already edits, the
   store already persists and syncs, and `coordinator-adapter` already
   projects to proposals.
4. Recovery/pain/illness logic stays where `CLAUDE.md` puts it. The bench
   displays constraint outcomes; it never re-derives them.

## Architecture

**Placement.** `apps/web/src/coach/` — a lazy-loaded route group
(`/coach`, `/coach/program`, `/coach/week/:start`) with its own
`CoachShell` layout, mounted in `App.tsx` via `React.lazy`. The athlete
bundle does not grow; athletes never download the coach chunk.

**Gating.** A route guard compares the signed-in user id against
`VITE_COACH_USER_IDS` (comma-separated allowlist in Netlify env). Wrong
user → silent redirect to `/`. Adding a coach later is an env edit.

**Data flow.** Bench reads and writes the same `EngineDB` store the
athlete screens use (local-first, existing cloud sync untouched).
Resolution preview calls `coordinator-adapter` → `reconcileWeeklyPlan`
read-only. Coordinator authority is structural: the bench cannot write a
final weekly plan because no such write path exists outside the
Coordinator.

**Identity.** Distinct coach look, scoped under a `.coach-root` class so
athlete styles are untouched. Desktop-first density; keyboard-first
interaction. During implementation, `ui-ux-pro-max` supplies the
catalogue, `frontend-design` pushes the result off template defaults.

## Design principles (adopted from research, deliverable H)

The fourteen simplicity principles in the research are adopted wholesale.
The five that most shape this design:

- **One object, many views.** Grid, drawer, and athlete delivery render
  the same `Workout` objects. No parallel coach-side plan model.
- **Local context beats navigation.** Sessions open in a side drawer over
  the grid, never a page navigation away from it.
- **One action per data effect.** Duplicate / repeat / move are separate,
  named actions. Nothing is ambiguously "copy."
- **Empty space is data.** Rest days and unplanned days are intentional
  states with affordances, not blank cells.
- **Earn complexity.** Fields and layers appear when they change a
  decision. The research's full object hierarchy (Program → Phase →
  Block…) is explicitly *not* adopted in v1 — see Deferred.

## Phase 1 — multi-week program grid (first shippable slice)

A grid: **weeks as rows, days as columns**, sessions as compact cells.
Real data from the existing store, rendered in coach clothing.

- **Cell contents:** session name, domain color (strength/conditioning),
  one key line (top lift or modality + dose). Nothing else — detail lives
  in the drawer. (Research patterns 1, 15: cell summary + side peek;
  never a full editor in a cell.)
- **Peek drawer:** selecting a cell opens a right-hand drawer showing the
  full session read-only. Grid context stays visible. (Pattern 7, Linear
  Peek.)
- **Density & horizon controls:** 1/2/4-week zoom as a projection change,
  same underlying model (pattern 5). Hide-empty-days as a visual toggle
  that never hides meaning (pattern 6, anti-pattern 24).
- **Empty-cell affordances:** an empty day offers "add session," "copy
  previous," or "rest" — never a dead end (pattern 53). Phase 1 renders
  the affordances; the actions land in phase 2.
- **Keyboard:** arrow-key cell navigation, Space/Enter opens the drawer,
  visible hints (patterns 8, 56).
- **States:** deterministic skeleton while loading (pattern 54), explicit
  empty state for a store with no workouts, error boundary scoped to the
  coach chunk.

Out of scope for phase 1: any editing, any Coordinator call, any
comparison mode.

## Phase 2 — session editing and week operations

- **Editing in the drawer**, reusing the athlete Planner's block
  components (`ExerciseCard`, `CondBlockCard`, `SupersetSeam`,
  `TextBlockCard`) inside a coach-density wrapper. No rebuilt editors.
- **Explicit copy semantics** (research A3): v1 ships exactly two —
  **Duplicate** (independent copy now) and **Repeat** (independent copies
  across a range, with collision preview). Link/sync/template semantics
  are deferred; when reuse arrives it defaults to copy-on-write.
- **Range selection + contextual bulk bar** for duplicate/repeat/move/
  delete near the selection (patterns 9, 10).
- **Same-weekday comparison** ("all Mondays side by side") — the
  TeamBuildr-validated view (pattern 4), read-only in this phase. It
  reuses the grid with a transposed projection; no new model.

## Phase 3 — resolution preview (the trust surface)

The bench's differentiator, built on the research's trust-UX playbook
(deliverable E). The coach sees **what their proposed week resolves to,
and why**, before anything reaches an athlete.

V1 of the preview adopts these rules from the playbook:

1. **Proposal before mutation** — the preview is read-only; the
   coach-authored week is never modified by viewing it.
2. **Semantic diff** — "Thursday's intervals capped at RPE 7" in coach
   language, never raw object dumps.
3. **Reason before metrics** — lead with the constraint that fired
   ("protecting recovery: readiness constraint from whole-athlete-state"),
   evidence on demand.
4. **Signal → inference → action** shown as visibly distinct layers.
5. **Missing data is visible** — "no readiness data" renders as unknown,
   never as green.
6. **"Cannot safely resolve" is a valid outcome** — rendered as a
   conflict card with the preserved proposal, not a guess.

Deferred from the playbook (they require write paths or new persistence):
per-change accept/decline, versioned plans, decision ledger, coach
anchors. These are real, they are the long-term moat, and they are not
v1 — each needs an additive design of its own. The preview's read-only
nature makes the full playbook adoptable incrementally without rework.

**Phase 3 as implemented.** The persistence question resolved additively:
a bench-local store (`hybrid-coach-bench-v1` in localStorage, never a
field on EngineDB, invisible to sync) holds the coach's review baseline,
per-decision acknowledgments, and the decision ledger. On top of it:
"changed since your last review" renders a semantic diff of the current
resolution against the baseline (added/moved/removed entries by proposal
identity, new drops); each drop offers Acknowledge or Adjust proposal
(deep link to the source workout — proposal ids are workout ids in both
engines); and the ledger records coach actions and observed Coordinator
drops. Two consciously kept boundaries: "keep original" does not exist —
a drop is the Coordinator holding a line, and the honest affordances are
acknowledging it or adjusting the proposal until it resolves; and bench
review state is local-only — cross-device review state joins the phase-4
persistence design.

**Athlete-zero onboarding (added).** The coach is the first athlete, in
the same account. A checklist derived entirely from live state — shared
core present, schedule days set, primary goal chosen, Whoop connected,
Concept2 connected, first workout planned, first session logged — with
integrations skippable and nothing self-checking. It exists so the first
real athlete's path from empty store to working loop is observable, and
it becomes the template for onboarding athletes two-plus in phase 4.

## Phase 4 — athlete linkage (design-later gate)

Deliberately unstarted until real athletes onboard. That is the moment
the RLS/sharing question becomes concrete (separate logins ⇒ sharing
policies ⇒ a migration — the thing v1 refuses to force). Nothing in
phases 1–3 presumes a particular answer.

## Success criteria (from research F1, treated as usability targets)

- Lay out a credible 4-week phase from existing sessions via
  duplicate/repeat in **< 10 min** (post-phase-2; drops further when
  templates arrive).
- Duplicate/repeat a week in **< 15 s**.
- Inspect all Day-1 sessions across 8–12 weeks in **one action**.
- Edit a session **without losing grid context**.
- Understand any Coordinator resolution in **< 30 s** before opening
  detail.
- Beat the market's blank-build benchmark (20–35 min on TrueCoach/
  Everfit per the research's inferred click-paths).

These are targets to test against, not launch gates.

## Error handling

- Guard failure → silent redirect; no coach traces in athlete UX.
- Store empty/corrupt → explicit empty state; the coach chunk's error
  boundary never takes down athlete routes.
- Resolution preview failure → the proposal remains visible with a
  "preview unavailable" state; authoring is never blocked by the preview.

## Testing

- Route-guard unit tests (allowlisted id, wrong id, signed out).
- Program-grid rendering against a fixture `EngineDB` (populated, empty,
  single-week, 12-week).
- Adapter round-trip: coach-authored `Workout`s produce valid
  `SessionProposal`s and a resolvable week.
- Same-weekday projection is a pure function — property-tested.
- Handoff gate per `CLAUDE.md`: `pnpm run typecheck`, focused Vitest,
  `pnpm run check:ecosystem`, `pnpm run build:site`.

## Explicitly untouched

`@hybrid/shared-core`, all engines, the Coordinator, `coordinator-adapter`
internals, the mobile app, Supabase migrations, `netlify.toml`,
`build-site.mjs`, the service worker, all athlete routes and styles.

## Deferred decisions (recorded so they aren't re-litigated)

| Decision | Deferred to | Why |
|---|---|---|
| Full object hierarchy (Program → Phase → Block) | When multi-program coaching is real | v1's grid projects existing `Workout`s; adding layers now is speculative structure. |
| Templates / link / sync semantics | Phase 2+ follow-up | Ships only with copy-on-write default and visible propagation, per research anti-patterns 28–29. |
| Compact text notation (typed model, two views) | Post-phase-2 | Research deliverable D is compelling; it deserves its own additive design against `@hybrid/engine`'s types. |
| Versioning, decision ledger, per-change accept | Post-phase-3 | Requires new persistence — an additive, RLS-respecting design of its own. |
| Athlete-side explanation surfaces | Phase 4 | Athlete PWA is out of scope for the bench. |
