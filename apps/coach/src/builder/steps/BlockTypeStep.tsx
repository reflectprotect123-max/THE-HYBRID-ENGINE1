import { BRASS } from '../../ui';

const CHOICES: { kind: 'lift' | 'warmup' | 'cond' | 'metcon'; label: string; icon: string }[] = [
  { kind: 'lift', label: 'Lift', icon: '🏋' },
  { kind: 'warmup', label: 'Warm-up / Cooldown', icon: '☀' },
  { kind: 'cond', label: 'Conditioning', icon: '♥' },
  { kind: 'metcon', label: 'Metcon / notes', icon: '✎' },
];

export function BlockTypeStep({ onPick }: { onPick: (kind: 'lift' | 'warmup' | 'cond' | 'metcon') => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What are we doing?</h1>
      <div className="grid w-full max-w-[420px] grid-cols-2 gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.kind}
            onClick={() => onPick(c.kind)}
            className={BRASS + ' flex h-10 flex-col items-center justify-center gap-0.5 text-5'}
          >
            <span aria-hidden="true" className="text-7">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
