import { useState } from 'react';
import { View } from 'react-native';
import { Btn, Chip, Input, T, Tap, Title } from '../../ui';

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
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>How many reps?</Title>
      <Tap
        onPress={() => onWarmupSetChange(!isWarmupSet)}
        label="this is a warm-up"
        box={{ h: 40 }}
        selected={isWarmupSet}
        className="flex-row items-center gap-1.5"
      >
        <View
          className={`h-5 w-5 items-center justify-center rounded border ${
            isWarmupSet ? 'border-gold-line bg-gold-wash' : 'border-line2'
          }`}
        >
          {isWarmupSet ? <T className="text-3">✓</T> : null}
        </View>
        <T className="text-4">This is a warm-up</T>
      </Tap>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {PRESETS.map((r) => (
          <Chip key={r} on={value === r} onPress={() => { onChange(r); setCustom(''); }}>
            {(value === r ? '✓ ' : '') + r}
          </Chip>
        ))}
      </View>
      <Input
        value={custom}
        onChangeText={(v) => { setCustom(v); onChange(v); }}
        placeholder="or type a custom target, e.g. 8-12"
        accessibilityLabel="custom reps target"
      />
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Next
        </Btn>
      </View>
    </View>
  );
}
