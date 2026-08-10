# Command Center → Readiness pillar

Date: 2026-08-10
Status: Approved by user, ready for planning

## Problem

The coach's Command Center (`CoachCommandCenter.tsx`) was decluttered earlier
this session using a `CoachSection` collapse pattern (one always-open queue,
everything else collapsed). Living with it, the user's verdict is that it
"still feels busy" and "doesn't feel premium" — and, separately, that the
page carries no readiness/recovery signal at all, despite that data (WHOOP
recovery, HRV, sleep, strain, resting heart rate, and this app's own
whole-athlete-state readiness band) already existing in the codebase and
going unused on this screen.

The user's direction: restructure Command Center around a small set of
clickable pillars — Strength, Conditioning, Nutrition, Readiness — each
opening its own focused screen with real depth underneath, rather than
cramming everything onto one page. This spec covers the first pillar,
**Readiness**, end to end (Command Center's restructure + the new Readiness
screen). The other three pillars are explicitly out of scope for this round
and will each get their own brainstorm/spec/plan cycle later.

## Command Center changes

**Removed:**
- The page header block ("ARC command" eyebrow, "What needs your
  judgement?" heading, sub-copy, week-of date).
- The full client-selector strip (client photo chips, "All clients" toggle).
- Every `CoachSection`-wrapped block: Overview, Three systems, Resolved
  week, Intensity distribution, Operating context. All of it is deleted for
  the self-coach view, not collapsed — this is a page reset, not another
  round of decluttering.

**Kept, simplified:**
- A minimal client-switcher: a plain dropdown/select, not the current
  photo-strip with per-client counts. Available whenever there's more than
  one client in the roster; if there's only the self-coach account, it can
  be omitted entirely.
- The identity line: client name + current block/week text only. The
  "Assign training" link is dropped (or, if there's a strong reason to keep
  a pointer into Library, de-emphasized to something much quieter than
  today's pill button — default to dropping it).
- Coach queue: completely unchanged. Still the one always-open, gold-elevated
  card, still first in the content area.

**Added:**
- One tile: **Readiness**. Shows a label, today's readiness band name, and
  a small colored dot (green/amber/red, matching the band) as a live
  preview. Tapping it navigates to `/coach/readiness`.
- The Readiness tile is visible ONLY when the selected client's source is
  `engine-local` (the signed-in coach's own data). It does not render at
  all for a `roster-summary` client — WHOOP/readiness data doesn't exist
  for real athlete clients yet (`docs/ARC_LAYER3_DESIGN.md`'s existing
  consent/data boundaries), and this screen must not imply data that isn't
  there. This mirrors how every other local-only section on this bench
  already gates on `isLocalClient`.

## Readiness screen (`/coach/readiness`)

New route, new component (`CoachReadiness.tsx` or similar — implementer's
choice of exact filename, following this directory's existing naming). Full
page, reached only from the Command Center tile, with a back affordance
(reuse whatever back-navigation pattern `RosterPlanner.tsx` or similar
sub-screens already use in this codebase — likely a `useNavigate()` back()
to `/coach`).

### Safety alert (conditional)

Rendered only when `athleteState.constraints` contains a hard pain or
illness constraint (the same data `CoachCommandCenter.tsx`'s existing
`priorities` safety items already read). A slim, always-visible strip —
not a full-page takeover, not hidden behind a click to even know it exists.
Color: a new, more saturated red token than the existing muted `--color-bad`
(`#cf7f7c`) — genuinely more alarming without going full neon, since a
literal neon red would clash with this app's established muted palette
everywhere else. Exact hex is an implementation-time design call; document
the new token in `packages/design/src/tokens.css` alongside the existing
`--color-bad`/`--color-warn`/`--color-ok` (e.g. `--color-alert` or similar
name — implementer's choice, follow existing naming convention). The strip
is tappable/expandable to reveal the constraint's actual `reason` text
(e.g. "Knee soreness reported"). Collapsed by default; the strip itself
(icon + short label) is always visible, only the detail text is hidden
until tapped.

### Hero block

Two stacked elements, ring on top:

1. **WHOOP recovery ring.** Large and centered — the clear focal point of
   the whole screen. A circular progress ring filled to `recoveryScore`
   (0-100, from `useWhoop()`), colored on a red→orange→green scale that is
   WHOOP's own convention (roughly: 0-33 red, 34-66 orange/yellow, 67-100
   green — implementer should use reasonable thresholds matching WHOOP's
   actual published bands if easily found, otherwise these three even
   bands are an acceptable default). This is a NEW component for this
   codebase (no existing ring/gauge primitive) — build it as a focused,
   reusable SVG component, not a one-off inline chart.
2. **Readiness gradient bar.** A horizontal bar going red→orange→green
   left to right, with a marker/dot showing where today's
   `athleteState.readiness.band` sits on it. This is deliberately a
   SEPARATE signal from the WHOOP ring — never merge their colors or
   imply they're the same number. The band today is categorical
   (`primed`/`moderate`/`compromised` or similar — check the actual
   `ReadinessBand` type in `whole-athlete-state`), so the bar's marker
   position is a fixed point per band, not a continuous value.

**No-WHOOP state:** if `useWhoop()` reports not-connected, the ring
renders empty/neutral (no fill, dim outline) with a "Connect WHOOP" prompt
that links to the existing WHOOP-connect flow in Settings. The readiness
bar still renders normally underneath, since it doesn't depend on WHOOP.

**Stale-data state:** if WHOOP is connected but today's row hasn't landed
yet (check `whoopDaily`'s most recent entry's date against today), show
the most recent available reading with a visible "as of [date]" label
rather than an empty/zero ring. Do not silently present yesterday's number
as if it were today's.

### Metric cards

Four cards, one row (responsive-wrap is fine, desktop-first per this
codebase's coach-workspace rule — 1440px remains the review width):
**HRV, RHR (resting heart rate), Sleep Performance, Strain**, in that order
(approximating WHOOP's own app convention: the three recovery-contributing
metrics first, strain — the prior day's output/cost, not a recovery input —
last).

Each card shows:
- Today's value (or the stale-data fallback, same rule as the hero).
- A small delta vs. yesterday, with direction-aware coloring:
  - HRV up = green (better), down = red (worse).
  - RHR up = red (worse), down = green (better) — inverse of HRV, since a
    lower resting heart rate is the healthier direction.
  - Sleep Performance up = green, down = red.
  - **Strain is always neutral-colored**, regardless of direction — it
    is not a "good/bad" metric, it's a measure of how hard the prior day
    was, so implying "lower is better" would be actively wrong guidance
    for a coach reading it.
- A 7-day sparkline (reuse the `Spark` component pattern from
  `AthleteStatus.tsx` — same rendering approach, don't fork a new one),
  colored to match the card's own good/bad logic above (neutral for
  Strain, red/orange/green for the other three based on the trend's
  overall direction — implementer's reasonable judgement on exactly how
  a 7-point trend maps to a single sparkline color, e.g. compare first
  vs. last point, or use today's delta color).

**Tap a card** → expands in place (no navigation) to a larger chart with a
7/30/90-day toggle. Collapses back on a second tap. This is genuinely a
"more detail on the same fact," not a new destination — keep it inline.

### Data sources (all pre-existing, no backend work)

- `useWhoop()` (`apps/web/src/cloud/whoop.tsx`): `recoveryScore`, `hrvMs`,
  `restingHr`, `sleepPerformance`, `strain`, plus the `whoopDaily` rolling
  history array (up to 365 days) for sparklines and the 30/90-day expanded
  view.
- `useDb().athleteState.readiness.band` (whole-athlete-state, via
  `packages/whole-athlete-state`): the categorical readiness band for the
  gradient bar.
- `useDb().athleteState.constraints`: hard pain/illness constraints for the
  safety alert, same shape `CoachCommandCenter.tsx` already reads.

No new engine logic, no new migrations, no new sync work. This is
presentation-only, consuming data structures that already exist and are
already synced.

## Non-goals

- Strength, Conditioning, and Nutrition pillars are NOT part of this spec.
  Command Center will show only the Readiness tile until each of those gets
  its own brainstorm/spec/plan cycle.
- No changes to the mobile app. This is the web coach workspace only,
  desktop-first per `CLAUDE.md`.
- No changes to `RosterAuthoringView`, `RosterProgressionView`, or any
  other roster-tier screen.
- No new backend RPCs, migrations, or sync-layer changes.

## Testing

Colocated tests, following this codebase's established convention:
- `CoachCommandCenter.test.tsx`: update existing tests for the removed
  header/client-strip/CoachSections; add a test that the Readiness tile
  renders (with band + dot) for an `engine-local` client and does NOT
  render for a `roster-summary` client.
- A new `CoachReadiness.test.tsx`: cover the safety-alert conditional
  render + expand, the hero ring + bar rendering with real WHOOP data,
  the no-WHOOP empty state, the stale-data "as of" state, each metric
  card's delta color logic (including Strain's neutral-always rule), and
  the tap-to-expand/collapse behavior on a card.
