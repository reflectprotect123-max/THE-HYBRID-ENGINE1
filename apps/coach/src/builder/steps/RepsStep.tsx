import { useState } from 'react';
import { BRASS, GHOST } from '../../ui';

const CHIPS = ['5', '8', '10', '12', 'max'];

export function RepsStep({
  value,
  isWarmup,
  onChange,
  onWarmupToggle,
  onNext,
}: {
  value: string;
  isWarmup: boolean;
  onChange: (v: string) => void;
  onWarmupToggle: (v: boolean) => void;
  onNext: () => void;
}) {
  // The custom field owns its text. Chips clear it (they replace a custom
  // target); typing writes the draft directly. `value` still renders the
  // chips' pressed state, so the two inputs never fight over one string.
  const [custom, setCustom] = useState(CHIPS.includes(value) ? '' : value);
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many reps?</h1>
      <label className="flex items-center gap-1 text-4 text-muted">
        <input type="checkbox" checked={isWarmup} onChange={(e) => onWarmupToggle(e.target.checked)} />
        This is a warm-up
      </label>
      <div className="flex flex-wrap justify-center gap-1">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => { setCustom(''); onChange(c); }}
            aria-pressed={value === c}
            className={value === c ? BRASS : GHOST}
          >
            {c}
          </button>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }}
        placeholder="or type a custom target, e.g. 8-12"
        aria-label="custom rep target"
        className="mt-1 w-full max-w-[280px] rounded-md border border-line2 bg-panel2 px-1.5 py-1 text-center text-4"
      />
      <button onClick={onNext} className={BRASS + ' mt-2'} disabled={!value.trim()}>
        Next
      </button>
    </div>
  );
}
