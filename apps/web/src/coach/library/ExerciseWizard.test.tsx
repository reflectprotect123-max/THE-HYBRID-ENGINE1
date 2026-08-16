// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { measureFor, MEASURES, fmtEvery, DEFAULT_REST_SEC, DEFAULT_EVERY_SEC, ExerciseWizard } from './ExerciseWizard';

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
  render(<ExerciseWizard {...props} />);
  return props;
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
