import { View } from 'react-native';
import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { Btn, Chip, T, Tap, Title } from '../../ui';

export function CondDetailStep({
  condFmt,
  effort,
  minutes,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  condFmt: CondFmtKey | '';
  effort: EffortKey;
  minutes: number;
  onChange: (patch: { condFmt?: CondFmtKey; effort?: EffortKey; minutes?: number }) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>What kind of conditioning?</Title>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {CON_FORMAT_KEYS.map((k) => (
          <Chip key={k} on={condFmt === k} onPress={() => onChange({ condFmt: k })}>
            {(condFmt === k ? '✓ ' : '') + CON_FORMATS[k].name}
          </Chip>
        ))}
      </View>
      <T className="text-2 uppercase text-dim">Effort</T>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {CON_EFFORT_KEYS.map((k) => (
          <Chip key={k} on={effort === k} onPress={() => onChange({ effort: k })}>
            {(effort === k ? '✓ ' : '') + CON_EFFORTS[k].name}
          </Chip>
        ))}
      </View>
      <T className="text-2 uppercase text-dim">Minutes (optional)</T>
      <View className="flex-row items-center gap-4">
        <Tap
          onPress={() => onChange({ minutes: Math.max(0, minutes - 5) })}
          label="fewer minutes"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">−</T>
        </Tap>
        <T num w="black" className="w-12 text-center text-9">{minutes || '—'}</T>
        <Tap
          onPress={() => onChange({ minutes: Math.min(120, (minutes || 0) + 5) })}
          label="more minutes"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">+</T>
        </Tap>
      </View>
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Next
        </Btn>
      </View>
    </View>
  );
}
