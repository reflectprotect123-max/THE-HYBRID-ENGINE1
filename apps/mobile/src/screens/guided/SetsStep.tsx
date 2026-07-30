import { View } from 'react-native';
import { Btn, T, Tap, Title } from '../../ui';

export function SetsStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: number;
  onChange: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>How many sets?</Title>
      <View className="flex-row items-center gap-4">
        <Tap
          onPress={() => onChange(Math.max(1, value - 1))}
          label="fewer sets"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">−</T>
        </Tap>
        <T num w="black" className="w-12 text-center text-9">{String(value)}</T>
        <Tap
          onPress={() => onChange(Math.min(20, value + 1))}
          label="more sets"
          box={{ h: 40, w: 40 }}
          className="h-5 w-5 items-center justify-center rounded-full border border-line2"
        >
          <T className="text-8">+</T>
        </Tap>
      </View>
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext}>Next</Btn>
      </View>
    </View>
  );
}
