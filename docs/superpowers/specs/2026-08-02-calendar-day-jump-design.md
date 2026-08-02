# Calendar day-jump — design

## Problem

Tapping a day doesn't go to that day. Two separate gaps, both confirmed by reading the actual code:

- **Home's week strip**: all 7 day buttons share one `onOpen` callback that discards which date was tapped and just navigates to `/calendar` generically (`Home.tsx`, both apps — explicitly commented "every cell is a door into the calendar"). Tapping Tuesday and tapping Friday do the same thing.
- **Calendar's month grid**: day cells aren't interactive at all — no `onClick`/`onPress` anywhere. Tapping them is currently inert.

Neither gap is a regression from this session's work — confirmed via git history, this has been the app's behavior since its first commit.

## What "going to that day" should mean — three cases

There's no existing concept of "preview an arbitrary day" in the app — every current day-view either assumes *now* (Training's start flow, hard-anchored to `today`) or *already happened* (Recap/History, keyed by a real logged `Session`). A tapped date needs to resolve to one of three outcomes, decided by what's actually true about that date:

1. **A trained day** (a completed `Session` exists on that date) → go straight to **Recap** for that session. Recap already takes a session id as a route param and works for any session, past or present (`/recap/:id` web, `Recap: {id}` mobile) — it's just never been reachable except right after finishing a session. No new screen needed here, only a caller.
2. **Today** → go to **Training**, exactly the existing flow (unchanged). Training is already the "start / in-progress" screen for today specifically.
3. **Any other day** (a past day with nothing logged, or a future day) → a new **read-only Day preview**. Shows what's scheduled (if a workout's `dates`/`days` matches, via `blockExercises`/`WorkoutDetail`-style read-only listing — the same component Library already uses for its expand) or "nothing scheduled" if not. **No Start button** — starting a workout is deliberately kept anchored to *today only*, matching how the rest of the app already works (autoregulation, recovery-based prefill, and session timestamps all assume "started now"). Retroactive logging and pre-loading a future day are explicitly out of scope for this plan.

## Design

### 1. Calendar's `Cell` needs ids, not just booleans

Today (`Cell` in both `Calendar.tsx` files): `{ key, n, planned: boolean, trained: boolean }` — both flags are computed via `.some()`/`Set.has()` and immediately collapse to a boolean, discarding which workout or session actually matched. Add the ids the boolean already implies:

```ts
interface Cell {
  key: string;
  n: number;
  workoutId?: string;   // first workout whose days/dates matches this date, if any
  sessionId?: string;   // completed session with real logged work on this date, if any
}
```
(`planned`/`trained` become `!!workoutId`/`!!sessionId` at render time — no behavior change to the existing dot rendering, just don't throw the id away.) If multiple workouts or sessions match one date, take the first — same ambiguity the current boolean already silently resolves via `.some()`, not a new problem this plan introduces.

### 2. A shared date-resolution helper

One small function, used by both Calendar's tap handler and Home's WeekStrip tap handler, so the "which of the 3 cases applies" logic isn't duplicated:

```ts
function resolveDayTarget(dateKey: string, today: string, workoutId?: string, sessionId?: string):
  | { kind: 'recap'; id: string }
  | { kind: 'today' }
  | { kind: 'preview'; date: string; workoutId?: string } {
  if (sessionId) return { kind: 'recap', id: sessionId };
  if (dateKey === today) return { kind: 'today' };
  return { kind: 'preview', date: dateKey, workoutId };
}
```
Web navigates on the result (`nav('/recap/'+id)` / `nav('/training')` / `nav('/day/'+date)`); mobile does the equivalent `nav.navigate(...)`.

### 3. New Day preview screen

- Web: new route `/day/:date`, new screen `apps/web/src/screens/Day.tsx`.
- Mobile: new stack entry `Day: { date: string; workoutId?: string }`, new screen `apps/mobile/src/screens/Day.tsx`.
- Renders the date as a heading, and either the matched workout's content (reusing Library's existing read-only block/exercise listing component — do not build a second one) or an explicit "Nothing scheduled" empty state. No Start button, no edit affordance (editing is Library/Planner's job, this is a pure lookup).

### 4. Wire the two tap sites

- **Calendar's day cells**: add the missing `onClick`/`onPress`, call `resolveDayTarget` with that cell's data, navigate on the result.
- **Home's WeekStrip**: each of the 7 day buttons currently share one `onOpen`. Give each button its own date, call the same `resolveDayTarget`, navigate on the result — same behavior as tapping the equivalent Calendar cell, just reachable one screen earlier. WeekStrip needs its own `workoutId`/`sessionId` per day, computed the same way Calendar's `buildMonth`/`build` already does (same filter logic, 7-day window instead of a month).

## Scope

**In scope:** Cell/WeekStrip data carrying ids instead of booleans, the shared resolve helper, the new Day preview screen (both apps), wiring both tap sites.

**Explicitly out of scope:** starting or logging a session for a non-today date (retroactive logging, pre-loading a future day) — a real, separate feature if ever wanted, not bundled here. Editing a scheduled workout from the Day preview (already reachable via Library → Edit). Handling more than one workout/session matching the same date beyond "take the first" (matches existing behavior, not a regression).

## Files touched (expected, confirmed at plan-writing time)

- Modify: `apps/web/src/screens/Calendar.tsx` (`Cell` type, `buildMonth`, tap handler)
- Modify: `apps/mobile/src/screens/Calendar.tsx` (same, mobile shape)
- Modify: `apps/web/src/screens/Home.tsx` (`WeekStrip` — per-day ids, per-day tap)
- Modify: `apps/mobile/src/screens/Home.tsx` (same)
- New: `apps/web/src/screens/Day.tsx`, route registration in `apps/web/src/App.tsx`
- New: `apps/mobile/src/screens/Day.tsx`, stack registration in `apps/mobile/src/App.tsx`
- New: a small shared `resolveDayTarget` — likely `packages/engine/src/session.ts` or a per-app `lib/`, since `sessionFrom`-adjacent date logic already lives per-app not in the engine (confirmed: `sessionFrom` itself is NOT in `packages/engine`, it's duplicated per-app in `apps/web/src/lib/session.ts` / `apps/mobile/src/store/session.ts` — mirror that placement unless there's a clean reason to finally hoist both into the engine while touching this).
- Test: react-smoke.mjs scenario(s) for tapping a trained day (→ Recap), today (→ Training), and an empty/future day (→ Day preview, empty state); RNTL equivalent for mobile.

## Sequencing note

Independent of the timer/duplicate-workout tracks (touches Calendar/Home, not Logger/Library) and independent of the debug-fix pass (different files entirely) — can run in its own worktree in parallel with either.
