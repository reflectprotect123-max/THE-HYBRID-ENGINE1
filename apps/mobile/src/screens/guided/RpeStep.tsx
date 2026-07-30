import { View } from 'react-native';
import { Btn, Chip, Title } from '../../ui';

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
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>How hard should it feel?</Title>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {RPE_VALUES.map((r) => (
          <Chip key={r} on={value === r} onPress={() => onChange(r)}>
            {(value === r ? '✓ ' : '') + 'RPE ' + r}
          </Chip>
        ))}
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
