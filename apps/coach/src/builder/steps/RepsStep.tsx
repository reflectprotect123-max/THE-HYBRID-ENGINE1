import { BRASS, GHOST } from '../../ui';

const CHIPS = ['5', '8', '10', '12', 'max'];

export function RepsStep({
  value,
  isWarmup,
  onChange,
  onWarmupToggle,
}: {
  value: string;
  isWarmup: boolean;
  onChange: (v: string) => void;
  onWarmupToggle: (v: boolean) => void;
}) {
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
            onClick={() => onChange(c)}
            aria-pressed={value === c}
            className={value === c ? BRASS : GHOST}
          >
            {c}
          </button>
        ))}
      </div>
      <input
        value={CHIPS.includes(value) ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="or type a custom target, e.g. 8-12"
        aria-label="custom rep target"
        className="mt-1 w-full max-w-[280px] rounded-md border border-line2 bg-panel2 px-1.5 py-1 text-center text-4"
      />
      <button onClick={() => onChange(value)} className={BRASS + ' mt-2'} disabled={!value}>
        Next
      </button>
    </div>
  );
}
