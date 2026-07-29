import { BRASS } from '../../ui';

export function SetsStep({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many sets?</h1>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange(Math.max(1, count - 1))} aria-label="fewer sets" className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8">
          −
        </button>
        <span className="num w-12 text-center text-9 font-[900]">{count}</span>
        <button onClick={() => onChange(Math.min(10, count + 1))} aria-label="more sets" className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8">
          +
        </button>
      </div>
      <button onClick={() => onChange(count)} className={BRASS + ' mt-2'}>
        Next
      </button>
    </div>
  );
}
