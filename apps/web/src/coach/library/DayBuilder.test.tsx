// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DayBuilder } from './DayBuilder';

function renderDay(over: Partial<Parameters<typeof DayBuilder>[0]> = {}) {
  const props = {
    mode: 'dated' as const,
    date: '2026-08-11',
    published: false,
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
  /*
   * `hybrid-2-intensity`, `hybrid-1-intensity`, `hybrid-roots-1` and
   * `hybrid-roots-2` were deleted on 17 August 2026 along with the
   * Strength/Power category they depended on — see `session-templates.ts`'s
   * own header. `lift-and-engine` is the one template left: a conditioning
   * piece framed by a warm-up and cooldown.
   */
  it('offers the template on an empty day and lays out its sections', () => {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /lift and engine/i }));
    expect(screen.getByText('BLOCK 03')).toBeInTheDocument();
    /* The NAME is what each block head says, so the three sections are told
       apart while they are all still closed. */
    expect(screen.getByText('WARM-UP')).toBeInTheDocument();
    expect(screen.getByText('ENGINE')).toBeInTheDocument();
    expect(screen.getByText('COOLDOWN')).toBeInTheDocument();
  });

  it('lays its sections down CLOSED', () => {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /lift and engine/i }));
    expect(screen.queryByLabelText('Section name')).not.toBeInTheDocument();
    /* And every one of them can be opened again. The toggle says which way it
       goes, and until 16 August 2026 the stylesheet hid it above phone width —
       so a block laid down closed had no visible way back open at all. */
    const open = screen.getAllByRole('button', { name: /expand block/i });
    expect(open).toHaveLength(3);
    fireEvent.click(open[0]);
    expect(screen.getAllByRole('button', { name: /collapse block/i })).toHaveLength(1);
    /* Section name/Kind stay collapsed behind their own toggle on a
       REOPENED template block — see BlockEditor's `metaOpen`. A template
       already set both; the coach reopening one is almost always there for
       the conditioning fields or the note. */
    expect(screen.queryByDisplayValue('WARM-UP')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /block settings/i }));
    expect(screen.getByDisplayValue('WARM-UP')).toBeInTheDocument();
  });

  it('gives its conditioning section real fields to edit, seeded from the template minutes', () => {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /lift and engine/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /expand block/i })[1]);
    expect(screen.getByLabelText('Minutes')).toHaveValue(20);
  });

  it('stops offering the template once the day has anything on it', () => {
    /* Applying a template APPENDS, so the offer is only unambiguous while the
       day is empty. See `applyTemplate`. */
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /lift and engine/i }));
    expect(screen.queryByRole('button', { name: /lift and engine/i })).not.toBeInTheDocument();
  });
});

/*
 * REORDERING BLOCKS — up/down swaps a block with its neighbour.
 */
describe('reordering blocks up and down', () => {
  it('has no move-up on the first block and no move-down on the last', () => {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    const ups = screen.getAllByRole('button', { name: /move block up/i });
    const downs = screen.getAllByRole('button', { name: /move block down/i });
    expect(ups).toHaveLength(1);
    expect(downs).toHaveLength(1);
  });

  it('swaps two blocks, and their fields move with them', () => {
    renderDay();
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    fireEvent.click(screen.getByRole('button', { name: /add block/i }));
    const names = screen.getAllByRole('button', { name: /^conditioning$/i });
    fireEvent.click(names[0]);
    fireEvent.change(screen.getAllByLabelText(/section name/i)[0], { target: { value: 'FIRST' } });
    fireEvent.click(names[1]);
    fireEvent.change(screen.getAllByLabelText(/section name/i)[1], { target: { value: 'SECOND' } });

    fireEvent.click(screen.getAllByRole('button', { name: /move block down/i })[0]);
    const order = screen.getAllByText(/^(FIRST|SECOND)$/).map((el) => el.textContent);
    expect(order).toEqual(['SECOND', 'FIRST']);
  });
});
