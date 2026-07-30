import { View } from 'react-native';
import { Btn, Chip, Input, T, Title } from '../../ui';

const MAX_SUGGEST = 6;

function Suggest({ typed, known, onPick }: { typed: string; known: string[]; onPick: (name: string) => void }) {
  const q = String(typed || '').trim().toLowerCase();
  const hits = known.filter((n) => n.toLowerCase() !== q && (!q || n.toLowerCase().includes(q))).slice(0, MAX_SUGGEST);
  if (!hits.length) return null;
  return (
    <View className="mt-1 flex-row flex-wrap justify-center gap-1">
      {hits.map((n) => (
        <Chip key={n} onPress={() => onPick(n)}>
          {n}
        </Chip>
      ))}
    </View>
  );
}

export function MovementStep({
  value,
  known,
  onChange,
  onNext,
  onBack,
  disabled,
}: {
  value: string;
  known: string[];
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>Which movement?</Title>
      <T className="text-3 text-muted">Type a name, or pick one you've done before</T>
      <Input value={value} onChangeText={onChange} placeholder="Movement" accessibilityLabel="movement name" />
      <Suggest typed={value} known={known} onPick={onChange} />
      <View className="mt-2 flex-row gap-2">
        <Btn onPress={onBack} label="back">‹ Back</Btn>
        <Btn variant="brass" onPress={onNext} disabled={disabled}>
          Next
        </Btn>
      </View>
    </View>
  );
}
