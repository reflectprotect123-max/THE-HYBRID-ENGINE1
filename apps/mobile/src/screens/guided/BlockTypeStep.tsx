import { View } from 'react-native';
import type { BlockKind } from '@hybrid/guided-flow';
import { Btn, Title } from '../../ui';

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
 * in survived as a phantom (see GuidedBuilder's `dropPhantom`).
 */
export function BlockTypeStep({
  onPick,
  onBack,
}: {
  onPick: (kind: Exclude<BlockKind, null>) => void;
  onBack: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>What are we doing?</Title>
      <View className="flex-row flex-wrap justify-center gap-2">
        {CHOICES.map((c) => (
          <Btn key={c.kind} variant="brass" size="lg" onPress={() => onPick(c.kind)} label={c.label}>
            {c.glyph + ' ' + c.label}
          </Btn>
        ))}
      </View>
      <Btn className="mt-2" onPress={onBack} label="cancel and go back to the library">
        ‹ Cancel
      </Btn>
    </View>
  );
}
