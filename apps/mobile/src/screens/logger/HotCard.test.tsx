import { fireEvent, render, within } from '@testing-library/react-native';
import type { Draft, HotSet } from '@hybrid/session-authoring';
import { HotCard } from './HotCard';

const hot = (message: string): HotSet => ({
  exerciseIndex: 0,
  setIndex: 0,
  exerciseName: 'Back Squat',
  message,
  planned: { reps: '8', rpe: '8' },
});

const draft = (patch: Partial<Draft> = {}): Draft => ({ kg: 100, reps: 8, felt: null, ...patch });

const noop = () => {};

describe('HotCard — the coaching message', () => {
  it('renders a short message verbatim', () => {
    const r = render(<HotCard hot={hot('opener — everything works from here')} draft={draft()} dispatch={noop} label="Set 1" weighted />);
    expect(r.getByTestId('hot-why').props.children).toBe('opener — everything works from here');
  });

  it('renders a long message with an em dash verbatim, untruncated and unreworded', () => {
    // Exactly the string `foldExercise` produces for a max set that came in
    // below the earned back-off — the branch the golden fixture pins. Not
    // paraphrased, not sentence-cased. A parity gate asserts this exact string
    // against the prototype, so a screen that rewords it fails there too.
    const long = 'set 1 minus the back-off — arrive fresh';
    const r = render(<HotCard hot={hot(long)} draft={draft()} dispatch={noop} label="Set 1" weighted />);
    expect(r.getByTestId('hot-why').props.children).toBe(long);
  });
});

describe('HotCard — the log gate', () => {
  it('is disabled with reps but no rating', () => {
    const r = render(<HotCard hot={hot('m')} draft={draft({ felt: null })} dispatch={noop} label="Set 1" weighted />);
    expect(r.getByTestId('log').props.accessibilityState.disabled).toBe(true);
  });

  it('is enabled once a rating is chosen', () => {
    const r = render(<HotCard hot={hot('m')} draft={draft({ felt: 8 })} dispatch={noop} label="Set 1" weighted />);
    expect(r.getByTestId('log').props.accessibilityState.disabled).toBe(false);
  });

  it('dispatches logSet on press', () => {
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft({ felt: 8 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.press(r.getByTestId('log'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'logSet' });
  });

  it('logs nothing while the gate is closed', () => {
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft({ felt: null })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.press(r.getByTestId('log'));
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('HotCard — a bodyweight exercise', () => {
  it('renders no weight control at all', () => {
    const r = render(<HotCard hot={hot('bodyweight')} draft={draft({ kg: 0 })} dispatch={noop} label="Set 1" weighted={false} />);
    expect(r.queryByTestId('hot-kg')).toBeNull();
  });
});

describe('HotCard — the weight field', () => {
  it('reads `100kg` with no space, which is what the recorded trace pins', () => {
    // React Native does not apply margin to nested text, so the unit sits in
    // its own baseline-aligned sibling. The rendered STRING has to stay
    // exactly what the prototype's `<button>100<small>kg</small></button>`
    // produced.
    const r = render(<HotCard hot={hot('m')} draft={draft({ kg: 100 })} dispatch={noop} label="Set 1" weighted />);
    const text = within(r.getByTestId('hot-kg'))
      .getAllByText(/\S/)
      .map((n) => String(n.props.children))
      .join('');
    expect(text).toBe('100kg');
  });

  it('commits a typed weight through setDraft, never by writing the session', () => {
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft({ kg: 100 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.press(r.getByTestId('hot-kg'));
    fireEvent.changeText(r.getByTestId('hot-kg'), '82.5');
    fireEvent(r.getByTestId('hot-kg'), 'blur');
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { kg: 82.5 } });
  });

  it('ignores an unparseable entry rather than storing NaN', () => {
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft({ kg: 100 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.press(r.getByTestId('hot-kg'));
    fireEvent.changeText(r.getByTestId('hot-kg'), 'heavy');
    fireEvent(r.getByTestId('hot-kg'), 'blur');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('HotCard — the rep stepper', () => {
  it('floors at zero rather than going negative', () => {
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft({ reps: 0 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.press(r.getByTestId('reps-down'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { reps: 0 } });
  });

  it('every change goes through setDraft', () => {
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft({ reps: 5 })} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.press(r.getByTestId('reps-up'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { reps: 6 } });
  });
});

describe('HotCard — the rating chips', () => {
  it('renders every chip from the prototype, 7 through 10', () => {
    const r = render(<HotCard hot={hot('m')} draft={draft()} dispatch={noop} label="Set 1" weighted />);
    for (const key of ['7', '75', '8', '85', '9', '95', '10']) {
      expect(r.getByTestId(`rpe-${key}`)).toBeTruthy();
    }
  });

  it('7.5 is the chip whose hook and value differ: rpe-75', () => {
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft()} dispatch={dispatch} label="Set 1" weighted />);
    fireEvent.press(r.getByTestId('rpe-75'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { felt: 7.5 } });
  });

  it('10 is the chip where the ×10 rule and the decimal-strip rule diverge: rpe-10', () => {
    // The vocabulary table once said value×10, which would make this chip
    // `rpe-100`. It agrees with the prototype on every half-point value and
    // disagrees only here and on 7, 8 and 9 — so a suite that only ever
    // exercised 7.5 went green while the contract was wrong.
    const dispatch = jest.fn();
    const r = render(<HotCard hot={hot('m')} draft={draft()} dispatch={dispatch} label="Set 1" weighted />);
    expect(r.queryByTestId('rpe-100')).toBeNull();
    fireEvent.press(r.getByTestId('rpe-10'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setDraft', patch: { felt: 10 } });
  });
});
