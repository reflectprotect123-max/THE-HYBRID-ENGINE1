// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CatalogueEntry } from '@hybrid/engine';
import { ExercisePicker } from './ExercisePicker';

/*
 * Two empty states, deliberately distinct. "No exercises match those filters."
 * is the mockup's own copy for a filter that excluded everything. An athlete
 * whose library is genuinely empty has not made a bad search, and telling them
 * they have would send them hunting for a typo that is not there.
 */
const entries: CatalogueEntry[] = [
  { name: 'Back Squat', tags: ['Barbell'], uses: 3 },
  { name: 'Pull-Up', tags: ['Bodyweight', 'Band'], uses: 1 },
  { name: 'Row Erg', tags: ['Conditioning'], uses: 0 },
];

function renderPicker(over: Partial<Parameters<typeof ExercisePicker>[0]> = {}) {
  const props = {
    entries,
    // Open by default here: these cases are about what the picker DOES, and
    // the closed state is a CSS class rather than a different component. The
    // class itself is asserted below.
    open: true,
    onPick: vi.fn(),
    onNewExercise: vi.fn(),
    onDone: vi.fn(),
    ...over,
  };
  render(<ExercisePicker {...props} />);
  return props;
}

describe('ExercisePicker', () => {
  it('lists every movement and says how many are shown', () => {
    renderPicker();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('Pull-Up')).toBeInTheDocument();
    expect(screen.getByText('Row Erg')).toBeInTheDocument();
    expect(screen.getByTestId('picker-shown-count')).toHaveTextContent('3');
  });

  it('narrows the list as you search, and updates the count', () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText('Search the exercise library'), {
      target: { value: 'squat' },
    });
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.queryByText('Row Erg')).not.toBeInTheDocument();
    expect(screen.getByTestId('picker-shown-count')).toHaveTextContent('1');
  });

  it('filters by tag', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('checkbox', { name: /Bodyweight/i }));
    expect(screen.getByText('Pull-Up')).toBeInTheDocument();
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
  });

  it('shows every offered tag with its real count, including zero', () => {
    renderPicker();
    // Warm-up is offered by the picker but carried by nothing in this fixture.
    expect(screen.getByRole('checkbox', { name: /Warm-up/i })).toBeInTheDocument();
    expect(screen.getByTestId('tag-count-Warm-up')).toHaveTextContent('0');
    expect(screen.getByTestId('tag-count-Barbell')).toHaveTextContent('1');
  });

  it('clears search and tags back to the whole list', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('checkbox', { name: /Bodyweight/i }));
    fireEvent.change(screen.getByPlaceholderText('Search the exercise library'), {
      target: { value: 'zzz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('Row Erg')).toBeInTheDocument();
  });

  it('reports the movement you pick', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));
    expect(props.onPick).toHaveBeenCalledWith('Back Squat');
  });

  it('says so when a search matches nothing, in the mockup wording', () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText('Search the exercise library'), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText('No exercises match those filters.')).toBeInTheDocument();
  });

  it('tells an athlete with no movements yet why the list is empty, differently', () => {
    renderPicker({ entries: [] });
    expect(screen.getByText(/no movements in your library yet/i)).toBeInTheDocument();
    expect(screen.queryByText('No exercises match those filters.')).not.toBeInTheDocument();
  });

  it('offers New exercise, and reports the name typed', () => {
    const props = renderPicker();
    fireEvent.change(screen.getByPlaceholderText('Search the exercise library'), {
      target: { value: 'Zercher Squat' },
    });
    fireEvent.click(screen.getByRole('button', { name: /new exercise/i }));
    expect(props.onNewExercise).toHaveBeenCalledWith('Zercher Squat');
  });

  it('THE BUG: clears the search after New exercise, so a second click cannot silently repeat it', () => {
    /* Reported live: a coach who pressed "+ New exercise" once, then pressed
       it again to add a SECOND, different movement to the same block, got
       the FIRST name added twice — the search box still read the old name
       and the button reads straight off it. */
    const props = renderPicker();
    const search = screen.getByPlaceholderText('Search the exercise library') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'Squat' } });
    fireEvent.click(screen.getByRole('button', { name: /new exercise/i }));
    expect(props.onNewExercise).toHaveBeenNthCalledWith(1, 'Squat');
    expect(search.value).toBe('');
    // A second click with nothing retyped must add nothing — not repeat "Squat".
    fireEvent.click(screen.getByRole('button', { name: /new exercise/i }));
    expect(props.onNewExercise).toHaveBeenCalledTimes(1);
  });

  it('clears the search after picking an existing movement, for the same reason', () => {
    const props = renderPicker();
    const search = screen.getByPlaceholderText('Search the exercise library') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'squat' } });
    fireEvent.click(screen.getByText('Back Squat'));
    expect(props.onPick).toHaveBeenCalledWith('Back Squat');
    expect(search.value).toBe('');
  });

  /*
   * Circuit has a tab in the mockup and no definition anywhere in this system
   * (see 2026-08-11-stage3c-sessions-exercises-design.md). Rendering the button
   * live would be a dead end; omitting it silently would lose the mockup's
   * intent. It renders, disabled, saying why.
   */
  it('offers New circuit but disables it, because circuits are not defined yet', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /new circuit/i })).toBeDisabled();
  });

  it('closes when done', () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(props.onDone).toHaveBeenCalled();
  });

  /*
   * A PHONE bug, caught on a real phone and not by any check here.
   *
   * `coach-redesign.css`'s phone block hides the picker until it is asked for:
   *
   *     .cb-picker { display: none; }
   *     .cb-picker.picker-open { display: block; }
   *
   * The mockup toggled `picker-open` by hand; this component was ported from
   * it and never applied the class — a search across the whole of
   * `apps/web/src` found `picker-open` in the stylesheet and NOWHERE else. So
   * on a phone, tapping "+ Add exercise from library" removed the reveal
   * button (it renders only while closed) and mounted a picker the stylesheet
   * hid. The block went empty with nothing left to tap: a coach could add a
   * block and then never put anything in it. Desktop was fine, because none
   * of those rules apply above the breakpoint — which is why every review
   * missed it.
   *
   * jsdom does not apply the stylesheet, so this asserts the CLASS rather
   * than the computed display. That is the honest limit of a unit test here,
   * and it is still the assertion that would have failed.
   */
  it('carries picker-open, without which the phone stylesheet hides it entirely', () => {
    renderPicker();
    const picker = document.querySelector('.cb-picker');
    expect(picker).not.toBeNull();
    expect(picker).toHaveClass('picker-open');
  });
});

/*
 * THE CLASS THAT DECIDES WHETHER A PHONE CAN SEE THIS, and the reason the
 * picker is always mounted.
 *
 * This has been wrong in both directions now. On 14 August a phone tapped
 * "+ Add exercise from library" and got an empty block, because the class was
 * never applied. The fix hard-coded it and left `BlockEditor` mounting the
 * picker only when `pickerOpen` — and the only control that sets `pickerOpen`
 * is the reveal button, which is `display: none` outside the phone media
 * query. So from 14 August until 16 August there was no way to add an exercise
 * at DESKTOP width at all, on the screen this workspace is composed at.
 *
 * jsdom applies no stylesheet, so neither of those failures is visible to a
 * rendering assertion about what is on screen. What IS assertable is the
 * contract the stylesheet depends on: the element exists, and it carries the
 * class exactly when it is open.
 */
describe('ExercisePicker — the open class', () => {
  const pickerEl = () => document.querySelector('.cb-picker');

  it('is mounted whether or not it is open, so CSS can decide', () => {
    renderPicker({ open: false });
    expect(pickerEl()).not.toBeNull();
  });

  it('carries picker-open only when open', () => {
    const { unmount } = render(
      <ExercisePicker entries={entries} open={false} onPick={vi.fn()} onNewExercise={vi.fn()} onDone={vi.fn()} />,
    );
    expect(pickerEl()?.className).toBe('cb-picker');
    unmount();

    render(<ExercisePicker entries={entries} open onPick={vi.fn()} onNewExercise={vi.fn()} onDone={vi.fn()} />);
    expect(pickerEl()?.className).toBe('cb-picker picker-open');
  });
});
