import { BRASS, GHOST } from '../../ui';

const RPE_CHIPS = ['6', '7', '8', '9', '10'];

export function RpeStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How hard should it feel?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {RPE_CHIPS.map((c) => (
          <button key={c} onClick={() => onChange(c)} aria-pressed={value === c} className={value === c ? BRASS : GHOST}>
            RPE {c}
          </button>
        ))}
      </div>
      <button onClick={() => onChange(value)} className={BRASS + ' mt-2'} disabled={!value}>
        Next
      </button>
    </div>
  );
}
