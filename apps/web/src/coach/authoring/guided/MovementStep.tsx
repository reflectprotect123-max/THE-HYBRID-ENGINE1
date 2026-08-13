import { Button, Field, Kicker } from '../../../ui';

const MOVEMENT_LIST_ID = 'guided-movement-list';

export function MovementStep({
  value,
  known,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  known: string[];
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">Which movement?</h1>
      <Kicker>Type a name, or pick one you've done before</Kicker>
      <Field
        value={value}
        list={MOVEMENT_LIST_ID}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Movement"
        aria-label="movement name"
        className="max-w-[18rem]"
      />
      <datalist id={MOVEMENT_LIST_ID}>
        {known.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Next
        </Button>
      </div>
    </div>
  );
}
