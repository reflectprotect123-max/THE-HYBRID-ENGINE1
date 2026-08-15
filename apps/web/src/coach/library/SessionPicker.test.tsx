// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { DayBuilderRoute } from './DayBuilderRoute';

/*
 * The Calendar's "Add from library" used to open an EMPTY builder — the same
 * thing "Create session" did, under a label promising something else. This is
 * Stage 3c's Sessions, reached the way it is actually useful.
 */

const DATE = '2026-08-20';

function seed(workouts: unknown[]) {
  localStorage.setItem(LS_KEY, JSON.stringify({ workouts }));
}

function renderPicker() {
  return render(
    <DbProvider>
      <MemoryRouter initialEntries={[`/coach/day/${DATE}?pick=1`]}>
        <Routes>
          <Route path="/coach/day/:date" element={<DayBuilderRoute mode="dated" />} />
          <Route path="/coach/library" element={<p>library</p>} />
        </Routes>
      </MemoryRouter>
    </DbProvider>,
  );
}

const HEAVY_PULL = {
  id: 'w-pull',
  name: 'Heavy Pull',
  kind: 'strength',
  updatedAt: 2,
  blocks: [{
    id: 'b0',
    heading: 'Strength/Power',
    exercises: [{ id: 'e0', name: 'Deadlift', mode: 'reps_kg', cols: { a: 'reps', b: 'weight_kg' }, sets: [{ t: '', rpe: '', aVal: '3', aVal2: '140' }] }],
  }],
};

describe('SessionPicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers the sessions the coach has written', async () => {
    seed([HEAVY_PULL, { id: 'w-row', name: 'Easy Row', updatedAt: 1, blocks: [{ id: 'b0', heading: 'Conditioning', exercises: [] }] }]);
    renderPicker();
    expect(screen.getByRole('button', { name: /Heavy Pull/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Easy Row/ })).toBeInTheDocument();
  });

  it('says so, and offers a way forward, when there is nothing to pick', async () => {
    seed([]);
    renderPicker();
    expect(screen.getByText(/have not written any sessions yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /build this day from scratch/i })).toBeInTheDocument();
  });

  it('opens the builder carrying the picked session, not an empty day', async () => {
    seed([HEAVY_PULL]);
    renderPicker();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Heavy Pull/ }));
    });

    // The builder, seeded: the picked session's exercise is IN THE BLOCK and
    // the empty-day message is gone.
    //
    // Scoped to `.cb-block-items` since 16 August 2026. The exercise picker is
    // mounted at every width now — it has to be, or a coach on a desktop
    // cannot add anything — and it lists 'Deadlift' as something you COULD
    // add. An unscoped query matches the offer as well as the fact, and would
    // pass against a day the picked session never reached.
    expect(screen.queryByText(/nothing on this day yet/i)).not.toBeInTheDocument();
    const items = document.querySelector('.cb-block-items') as HTMLElement;
    expect(within(items).getByText('Deadlift')).toBeInTheDocument();
  });

  it('copies rather than links — saving the day leaves the original session alone', async () => {
    seed([HEAVY_PULL]);
    renderPicker();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Heavy Pull/ }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Coach instructions'), { target: { value: 'Day-specific note' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /publish session/i }));
    });

    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as { workouts: { id: string; blocks: { body?: string }[] }[] };
    const original = stored.workouts.find((w) => w.id === 'w-pull')!;
    // The original gained nothing: no instructions note, no date.
    expect(JSON.stringify(original)).not.toContain('Day-specific note');
    expect(stored.workouts.some((w) => w.id !== 'w-pull' && JSON.stringify(w).includes('Day-specific note'))).toBe(true);
  });

  it('lets the coach back out and build the day from scratch', async () => {
    seed([HEAVY_PULL]);
    renderPicker();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /build this day from scratch/i }));
    });
    expect(screen.getByText(/nothing on this day yet/i)).toBeInTheDocument();
  });
});
