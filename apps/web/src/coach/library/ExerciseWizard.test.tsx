// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { measureFor, MEASURES, fmtEvery, DEFAULT_REST_SEC, DEFAULT_EVERY_SEC, ExerciseWizard } from './ExerciseWizard';
import type { SetRow } from './SetRows';

describe('measureFor', () => {
  it('reads reps + weight_kg as reps_weight', () => {
    expect(measureFor('reps', 'weight_kg')).toBe('reps_weight');
  });

  it('reads reps with no second column as reps', () => {
    expect(measureFor('reps', '')).toBe('reps');
  });

  it('reads seconds as seconds regardless of the second column', () => {
    expect(measureFor('seconds', '')).toBe('seconds');
  });

  it('reads meters as distance', () => {
    expect(measureFor('meters', '')).toBe('distance');
  });

  it('falls back to reps for an unrecognised pair', () => {
    expect(measureFor('weight_pct', '')).toBe('reps');
  });
});

describe('MEASURES', () => {
  it('has exactly the four measures the wizard offers, each mapping to a real column pair', () => {
    expect(MEASURES.map((m) => m.key)).toEqual(['reps_weight', 'reps', 'seconds', 'distance']);
    expect(MEASURES.find((m) => m.key === 'reps_weight')).toMatchObject({ columnA: 'reps', columnB: 'weight_kg' });
    expect(MEASURES.find((m) => m.key === 'distance')).toMatchObject({ columnA: 'meters', columnB: '' });
  });
});

describe('fmtEvery', () => {
  it('formats seconds as minutes:seconds, matching the prescription card', () => {
    expect(fmtEvery(150)).toBe('2:30');
    expect(fmtEvery(65)).toBe('1:05');
  });
});

describe('defaults', () => {
  it('keeps the ninety-second rest and two-and-a-half-minute EMOM defaults', () => {
    expect(DEFAULT_REST_SEC).toBe(90);
    expect(DEFAULT_EVERY_SEC).toBe(150);
  });
});

const ENTRIES = [
  { name: 'Back Squat', tags: ['Barbell'], uses: 3 },
  { name: 'Pull-Up', tags: ['Bodyweight'], uses: 1 },
];

function renderWizard(over: Partial<Parameters<typeof ExerciseWizard>[0]> = {}) {
  const props = { entries: ENTRIES, onSave: vi.fn(), onCancel: vi.fn(), ...over };
  const { unmount } = render(<ExerciseWizard {...props} />);
  return { ...props, unmount };
}

describe('ExerciseWizard — steps 1 and 2', () => {
  it('opens on the Exercise step and shows the library picker', () => {
    renderWizard();
    expect(screen.getByText('What are they doing?')).toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
  });

  it('advances to Measure once an exercise is picked and Next is pressed', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByText('What are you tracking?')).toBeInTheDocument();
  });

  it('disables Next on the Exercise step until something is picked', () => {
    renderWizard();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('defaults Measure to Reps + Weight, matching most strength work', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByRole('button', { name: /Reps \+ Weight/ })).toHaveClass('on');
  });

  it('picking a different measure tile updates the selection', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Seconds/ }));
    expect(screen.getByRole('button', { name: /Seconds/ })).toHaveClass('on');
    expect(screen.getByRole('button', { name: /Reps \+ Weight/ })).not.toHaveClass('on');
  });

  it('Back from Measure returns to Exercise with the pick remembered', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText('What are they doing?')).toBeInTheDocument();
  });

  it('Back from the Exercise step calls onCancel with nothing added', () => {
    const props = renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /back to block/i }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('pre-fills the exercise and measure from `initial` when editing', () => {
    renderWizard({
      initial: {
        id: 'e1', name: 'Front Squat', columnA: 'seconds', columnB: '', rest: 90,
        sets: [{ id: 'e1-s0', a: '20', b: '' }],
      },
    });
    expect(screen.getByDisplayValue('Front Squat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByRole('button', { name: /Seconds/ })).toHaveClass('on');
  });
});

function toValues(container = document) {
  fireEvent.click(screen.getByText('Back Squat'));
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> sets
}

describe('ExerciseWizard — Sets and Values', () => {
  it('starts Sets at 3 and steps with +/-', () => {
    renderWizard();
    toValues();
    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /one more set/i }));
    expect(screen.getByText('4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /one fewer set/i }));
    fireEvent.click(screen.getByRole('button', { name: /one fewer set/i }));
    fireEvent.click(screen.getByRole('button', { name: /one fewer set/i }));
    expect(screen.getByText('1')).toBeInTheDocument(); // floor at 1, not 0
  });

  it('advancing from Sets to Values shows reps presets for Reps + Weight, plus a weight field', () => {
    renderWizard();
    toValues();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    expect(screen.getByRole('button', { name: '8' })).toBeInTheDocument();
    expect(screen.getByLabelText(/weight in kilograms/i)).toBeInTheDocument();
  });

  it('hides the weight field for Reps only', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
    fireEvent.click(screen.getByRole('button', { name: /Reps only/ }));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> sets
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    expect(screen.queryByLabelText(/weight in kilograms/i)).not.toBeInTheDocument();
  });

  it('picking a reps preset sets the shared value and clears the custom box', () => {
    renderWizard();
    toValues();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    fireEvent.click(screen.getByRole('button', { name: '10' }));
    expect(screen.getByRole('button', { name: '10' })).toHaveClass('on');
  });

  it('typing a custom value overrides the presets', () => {
    renderWizard();
    toValues();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
    fireEvent.change(screen.getByLabelText(/custom value/i), { target: { value: '8-12' } });
    expect(screen.queryAllByRole('button', { name: /^(5|8|10|12|max)$/ }).some((b) => b.classList.contains('on'))).toBe(false);
  });
});

function toReview() {
  fireEvent.click(screen.getByText('Back Squat'));
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> sets
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> values
  fireEvent.click(screen.getByRole('button', { name: '8' }));
  fireEvent.change(screen.getByLabelText(/weight in kilograms/i), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> review
}

describe('ExerciseWizard — Review and commit', () => {
  it('shows the exercise name and its shape summary', () => {
    renderWizard();
    toReview();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('3 × 8 @ 100kg')).toBeInTheDocument();
  });

  it('commits a WizardResult with three identical sets and no id, for a new exercise', () => {
    const props = renderWizard();
    toReview();
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result, shape] = onSave.mock.calls[0];
    expect(result.id).toBeUndefined();
    expect(result.name).toBe('Back Squat');
    expect(result.columnA).toBe('reps');
    expect(result.columnB).toBe('weight_kg');
    expect(result.sets).toHaveLength(3);
    expect(result.sets.every((s: SetRow) => s.a === '8' && s.b === '100')).toBe(true);
    expect(shape).toEqual({ measure: 'reps_weight', sets: 3, a: '8', b: '100' });
  });

  it('carries the rest, target RPE, and tempo optional fields into the result', () => {
    const props = renderWizard();
    toReview();
    fireEvent.change(screen.getByLabelText(/^rest/i), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/target rpe/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/^tempo/i), { target: { value: '3-1-1-0' } });
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect(result.rest).toBe(120);
    expect(result.tempo).toBe('3-1-1-0');
    expect(result.sets.every((s: SetRow) => s.rpe === '8')).toBe(true);
  });

  it('preserves the existing id when committing an edit', () => {
    const props = renderWizard({
      initial: { id: 'e7', name: 'Front Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, sets: [{ id: 'e7-s0', a: '5', b: '80' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /add exercise/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    expect(onSave.mock.calls[0][0].id).toBe('e7');
  });

  it('offers Skip to review from Measure onward, not on the Exercise step', () => {
    renderWizard();
    expect(screen.queryByRole('button', { name: /skip to review/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    expect(screen.getByText('Look right?')).toBeInTheDocument();
  });

  it('uses lastShape to default Measure/Sets/Values for a brand-new add', () => {
    renderWizard({ lastShape: { measure: 'seconds', sets: 5, a: '30', b: '' } });
    fireEvent.click(screen.getByText('Back Squat'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    expect(screen.getByText('5 × 30s')).toBeInTheDocument();
  });
});

/*
 * CRITICAL FINDING 2a — commit() must not silently destroy what an edit
 * didn't touch. Two separate traps: overwriting a column pair the wizard's
 * Measure step cannot represent (weight_pct, reps_range, …), and replacing
 * every set with one shared value even when the coach never opened Values.
 */
describe('ExerciseWizard — editing does not silently destroy what it did not touch', () => {
  it('keeps an unrepresentable column pair (e.g. %1RM) when the coach never visits Measure', () => {
    const props = renderWizard({
      initial: {
        id: 'e10', name: 'Back Squat', columnA: 'reps', columnB: 'weight_pct', rest: 90,
        sets: [{ id: 'e10-s0', a: '5', b: '80' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect(result.columnA).toBe('reps');
    expect(result.columnB).toBe('weight_pct');
  });

  it('overwrites the column pair when the coach explicitly picks a Measure tile', () => {
    const props = renderWizard({
      initial: {
        id: 'e11', name: 'Back Squat', columnA: 'reps', columnB: 'weight_pct', rest: 90,
        sets: [{ id: 'e11-s0', a: '5', b: '80' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
    fireEvent.click(screen.getByRole('button', { name: /Seconds/ }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect(result.columnA).toBe('seconds');
    expect(result.columnB).toBe('');
  });

  it('editing with an unchanged set count preserves warm flags and untouched per-set RPE', () => {
    const props = renderWizard({
      initial: {
        id: 'e9', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90,
        sets: [
          { id: 'e9-s0', a: '10', b: '40', warm: true, rpe: '3' },
          { id: 'e9-s1', a: '8', b: '80', rpe: '9' },
          { id: 'e9-s2', a: '6', b: '90' },
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect(result.sets).toHaveLength(3);
    expect(result.sets[0].warm).toBe(true);
    expect(result.sets[0].rpe).toBe('3');
    expect(result.sets[1].rpe).toBe('9');
    expect(result.sets[2].rpe).toBeUndefined();
  });

  it('changing the set count still rebuilds the array (nothing to merge onto)', () => {
    const props = renderWizard({
      initial: {
        id: 'e14', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90,
        sets: [{ id: 'e14-s0', a: '5', b: '80', warm: true }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> measure
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> sets
    fireEvent.click(screen.getByRole('button', { name: /one more set/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect(result.sets).toHaveLength(2);
    expect(result.sets.every((s: SetRow) => !s.warm)).toBe(true);
  });
});

/*
 * IMPORTANT FINDING 3 — `commit()` only included `tempo`/`every` in its
 * result when non-blank/non-zero, so `BlockEditor`'s `{ ...e, ...result }`
 * merge had no key to clear the old value with. Both must now be clearable.
 */
describe('ExerciseWizard — clearing tempo and pacing', () => {
  it('blanking Tempo on an edit reports it as cleared, not simply absent', () => {
    const props = renderWizard({
      initial: {
        id: 'e12', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, tempo: '3-1-1-0',
        sets: [{ id: 'e12-s0', a: '5', b: '80' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    fireEvent.change(screen.getByLabelText(/^tempo/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect('tempo' in result).toBe(true);
    expect(result.tempo).toBeUndefined();
  });

  it('switching Pacing from Every back to Rest clears `every`', () => {
    const props = renderWizard({
      initial: {
        id: 'e13', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, every: 120,
        sets: [{ id: 'e13-s0', a: '5', b: '80' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    expect(screen.getByLabelText('Pacing')).toHaveValue('every');
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'rest' } });
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect('every' in result).toBe(true);
    expect(result.every).toBeUndefined();
  });
});

/*
 * IMPORTANT FINDING 4 — EMOM pacing had a `Draft.every` field and preserved
 * it through an edit, but no step ever rendered a control to author it.
 */
describe('ExerciseWizard — EMOM pacing on Review', () => {
  it('defaults to Rest between sets for a new exercise', () => {
    renderWizard();
    toReview();
    expect(screen.getByLabelText('Pacing')).toHaveValue('rest');
    expect(screen.getByText(/the countdown starts when the set ends/i)).toBeInTheDocument();
  });

  it('switching to Every — EMOM shows the seconds field and the EMOM summary, and commits `every`', () => {
    const props = renderWizard();
    toReview();
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'every' } });
    fireEvent.change(screen.getByLabelText(/every, in seconds/i), { target: { value: '90' } });
    expect(screen.getByText(/1:30 × 3 sets — each set starts on the clock/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect(result.every).toBe(90);
  });

  it('pre-fills Every and Pacing from an exercise already on EMOM pacing', () => {
    renderWizard({
      initial: {
        id: 'e15', name: 'Back Squat', columnA: 'reps', columnB: 'weight_kg', rest: 90, every: 150,
        sets: [{ id: 'e15-s0', a: '5', b: '80' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip to review/i }));
    expect(screen.getByLabelText('Pacing')).toHaveValue('every');
    expect(screen.getByLabelText(/every, in seconds/i)).toHaveValue(150);
  });
});

/*
 * IMPORTANT FINDING 6 — every NEW exercise's set ids were keyed
 * `new-s0`/`new-s1`/…, colliding across every new exercise added in the same
 * block. A fresh mount now mints a unique per-exercise id.
 */
describe('ExerciseWizard — new-exercise set ids', () => {
  it('does not key a new exercise\'s sets with the literal prefix "new"', () => {
    const props = renderWizard();
    toReview();
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const onSave = props.onSave as ReturnType<typeof vi.fn>;
    const [result] = onSave.mock.calls[0];
    expect(result.sets.every((s: SetRow) => !s.id.startsWith('new-s'))).toBe(true);
  });

  it('mints different set-id prefixes for two separate new-exercise mounts', () => {
    const first = renderWizard();
    toReview();
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const firstIds = (first.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0].sets.map((s: SetRow) => s.id);
    first.unmount();

    const second = renderWizard();
    toReview();
    fireEvent.click(screen.getByRole('button', { name: /^add exercise$/i }));
    const secondIds = (second.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0].sets.map((s: SetRow) => s.id);

    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
  });
});
