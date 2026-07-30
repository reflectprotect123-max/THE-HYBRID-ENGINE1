import type { BlockKind } from '@hybrid/guided-flow';
import { Button } from '../../ui';

const CHOICES: { kind: Exclude<BlockKind, null>; label: string; glyph: string }[] = [
  { kind: 'lift', label: 'Lift', glyph: '🏋' },
  { kind: 'warmup', label: 'Warm-up / Cooldown', glyph: '☀' },
  { kind: 'cond', label: 'Conditioning', glyph: '♥' },
  { kind: 'metcon', label: 'Metcon / notes', glyph: '✎' },
];

export function BlockTypeStep({ onPick }: { onPick: (kind: Exclude<BlockKind, null>) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">What are we doing?</h1>
      <div className="grid grid-cols-2 gap-1.5">
        {CHOICES.map((c) => (
          <Button
            key={c.kind}
            variant="brass"
            size="lg"
            className="flex-col gap-0.5 !h-9 !w-[9.5rem]"
            onClick={() => onPick(c.kind)}
          >
            <span aria-hidden className="text-8">{c.glyph}</span>
            <span>{c.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
