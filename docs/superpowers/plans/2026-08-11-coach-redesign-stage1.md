# Coach Workspace Redesign — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/coach`'s Command Center as a four-tile launcher over four new pillar screens (Readiness, Strength, Conditioning, Nutrition), matching the approved mockup exactly, with every number wired to real data.

**Architecture:** The mockup's own stylesheet ships nearly verbatim as `apps/web/src/coach/coach-redesign.css`; markup is ported to JSX keeping its class names. Four new pillar screens live under `apps/web/src/coach/pillars/`. One genuinely new engine derivation — time in five %HRmax bands, computed from a session's stored HR trace — is added to `packages/engine/src/hr.ts` alongside the existing three-zone `zoneSeconds`.

**Tech Stack:** React 19 + react-router-dom, TypeScript, Vitest + @testing-library/react, plain CSS (mockup-sourced), Vite.

## Reference

The approved mockup is saved at:
`/root/.claude/projects/-home-user-THE-HYBRID-ENGINE1/d30b5cca-0c7a-5866-8a26-5d3b78a831cf/tool-results/artifact-d7069c12-1786398549-c8fe.html`

Its `<style>` block (lines ~20–910) is the source of all CSS. Its
`<section id="view-command">` (~line 933) and the four `<section
id="view-readiness|strength|conditioning|nutrition">` blocks (~lines 979–1150)
are the source of all markup. **Read the relevant block before writing each
screen.** Do not reproduce it from memory or from this plan's excerpts alone.

Spec: `docs/superpowers/specs/2026-08-11-coach-workspace-redesign-design.md`

## Global Constraints

- **The mockup is the visual specification.** Class names, markup structure and inline SVG icons are copied from it, not reinvented. Where this plan and the mockup disagree, the mockup wins and the discrepancy is reported.
- **Every number comes from real data.** The mockup's figures (87%, "3 pending", 120 min, 78.4 kg) are placeholders. No hardcoded athlete data ships.
- **Absent data is stated, never faked.** No WHOOP connection shows the mockup's "Connect WHOOP" prompt, not a number. Unlogged is unknown, never zero.
- **Pillar screens read the signed-in athlete's own stores**, so every pillar route is wrapped in `<ClientDetailGate tool="...">`, exactly as `legacy` / `build/:id` / `planner/:id` already are.
- **`CoachCommandCenter` keeps its `isLocalClient` gating.** `checks/coach-contract.mjs` statically enforces this; it must stay green.
- **The three-zone model is untouched.** The five-zone derivation is additive and display-only. Nothing reads it as an instruction, and no prescription or progression path changes.
- **Training decisions live in the engine, not in screens** (`CLAUDE.md`). The five-zone maths goes in `packages/engine/src/hr.ts`.
- **Tests are colocated.** `src/foo.ts` is tested by `src/foo.test.ts` in the same directory.
- **Desktop is composed at 1440px; phone is a supported viewport.** Both are verified.
- Before every commit: `pnpm --filter @hybrid/web exec tsc --noEmit -p .`, `pnpm --filter @hybrid/web exec vitest run`, and `node checks/coach-contract.mjs` must all pass.

## File Structure

| File | Responsibility |
|---|---|
| `packages/engine/src/hr.ts` (modify) | Add `hrMaxBandSeconds` — time in five %HRmax bands from a trace |
| `packages/engine/src/hr.test.ts` (create) | Colocated tests for the above; `hr.ts` currently has none |
| `apps/web/src/coach/coach-redesign.css` (create) | The mockup's stylesheet, verbatim |
| `apps/web/src/coach/CoachCommandCenter.tsx` (rewrite) | Four-tile launcher |
| `apps/web/src/coach/CoachCommandCenter.test.tsx` (update) | Existing gating assertions, new markup |
| `apps/web/src/coach/pillars/PillarBack.tsx` (create) | Shared "← Command Center" back link |
| `apps/web/src/coach/pillars/Readiness.tsx` + `.test.tsx` | Recovery ring, band, trend cards |
| `apps/web/src/coach/pillars/Strength.tsx` + `.test.tsx` | Progression queue, lift trends, hard budget |
| `apps/web/src/coach/pillars/Conditioning.tsx` + `.test.tsx` | Queue, zone bar, five-zone donut, erg trends |
| `apps/web/src/coach/pillars/Nutrition.tsx` + `.test.tsx` | Adherence, macros, weight trend — replaces `CoachNutrition` |
| `apps/web/src/coach/index.tsx` (modify) | Register pillar routes; retire `/coach/progression` |
| `CLAUDE.md` (modify) | Rewrite the coach-workspace mobile boundary |
| `checks/screens.mjs` (modify) | Shoot stage-1 coach routes at phone width |

---

### Task 1: Five-zone %HRmax derivation in the engine

**Files:**
- Modify: `packages/engine/src/hr.ts`
- Test: `packages/engine/src/hr.test.ts` (create — none exists today)

**Interfaces:**
- Consumes: `Downsampled { every: number; pts: (number|null)[] }`, `conMaxHr(profile?: Profile): number` — both already in scope in `hr.ts`.
- Produces: `export type HrMaxBand = 'z1' | 'z2' | 'z3' | 'z4' | 'z5';` and `export function hrMaxBandSeconds(ds: Downsampled | null | undefined, maxHr: number): Record<HrMaxBand, number>`. Task 5 consumes both.

Band edges are the standard %HRmax model: Z1 50–60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 90%+. Beats under 50% are **excluded** — unlike the three-zone `zoneSeconds`, which banks sub-floor beats into Recovery because `conAdapt` divides by that total. Nothing divides by this one; it is a display breakdown, and folding warm-up drift into Z1 would overstate it.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/hr.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hrMaxBandSeconds } from './hr';

/*
 * The five-zone %HRmax breakdown is DISPLAY-ONLY context for the coach
 * bench. The three-zone model (`zoneSeconds`) still drives every
 * prescription and progression — see the redesign spec. These tests pin the
 * band edges and the two honesty rules: a null sample is not time, and a
 * beat below Z1 is not Z1.
 */
describe('hrMaxBandSeconds', () => {
  it('banks each sample into its %HRmax band, one `every` at a time', () => {
    // maxHr 200 → Z1 100-119, Z2 120-139, Z3 140-159, Z4 160-179, Z5 180+
    const ds = { every: 10, pts: [110, 130, 150, 170, 190] };
    expect(hrMaxBandSeconds(ds, 200)).toEqual({ z1: 10, z2: 10, z3: 10, z4: 10, z5: 10 });
  });

  it('excludes beats under 50% of max — warm-up drift is not Z1', () => {
    const ds = { every: 5, pts: [80, 99, 110] }; // 40%, 49.5%, 55%
    expect(hrMaxBandSeconds(ds, 200)).toEqual({ z1: 5, z2: 0, z3: 0, z4: 0, z5: 0 });
  });

  it('skips null samples rather than counting them as time', () => {
    const ds = { every: 10, pts: [150, null, 150] };
    expect(hrMaxBandSeconds(ds, 200).z3).toBe(20);
  });

  it('returns all zeroes for an absent trace — no HR recorded is not zero minutes trained', () => {
    expect(hrMaxBandSeconds(null, 200)).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
    expect(hrMaxBandSeconds(undefined, 200)).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
  });

  it('returns all zeroes rather than dividing by a nonsense max', () => {
    expect(hrMaxBandSeconds({ every: 10, pts: [150] }, 0)).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
  });

  it('puts a beat at exactly a band edge in the higher band', () => {
    // 120 is exactly 60% of 200 → Z2, not Z1
    expect(hrMaxBandSeconds({ every: 10, pts: [120] }, 200)).toEqual({ z1: 0, z2: 10, z3: 0, z4: 0, z5: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/engine exec vitest run src/hr.test.ts`
Expected: FAIL — `hrMaxBandSeconds` is not exported from `./hr`.

- [ ] **Step 3: Implement**

Append to `packages/engine/src/hr.ts`, directly below `zoneSeconds`:

```ts
/** The five %HRmax bands coaches prescribe against. */
export type HrMaxBand = 'z1' | 'z2' | 'z3' | 'z4' | 'z5';

/**
 * Seconds banked in each %HRmax band across a trace.
 *
 * DISPLAY ONLY, and deliberately separate from `zoneSeconds`. The three-zone
 * model above is what `conAdapt` divides by and what every prescription is
 * written in; this is coach-facing context for where a week's load actually
 * went. Nothing may read it as an instruction.
 *
 * Two rules differ from `zoneSeconds`, both on purpose:
 *
 *  - A beat under 50% of max is DROPPED, not banked. `zoneSeconds` banks
 *    sub-floor beats into Recovery because its total is a denominator;
 *    nothing divides by this one, and folding warm-up and rest drift into Z1
 *    would report easy time the athlete never spent there.
 *  - An absent trace returns zeroes rather than throwing. A session with no
 *    heart-rate recorded is unknown, not zero — the caller states that, and
 *    excludes such sessions rather than charting them flat.
 */
export function hrMaxBandSeconds(
  ds: Downsampled | null | undefined,
  maxHr: number,
): Record<HrMaxBand, number> {
  const out: Record<HrMaxBand, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (!ds || !Array.isArray(ds.pts) || !Number.isFinite(maxHr) || maxHr <= 0) return out;
  ds.pts.forEach((b) => {
    if (b == null || !Number.isFinite(b)) return;
    const pct = (b / maxHr) * 100;
    if (pct < 50) return;
    const band: HrMaxBand = pct < 60 ? 'z1' : pct < 70 ? 'z2' : pct < 80 ? 'z3' : pct < 90 ? 'z4' : 'z5';
    out[band] += ds.every;
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/engine exec vitest run src/hr.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Confirm nothing else regressed**

Run: `pnpm --filter @hybrid/engine exec vitest run`
Expected: PASS. `packages/engine/src/index.ts` already does `export * from './hr'`, so the new export surfaces to `@hybrid/engine` with no barrel edit.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/hr.ts packages/engine/src/hr.test.ts
git commit -m "Add five-zone %HRmax breakdown for the coach bench

Display-only and additive: the three-zone model still drives every
prescription and progression. Sub-50% beats are dropped rather than
banked into Z1, and an absent trace returns zeroes, because a session
with no HR recorded is unknown rather than zero."
```

---

### Task 2: The mockup stylesheet and the Command Center launcher

**Files:**
- Create: `apps/web/src/coach/coach-redesign.css`
- Rewrite: `apps/web/src/coach/CoachCommandCenter.tsx`
- Test: `apps/web/src/coach/CoachCommandCenter.test.tsx` (update in place)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the four pillar routes' link targets — `/coach/readiness`, `/coach/strength`, `/coach/conditioning`, `/coach/nutrition`. Tasks 3–6 build those screens; Task 7 registers them. **Until Task 7 lands these links 404** — that is expected and is why Task 7 is not optional.

- [ ] **Step 1: Extract the stylesheet**

Copy the mockup's entire `<style>` block into `apps/web/src/coach/coach-redesign.css`, minus the `:root { ... }` token block (those tokens already exist in `packages/design/src/tokens.css` and redeclaring them would fork the palette — verify each token the CSS references already exists there, and report any that does not rather than adding it silently).

Head the file with a comment recording where it came from:

```css
/*
 * The approved coach-workspace redesign, imported from its mockup rather
 * than retranslated into utility classes. See
 * docs/superpowers/specs/2026-08-11-coach-workspace-redesign-design.md for
 * why: translation is where the drift this redesign corrects came from.
 *
 * Tokens (--gold, --panel, --radius-lg …) are NOT declared here. They live
 * in packages/design/src/tokens.css and are the same tokens the athlete app
 * uses; this file only consumes them.
 */
```

- [ ] **Step 2: Write the failing test**

Replace the body of `apps/web/src/coach/CoachCommandCenter.test.tsx`, keeping its existing harness (`renderCommandCenter`, `FakeCoachWorkspaceRepository`, the `AthleteStatus` mock) and its existing intent. The roster-versus-local gating assertions must survive:

```tsx
  it('renders a tile per pillar, each linking to its own screen', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT];
    await renderCommandCenter(repo);

    expect(screen.getByRole('link', { name: /Readiness/ })).toHaveAttribute('href', '/coach/readiness');
    expect(screen.getByRole('link', { name: /Strength/ })).toHaveAttribute('href', '/coach/strength');
    expect(screen.getByRole('link', { name: /Conditioning/ })).toHaveAttribute('href', '/coach/conditioning');
    expect(screen.getByRole('link', { name: /Nutrition/ })).toHaveAttribute('href', '/coach/nutrition');
  });

  it('shows the signed-in athlete a real readiness band, not the mockup placeholder', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT];
    await renderCommandCenter(repo);

    const tile = screen.getByRole('link', { name: /Readiness/ });
    // A fresh DB has no WHOOP data, so the band is the engine's own
    // unknown state — never the mockup's hardcoded "Primed".
    expect(tile).not.toHaveTextContent('Primed');
  });

  it('switching clients swaps the tiles to that client to their own counts', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [ENGINE_LOCAL_CLIENT, ROSTER_CLIENT];
    repo.progressionProposals = [
      rosterProposal({ id: 'p1', domain: 'strength' }),
      rosterProposal({ id: 'p2', domain: 'conditioning', clientKey: 'row_erg', subject: 'Row erg' }),
    ];
    await renderCommandCenter(repo);

    // The mockup replaces the old chip strip with a <select>, so selection
    // is driven by changing it — not by clicking a chip that no longer
    // exists. Same behaviour asserted, new control.
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: /client/i }), {
        target: { value: ROSTER_CLIENT.id },
      });
    });

    expect(screen.getByRole('link', { name: /Strength/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Conditioning/ })).toHaveTextContent('1');
  });
```

Keep the existing test that asserts a roster client does **not** see the local athlete's records, adapting its selectors to the new markup. Do not delete it.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachCommandCenter.test.tsx`
Expected: FAIL — no tile links exist yet.

- [ ] **Step 4: Rewrite the Command Center**

Read the mockup's `<section id="view-command">` and `.rd-tile` CSS first. Then rewrite `CoachCommandCenter.tsx` to render, inside the existing providers and `isLocalClient` discipline:

1. The client selector (`.rd-client-row` / `.rd-select`) driving the **existing** `useCoachWorkspace()` selection state. It **replaces** the old roster chip strip — the mockup has one control, not two, so do not keep both. Selection behaviour must not regress: the existing client-switching test is updated to drive the `<select>` (see the test above), not deleted. Give the `<select>` an accessible name (`aria-label="Select client"`, as the mockup does) so it is reachable by role.
2. The identity row (`.rd-identity`): client name, program name, `Week N of M`.
3. The `.rd-tiles` grid of four `.rd-tile` elements. Each is a react-router `<Link>`, not a `<button>` — they navigate. Copy each tile's inline SVG icon verbatim from the mockup.

Tile status values, all from data already derived in this file today:

| Tile | Eyebrow | Status |
|---|---|---|
| Readiness | `Athlete state` | `athleteState.readiness.band` |
| Strength | `Specialist input` | `${strengthPending} pending` (roster: `rosterStrengthPending`) |
| Conditioning | `Specialist input` | `${conditioningPending} pending` (roster: `rosterConditioningPending`) |
| Nutrition | `Context engine` | `${nutritionReview.exceptions.length} exception(s)`, as the mockup's `.t-badge.warn` when non-zero |

Map the readiness band to the mockup's dot colours: a good band uses `var(--ok)`, a watch band `var(--warn)`, a low band `var(--bad)`, unknown `var(--dim)`.

Import the stylesheet at the top: `import './coach-redesign.css';`

Everything the old Command Center rendered below the tiles — the decision queue, the collapsed overview, the system rows — is **removed here and rebuilt in Tasks 3–6**. Do not leave it duplicated.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/CoachCommandCenter.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify the contract check still holds**

Run: `node checks/coach-contract.mjs`
Expected: all PASS, including "CoachCommandCenter's local-only sections stay behind isLocalClient".

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/coach/coach-redesign.css apps/web/src/coach/CoachCommandCenter.tsx apps/web/src/coach/CoachCommandCenter.test.tsx
git commit -m "Rebuild the Command Center as a four-tile launcher

Imports the approved mockup's stylesheet verbatim rather than
retranslating it. Tile status comes from real readiness bands, real
pending-proposal counts and real nutrition exceptions — never the
mockup's placeholder figures. Pillar links 404 until the routes land."
```

---

### Task 3: Readiness pillar

**Files:**
- Create: `apps/web/src/coach/pillars/PillarBack.tsx`
- Create: `apps/web/src/coach/pillars/Readiness.tsx`
- Test: `apps/web/src/coach/pillars/Readiness.test.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 beyond the stylesheet already imported.
- Produces: `export function PillarBack(): JSX.Element` — the `.rd-back` "← Command Center" link, reused by Tasks 4, 5 and 6.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { Readiness } from './Readiness';

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Readiness /></MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Readiness pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('asks for a WHOOP connection instead of inventing a recovery score', () => {
    // A fresh DB has no WHOOP data. The mockup shows 87%; showing that
    // number here would be a fabricated vital sign.
    renderPillar();
    expect(screen.getByRole('link', { name: /Connect WHOOP/i })).toBeInTheDocument();
    expect(screen.queryByText('87')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/Readiness.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PillarBack`**

```tsx
import { Link } from 'react-router-dom';

/** The mockup's `.rd-back` control, shared by all four pillar screens. */
export function PillarBack() {
  return (
    <Link to="/coach" className="rd-back">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      Command Center
    </Link>
  );
}
```

- [ ] **Step 4: Implement the Readiness screen**

Read the mockup's `<section id="view-readiness">` and its `.rd-hero`, `.rd-ring-*`, `.rd-band-*` and `.rd-card` CSS. Build:

1. `<PillarBack />`.
2. The `.rd-alert` pain-flag banner — rendered **only** when a pain flag is actually active in `athleteState`. Pain and illness outrank readiness scores in this system (`CLAUDE.md`), so it sits above the ring, exactly as the mockup places it.
3. The `.rd-hero` gauge: brass bezel, ticks, needle, and the recovery ring. Copy the SVG and its `brassBezel` gradient `<defs>` verbatim. Drive `stroke-dashoffset` from the real recovery percentage (circumference `452.4`, so `offset = 452.4 * (1 - pct/100)`), and the needle's rotation from the same value.
4. When there is no WHOOP data: hide the ring value, show the mockup's `.rd-connect` "Connect WHOOP" call to action. When the newest reading is older than today, show the `.rd-ring-note` stale line with its date.
5. The `.rd-band-wrap` band bar, its marker positioned from the real readiness band.
6. The `.rd-cards` grid of trend cards, from the stored WHOOP daily series (HRV, resting HR, sleep performance). A metric with no history renders its card with an explicit "not enough history yet" state rather than a flat zero line.

Source the readiness band and pain flag from `useDb()`'s `athleteState`, and the daily series from `db.settings.whoopDaily`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/Readiness.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/pillars/PillarBack.tsx apps/web/src/coach/pillars/Readiness.tsx apps/web/src/coach/pillars/Readiness.test.tsx
git commit -m "Add the Readiness pillar screen

With no WHOOP connected it asks for one rather than rendering the
mockup's placeholder 87%. The pain-flag banner sits above the score
because pain outranks readiness here."
```

---

### Task 4: Strength pillar

**Files:**
- Create: `apps/web/src/coach/pillars/Strength.tsx`
- Test: `apps/web/src/coach/pillars/Strength.test.tsx`

**Interfaces:**
- Consumes: `PillarBack` from Task 3. `liftTrends(sessions, today)` and `weeklyHardBudget(workouts, sessions, today, budgetTarget)` from `../trends`, plus `TrendSeries` and `HardBudget` types.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { Strength } from './Strength';

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Strength /></MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Strength pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('says the queue is empty rather than showing the mockup lifts', () => {
    // A fresh DB has no proposals. "Back squat 100 → 102.5" is mockup
    // furniture; shipping it would invent a decision the coach never made.
    renderPillar();
    expect(screen.queryByText(/Back squat/)).not.toBeInTheDocument();
    expect(screen.getByText(/no .*(proposal|decision)/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/Strength.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Read the mockup's `<section id="view-strength">` and its `.rd-queue`, `.qi-*`, `.rd-section-label`, `.rd-panel` and `.rd-loadbar` CSS. Build, in the mockup's order:

1. `<PillarBack />`.
2. `.rd-queue` — the progression queue, from the same real pending strength proposals `CoachProgression` reads today. Each `.rd-queue-item` shows the lift, a `.qi-badge` (`approval` / `hold` / `review`) from the proposal's own state, the `before → after` change, and the confidence detail line. With no proposals, render an explicit empty state.
3. `.rd-cards` — lift trend cards from `liftTrends`. Reuse the existing sparkline approach in `apps/web/src/coach/AthleteStatus.tsx` rather than writing a second one.
4. `.rd-panel` — the weekly hard-session budget bar from `weeklyHardBudget`, with the mockup's explanatory note about what counts as hard and that the ceiling is a cap, not a target.

Approving a proposal must route through the **existing** decision path, not a new one — the Coordinator remains the only writer of a weekly plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/Strength.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/pillars/Strength.tsx apps/web/src/coach/pillars/Strength.test.tsx
git commit -m "Add the Strength pillar screen

Real pending proposals, real lift trends, real hard-session budget. An
empty queue says so rather than showing the mockup's example lifts."
```

---

### Task 5: Conditioning pillar

**Files:**
- Create: `apps/web/src/coach/pillars/Conditioning.tsx`
- Test: `apps/web/src/coach/pillars/Conditioning.test.tsx`

**Interfaces:**
- Consumes: `PillarBack` (Task 3); `hrMaxBandSeconds` and `HrMaxBand` from `@hybrid/engine` (Task 1); `conMaxHr` from `@hybrid/engine`; `ergTrend(results)` from `../trends`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { Conditioning } from './Conditioning';

function renderPillar() {
  return render(
    <DbProvider>
      <MemoryRouter><Conditioning /></MemoryRouter>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Conditioning pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('shows no zone minutes at all when nothing has been logged', () => {
    // A fresh DB has no sessions. The mockup's 62m/40m/18m split is
    // furniture; rendering it would invent training that never happened.
    renderPillar();
    expect(screen.queryByText('62m')).not.toBeInTheDocument();
    expect(screen.queryByText('40m')).not.toBeInTheDocument();
    expect(screen.queryByText('18m')).not.toBeInTheDocument();
  });

  it('names how many sessions the HR donut had to exclude', () => {
    // The five-zone breakdown only covers sessions that stored a trace.
    // A session without one is unknown, not zero, and the screen must say
    // so rather than quietly charting a smaller week.
    renderPillar();
    expect(screen.getByText(/recorded heart rate|no heart-rate|excluded/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/Conditioning.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Read the mockup's `<section id="view-conditioning">` and its `.rd-hero-cond`, `.rd-cond-split`, `.rd-zone-bar`, `.rd-donut*` CSS. Build:

1. `<PillarBack />`.
2. `.rd-queue` — real pending **conditioning** proposals, same component shape as Task 4's queue.
3. `.rd-hero-cond`, which the mockup splits in two:
   - **Left** — total logged minutes this week, and the three-bucket Easy/Moderate/Hard `.rd-zone-bar` summed from each session's `condResult.zsec`. This is the app's real three-zone model.
   - **Right** — the five-zone `%HRmax` donut. For each of the week's sessions call `hrMaxBandSeconds(session.condResult?.trace, conMaxHr(db.core?.profile))` and sum per band. Render the arcs from those sums and the legend from the band names and ranges.
4. The donut renders **only** sessions that actually stored a trace. State that in the panel note, and say how many sessions are excluded when any are. A session without HR is unknown, never zero.
5. `.rd-cards` — erg trend cards from `ergTrend`.

Do not compute band edges in this component; `hrMaxBandSeconds` owns them.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/Conditioning.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/coach/pillars/Conditioning.tsx apps/web/src/coach/pillars/Conditioning.test.tsx
git commit -m "Add the Conditioning pillar screen

The three-bucket bar is the app's real zone model; the five-zone donut
is computed from stored HR traces via the engine, and says which
sessions it excludes rather than charting them as zero."
```

---

### Task 6: Nutrition pillar, replacing CoachNutrition

**Files:**
- Create: `apps/web/src/coach/pillars/Nutrition.tsx`
- Test: `apps/web/src/coach/pillars/Nutrition.test.tsx`
- Delete: `apps/web/src/coach/CoachNutrition.tsx` (and its colocated test, if one exists)

**Interfaces:**
- Consumes: `PillarBack` (Task 3); the nutrition adapter reads and `buildCoachNutritionReview` that `CoachNutrition.tsx` uses today.
- Produces: nothing consumed later.

- [ ] **Step 1: Read what is being replaced**

Read `apps/web/src/coach/CoachNutrition.tsx` in full and list every real data source it uses. The pillar must not lose a reading — it rearranges them into the mockup's layout. Report anything it shows that the mockup has no place for, rather than dropping it silently.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DbProvider } from '../../store/db';
import { NutritionProvider } from '../../store/nutrition';
import { Nutrition } from './Nutrition';

function renderPillar() {
  return render(
    <DbProvider>
      <NutritionProvider>
        <MemoryRouter><Nutrition /></MemoryRouter>
      </NutritionProvider>
    </DbProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('Nutrition pillar', () => {
  it('offers a way back to the Command Center', () => {
    renderPillar();
    expect(screen.getByRole('link', { name: /Command Center/ })).toHaveAttribute('href', '/coach');
  });

  it('reports unlogged days as unlogged, not as zero-calorie days', () => {
    renderPillar();
    expect(screen.getByText(/0 of 7|unlogged|no days logged/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/Nutrition.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Read the mockup's `<section id="view-nutrition">` and its `.rd-panel-grid`, `.rd-metric`, `.rd-macro-bars`, `.rd-weight-row` CSS. Build:

1. `<PillarBack />`.
2. The `.rd-alert` unlogged-days banner when any day this week has no entries, carrying the mockup's exact point: unlogged means unknown, never zero, and the averages below exclude those days rather than treating them as zero-calorie.
3. `.rd-panel-grid` — days logged, weigh-in coverage, estimate confidence, and the three macro progress bars.
4. `.rd-panel` — the weight trend: latest weight, weekly rate, and the sparkline.

This screen is read-only. Nutrition is context here and never writes to training.

**Accepted regression, decided 11 August 2026.** `CoachNutrition` served roster
clients through a real layer-3 backend (`getNutritionSummary`). The pillar
reads local stores only, so roster clients are blocked by `ClientDetailGate`
rather than shown a summary. This is a deliberate, owner-approved capability
loss taken to ship Stage 1, not an oversight — restoring roster nutrition is
future work. Do not silently re-add the roster branch, and do not "fix" the
block: it is the agreed behaviour. Note it in your report.

- [ ] **Step 5: Delete the screen it replaces**

```bash
git rm apps/web/src/coach/CoachNutrition.tsx
```

Remove its import from `apps/web/src/coach/index.tsx`. Task 7 points the route at the pillar.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/pillars/`
Expected: PASS, all four pillar suites.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/coach/pillars/Nutrition.tsx apps/web/src/coach/pillars/Nutrition.test.tsx apps/web/src/coach/index.tsx
git commit -m "Replace CoachNutrition with the Nutrition pillar

Same readings, the mockup's layout. Unlogged days stay unlogged rather
than being averaged in as zero."
```

---

### Task 7: Route the pillars and retire /coach/progression

**Files:**
- Modify: `apps/web/src/coach/index.tsx`
- Delete: `apps/web/src/coach/CoachProgression.tsx` (and its colocated test, if one exists)
- Test: `apps/web/src/coach/coach-routes.test.tsx` (create)

**Interfaces:**
- Consumes: all four pillar components (Tasks 3–6).
- Produces: the routes the Task 2 tiles link to. **This task is what makes those links work.**

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The pillar screens read the SIGNED-IN athlete's own stores, exactly like
 * legacy/build/planner. Without ClientDetailGate a coach would see their own
 * records under a roster client's name — the failure ClientDetailGate.tsx's
 * own header comment exists to prevent. Asserted statically because the
 * router is a lazy chunk, matching how checks/coach-contract.mjs proves the
 * same property for the routes that already have it.
 */
describe('coach pillar routes', () => {
  const src = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');

  it.each(['readiness', 'strength', 'conditioning', 'nutrition'])(
    'wraps /coach/%s in ClientDetailGate',
    (path) => {
      const re = new RegExp(`path="${path}"[^>]*element=\\{<ClientDetailGate\\b`);
      expect(src).toMatch(re);
    },
  );

  it('keeps /coach/progression reachable as a redirect rather than a dead link', () => {
    expect(src).toMatch(/path="progression"[^>]*element=\{<Navigate to="\/coach\/strength"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/web exec vitest run src/coach/coach-routes.test.tsx`
Expected: FAIL — no pillar routes registered.

- [ ] **Step 3: Register the routes**

In `apps/web/src/coach/index.tsx`, inside the existing `<Route element={<ArcCoachFrame />}>` block, add:

```tsx
<Route path="readiness" element={<ClientDetailGate tool="Readiness"><Readiness /></ClientDetailGate>} />
<Route path="strength" element={<ClientDetailGate tool="Strength"><Strength /></ClientDetailGate>} />
<Route path="conditioning" element={<ClientDetailGate tool="Conditioning"><Conditioning /></ClientDetailGate>} />
<Route path="nutrition" element={<ClientDetailGate tool="Nutrition"><Nutrition /></ClientDetailGate>} />
```

Note these use `ClientDetailGate` **without** `layer3Ready`: they read local `useDb()` stores, so a roster client must be blocked, not merely warned — the same reasoning the file's existing comment gives for `legacy` / `build` / `planner`. Read that comment before deciding otherwise.

Replace the old `progression` route with a redirect, and delete its import:

```tsx
<Route path="progression" element={<Navigate to="/coach/strength" replace />} />
```

- [ ] **Step 4: Delete the retired screen**

```bash
git rm apps/web/src/coach/CoachProgression.tsx
```

Confirm nothing still imports it: `grep -rn "CoachProgression" apps/web/src` should return nothing.

- [ ] **Step 5: Run the full suite and the contract checks**

```bash
pnpm --filter @hybrid/web exec tsc --noEmit -p .
pnpm --filter @hybrid/web exec vitest run
node checks/coach-contract.mjs
```
Expected: all clean. If `coach-contract.mjs` flags a route-leak on the new files, read its rule 8 before changing the check — a genuine leak is a bug in the screen, not in the check.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/coach/index.tsx apps/web/src/coach/coach-routes.test.tsx
git commit -m "Route the four pillar screens and retire /coach/progression

Each pillar reads the signed-in athlete's own stores, so each sits
behind ClientDetailGate like legacy/build/planner. /coach/progression
redirects to Strength rather than 404ing; its conditioning half now
lives on the Conditioning pillar."
```

---

### Task 8: Phone verification and the CLAUDE.md boundary

**Files:**
- Modify: `checks/screens.mjs`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: all routes from Task 7.
- Produces: nothing consumed later. This is the task that makes the phone claim checkable.

- [ ] **Step 1: Add the stage-1 coach routes to the screenshot check**

Read `checks/screens.mjs`. It currently shoots the athlete app at 420px only. Add the five stage-1 coach routes — `/coach`, `/coach/readiness`, `/coach/strength`, `/coach/conditioning`, `/coach/nutrition` — to its route list, at the same 420px viewport.

The check must fail on horizontal overflow: a coach screen that needs sideways scrolling on a phone is the exact regression this is here to catch.

- [ ] **Step 2: Run it and fix what it finds**

Run: `node checks/screens.mjs`
Expected: PASS with no horizontal overflow at 420px on all five routes. Where the mockup's own responsive rules do not cover a case, fix the CSS in `coach-redesign.css` and report what needed adding beyond the approved design.

- [ ] **Step 3: Rewrite the CLAUDE.md boundary**

`CLAUDE.md`'s section "The coach workspace is desktop-first, mobile is open for exploration" is now false: a phone layout has been approved and shipped. Rewrite it in the same style as the amendments already in that file — state what changed, what the new boundary is, and keep the principle that motivated the old rule.

It must now say:
- Phone is a **supported** viewport for `/coach`, approved 11 August 2026, with the redesign spec named.
- `1440px` remains the width the layouts are composed at.
- The stage-1 routes are covered by `checks/screens.mjs` at 420px; Library and Settings join as their stages land.
- Any screen that genuinely cannot work at phone width is named explicitly with its reason — not left implied.

Do not delete the section's history. Amend it the way the nutrition and coach-workspace sections above it were amended.

- [ ] **Step 4: Verify the whole tree**

```bash
pnpm run typecheck
pnpm run test
pnpm run check:ecosystem
node checks/coach-contract.mjs
node checks/screens.mjs
pnpm --filter @hybrid/web build
```
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add checks/screens.mjs CLAUDE.md
git commit -m "Cover coach routes at phone width and correct the CLAUDE.md boundary

The desktop-only rule stopped being true when the phone layout was
approved; leaving it standing is what that section itself warns
against. screens.mjs now shoots the stage-1 coach routes at 420px, so
a phone regression fails a check instead of being found by hand."
```

- [ ] **Step 6: The device gate**

Stage 1 is not complete until the owner has opened these five screens on a real Android phone and confirmed they match the mockup. Every automated check above passed on the night the shipped app was, in fact, wrong — that is why this gate is written into the plan rather than assumed.

Do not begin Stage 2 before this confirmation.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Mockup's stylesheet shipped verbatim | 2 |
| Command Center becomes a four-tile launcher | 2 |
| Four pillar screens | 3, 4, 5, 6 |
| Real data behind every number | 2–6 |
| Five-zone donut built for real, in the engine, additive | 1, 5 |
| Donut covers only HR-recorded sessions | 1 (returns zeroes), 5 (states exclusions) |
| `ClientDetailGate` on every pillar route | 7 |
| `isLocalClient` gating preserved | 2 |
| Pain flag above the readiness score | 3 |
| Nutrition stays context-only | 6 |
| Coordinator remains sole plan writer | 4 |
| `/coach/nutrition` replaced in place | 6, 7 |
| `/coach/progression` redirects to Strength | 7 |
| Phone supported and checked | 8 |
| `CLAUDE.md` boundary rewritten | 8 |
| Colocated tests | every task |
| Device gate before the next stage | 8 |

No gaps.

**Placeholder scan:** No "TBD", "handle edge cases", or "write tests for the above". Every code step carries real code or a concrete instruction naming the file, the data source and the rule it must honour. Steps that intentionally defer to the mockup say so explicitly and name the section to read — that is a pointer to the specification, not a placeholder.

**Type consistency:** `hrMaxBandSeconds(ds, maxHr): Record<HrMaxBand, number>` is defined in Task 1 and consumed under that exact name and signature in Task 5. `PillarBack` is defined in Task 3 and consumed in Tasks 4–6. `liftTrends`, `ergTrend`, `weeklyHardBudget` are named as they are exported from `apps/web/src/coach/trends.ts`. Route paths in Task 2's tiles (`/coach/readiness|strength|conditioning|nutrition`) match Task 7's registrations exactly.

## Out of scope for Stage 1

Settings (Stage 2), Library (Stage 3), and the responsive close-out over those two (Stage 4). Each gets its own plan, written when its stage begins so it can account for what Stage 1 taught.
