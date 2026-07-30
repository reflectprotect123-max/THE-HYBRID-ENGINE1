import { Button } from '../../ui';

export function SetsStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: number;
  onChange: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many sets?</h1>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(Math.max(1, value - 1))}
          aria-label="fewer sets"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          −
        </button>
        <span className="num w-12 text-center text-9 font-[900]">{value}</span>
        <button
          onClick={() => onChange(Math.min(20, value + 1))}
          aria-label="more sets"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          +
        </button>
      </div>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
