# Coach week review implementation

Implemented as the first Arc-to-Hybrid integration slice against `71b14b2`.

The second slice adds `/coach/author`, now the default coach route. It reuses
the athlete app's Guided Builder and Planner for real workout structure, then
projects those workouts through the specialist engines and Coordinator.

## Product boundary

- Single-athlete lens: the signed-in user reviews their own data.
- The Coordinator remains the only weekly-plan writer.
- The review pairs resolved intent with actual sessions without mutating either.
- Ambiguous sessions remain `unplanned`; they are never silently credited.
- Pain and illness drops are presented before optimization context.
- Nutrition is read-only context and is never presented as a cause of a training decision.
- Automation receipts are labelled device-local until the ledger is synced.

## Route

`/coach/author`

- Creates real Strength or Conditioning `Workout` records through `EngineDB`.
- Uses the existing `/build/:id` and `/planner/:id` flows.
- Stores local coach proposal inputs separately from athlete workout data.
- Shows the resulting Coordinator entries and every dropped decision.
- Provides no resolved-date editor.

`/coach/review/:weekStart`

Only the current live Coordinator projection can be reviewed honestly with the
local model today. A request for another week abstains instead of rebuilding
history from current workouts. Historical review requires a retained weekly
plan snapshot.

`/coach/nutrition`

- Opens with data quality and explicit missing-day states.
- Shows the current program and accepted target without editing it.
- Pairs seven days of calories/macros with targets and declaration state.
- Shows weigh-in coverage, weight trend, expenditure confidence and the
  engine's own explanation.
- Displays weekly check-in proposals, holds and actionable exceptions.
- Contains no food search, barcode/OCR, recipe, meal-log or diary-edit control.
- Keeps nutrition beside training as context; it never becomes a Coordinator
  proposal or a claimed cause of training outcomes.

## Offline contract

The week and nutrition review routes may reopen through the PWA shell and read local state. The
mutation-heavy program bench remains excluded from navigation fallback until
pending writes, conflicts and rejection are explicit states.

The previous direct-placement bench is retained temporarily at `/coach/legacy`
for comparison and migration only. It is no longer the default coach route.

## Verification

```bash
pnpm --filter @hybrid/web typecheck
pnpm --filter @hybrid/web test
pnpm --filter @hybrid/web build
node checks/coach-contract.mjs
```

The component casing collisions were also removed (`OnboardingPanel.tsx` and
`WeeklySummaryPanel.tsx`) so these checks work on case-insensitive Windows
filesystems. The coach contract now normalizes repository paths before applying
its allowlist rule for the same reason.
