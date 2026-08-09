# Responsive phone-width layouts for three ARC coach workspace routes

## Problem

CLAUDE.md's coach-workspace rule was amended on 9 August 2026 from an
absolute "WEB ONLY, never designed at a phone viewport" to "desktop-first,
mobile is open for exploration" — a phone layout is now in scope to design
and build once a design is explicitly approved. This spec is that approval
for a specific, bounded slice: three real routes, not the whole bench.

**This stays a PWA.** `@hybrid/web` already ships a manifest and service
worker (`vite-plugin-pwa`, confirmed in `build:strength`/`build:conditioning`
output). Nothing here creates a new app, and `apps/mobile` (Expo/React
Native) is not involved — a coach opens the same URL on a phone and gets a
responsive layout, same React/Vite code, same deploy.

## What's actually in scope

Three routes, gated to real code (not the earlier static mockup's assumed
mapping — see "Corrections from the mockup" below):

- `ArcCoachFrame` (`apps/web/src/coach/ArcCoachFrame.tsx`) — the shell every
  `/coach/*` route renders inside.
- `CoachCommandCenter` (`apps/web/src/coach/CoachCommandCenter.tsx`) — route
  `/coach`.
- `CoachLibrary` (`apps/web/src/coach/CoachLibrary.tsx`) — route
  `/coach/library`.
- `CoachAuthoring` (`apps/web/src/coach/CoachAuthoring.tsx`) — route
  `/coach/author`.

Desktop (1440px) is unchanged for all four — this is additive.

**Out of scope, explicitly:** `CoachNutrition`, `CoachProgression`,
`WeekReview`, `CoachSettings`, `ClientDetailGate`, `RosterPlanner`,
`CoachShell` (legacy), `GuidedBuilder`, `Planner`, and everything else under
`/coach/*`. These stay desktop-only. CLAUDE.md's rule requires explicit
approval per surface — this spec only grants it for the four above.
`checks/screens.mjs` stays athlete-only at 420px; coach routes are not added
to it in this pass.

## Corrections from the mockup

Two artifact prototypes explored this earlier
(`arc-mobile-explore.html`, an interactive tap-through mockup) using
invented screens ("Command Center", "Library", "session builder") that don't
map 1:1 onto the real code:

1. **The shell and two screens already have partial responsive CSS.**
   `ArcCoachFrame` is `lg:grid-cols-[208px_minmax(0,1fr)]` (single column
   below `lg`); `CoachCommandCenter` and `CoachLibrary` both collapse their
   `xl:grid-cols-[...]` two-column layouts to one column below 1280px. This
   is finishing and correcting responsiveness that's already half-built and
   never tested at real phone widths (375–430px) — not a from-scratch build.
2. **The mockup's "session builder" was actually `GuidedBuilder`** (the
   athlete app's own mobile-first guided flow, reused) — the real coach
   "session builder" is `CoachAuthoring.tsx`, a dense 22KB desktop editor
   with simultaneous side-by-side panels. It needs real design work, not a
   near-no-op port.
3. **The mockup's Library "+ New template" FAB has nothing to replace.** The
   real `CoachLibrary.tsx` has no create button — templates are opened by
   selecting a template card, which links to `/coach/author`. Dropped from
   this spec.

## Design plan

**Color & type — unchanged, deliberately.** This is a viewport extension of
an existing, already-shipped visual system, not a new one. Every token stays
exactly as used across the desktop coach bench: `--bg #070706`, `--panel3
#0a0a09`, `--text #f5f1e9`, `--gold #c09358` / `--gold2 #e0bc87`, Inter
throughout. Inventing a new palette or face for the phone layout would make
phone ARC read as a different product from desktop ARC, which it isn't.

**Signature interaction — the rail collapses to itself.** Below `sm`,
`ArcCoachFrame`'s `<aside>` rail does not disappear behind a generic ☰ icon.
It collapses to a slim (~16px) gold-accented spine at the left edge — using
the same gold dot the rail already renders next to the current page — and
tapping the spine expands it back into the full rail as an overlay drawer
(Command / Library / Settings links, the "How ARC decides" blurb). Tapping a
link or the backdrop collapses it again. This is chosen over a bottom nav
(rejected — introduces a second nav paradigm for only 3 items) and over a
disconnected hamburger icon (rejected — the point is "the rail you already
know, folded," not "a menu"). Motion: width/transform transition on
expand/collapse, backdrop fade-in; instant (no transition) under
`prefers-reduced-motion: reduce`.

**`CoachCommandCenter` — reordered, not just reflowed.** Below `sm`, the
"Needs your decision" queue card promotes to the top of the content area,
above the client-overview stat grid — matching the "one dominant tap first"
priority the athlete `Home.tsx` screen already uses (see its own top-of-file
comment). Reflowing the existing desktop column order top-to-bottom would
bury the one thing a coach most needs to act on. The `sm:grid-cols-4`
overview stat grid (`OverviewMetric`) and the `sm:grid-cols-[72px_1fr_auto]`
weekly-plan article rows stack to single-column cards below `sm`. All
interactive targets (client-select chips, the queue row, `SystemRow` links)
grow to 44px minimum height, per `tokens.css`'s own `pointer: coarse` rule,
which nothing currently enforces below `sm`.

**`CoachLibrary` — CSS extension only.** The `xl:grid-cols-[350px_minmax(0,1fr)]`
filter-aside-plus-list layout already collapses to one column below `xl`;
below `sm` the remaining `sm:grid-cols-[minmax(0,1fr)_125px_110px_24px]`
template rows stack to cards (name/category, then starting point and dose as
a two-item meta row, then the → affordance). The weekday picker keeps its
existing `grid-cols-4` layout; each day button grows from the current dense
`min-h-8` to a real 44px tap target.

**`CoachAuthoring` — structural branch via a shared hook.** This screen's
simultaneous side-by-side panels are a genuine information-density problem,
not a reflow problem — cramming them into one narrow column would make the
tool worse, not smaller. A new `useIsPhone()` hook (`matchMedia
'(max-width: 639px)'`, SSR-safe default `false`, colocated at
`apps/web/src/ui.tsx` + `useIsPhone.test.ts` since it's a reusable
primitive, not authoring-specific) lets `CoachAuthoring` branch its JSX
between the existing desktop tree and a new linear single-panel-at-a-time
phone tree, both driven by the same data/state hooks already in the
component — no duplicated data logic, only duplicated markup for the parts
that must genuinely differ.

## Testing

Colocated per CLAUDE.md convention — no files under `test/`:

- `useIsPhone.test.ts` — the hook's `matchMedia` branching (mocked
  `window.matchMedia`), colocated with `ui.tsx`.
- `ArcCoachFrame.test.tsx` (existing) — extended with assertions for the
  collapsed-spine state, the expand/collapse toggle, and that
  `prefers-reduced-motion` skips the transition class.
- `CoachCommandCenter.test.tsx` (existing) — extended with a phone-width
  assertion that the decision queue renders before the overview stats in DOM
  order.
- `CoachLibrary.test.tsx` (existing) — extended with a phone-width row-stack
  assertion.
- `CoachAuthoring.test.tsx` (existing) — extended for the desktop branch;
  a new colocated `CoachAuthoring.mobile.test.tsx` covers the phone branch,
  given the two render trees are substantial enough to warrant their own
  file rather than crowding the existing one.

`pnpm run typecheck`, the focused Vitest files above, `pnpm run
check:ecosystem` (unaffected but run per the Safe Workflow), and both
`pnpm --filter @hybrid/web build:strength` / `build:conditioning` run before
handoff, same as the product-gating fix earlier this session.

## Non-goals

- No bottom navigation anywhere in the coach bench.
- No new color tokens, fonts, or a distinct "mobile ARC" brand.
- No changes to `apps/mobile` or Expo.
- No changes to the five routes/screens listed under "Out of scope" above.
- No addition of coach routes to `checks/screens.mjs`.
