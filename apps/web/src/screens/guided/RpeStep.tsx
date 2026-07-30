import { Button, Chip } from '../../ui';

const RPE_VALUES = ['6', '7', '8', '9', '10'];

export function RpeStep({
  value,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">How hard should it feel?</h1>
      <div className="flex flex-wrap justify-center gap-1">
        {RPE_VALUES.map((r) => (
          <Chip key={r} on={value === r} onClick={() => onChange(r)}>
            {value === r ? '✓ ' : ''}RPE {r}
          </Chip>
        ))}
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
