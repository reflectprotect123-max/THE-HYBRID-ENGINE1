// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LS_KEY } from '@hybrid/engine';
import { DbProvider } from '../../store/db';
import { DayBuilderRoute } from './DayBuilderRoute';

/*
 * The regression this file exists for: until 12 August 2026 both of this
 * screen's buttons were stubs, so a coach could build an entire session and
 * lose every word of it by navigating away. A test that only asserts the
 * buttons render would have passed the whole time — so each test below either
 * REMOUNTS the screen or reads the store back, and none of them trusts what is
 * on screen before the save.
 */

const DATE = '2026-08-14';

function renderDay() {
  return render(
    <DbProvider>
      <MemoryRouter initialEntries={[`/coach/day/${DATE}`]}>
        <Routes>
          <Route path="/coach/day/:date" element={<DayBuilderRoute mode="dated" />} />
          <Route path="/coach/library" element={<p>library</p>} />
        </Routes>
      </MemoryRouter>
    </DbProvider>,
  );
}

async function typeInstructions(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Coach instructions'), { target: { value: text } });
  });
}

async function publish() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /publish session/i }));
  });
}

describe('DayBuilderRoute', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps what the coach wrote after the screen is closed and reopened', async () => {
    const first = renderDay();
    await typeInstructions('Ease into it. Stop the top set if the bar slows.');
    await publish();
    first.unmount();

    renderDay();
    expect(screen.getByLabelText('Coach instructions')).toHaveValue('Ease into it. Stop the top set if the bar slows.');
  });

  it('keeps the blocks too, not only the instructions', async () => {
    const first = renderDay();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    });
    await publish();
    first.unmount();

    renderDay();
    expect(screen.queryByText(/nothing on this day yet/i)).not.toBeInTheDocument();
  });

  it('opens empty for a day with nothing on it', async () => {
    renderDay();
    expect(screen.getByLabelText('Coach instructions')).toHaveValue('');
    expect(screen.getByText(/nothing on this day yet/i)).toBeInTheDocument();
  });

  it('edits the same session on a second save instead of stacking duplicates', async () => {
    const first = renderDay();
    await typeInstructions('First version');
    await publish();
    await typeInstructions('Second version');
    await publish();
    first.unmount();

    renderDay();
    expect(screen.getByLabelText('Coach instructions')).toHaveValue('Second version');
    // One session for the day, not two — a duplicate would show up here as a
    // second stored workout carrying the same date.
    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as { workouts?: { dates?: string[] }[] };
    expect((stored.workouts ?? []).filter((w) => w.dates?.includes(DATE))).toHaveLength(1);
  });

  it('does not claim to have sent anything to an athlete', async () => {
    // Publish writes to the coach's own calendar. `publishWorkoutDraft` — the
    // path that actually reaches a roster athlete — needs a client and a draft
    // base version this route does not have, so the notice must not imply it.
    renderDay();
    await typeInstructions('Anything');
    await publish();

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/saved and scheduled/i);
    expect(notice).toHaveTextContent(/has not happened/i);
  });
});
