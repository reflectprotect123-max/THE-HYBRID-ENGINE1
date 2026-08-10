# Coach bench declutter — whole-bench rollout

Date: 2026-08-10
Status: Approved (user: "just design something" — deferred to this design after reviewing the primary/secondary split)

## Problem

`CoachCommandCenter` was decluttered this session using a new `CoachSection`
disclosure primitive: one always-open, gold-elevated "Coach queue" card, with
everything else (Overview, Three systems, Resolved week, Intensity
distribution, Operating context) collapsed behind `<details>` and quiet by
default. The rest of the coach bench — Library, Authoring, Nutrition,
Progression, Week Review — was never touched, so the bench reads as one
organised page followed by five busy ones. The user's stated goal is a
TrainHeroic-like feel: "very organised & coach first focused. easy to see."
Library already picked up real tab semantics for its domain filter in a
follow-up change; this spec covers the rest.

## Principle

Exactly one thing is always open and visually elevated per page — the thing
the coach needs *right now, for that page's job*. Everything else collapses
into a `CoachSection` and stays out of the way until tapped. No new visual
language: reuse the gold-elevated "raised" card for the primary block and the
existing `CoachSection` disclosure (`packages` unchanged — component already
lives at `apps/web/src/coach/CoachSection.tsx`) for everything else. Every
collapsed section keeps the same `eyebrow` / `title` / `count` header format
already established on Command Center, so the whole bench reads as one
system.

## Per-page split

| Page | Always-open (primary) | Collapses into `CoachSection` |
|---|---|---|
| Command Center | Coach queue | Overview, Three systems, Resolved week, Intensity distribution, Operating context — **done, shipped** |
| Library | Quick-start "prepare an assignment" panel + template list | Selected-template detail/progression preview — **tab semantics done, shipped**; detail panel stays visible (it carries its own CTA) but its progression-stage breakdown gets tightened |
| Authoring | The active draft/builder surface — whichever domain input the coach is editing | Resolution preview, nutrition-system panel, and the "new draft" picker once a draft is open |
| Progression | The pending-proposal decision list | Decided/historical proposals, evidence/detail panels per proposal |
| Nutrition | Today's exceptions/flags needing coach attention | Day-by-day log detail, macro breakdown, trend history |
| Week Review | The reconciliation exceptions list (planned-vs-actual mismatches) | Fully-matched/completed rows, decision-trace detail |
| Settings | No change — already 60 lines, not busy | — |

## Non-goals

- No new component beyond `CoachSection` (already built and tested).
- No change to any data/decision logic — this is purely presentational
  reorganisation, same pattern as the Command Center rollout.
- Settings is explicitly out of scope; it isn't busy.

## Testing

Each page keeps its existing colocated test file. Per page, add/update:
1. A DOM-order assertion that the primary section renders before the first
   collapsed section (mirrors `CoachCommandCenter.test.tsx`'s
   `compareDocumentPosition` check).
2. A default-collapsed assertion for each new `CoachSection` (mirrors
   `CoachCommandCenter.test.tsx`'s "collapses ... by default" test).

No new test infrastructure — reuse `coach-test-harness.tsx` as every existing
coach test does.

## Execution

One subagent-driven-development task per page (Authoring, Progression,
Nutrition, Week Review), run independently since they don't share files,
followed by one final whole-branch review + fix wave, matching the pattern
used for the Command Center rollout and the mobile-responsive and
coach-first-root work earlier this session.
