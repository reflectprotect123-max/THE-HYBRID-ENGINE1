// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CatalogueEntry } from '@hybrid/engine';
import { DayBuilder } from './DayBuilder';

const entries: CatalogueEntry[] = [{ name: 'Back Squat', tags: ['Barbell'], uses: 2 }];

function renderDay(over: Partial<Parameters<typeof DayBuilder>[0]> = {}) {
  const props = {
    mode: 'dated' as const,
    date: '2026-08-11',
    published: false,
    entries,
    onPublish: vi.fn(),
    onSave: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
  render(<DayBuilder {...props} />);
  return props;
}

describe('DayBuilder — dated mode', () => {
  it('heads with the day, in the mockup format', () => {
    renderDay();
    expect(screen.getByText('Tuesday, August 11')).toBeInTheDocument();
    expect(screen.getByText('2026-08-11')).toBeInTheDocument();
  });

  it('shows the published status', () => {
    renderDay();
    expect(screen.getByText(/unpublished/i)).toBeInTheDocument();
  });

  it('says Published once it is', () => {
    renderDay({ published: true });
    expect(screen.getByText(/^published$/i)).toBeInTheDocument();
  });

  it('offers Publish session', () => {
    const props = renderDay();
    fireEvent.click(screen.getByRole('button', { name: /publish session/i }));
    expect(props.onPublish).toHaveBeenCalled();
  });

  /*
   * publishWorkoutDraft takes a PREFERRED start date and PREFERRED weekdays and
   * routes through Coordinator placement. A dated heading beside a Publish
   * button implies a placement the coach has not made, and CoachAuthoring
   * already refuses to blur this ("preferences are not resolved calendar
   * positions"). The Calendar must not contradict its sibling screen.
   */
  it('says the date is a preference, not a placement', () => {
    renderDay();
    expect(screen.getByText(/preferred day/i)).toBeInTheDocument();
    expect(screen.getByText(/Coordinator/i)).toBeInTheDocument();
  });

  it('disables Add new session and says why', () => {
    renderDay();
    expect(screen.getByRole('button', { name: /add new session/i })).toBeDisabled();
    expect(screen.getByText(/for now this day holds one/i)).toBeInTheDocument();
  });

  it('goes back to the calendar', () => {
    const props = renderDay();
    fireEvent.click(screen.getByRole('button', { name: /back to calendar/i }));
    expect(props.onBack).toHaveBeenCalled();
  });
});

describe('DayBuilder — library mode', () => {
  it('shows no date, no status and no Publish', () => {
    renderDay({ mode: 'library', date: undefined });
    expect(screen.queryByText(/August 11/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unpublished/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish session/i })).not.toBeInTheDocument();
  });

  it('saves to the library instead', () => {
    const props = renderDay({ mode: 'library', date: undefined });
    fireEvent.click(screen.getByRole('button', { name: /save to library/i }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('makes no placement claim, because it has no date to claim about', () => {
    renderDay({ mode: 'library', date: undefined });
    expect(screen.queryByText(/preferred day/i)).not.toBeInTheDocument();
  });
});

describe('DayBuilder — both modes', () => {
  it('takes coach instructions', () => {
    renderDay();
    expect(screen.getByLabelText(/coach instructions/i)).toBeInTheDocument();
    renderDay({ mode: 'library', date: undefined });
    expect(screen.getAllByLabelText(/coach instructions/i).length).toBeGreaterThan(0);
  });

  it('adds and removes blocks', () => {
    renderDay();
    expect(screen.queryByText('BLOCK 01')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    expect(screen.getByText('BLOCK 01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove block/i }));
    expect(screen.queryByText('BLOCK 01')).not.toBeInTheDocument();
  });

  it('renumbers the remaining blocks after one is removed', () => {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    expect(screen.getByText('BLOCK 02')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /remove block/i })[0]);
    expect(screen.getByText('BLOCK 01')).toBeInTheDocument();
    expect(screen.queryByText('BLOCK 02')).not.toBeInTheDocument();
  });

  it('says the day is empty rather than showing a bare panel', () => {
    renderDay();
    expect(screen.getByText(/nothing on this day yet/i)).toBeInTheDocument();
  });
});

describe('starting from a session template', () => {
  it('offers the templates on an empty day and lays out their sections', () => {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /hybrid — two strength pieces/i }));
    expect(screen.getByText('BLOCK 06')).toBeInTheDocument();
    /* The NAME is what each block head says, so six sections are told apart
       while they are all still closed. */
    expect(screen.getByText('STRENGTH INTENSITY 1')).toBeInTheDocument();
    expect(screen.getByText('STRENGTH INTENSITY 2')).toBeInTheDocument();
    expect(screen.getByText('FINISHER')).toBeInTheDocument();
  });

  it('lays its sections down CLOSED', () => {
    /* Six sections each opening onto its own exercise library is a 7,600px
       page before the coach has chosen a single movement. A block added one at
       a time still opens expanded — see `BlockEditor`'s `startCollapsed`. */
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /hybrid — two strength pieces/i }));
    expect(screen.queryByLabelText('Section name')).not.toBeInTheDocument();
    /* And every one of them can be opened again. The toggle says which way it
       goes, and until 16 August 2026 the stylesheet hid it above phone width —
       so a block laid down closed had no visible way back open at all. */
    const open = screen.getAllByRole('button', { name: /expand block/i });
    expect(open).toHaveLength(6);
    fireEvent.click(open[0]);
    expect(screen.getAllByRole('button', { name: /collapse block/i })).toHaveLength(1);
    /* Section name/Kind/Minutes/Superset stay collapsed behind their own
       toggle on a REOPENED template block — see BlockEditor's `metaOpen`.
       A template already set all four; the coach reopening one is almost
       always there for the exercise list. */
    expect(screen.queryByDisplayValue('WARM-UP')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /block settings/i }));
    expect(screen.getByDisplayValue('WARM-UP')).toBeInTheDocument();
  });

  it('brings no movements with it — the coach still picks every one', () => {
    /* The whole point of a template, in the owner's words: "then I just need to
       select exercise / rest timers / rpe". A template that arrived with
       exercises in it would be a workout, not a shape. */
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /hybrid — one strength piece/i }));
    expect(screen.queryByRole('button', { name: /remove exercise/i })).not.toBeInTheDocument();
  });

  it('stops offering templates once the day has anything on it', () => {
    /* Applying a template APPENDS, so the offer is only unambiguous while the
       day is empty. See `applyTemplate`. */
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /lift and engine/i }));
    expect(screen.queryByRole('button', { name: /lift and engine/i })).not.toBeInTheDocument();
  });
});

/*
 * PAIRING TWO BLOCKS — the "+ Superset" control between two adjacent
 * Strength/Power blocks, mirroring the mockup. `hybrid-roots-1` seeds six
 * consecutive Strength/Power blocks (each one real exercise) then a
 * Cooldown block, which is exactly the shape needed to exercise both the
 * offered and withheld cases without hand-building blocks.
 */
describe('pairing two blocks into a superset', () => {
  function applyRootsOne() {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /hybrid roots — day 1/i }));
  }

  it('offers "+ Superset" between every adjacent pair of Strength/Power blocks, and nowhere else', () => {
    applyRootsOne();
    /* Six Strength/Power blocks then one Cooldown block — five internal gaps
       between the six, none leading into the Cooldown block. */
    expect(screen.getAllByRole('button', { name: /^\+ superset$/i })).toHaveLength(5);
  });

  it('merges two blocks into one, folding both exercises in, and flips to "− Superset"', () => {
    applyRootsOne();
    fireEvent.click(screen.getAllByRole('button', { name: /^\+ superset$/i })[0]);
    /* One fewer block: BLOCK 07 (Cooldown) shifts down to BLOCK 06. */
    expect(screen.queryByText('BLOCK 07')).not.toBeInTheDocument();
    expect(screen.getByText('BLOCK 06')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^− superset$/i })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /expand block/i })[0]);
    expect(screen.getByRole('button', { name: /remove zercher squat/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove glute ham raise/i })).toBeInTheDocument();
  });

  it('splits the pairing back apart on "− Superset", one exercise at a time', () => {
    applyRootsOne();
    fireEvent.click(screen.getAllByRole('button', { name: /^\+ superset$/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /^− superset$/i }));
    /* Back to seven blocks, and the pairing control is gone from that slot —
       each exercise owns its own block again. */
    expect(screen.getByText('BLOCK 07')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^− superset$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /expand block/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /expand block/i })[1]);
    expect(screen.getByRole('button', { name: /remove zercher squat/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove glute ham raise/i })).toBeInTheDocument();
  });

  it('offers no pairing control at all between hand-added blocks with no exercises yet', () => {
    /* A block from "+ Add block" is empty and unnamed until the coach fills
       it in — nothing to pair with an equally-empty neighbour is still
       offered, since both ARE Strength/Power by default; this just confirms
       the control appears without requiring real content first. */
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    expect(screen.getByRole('button', { name: /^\+ superset$/i })).toBeInTheDocument();
  });
});
