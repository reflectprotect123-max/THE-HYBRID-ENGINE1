import { Button, Chip } from '../../ui';

const PRESETS = ['5', '8', '10', '12', 'max'];

export function RepsStep({
  value,
  isWarmupSet,
  onChange,
  onWarmupSetChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  isWarmupSet: boolean;
  onChange: (v: string) => void;
  onWarmupSetChange: (v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  /*
   * Derived, never held in local state.
   *
   * As a `useState` this reset to '' every time the step unmounted — which is
   * every Back navigation — while the orchestrator's `value` still held what was
   * typed. The step then showed an empty box and no chip selected with Next
   * enabled and nothing to say why. Deriving it removes the desync by
   * construction: anything that is not a preset IS the custom target.
   */
  const custom = PRESETS.includes(value) ? '' : value;
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many reps?</h1>
      {/* The whole row is the target, not the 13px box. tokens.css's coarse-pointer
          44px rule deliberately skips checkboxes (a stretched checkbox looks
          broken), so the row it sits in has to carry the minimum itself. */}
      <label className="flex min-h-[44px] cursor-pointer items-center gap-1 px-1 text-4">
        <input
          type="checkbox"
          checked={isWarmupSet}
          onChange={(e) => onWarmupSetChange(e.target.checked)}
        />
        This is a warm-up
      </label>
      <div className="flex flex-wrap justify-center gap-1">
        {PRESETS.map((r) => (
          <Chip key={r} on={value === r} onClick={() => onChange(r)}>
            {value === r ? '✓ ' : ''}{r}
          </Chip>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => onChange(e.target.value)}
        placeholder="or type a custom target, e.g. 8-12"
        aria-label="custom reps target"
        className="h-5 w-[16rem] rounded-md border border-line bg-well px-1.5 text-center text-4 outline-none focus:border-gold-line"
      />
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
