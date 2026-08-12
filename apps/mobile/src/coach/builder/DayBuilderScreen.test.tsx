import { act, fireEvent, screen } from '@testing-library/react-native';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { liftWorkout, renderScreen, seed } from '../../../test/harness';
import { storage } from '../../store/storage';
import { DayBuilderScreen } from './DayBuilderScreen';

/*
 * The screen wrapper's own contract, over and above DayBuilder.test.tsx's:
 * loading the day, persisting a save, editing rather than duplicating, the
 * honesty of the publish notice, and the pick flow seeding a COPY.
 */

const DATE = '2026-08-11';

/** DbProvider coalesces writes for 400ms; this beats the debounce to disk. */
const flushSave = () => act(() => jest.advanceTimersByTime(500));

const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

describe('DayBuilderScreen', () => {
  it('a day with nothing on it opens empty', () => {
    seed({});
    renderScreen(<DayBuilderScreen />, { date: DATE });
    expect(screen.getByText('Nothing on this day yet — add a block to start.')).toBeTruthy();
    // A date param means dated mode: Publish, not Save to library.
    expect(screen.getByText('Publish session')).toBeTruthy();
    expect(screen.queryByText('Save to library')).toBeNull();
  });

  it('no date param means library mode', () => {
    seed({});
    // `{}` and not nothing: params put the screen inside a real navigator,
    // which useRoute requires — the app never mounts this screen bare either.
    renderScreen(<DayBuilderScreen />, {});
    expect(screen.getByText('Save to library')).toBeTruthy();
    expect(screen.queryByText('Publish session')).toBeNull();
  });

  it('what is typed survives a save and a remount', () => {
    seed({});
    const first = renderScreen(<DayBuilderScreen />, { date: DATE });
    fireEvent.changeText(screen.getByLabelText('Coach instructions'), 'Heavy triples, long rests');
    fireEvent.press(screen.getByText('Publish session'));
    flushSave();
    first.unmount();

    // A fresh mount loads from the store, exactly as reopening the day would.
    renderScreen(<DayBuilderScreen />, { date: DATE });
    expect(screen.getByDisplayValue('Heavy triples, long rests')).toBeTruthy();
  });

  it('saving twice edits ONE session rather than stacking duplicates', () => {
    seed({});
    renderScreen(<DayBuilderScreen />, { date: DATE });
    fireEvent.changeText(screen.getByLabelText('Coach instructions'), 'First draft');
    fireEvent.press(screen.getByText('Publish session'));
    flushSave();
    fireEvent.changeText(screen.getByLabelText('Coach instructions'), 'Second draft');
    fireEvent.press(screen.getByText('Publish session'));
    flushSave();

    const onDay = persisted().workouts.filter((w) => w.dates?.includes(DATE));
    expect(onDay).toHaveLength(1);
  });

  it('the publish notice does not claim an athlete was sent anything', () => {
    seed({});
    renderScreen(<DayBuilderScreen />, { date: DATE });
    fireEvent.press(screen.getByText('Publish session'));

    // The whole notice, so a rewording that starts overclaiming fails here.
    expect(
      screen.getByText(
        `Saved and scheduled for ${DATE}. Sending it to a roster athlete is a separate step and has not happened.`,
      ),
    ).toBeTruthy();
    // And the negative claim directly: nothing on screen says "sent".
    expect(screen.queryByText(/\bsent\b/i)).toBeNull();
  });

  it('the pick flow seeds a COPY and leaves the original untouched', () => {
    const src = { ...liftWorkout('Back squat'), id: 'src-1', name: 'Lower A' };
    seed({ workouts: [src] });
    renderScreen(<DayBuilderScreen />, { date: '2026-08-12', pick: true });

    // The picker, not the editor.
    expect(screen.getByText('Lower A')).toBeTruthy();
    fireEvent.press(screen.getByText('Lower A'));

    // Choosing one re-renders the editor seeded with the copy.
    expect(screen.getByText('Back squat')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Coach instructions'), 'Tweaked for today');
    fireEvent.press(screen.getByText('Publish session'));
    flushSave();

    const db = persisted();
    // The day got its own record, under its own id — never the source's.
    const onDay = db.workouts.filter((w) => w.dates?.includes('2026-08-12'));
    expect(onDay).toHaveLength(1);
    expect(onDay[0].id).not.toBe('src-1');

    // The original: still there, not scheduled, and none of the edit reached it.
    const original = db.workouts.find((w) => w.id === 'src-1');
    expect(original).toBeTruthy();
    expect(original?.dates ?? []).not.toContain('2026-08-12');
    expect(
      (original?.blocks ?? []).some((b) => (b as { kind?: string }).kind === 'text'),
    ).toBe(false);
    // Its sets kept the coach's original prescription.
    const sets = original?.blocks?.[0]?.exercises?.[0]?.sets ?? [];
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.t === '5')).toBe(true);
  });

  /*
   * ADDED after the port, because nothing covered it: stripping every
   * `deletedIds` line from the screen left all six tests above passing.
   *
   * The property is the whole reason the tombstone is written. Removing a
   * day's last conditioning block must delete its conditioning SIBLING — a
   * separate workout, because sanitizeDB splits a mixed one — and record the
   * deletion, or `mergeEngines` lets the server's copy back in on the next
   * pull and the coach finds a session they cannot see or open sitting on
   * their calendar.
   */
  it('removing the last conditioning block deletes its sibling AND tombstones it', () => {
    const day = '2026-08-13';
    seed({
      workouts: [
        { id: 'day-1', name: 'Lower A', kind: 'strength', dates: [day], blocks: [], updatedAt: 1 },
        {
          id: 'day-1-cond',
          name: 'Lower A — Conditioning',
          kind: 'conditioning',
          dates: [day],
          updatedAt: 1,
          blocks: [{ id: 'c0', kind: 'conditioning', heading: 'Conditioning', condFmt: 'steady' }],
        },
      ],
    });

    renderScreen(<DayBuilderScreen />, { date: day });
    // Both siblings opened as ONE day, so the conditioning block is here.
    fireEvent.press(screen.getByLabelText('Remove block'));
    fireEvent.press(screen.getByText('Publish session'));
    flushSave();

    const db = persisted();
    expect(db.workouts.find((w) => w.id === 'day-1-cond')).toBeUndefined();
    // Gone is not enough — it has to STAY gone across a merge.
    expect(db.settings.deletedIds?.['day-1-cond']).toEqual(expect.any(Number));
    // The strength half is untouched and still on the day.
    expect(db.workouts.find((w) => w.id === 'day-1')?.dates).toContain(day);
  });
});
