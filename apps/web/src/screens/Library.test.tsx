// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { LS_KEY, type EngineDB, type Workout } from '@hybrid/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DbProvider } from '../store/db';
import { Library } from './Library';

/*
 * "Clear all sessions" empties the library in one move.
 *
 * The half that actually matters is the TOMBSTONES. A bulk delete that only
 * emptied `db.workouts` would look correct on this device and then quietly
 * refill from the next sync — `mergeEngines` restores any record the remote
 * still has unless its id is tombstoned, which is the exact failure the
 * single-workout `removeWorkout` path already carries a comment about. So the
 * second test here is not a nicety: without it, the feature is a bug that
 * takes a device round trip to notice.
 *
 * Logged sessions are asserted untouched because clearing the library is a
 * statement about the PROGRAMME, not about training that happened.
 */

function workout(id: string, name: string): Workout {
  return { id, name, kind: 'strength', blocks: [], days: [], updatedAt: 1 } as unknown as Workout;
}

function seed(workouts: Workout[]) {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      workouts,
      sessions: [{ id: 's1', workoutId: 'w1', date: '2026-08-01', sets: [] }],
      settings: {},
    } as unknown as EngineDB),
  );
}

function renderLibrary() {
  return render(
    <MemoryRouter>
      <DbProvider>
        <Library />
      </DbProvider>
    </MemoryRouter>,
  );
}

function storedDb(): EngineDB {
  return JSON.parse(localStorage.getItem(LS_KEY) || '{}') as EngineDB;
}

beforeEach(() => {
  localStorage.clear();
});

describe('Library — clear all sessions', () => {
  it('names the real count and requires a second press before deleting', () => {
    seed([workout('w1', 'Hinge/Press'), workout('w2', 'Squat/Vertical Pull')]);
    renderLibrary();

    const button = screen.getByRole('button', { name: /clear all 2 sessions/i });
    fireEvent.click(button);

    // Armed, not fired: one press must never be enough to empty a library.
    expect(storedDb().workouts).toHaveLength(2);
    expect(screen.getByRole('button', { name: /really delete all 2\?/i })).toBeInTheDocument();
  });

  it('tombstones every id it removes, so a sync cannot resurrect them', () => {
    seed([workout('w1', 'Hinge/Press'), workout('w2', 'Squat/Vertical Pull')]);
    renderLibrary();

    fireEvent.click(screen.getByRole('button', { name: /clear all 2 sessions/i }));
    fireEvent.click(screen.getByRole('button', { name: /really delete all 2\?/i }));

    const db = storedDb();
    expect(db.workouts).toHaveLength(0);
    expect(Object.keys(db.settings.deletedIds || {})).toEqual(expect.arrayContaining(['w1', 'w2']));
  });

  it('leaves logged sessions alone — the programme goes, the training stays', () => {
    seed([workout('w1', 'Hinge/Press')]);
    renderLibrary();

    fireEvent.click(screen.getByRole('button', { name: /clear all 1 session/i }));
    fireEvent.click(screen.getByRole('button', { name: /really delete all 1\?/i }));

    expect(storedDb().sessions).toHaveLength(1);
  });

  it('offers nothing to clear when the library is already empty', () => {
    seed([]);
    renderLibrary();

    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
  });
});
