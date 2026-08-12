import { View } from 'react-native';
import { WORLDS, resolvePalette, type WorldId } from '@hybrid/design';
import { setDiscipline, useDiscipline } from '../discipline';
import { T, Tap } from '../ui';

/**
 * The merged app's only cross-world chrome: the row that moves between worlds.
 *
 * It was a TOGGLE while there were two worlds — one row naming the only other
 * place you could be. With three, "the other one" stops existing, so this is a
 * chooser: every world is present, the one you are in is shown selected rather
 * than hidden, and the destination's accent is on its dot BEFORE you tap.
 *
 * Still no confirmation: switching destroys nothing, and the app-wide theme
 * change IS the arrival feedback. This is also the only way OUT of the
 * nutrition world, which is why it renders on that world's Settings too — a
 * sealed world with no door is a trap, not a seal.
 */

const NAMES: Record<WorldId, string> = {
  strength: 'Strength',
  conditioning: 'Conditioning',
  nutrition: 'Nutrition',
};

export function WorldSwitch() {
  const world = useDiscipline();
  return (
    <View className="mt-2 flex-row gap-1">
      {WORLDS.map((id) => {
        const on = id === world;
        return (
          <View key={id} className="min-w-0 flex-1">
            <Tap
              box={{ h: 48 }}
              role="radio"
              selected={on}
              onPress={() => setDiscipline(id)}
              /* Named for the ACTION, not the state: "Strength" alone leaves a
                 screen reader user unable to tell a destination from a label.
                 The current world says so instead of offering a move that
                 would do nothing. */
              label={on ? `${NAMES[id]}, current world` : `Switch to ${NAMES[id]}`}
              className={`flex-row items-center justify-center gap-0.5 rounded-md border px-1 py-1.5 ${
                on ? 'border-gold-line bg-gold-wash' : 'border-line2 bg-panel2'
              }`}
            >
              <View
                importantForAccessibility="no-hide-descendants"
                style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: resolvePalette(id).gold }}
              />
              <T w="med" className={`text-3 ${on ? 'text-gold2' : 'text-text'}`}>
                {NAMES[id]}
              </T>
            </Tap>
          </View>
        );
      })}
    </View>
  );
}
