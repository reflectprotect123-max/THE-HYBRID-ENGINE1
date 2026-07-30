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
  /*
   * The custom box shows `value` directly rather than tracking its own state:
   * a `useState` here reset to '' on every Back navigation (a remount) while
   * the orchestrator's `value` still held what was typed, desyncing the two.
   * Blanking the box whenever `value` happens to match a preset string
   * (e.g. mid-typing "8-12", the moment the box reads "8") clobbers a custom
   * value while it's being typed, so it isn't blanked at all — a preset chip
   * being selected shows in the chip's own highlighted state.
   */
  return (
    <View className="flex-1 items-center justify-center gap-3 p-4">
      <Title>How many reps?</Title>
      <Tap
        onPress={() => onWarmupSetChange(!isWarmupSet)}
        label="this is a warm-up"
        box={{ h: 40 }}
        selected={isWarmupSet}
        className="flex-row items-center gap-1"
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
      <View className="flex-row flex-wrap justify-center gap-1">
        {PRESETS.map((r) => (
          <Chip key={r} on={value === r} onPress={() => onChange(r)}>
            {(value === r ? '✓ ' : '') + r}
          </Chip>
        ))}
      </View>
      <Input
        value={value}
        onChangeText={onChange}
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
