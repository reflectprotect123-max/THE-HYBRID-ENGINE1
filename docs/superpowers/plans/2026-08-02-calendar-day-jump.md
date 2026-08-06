# Calendar day-jump — implementation plan

Design doc: `docs/superpowers/specs/2026-08-02-calendar-day-jump-design.md`

## Global Constraints

- `sessionFrom(w, date)` (per-app: `apps/web/src/lib/session.ts`, `apps/mobile/src/store/session.ts`) already takes an arbitrary date — no change needed there, and this plan does not touch it.
- Starting/logging a session for a non-today date is explicitly OUT of scope. The new Day preview screen is read-only — no Start button, no write path.
- `resolveDayTarget` is pure and per-app (mirrors where `sessionFrom` already lives — this codebase keeps day/session helpers per-app, not in `packages/engine`, confirmed by survey before writing this plan).
- Recap (`/recap/:id` web, `Recap: {id}` mobile) already works for any session id with no status/date guard — Task 5/6 just need to call it, not modify it.

---

### Task 1: `Cell` carries ids, not just booleans (both apps)

**Files:**
- Modify: `apps/web/src/screens/Calendar.tsx`
- Modify: `apps/mobile/src/screens/Calendar.tsx`

- [ ] **Step 1: Read both files first** to confirm the current exact `Cell` interface and `buildMonth`/`build` function bodies (design doc quotes them as of survey time — confirm nothing has shifted).

- [ ] **Step 2: Change `Cell`** in both files from:
```ts
interface Cell { key: string; n: number; planned: boolean; trained: boolean; }
```
to:
```ts
interface Cell { key: string; n: number; workoutId?: string; sessionId?: string; }
```

- [ ] **Step 3: Update `buildMonth`/`build`** to populate `workoutId`/`sessionId` instead of collapsing to booleans. Where the current code does `const planned = workouts.some((w) => ...)`, change to find and keep the matching workout's `id`:
```ts
const matchedWorkout = workouts.find((w) => (w.dates || []).includes(key) || (w.days || []).includes(dow));
```
Where `trainedKeys` is built as a `Set<string>` of dates, change to a `Map<string, string>` (date → session id) instead, keeping the same `hasLoggedWork`/`status !== 'active'` filter:
```ts
const trainedByDate = new Map(
  sessions.filter((s) => s.status !== 'active' && hasLoggedWork(s)).map((s) => [s.date, s.id]),
);
```
then `cells.push({ key, n, workoutId: matchedWorkout?.id, sessionId: trainedByDate.get(key) })`.

- [ ] **Step 4: Update render call sites.** Wherever the JSX currently reads `d.planned`/`d.trained` (the dot/ring styling), change to `!!d.workoutId`/`!!d.sessionId` — same visual behavior, ids just replace the booleans as the source of truth. Read the file to find these exact render lines before editing.

- [ ] **Step 5: Typecheck.** `pnpm --filter @hybrid/web typecheck`, `pnpm --filter @hybrid/mobile typecheck`. Expect exit 0 both — this step alone shouldn't change behavior, only data shape, so no test changes expected yet.

- [ ] **Step 6: Run existing tests to confirm nothing broke.** `pnpm run build:site && pnpm run smoke` (rebuild first), `pnpm --filter @hybrid/mobile test`. Expect all existing tests still pass, including `checks/react-smoke.mjs`'s "Calendar marks a trained day differently from a planned one" scenario (should still pass since the rendered dot markup is unchanged, only its data source changed).

- [ ] **Step 7: Commit.**
```bash
git add apps/web/src/screens/Calendar.tsx apps/mobile/src/screens/Calendar.tsx
git commit -m "calendar: Cell carries workout/session ids instead of collapsed booleans"
```

---

### Task 2: `resolveDayTarget` helper + tests (both apps)

**Files:**
- New logic in: `apps/web/src/lib/session.ts` (alongside `sessionFrom`)
- New logic in: `apps/mobile/src/store/session.ts` (alongside `sessionFrom`)
- Test: wherever `sessionFrom` is already tested, if anywhere (check first — if no existing test file covers this per-app helper, create one following the nearest sibling test's conventions, e.g. `apps/web/test/session.test.ts` if it exists, or ask: read the directory first).

- [ ] **Step 1: Read the current `sessionFrom` file in full** in both apps to confirm placement conventions (imports, export style) before adding a sibling function.

- [ ] **Step 2: Add `resolveDayTarget`** to both files, identical logic (types adjusted per-app if needed):
```ts
export type DayTarget =
  | { kind: 'recap'; id: string }
  | { kind: 'today' }
  | { kind: 'preview'; date: string; workoutId?: string };

export function resolveDayTarget(dateKey: string, today: string, workoutId?: string, sessionId?: string): DayTarget {
  if (sessionId) return { kind: 'recap', id: sessionId };
  if (dateKey === today) return { kind: 'today' };
  return { kind: 'preview', date: dateKey, workoutId };
}
```

- [ ] **Step 3: Add tests** covering all three branches: a date with a `sessionId` returns `recap` (even if it's also today — recap takes priority, since a completed session that happens to be today's should still show its recap, not send the athlete back into a "start" flow for a day already done); a date matching `today` with no `sessionId` returns `today`; any other date returns `preview` with the `workoutId` passed through (including when `workoutId` is undefined — "nothing scheduled" is a valid preview state, not an error).

- [ ] **Step 4: Typecheck + run the new tests.** `pnpm --filter @hybrid/web typecheck`, `pnpm --filter @hybrid/mobile typecheck`, plus whatever test runner covers these new test files (`pnpm --filter @hybrid/web test` if it exists as a script, else confirm how web-side unit tests run today — check `package.json` first since prior context notes web's own unit-test count has historically been small/`3/3`).

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/lib/session.ts apps/mobile/src/store/session.ts <new test files>
git commit -m "calendar: resolveDayTarget — recap/today/preview resolution, shared by Calendar and Home"
```

---

### Task 3: Web Day preview screen

**Files:**
- New: `apps/web/src/screens/Day.tsx`
- Modify: `apps/web/src/App.tsx` (route registration)

- [ ] **Step 1: Read `apps/web/src/screens/Library.tsx`'s `WorkoutDetail` component in full first** — this plan reuses it rather than building a second read-only block/exercise listing. Confirm its exact props (`{ w: Workout }` per the design doc's survey) and import path.

- [ ] **Step 2: Create `Day.tsx`.** Route param via `useParams()` (`date`), read `db.workouts` for a workout matching `date` (via `dates`/`days`, same logic as `buildMonth`'s match — or accept a `workoutId` query param/state passed from the caller instead of re-deriving, whichever is cleaner given the actual router setup; read `apps/web/src/screens/Exercise.tsx` for the nearest existing pattern of an optional-param screen with a lookup-or-empty-state shape). Render:
  - A heading with the formatted date.
  - If a matching workout exists: `<WorkoutDetail w={matched} />` (no Edit/Delete/Duplicate buttons — those are Library's job).
  - Else: an empty state, "Nothing scheduled for this day."
  - No Start button, no write of any kind.

- [ ] **Step 3: Register the route** in `App.tsx`: `<Route path="/day/:date" element={<Day />} />`, near the other parameterized routes (`/planner/:id`, `/recap/:id`).

- [ ] **Step 4: Typecheck.** `pnpm --filter @hybrid/web typecheck`. Expect exit 0.

- [ ] **Step 5: Add a react-smoke scenario** for a future/empty day landing on the "Nothing scheduled" empty state, and one for a day with a matched workout showing its content. Read existing Library/Calendar smoke scenarios for the established seeding/navigation pattern first.

- [ ] **Step 6: Rebuild and run smoke.** `pnpm run build:site && pnpm run smoke`. Expect exit 0 including the new scenarios.

- [ ] **Step 7: Commit.**
```bash
git add apps/web/src/screens/Day.tsx apps/web/src/App.tsx checks/react-smoke.mjs
git commit -m "web: read-only Day preview screen"
```

---

### Task 4: Mobile Day preview screen

**Files:**
- New: `apps/mobile/src/screens/Day.tsx`
- Modify: `apps/mobile/src/App.tsx` (stack param + registration)

- [ ] **Step 1: Read `apps/mobile/src/screens/Library.tsx`'s `Detail` component in full first** (mobile's equivalent read-only listing, per the design doc's survey — confirm exact name/props before reusing it).

- [ ] **Step 2: Create `Day.tsx`**, mirroring web's Task 3 structure via `route.params.date`/`route.params.workoutId`. Add `Day: { date: string; workoutId?: string }` to `RootStackParams` (`apps/mobile/src/App.tsx`, alongside the other param types) and register the screen in the stack navigator.

- [ ] **Step 3: Typecheck.** `pnpm --filter @hybrid/mobile typecheck`. Expect exit 0.

- [ ] **Step 4: Add RNTL tests** mirroring Task 3's two web scenarios (empty day, day-with-workout).

- [ ] **Step 5: Run tests.** `pnpm --filter @hybrid/mobile test`. Expect all pass, existing count + your new tests.

- [ ] **Step 6: Commit.**
```bash
git add apps/mobile/src/screens/Day.tsx apps/mobile/src/App.tsx apps/mobile/test/<new test file>
git commit -m "mobile: read-only Day preview screen"
```

---

### Task 5: Wire Calendar's day-cell tap (both apps)

**Files:**
- Modify: `apps/web/src/screens/Calendar.tsx`
- Modify: `apps/mobile/src/screens/Calendar.tsx`

- [ ] **Step 1: Read both files first** to find the exact current day-cell JSX (currently a bare `<div>`/`<View>`, per the design doc's survey — confirm nothing has shifted since Task 1's edits landed).

- [ ] **Step 2: Add the tap handler.** Wrap or convert the cell to a pressable element, call `resolveDayTarget(cell.key, today, cell.workoutId, cell.sessionId)` (import from Task 2's helper), and navigate on the result:
  - `recap` → `nav('/recap/'+id)` / `nav.navigate('Recap', {id})`
  - `today` → `nav('/training')` / `nav.navigate('Tabs', ...)` (read how `today`'s tab/route is actually reached elsewhere in the app first — confirm the exact navigation target for "go to Training" on mobile, since it may be a tab switch rather than a stack push)
  - `preview` → `nav('/day/'+date)` / `nav.navigate('Day', {date, workoutId})`
  - Empty cells (no day, calendar padding) stay non-interactive — don't attach a handler to `d === null`.

- [ ] **Step 3: Typecheck.** Both apps, expect exit 0.

- [ ] **Step 4: Add react-smoke/RNTL scenarios** for all three outcomes (tap a trained day → lands on Recap with the right session; tap today → lands on Training; tap an empty/future day → lands on Day preview).

- [ ] **Step 5: Rebuild, run smoke, run mobile tests, run full verify.** `pnpm run build:site && pnpm run smoke`, `pnpm --filter @hybrid/mobile test`, `pnpm run verify`. Expect exit 0 across everything.

- [ ] **Step 6: Commit.**
```bash
git add apps/web/src/screens/Calendar.tsx apps/mobile/src/screens/Calendar.tsx checks/react-smoke.mjs <mobile test file>
git commit -m "calendar: wire day-cell tap to resolveDayTarget (recap / today / preview)"
```

---

### Task 6: Wire Home's WeekStrip per-day tap (both apps)

**Files:**
- Modify: `apps/web/src/screens/Home.tsx`
- Modify: `apps/mobile/src/screens/Home.tsx`

- [ ] **Step 1: Read both files' `WeekStrip` component in full first**, confirming the current shared `onOpen` callback and the 7-day data it already computes (per the design doc's survey, `WeekStrip` takes `workouts`/`sessions`/`today` as props — confirm it already has enough to compute each day's `workoutId`/`sessionId`, or needs the same match logic Task 1 added to Calendar, applied to a 7-day window instead of a month).

- [ ] **Step 2: Give each day its own resolved target** instead of one shared `onOpen`. Compute `workoutId`/`sessionId` per day using the same match logic as Calendar's `buildMonth`/`build` (Task 1) — either factor out a tiny shared per-date matcher both `Calendar.tsx` and `Home.tsx` can call, or duplicate the ~3-line match inline if factoring feels like scope creep; use judgment on which is cleaner given the actual current code shape. Each day button's `onClick`/`onPress` calls `resolveDayTarget(day.key, today, day.workoutId, day.sessionId)` and navigates on the result — same three-way routing as Task 5's Calendar wiring.

- [ ] **Step 3: Typecheck.** Both apps, expect exit 0.

- [ ] **Step 4: Add react-smoke/RNTL scenarios** for WeekStrip's per-day tap (at minimum: tapping a specific past trained day from Home lands on that day's Recap, not a generic Calendar view).

- [ ] **Step 5: Rebuild, run smoke, run mobile tests, run full verify.** Same as Task 5's Step 5.

- [ ] **Step 6: Commit.**
```bash
git add apps/web/src/screens/Home.tsx apps/mobile/src/screens/Home.tsx checks/react-smoke.mjs <mobile test file>
git commit -m "home: WeekStrip tap goes to that day (recap / today / preview), not just Calendar"
```

---

### Task 7: Full verification, push, and handoff

**Files:** `handoff.md` only.

- [ ] **Step 1: Run `pnpm run verify`** from the repo root. Expect exit 0 across everything.

- [ ] **Step 2: Update `handoff.md`.** Add a dated entry: what shipped (Calendar day cells and Home's week strip both now route to the tapped day's actual content — a completed day's Recap, today's Training, or a new read-only Day preview for anything else), the explicit scope cut (no retroactive logging, no future pre-loading — Day preview is look-only), and that `Cell`'s data shape changed from booleans to ids (internal, no visible behavior change from that alone). Real commit SHAs and test counts from your own `pnpm run verify` run.

- [ ] **Step 3: Commit and push the branch** (NOT main):
```bash
git add handoff.md
git commit -m "docs: handoff — calendar day-jump shipped"
git push -u origin calendar-day-jump
```
