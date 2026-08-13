import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { Button, Chip } from '../../../ui';

export function CondDetailStep({
  condFmt,
  effort,
  minutes,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  condFmt: CondFmtKey | '';
  effort: EffortKey;
  minutes: number;
  onChange: (patch: { condFmt?: CondFmtKey; effort?: EffortKey; minutes?: number }) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What kind of conditioning?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {CON_FORMAT_KEYS.map((k) => (
          <Chip key={k} on={condFmt === k} onClick={() => onChange({ condFmt: k })}>
            {condFmt === k ? '✓ ' : ''}{CON_FORMATS[k].name}
          </Chip>
        ))}
      </div>
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Effort</span>
      <div className="flex flex-wrap justify-center gap-1">
        {CON_EFFORT_KEYS.map((k) => (
          <Chip key={k} on={effort === k} onClick={() => onChange({ effort: k })}>
            {effort === k ? '✓ ' : ''}{CON_EFFORTS[k].name}
          </Chip>
        ))}
      </div>
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Minutes (optional)</span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange({ minutes: Math.max(0, minutes - 5) })}
          aria-label="fewer minutes"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          −
        </button>
        <span className="num w-12 text-center text-9 font-[900]">{minutes || '—'}</span>
        <button
          onClick={() => onChange({ minutes: Math.min(120, (minutes || 0) + 5) })}
          aria-label="more minutes"
          className="grid h-8 w-8 place-items-center rounded-full border border-line2 text-8"
        >
          +
        </button>
      </div>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
