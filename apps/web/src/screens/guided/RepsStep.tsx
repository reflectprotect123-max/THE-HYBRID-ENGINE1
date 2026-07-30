import { useState } from 'react';
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
  const [custom, setCustom] = useState('');
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How many reps?</h1>
      <label className="flex items-center gap-1 text-4">
        <input
          type="checkbox"
          checked={isWarmupSet}
          onChange={(e) => onWarmupSetChange(e.target.checked)}
        />
        This is a warm-up
      </label>
      <div className="flex flex-wrap justify-center gap-1">
        {PRESETS.map((r) => (
          <Chip key={r} on={value === r} onClick={() => { onChange(r); setCustom(''); }}>
            {value === r ? '✓ ' : ''}{r}
          </Chip>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }}
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
