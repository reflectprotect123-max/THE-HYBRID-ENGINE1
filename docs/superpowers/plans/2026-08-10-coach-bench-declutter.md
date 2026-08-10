# Coach Bench Declutter Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `CoachSection` collapse pattern already shipped on Command Center to Authoring, Progression, Nutrition and Week Review, so the whole coach bench reads as one organised system instead of one clean page followed by four busy ones.

**Architecture:** Each page keeps its existing data/logic untouched — this is presentation-only. Each secondary/reference block that currently renders as an always-visible `<section>` gets wrapped in the existing `CoachSection` component (`apps/web/src/coach/CoachSection.tsx`, already built and tested — do not modify it). The one primary/actionable block per page stays visible exactly as before.

**Tech Stack:** React 18, TypeScript, Tailwind (utility classes only, no new CSS), Vitest + Testing Library, react-router-dom.

## Global Constraints

- Tests are colocated: `Foo.tsx` is tested by `Foo.test.tsx` in the same directory (CLAUDE.md). Every task below extends an existing colocated test file — never create a new one under `test/`.
- The coach workspace is desktop-first; `1440px` remains the build/review width. Do not add any new responsive behavior in this plan — only wrap existing content in `CoachSection`.
- `CoachSection` is collapsed by default (no `defaultOpen` prop passed) for every wrap in this plan — match Command Center's rule of exactly one thing open per page.
- Do not touch `RosterAuthoringView` or `RosterNutritionView` — both are already lean (under ~165 lines, no secondary reference blocks) and were confirmed out of scope during design review.
- Run `pnpm --filter @hybrid/web exec vitest run <file>` after each task's implementation step, and `pnpm run typecheck` before each commit.

---

### Task 1: Authoring — collapse the Coordinator-output sidebar

**Files:**
- Modify: `apps/web/src/coach/CoachAuthoring.tsx` (import + `SelfCoachAuthoringView`'s `<aside>`, lines ~320-354)
- Test: `apps/web/src/coach/CoachAuthoring.test.tsx`

**Interfaces:**
- Consumes: `CoachSection` from `./CoachSection` — `{ title: string; eyebrow?: string; count?: number; defaultOpen?: boolean; children: ReactNode }` (existing, unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/coach/CoachAuthoring.test.tsx` (append inside the existing `describe` block, after the last test — check the file's existing `describe`/`it` structure and imports first; add `within` to the `@testing-library/react` import if not already present):

```tsx
it('collapses the Coordinator-output sidebar by default on the self-coach authoring screen', async () => {
  const repo = new FakeCoachWorkspaceRepository();
  await renderAuthoring(repo);

  const summary = screen.getByText('Resolved week');
  const details = summary.closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(within(details as HTMLElement).getByText('Resolved sessions')).not.toBeVisible();
});
```

(If `renderAuthoring` in this file renders the roster branch by default, use whatever helper/route this file already uses to reach `SelfCoachAuthoringView` — check the top of the file for the existing self-coach render helper before writing this step; adapt the render call to match, keeping the assertions above unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachAuthoring.test.tsx`
Expected: FAIL — `screen.getByText('Resolved week')` throws, because the current heading text is `Week of {date}`, not `Resolved week`.

- [ ] **Step 3: Implement the collapse**

In `apps/web/src/coach/CoachAuthoring.tsx`, add the import:

```tsx
import { CoachSection } from './CoachSection';
```

Replace the entire `<aside>` block inside `SelfCoachAuthoringView` (currently two `<section>` elements: the `resolution-title` section and the `Persistence status` section) with:

```tsx
        <aside className="space-y-2 xl:sticky xl:top-[58px] xl:self-start">
          <CoachSection eyebrow="Coordinator output" title="Resolved week" count={plan.entries.length}>
            <p className="text-[11px] text-muted">{plan.decisions.filter((decision) => decision.action === 'dropped').length} held back</p>
            <h3 className="mt-2 text-[10px] uppercase tracking-wider text-dim">Resolved sessions</h3>
            <div className="mt-0.5 space-y-1">
              {plan.entries.map((entry) => (
                <article key={entry.id} className="rounded border border-line bg-panel p-1">
                  <div className="flex items-baseline gap-1"><span className="text-xs font-medium">{entry.title}</span><span className="ml-auto text-[10px] tabular-nums text-muted">{readableDate(entry.date)}</span></div>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-dim">{entry.domain} · {entry.effort}</p>
                </article>
              ))}
              {plan.entries.length === 0 && <p className="py-2 text-xs text-muted">No session was placed. Review safety, availability and proposal inputs.</p>}
            </div>
            <h3 className="mt-1.5 text-[10px] uppercase tracking-wider text-dim">Held proposals</h3>
            <div className="mt-0.5 space-y-1">
              {plan.decisions.filter((decision) => decision.action === 'dropped').map((decision) => (
                <article key={`${decision.proposalId}:${decision.reasonCode}`} className="rounded border border-line bg-panel p-1">
                  <div className="flex items-baseline gap-1"><span className="text-xs font-medium">{titleById.get(decision.proposalId) ?? 'Proposal'}</span><span className="ml-auto text-[10px] uppercase tracking-wide text-warn">{decision.reasonCode.replaceAll('_', ' ')}</span></div>
                  <p className="mt-0.5 text-[11px] text-muted">{decision.explanation}</p>
                </article>
              ))}
              {!plan.decisions.some((decision) => decision.action === 'dropped') && <p className="py-1 text-xs text-muted">Nothing was held back in this resolution.</p>}
            </div>
            <p className="mt-2 text-[10px] text-dim">Workout structure uses the real synced EngineDB path. Coach proposal inputs are local-only in this phase and are not a published server plan.</p>
          </CoachSection>
        </aside>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachAuthoring.test.tsx`
Expected: PASS, all tests in the file green (re-run the whole file, not just the new test, to confirm nothing else broke).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/CoachAuthoring.tsx apps/web/src/coach/CoachAuthoring.test.tsx
git commit -m "Authoring: collapse Coordinator-output sidebar into CoachSection"
```

---

### Task 2: Progression — collapse decision history and autonomy receipts

**Files:**
- Modify: `apps/web/src/coach/CoachProgression.tsx` (import + `RosterProgressionView`'s receipts section, lines ~170-202; `SelfCoachProgressionView`'s `<aside>`, lines ~345-348)
- Test: `apps/web/src/coach/CoachProgression.test.tsx`

**Interfaces:**
- Consumes: `CoachSection` from `./CoachSection` (existing, unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/coach/CoachProgression.test.tsx` (add `within` to the `@testing-library/react` import if not already present):

```tsx
it('collapses the "What the system adjusted" receipts panel by default on the roster view', async () => {
  const repo = new FakeCoachWorkspaceRepository();
  repo.clients = [CLIENT];
  repo.listAutocoachReceipts = async () => [
    {
      clientEntryId: 'entry-1',
      action: 'adjusted',
      wasForked: false,
      occurredAt: '2026-08-01T00:00:00.000Z',
      operations: [{ type: 'cap_intensity', targetPath: 'session', materiality: 'minor', reasonCode: 'readiness_low' }],
    },
  ];
  await renderProgression(repo);

  const summary = screen.getByText('What the system adjusted for Riley Roster');
  const details = summary.closest('details');
  expect(details).not.toHaveAttribute('open');
});

it('collapses the decision-history sidebar by default on the self-coach progression screen', async () => {
  const repo = new FakeCoachWorkspaceRepository();
  await renderSelfProgression(repo);

  const summary = screen.getByText('Decision history');
  const details = summary.closest('details');
  expect(details).not.toHaveAttribute('open');
});
```

(Check the top of `CoachProgression.test.tsx` for the exact existing render-helper names — `renderProgression` for the roster branch and whatever helper reaches `SelfCoachProgressionView`, e.g. `renderSelfProgression` or a different name already in the file — and use those exact names, adapting the two tests above only if the real helper names differ. Do not invent a helper; reuse what exists or add a small one that mirrors `renderCommandCenter`'s shape from `CoachCommandCenter.test.tsx` — a `DbProvider` wrapper around `<CoachProgression />` inside a `MemoryRouter`, matching how the file already renders the self-coach branch elsewhere if it does, or how sibling files like `CoachCommandCenter.test.tsx` do it if this file has no self-coach render path yet.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachProgression.test.tsx`
Expected: FAIL — `screen.getByText('What the system adjusted for Riley Roster')` and `screen.getByText('Decision history')` are not wrapped in a `<details>`/`<summary>` yet, so `.closest('details')` is `null` and the `toHaveAttribute` assertion throws on a null element (or the text itself renders inside an `<h2>`, not a `<summary>`, if a fresh helper had to be added — the point of this run is to confirm the CURRENT render does not have collapse behavior).

- [ ] **Step 3: Implement the collapse**

In `apps/web/src/coach/CoachProgression.tsx`, add the import:

```tsx
import { CoachSection } from './CoachSection';
```

Replace the receipts `<section>` inside `RosterProgressionView` (the block starting `{receipts && receipts.length > 0 && (`) with:

```tsx
        {receipts && receipts.length > 0 && (
          <CoachSection eyebrow="Autonomy · read-only" title={`What the system adjusted for ${clientName}`} count={receipts.length}>
            <p className="text-[11px] text-muted">
              Auto-Coach changed a session automatically, before {clientName} started it, using
              whole-athlete-state's constraints as its input. Nothing here is editable — it is a record of
              what already happened locally on their device.
            </p>
            <div className="mt-1 space-y-1">
              {receipts.map((receipt) => (
                <article key={receipt.clientEntryId} className="rounded border border-line bg-panel p-1.5 text-xs">
                  <div className="flex flex-wrap items-baseline gap-1">
                    <span className="font-medium">
                      {receipt.action === 'undone' ? 'Undone' : receipt.wasForked ? 'Forked a copy' : 'Adjusted in place'}
                    </span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-dim">
                      {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(receipt.occurredAt))}
                    </span>
                  </div>
                  {receipt.operations.map((op, i) => (
                    <p key={i} className="mt-0.5 text-[11px] text-muted">
                      {OPERATION_LABEL[op.type] ?? op.type} at {op.targetPath || 'session level'}
                      {' '}<span className="text-dim">({op.materiality} · {op.reasonCode.replaceAll('_', ' ')})</span>
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </CoachSection>
        )}
```

Replace the `<aside>` block inside `SelfCoachProgressionView` with:

```tsx
        <aside className="space-y-2 xl:sticky xl:top-[58px] xl:self-start">
          <CoachSection eyebrow="History" title="Decision history" count={ledger.decisions.length}>
            <div className="space-y-1">
              {ledger.decisions.slice(0, 12).map((event) => {
                const proposal = ledger.proposals.find((item) => item.id === event.proposalId);
                return (
                  <article key={event.id} className="rounded border border-line bg-panel p-1">
                    <div className="flex items-baseline gap-1"><strong className="text-xs">{proposal?.subject ?? 'Proposal'}</strong><span className="ml-auto text-[10px] uppercase tracking-wide text-muted">{event.decision}</span></div>
                    <p className="mt-0.5 text-[11px] text-muted">{event.rationale}</p>
                    <p className="mt-0.5 text-[10px] text-dim">{dateTime(event.decidedAt)} · {event.applied ? 'prescription updated' : 'no prescription change'}</p>
                    {event.note && <p className="mt-0.5 text-[10px] text-warn">{event.note}</p>}
                  </article>
                );
              })}
              {ledger.decisions.length === 0 && <p className="text-xs text-muted">No coach decision has been recorded yet.</p>}
            </div>
            <p className="mt-2 text-[11px] text-dim">This is real front-end decision logic and local demo persistence. It is not server authorization, a durable audit trail, or multi-device sync.</p>
          </CoachSection>
        </aside>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachProgression.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/CoachProgression.tsx apps/web/src/coach/CoachProgression.test.tsx
git commit -m "Progression: collapse decision history and autonomy receipts into CoachSection"
```

---

### Task 3: Nutrition — elevate exceptions, collapse everything else

**Files:**
- Modify: `apps/web/src/coach/CoachNutrition.tsx` (import + all of `SelfCoachNutritionView`, lines ~136-269)
- Test: `apps/web/src/coach/CoachNutrition.test.tsx`

**Interfaces:**
- Consumes: `CoachSection` from `./CoachSection` (existing, unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/coach/CoachNutrition.test.tsx` (add `within` to the `@testing-library/react` import if not already present; check the file's existing self-coach render helper name before writing — reuse it, do not invent a new one):

```tsx
it('renders Actionable exceptions first in DOM order, ahead of the collapsed reference sections, on the self-coach nutrition screen', async () => {
  const { container } = await renderSelfNutrition();
  const exceptionsSection = container.querySelector('section[aria-labelledby="exceptions-title"]');
  const firstDetails = container.querySelector('details');
  expect(exceptionsSection).toBeInTheDocument();
  expect(firstDetails).toBeInTheDocument();
  expect(exceptionsSection!.compareDocumentPosition(firstDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('collapses the Data state and Current program sections by default', async () => {
  const { container } = await renderSelfNutrition();
  const dataStateSummary = screen.getByText(/days declared/);
  const dataStateDetails = dataStateSummary.closest('details');
  expect(dataStateDetails).not.toHaveAttribute('open');
  expect(within(dataStateDetails as HTMLElement).getByText(/Unlogged means unknown/)).not.toBeVisible();

  expect(container.querySelector('section[aria-labelledby="exceptions-title"]')?.tagName).not.toBe('DETAILS');
});
```

(`renderSelfNutrition` should already exist in the file, or be trivially derivable from whatever helper renders `SelfCoachNutritionView` today — check the top of the file first. If no such helper exists yet, add one that mirrors the file's existing `renderNutrition` for the roster branch but without setting `repo.clients` to a `roster-summary` client, so `selectedClient` stays `null`/`engine-local` and `CoachNutrition` falls into the self-coach branch — same pattern `CoachCommandCenter.test.tsx`'s `renderCommandCenter` uses.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachNutrition.test.tsx`
Expected: FAIL — there is no `<details>` element anywhere in the current `SelfCoachNutritionView` output, so `container.querySelector('details')` is `null` and the first test throws.

- [ ] **Step 3: Implement the restructure**

In `apps/web/src/coach/CoachNutrition.tsx`, add the import:

```tsx
import { CoachSection } from './CoachSection';
```

Replace the entire `return (...)` statement of `SelfCoachNutritionView` with:

```tsx
  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-[1240px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · nutrition</p>
            <h1 className="mt-0.5 text-xl font-semibold">Evidence, targets and the next conversation</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] p-2">
        {dataRecovered && (
          <section className="mb-2 rounded-md border border-warn bg-panel3 p-2" role="status">
            <h2 className="text-sm font-semibold">Local nutrition data was unreadable</h2>
            <p className="mt-0.5 text-xs text-muted">This is a fresh local fallback, not evidence that the athlete has no nutrition history.</p>
          </section>
        )}

        <section aria-labelledby="exceptions-title" className="card raised mb-4 overflow-hidden rounded-lg border border-gold-line bg-gold-wash/[0.03] border-l-0">
          <div className="flex items-end gap-2 border-b border-gold-line/40 bg-gold-wash px-3 py-2">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-gold">Now</p>
              <h2 id="exceptions-title" className="text-base font-semibold">
                {review.exceptions.length ? `${review.exceptions.length} item${review.exceptions.length === 1 ? '' : 's'} to understand` : 'No exception identified'}
              </h2>
            </div>
          </div>
          <div className="divide-y divide-line">
            {review.exceptions.map((exception) => (
              <div key={exception.id} className={`border-l-2 px-2.5 py-2.5 ${exception.priority === 'attention' ? 'border-warn/60' : 'border-line'}`}>
                <h3 className="text-sm font-semibold">{exception.title}</h3>
                <p className="mt-0.5 text-xs text-muted">{exception.detail}</p>
                <p className="mt-1 text-[11px] text-text"><span className="text-dim">Next</span> · {exception.next}</p>
              </div>
            ))}
            {review.exceptions.length === 0 && <div className="px-3 py-5 text-center"><p className="text-xs text-muted">No exception identified this week.</p></div>}
          </div>
        </section>

        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <CoachSection eyebrow="Data state" title={`${declaredDays} of 7 days declared`}>
              <p className="text-xs text-muted">Unlogged means unknown, never zero. Averages must not silently include missing days.</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Logged</dt><dd className="mt-0.5 font-semibold tabular-nums">{review.summary.adherence.loggedDays}/{review.summary.adherence.windowDays}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Weigh-ins</dt><dd className="mt-0.5 font-semibold tabular-nums">{review.coverage.weightDays}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-dim">Estimate</dt><dd className="mt-0.5 font-semibold capitalize">{review.summary.estimate.confidence}</dd></div>
              </dl>
            </CoachSection>

            <CoachSection eyebrow="Current program · read-only" title={review.program?.name ?? 'No program established'}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Goal" value={review.program ? goalLabel(review.program.targetRateKgPerWeek) : 'Unknown'} />
                <Metric label="Target rate" value={review.program ? `${review.program.targetRateKgPerWeek > 0 ? '+' : ''}${review.program.targetRateKgPerWeek} kg/week` : 'Unknown'} />
                <Metric label="Calories today" value={target ? number(target.calories, ' kcal') : 'No accepted target'} />
                <Metric label="Macros today" value={target ? `${number(target.proteinG)}P · ${number(target.carbsG)}C · ${number(target.fatG)}F` : 'No accepted target'} />
              </div>
              <p className="mt-2 text-[11px] text-dim">The coach can review this program here but cannot edit the athlete&rsquo;s diary or silently replace an accepted target.</p>
            </CoachSection>

            <CoachSection eyebrow="Evidence" title="Seven-day nutrition ledger">
              <p className="text-[11px] text-muted">Actual beside target, with the athlete&rsquo;s declared data state preserved.</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="bg-panel2 text-[10px] uppercase tracking-wider text-dim">
                    <tr><th className="px-2 py-1">Day</th><th className="px-2 py-1">State</th><th className="px-2 py-1">Calories</th><th className="px-2 py-1">Protein</th><th className="px-2 py-1">Carbs</th><th className="px-2 py-1">Fat</th><th className="px-2 py-1">Entries</th></tr>
                  </thead>
                  <tbody>
                    {review.days.map((day) => (
                      <tr key={day.date} className="border-t border-line">
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{dateLabel(day.date)}</td>
                        <td className={`px-2 py-1.5 font-medium ${STATUS_CLASS[day.status]}`}>{STATUS_LABEL[day.status]}</td>
                        <MacroCell actual={day.totals.calories} target={day.target?.calories} suffix=" kcal" unknown={day.status === 'unlogged'} />
                        <MacroCell actual={day.totals.proteinG} target={day.target?.proteinG} suffix=" g" unknown={day.status === 'unlogged'} />
                        <MacroCell actual={day.totals.carbsG} target={day.target?.carbsG} suffix=" g" unknown={day.status === 'unlogged'} />
                        <MacroCell actual={day.totals.fatG} target={day.target?.fatG} suffix=" g" unknown={day.status === 'unlogged'} />
                        <td className="px-2 py-1.5 tabular-nums text-muted">{day.status === 'unlogged' ? '—' : day.entryCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CoachSection>

            <CoachSection eyebrow={`Weekly check-in · ${review.weekStart} – ${review.weekEnd}`} title={review.checkIn?.status ?? 'Not recorded'}>
              {review.checkIn ? (
                <>
                  <p className="text-xs text-muted">{review.checkIn.explanation}</p>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Previous expenditure" value={number(review.checkIn.previousExpenditureKcal, ' kcal')} />
                    <Metric label="Observed expenditure" value={number(review.checkIn.observedExpenditureKcal, ' kcal')} />
                    <Metric label="Proposed expenditure" value={number(review.checkIn.proposedExpenditureKcal, ' kcal')} />
                    <Metric label="Proposed calories" value={number(review.checkIn.proposedCalories, ' kcal')} />
                  </div>
                  {review.checkIn.modules.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">{review.checkIn.modules.map((module) => <li key={`${module.key}:${module.action}`}>{module.action}</li>)}</ul>}
                </>
              ) : <p className="text-xs text-muted">No weekly nutrition decision exists for this week.</p>}
              <p className="mt-2 text-[11px] text-dim">This phase displays the recorded state. It does not fake coach approval before backend authority and receipts exist.</p>
            </CoachSection>
          </div>

          <aside className="xl:sticky xl:top-4 xl:self-start">
            <CoachSection eyebrow="Weight and expenditure evidence" title={review.latestWeight ? `${review.latestWeight.weightKg.toFixed(1)} kg latest` : 'No weigh-in available'}>
              <WeightTrend raw={review.weightSeries.raw} trend={review.weightSeries.trend} />
              <dl className="mt-1 space-y-0.5 text-xs">
                <Row label="Direction" value={review.summary.trend.direction} />
                <Row label="Slope" value={review.summary.trend.slopeKgPerWeek == null ? 'Unknown' : `${review.summary.trend.slopeKgPerWeek > 0 ? '+' : ''}${review.summary.trend.slopeKgPerWeek.toFixed(2)} kg/week`} />
                <Row label="Expenditure" value={number(review.summary.estimate.estimateKcal, ' kcal/day')} />
                <Row label="Confidence" value={review.summary.estimate.confidence} />
              </dl>
              <p className="mt-1 text-[11px] text-muted">{review.summary.estimate.explanation}</p>
              <p className="mt-1 text-[11px] text-dim">No wearable calorie estimate is used. This evidence never schedules or edits training.</p>
            </CoachSection>

            <CoachSection eyebrow="Coach boundary" title="What this route cannot do">
              <p className="text-xs text-muted">No barcode scanner, label reader, food search, recipe builder, meal logger or diary-edit control exists on this route.</p>
            </CoachSection>
          </aside>
        </div>
      </div>
    </main>
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachNutrition.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/CoachNutrition.tsx apps/web/src/coach/CoachNutrition.test.tsx
git commit -m "Nutrition: elevate Actionable exceptions, collapse reference sections into CoachSection"
```

---

### Task 4: Week Review — collapse review state, dropped-proposal, and sidebar sections

**Files:**
- Modify: `apps/web/src/coach/WeekReview.tsx` (import + `SelfCoachWeekReview`'s main column and aside, lines ~169-268)
- Test: `apps/web/src/coach/WeekReview.test.tsx`

**Interfaces:**
- Consumes: `CoachSection` from `./CoachSection` (existing, unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/coach/WeekReview.test.tsx` (add `within` to the `@testing-library/react` import if not already present; check the top of the file for the existing self-coach render helper name and reuse it):

```tsx
it('renders the Planned-versus-actual ledger before the collapsed reference sections, on the self-coach week review screen', async () => {
  const { container } = await renderSelfWeekReview();
  const ledgerSection = container.querySelector('section[aria-labelledby="ledger-title"]');
  const firstDetails = container.querySelector('details');
  expect(ledgerSection).toBeInTheDocument();
  expect(firstDetails).toBeInTheDocument();
  expect(ledgerSection!.compareDocumentPosition(firstDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('collapses the Review state and Automation receipts sections by default', async () => {
  const { container } = await renderSelfWeekReview();
  const reviewStateSummary = screen.getByText('Review state');
  const reviewStateDetails = reviewStateSummary.closest('details');
  expect(reviewStateDetails).not.toHaveAttribute('open');

  const receiptsSummary = screen.getByText('Automation receipts');
  const receiptsDetails = receiptsSummary.closest('details');
  expect(receiptsDetails).not.toHaveAttribute('open');

  expect(container.querySelector('section[aria-labelledby="ledger-title"]')?.tagName).not.toBe('DETAILS');
});
```

(`renderSelfWeekReview` should already exist in the file, or be trivially derivable — check the top of `WeekReview.test.tsx` first. If it doesn't exist, add one that renders `<WeekReview />` inside `DbProvider`/`NutritionProvider`/`MemoryRouter` with a `FakeCoachWorkspaceRepository` whose `clients` are NOT set to a `roster-summary` client, so `selectedClient` stays `null`/`engine-local` and the self-coach branch renders — same pattern as `CoachCommandCenter.test.tsx`'s `renderCommandCenter`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/WeekReview.test.tsx`
Expected: FAIL — there is no `<details>` element anywhere in the current `SelfCoachWeekReview` output.

- [ ] **Step 3: Implement the collapse**

In `apps/web/src/coach/WeekReview.tsx`, add the import:

```tsx
import { CoachSection } from './CoachSection';
```

Replace the `<section>` with `aria-labelledby="review-state"` (the first section in the main column) with:

```tsx
          <CoachSection eyebrow="Live projection" title="Review state">
            <p className="text-xs text-muted">
              This is the Coordinator&rsquo;s current deterministic projection paired with local actuals. It is not a
              stored historical plan snapshot; ambiguous matches remain explicit.
            </p>
          </CoachSection>
```

Leave the `reconciled.safetyDrops.length > 0` section and the `ledger-title` section exactly as they are — do not touch either.

Replace the `<section>` with `aria-labelledby="decisions-title"` ("What competed and lost") with:

```tsx
          <CoachSection eyebrow="Coordinator arbitration" title="What competed and lost" count={reconciled.dropped.length}>
            <p className="text-[11px] text-muted">Dropped proposals are part of the week, not hidden failures.</p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {reconciled.dropped.map((decision) => (
                <article key={`${decision.proposalId}:${decision.reasonCode}`} className="rounded border border-line bg-panel p-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-gold2">{decision.reasonCode.replaceAll('_', ' ')}</p>
                  <p className="mt-0.5 text-xs text-muted">{decision.explanation}</p>
                </article>
              ))}
              {reconciled.dropped.length === 0 && <p className="text-xs text-muted">No proposals were dropped in this projection.</p>}
            </div>
          </CoachSection>
```

Replace the `<section>` with `aria-labelledby="receipts-title"` ("Automation receipts") with:

```tsx
          <CoachSection eyebrow="Automation" title="Automation receipts" count={reconciled.interventions.length}>
            <p className="text-[11px] text-warn">Device-local evidence. It is not yet synced or authoritative off this device.</p>
            <div className="mt-1 space-y-1">
              {reconciled.interventions.map((entry) => (
                <article key={entry.id} className="rounded border border-line bg-panel p-1">
                  <div className="flex gap-1 text-[10px] uppercase tracking-wide"><span>{entry.action}</span><span className="ml-auto text-dim">{niceDate(entry.date)}</span></div>
                  <p className="mt-0.5 text-xs text-muted">{entry.reasonCodes.join(', ') || 'No reason code recorded'}</p>
                </article>
              ))}
              {reconciled.interventions.length === 0 && <p className="text-xs text-muted">No local automation receipt for this week.</p>}
            </div>
          </CoachSection>
```

Replace the `<section>` with `aria-labelledby="nutrition-title"` ("Nutrition context") with:

```tsx
          <CoachSection eyebrow="Context" title="Nutrition context">
            <Link to="/coach/nutrition" className="text-[10px] uppercase tracking-wide text-gold2">Open review</Link>
            <dl className="mt-1 space-y-0.5 text-xs">
              <div className="flex"><dt className="text-muted">Days logged</dt><dd className="ml-auto tabular-nums">{nutritionContext.adherence.loggedDays} of {nutritionContext.adherence.windowDays}</dd></div>
              <div className="flex"><dt className="text-muted">Today logged</dt><dd className="ml-auto tabular-nums">{Math.round(nutritionContext.today.totals.calories)} kcal</dd></div>
            </dl>
            <p className="mt-1 text-[11px] text-dim">Shown beside training as context only. It did not schedule, drop, or alter a session.</p>
          </CoachSection>
```

Leave the final `<section>` with `aria-labelledby="next-title"` ("Next" gold callout) exactly as it is — do not touch it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/WeekReview.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/web exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/WeekReview.tsx apps/web/src/coach/WeekReview.test.tsx
git commit -m "Week Review: collapse review-state, dropped-proposal and sidebar sections into CoachSection"
```

---

## Final Verification (after all 4 tasks)

- [ ] Run the full web test suite: `pnpm --filter @hybrid/web exec vitest run`
- [ ] Run full typecheck: `pnpm run typecheck`
- [ ] Run `pnpm run check:ecosystem`
- [ ] Push to `main` and confirm the Netlify deploy's `commit_ref` matches the final commit (same verification pattern used for every prior deploy this session).
