import type { BlockKind } from '@hybrid/guided-flow';
import { Button } from '../../ui';

const CHOICES: { kind: Exclude<BlockKind, null>; label: string; glyph: string }[] = [
  { kind: 'lift', label: 'Lift', glyph: '🏋' },
  { kind: 'warmup', label: 'Warm-up / Cooldown', glyph: '☀' },
  { kind: 'cond', label: 'Conditioning', glyph: '♥' },
  { kind: 'metcon', label: 'Metcon / notes', glyph: '✎' },
];

/**
 * The flow's first question.
 *
 * `onBack` is a cancel rather than a step back — there is no earlier step — and
 * it is the only way out of the wizard: without it an athlete who opened this by
 * accident was stuck here, and the empty session the Library minted on the way
 * in survived as a phantom (see GuidedBuilder's `abandon`).
 */
export function BlockTypeStep({
  onPick,
  onBack,
}: {
  onPick: (kind: Exclude<BlockKind, null>) => void;
  onBack: () => void;
}) {
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
      <Button className="mt-1" onClick={onBack} aria-label="cancel and go back to the library">
        ‹ Cancel
      </Button>
    </div>
  );
}
