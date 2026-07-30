import { View } from 'react-native';
import { Btn, Input, Title } from '../../ui';

export function TextStep({
  question,
  value,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  question: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>{question}</Title>
      <Input
        value={value}
        onChangeText={onChange}
        placeholder="Type here"
        accessibilityLabel={question}
        multiline
        numberOfLines={6}
        style={{ height: 140, width: '100%', textAlignVertical: 'top' }}
      />
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Done
        </Btn>
      </View>
    </View>
  );
}
