import { View } from 'react-native';
import { Tap } from '../../ui';

/**
 * The chain BETWEEN two movements, not a row inside one — see the web
 * Planner's twin. Drawn rather than glyphed: react-native-svg is not a
 * dependency and a chain emoji renders in full colour, off the palette.
 */
export function SupersetSeam({
  on,
  exName,
  nextName,
  onPress,
}: {
  on: boolean;
  exName: string;
  nextName: string;
  onPress: () => void;
}) {
  return (
    <View className="relative items-center justify-center py-0.5">
      <View className="absolute inset-y-0 w-px bg-line2" />
      <Tap
        onPress={onPress}
        role="radio"
        selected={on}
        label={on ? `Split the superset between ${exName} and ${nextName}` : `Superset ${exName} with ${nextName}`}
        box={{ h: 26, w: 48 }}
        className={`h-3.5 w-6 flex-row items-center justify-center gap-0.5 rounded-pill border ${
          on ? 'border-gold bg-gold' : 'border-dashed border-line2 bg-panel2'
        }`}
      >
        <View className={`h-1.5 w-2 rounded-pill border ${on ? 'border-[#1b1509]' : 'border-muted'}`} />
        <View className={`-ml-1 h-1.5 w-2 rounded-pill border ${on ? 'border-[#1b1509]' : 'border-muted'}`} />
      </Tap>
    </View>
  );
}
