import { Button } from '../../../ui';

export function TextStep({
  question,
  value,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  /** e.g. "What's the warm-up?" or "What's the workout?" */
  question: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">{question}</h1>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        aria-label={question}
        className="w-full max-w-[24rem] resize-y rounded-md border border-line bg-well p-1.5 text-4 outline-none focus:border-gold-line"
      />
      <div className="mt-1 flex gap-1">
        <Button onClick={onBack} aria-label="back">‹ Back</Button>
        <Button variant="brass" onClick={onNext} disabled={disabled}>
          Done
        </Button>
      </div>
    </div>
  );
}
