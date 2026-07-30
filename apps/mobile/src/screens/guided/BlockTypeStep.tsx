import { View } from 'react-native';
import type { BlockKind } from '@hybrid/guided-flow';
import { Btn, T, Title } from '../../ui';

const CHOICES: { kind: Exclude<BlockKind, null>; label: string; glyph: string }[] = [
  { kind: 'lift', label: 'Lift', glyph: '🏋' },
  { kind: 'warmup', label: 'Warm-up / Cooldown', glyph: '☀' },
  { kind: 'cond', label: 'Conditioning', glyph: '♥' },
  { kind: 'metcon', label: 'Metcon / notes', glyph: '✎' },
];

export function BlockTypeStep({ onPick }: { onPick: (kind: Exclude<BlockKind, null>) => void }) {
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
    </View>
  );
}
