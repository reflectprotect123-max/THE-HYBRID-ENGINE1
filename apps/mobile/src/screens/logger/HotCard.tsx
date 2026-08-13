import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { plateBreakdown } from '@hybrid/engine';
import type { Action, Draft, HotSet } from '@hybrid/session-authoring';
import { useLoggerStyles } from './styles';

/*
 * The live set — one hot card, one decision at a time.
 *
 * Every value shown here is read straight off `HotSet`/`Draft`, both handed
 * down from `useSession`'s view: this file computes no weight, no next set, no
 * coaching line. `hot.message` in particular renders VERBATIM — it is
 * `@hybrid/engine`'s `foldFromExercise` speaking, pinned by
 * `packages/engine/test/golden/foldExercise.json`, and every branch of it
 * (including a long one with an em dash) must reach the screen unedited.
 *
 * The only state this component owns is whether the weight field is in edit
 * mode. Every value change goes out through `dispatch({ type: 'setDraft' })` —
 * the same action the web body used on the same hook.
 *
 * Plate maths is `@hybrid/engine`'s own `plateBreakdown`, the same call the
 * old `Logger.tsx` made. There is not a second copy of that arithmetic here.
 */

const BAR_KG = 20;
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

/** The chip ladder, in the prototype's own order and values. The hook is the
 *  value with its decimal point removed — `7.5` is `rpe-75` and `10` is
 *  `rpe-10` — the same `String(v).replace('.', '')` rule the prototype and
 *  `checks/parity/script.mjs` both use. Getting this wrong once already cost a
 *  round of the gate: a table that said `rpe-100` agreed with the prototype on
 *  every half-point value and disagreed only on 7, 8, 9 and 10. */
const RPE_CHIPS = [7, 7.5, 8, 8.5, 9, 9.5, 10].map((value) => ({
  value,
  key: String(value).replace('.', ''),
}));

export function HotCard({
  hot,
  draft,
  dispatch,
  label,
  weighted,
}: {
  hot: HotSet;
  draft: Draft;
  dispatch: (action: Action) => void;
  /** `superset ? hot.exerciseName : 'Set N'` — built once by `BlockScreen`,
   *  which already forms this label for every other row in the round. */
  label: string;
  /** Whether this exercise records a load at all. */
  weighted: boolean;
}) {
  const st = useLoggerStyles();
  const [editingKg, setEditingKg] = useState(false);
  const typed = useRef('');

  const setDraft = (patch: Partial<Draft>) => dispatch({ type: 'setDraft', patch });

  const commitKg = () => {
    const v = parseFloat(typed.current);
    if (Number.isFinite(v) && v >= 0) setDraft({ kg: v });
    setEditingKg(false);
  };

  const plates = weighted && draft.kg > 0 ? plateBreakdown(draft.kg, BAR_KG, PLATES_KG) : null;
  const ready = draft.reps > 0 && draft.felt != null;

  return (
    <View style={st.card}>
      <Text testID="hot-name" style={st.hotName}>
        {label}
      </Text>
      <Text testID="hot-presc" style={st.hotPresc}>
        {hot.planned.reps} reps @ RPE {hot.planned.rpe}
      </Text>
      <Text testID="hot-why" style={st.hotWhy}>
        {hot.message}
      </Text>

      <View style={st.hotRow}>
        {weighted ? (
          <View style={st.kgWrap}>
            <Text style={st.fieldLabel}>weight</Text>
            {editingKg ? (
              <TextInput
                testID="hot-kg"
                accessibilityLabel="Kilograms"
                inputMode="decimal"
                autoFocus
                defaultValue={String(draft.kg)}
                onChangeText={(t) => {
                  typed.current = t;
                }}
                onBlur={commitKg}
                onSubmitEditing={commitKg}
                style={st.kgInput}
              />
            ) : (
              <Pressable
                testID="hot-kg"
                accessibilityRole="button"
                accessibilityLabel="Weight, tap to edit"
                onPress={() => {
                  typed.current = String(draft.kg);
                  setEditingKg(true);
                }}
              >
                {/* Two siblings on a shared baseline rather than a nested
                    `<Text>`: React Native does not apply margin to nested
                    text, and the gap has to come from layout. The rendered
                    string is still exactly `60kg` — no space — which is what
                    the recorded trace pins. */}
                <View style={st.kgLine}>
                  <Text style={st.kgValue}>{draft.kg}</Text>
                  <Text style={st.kgUnit}>kg</Text>
                </View>
              </Pressable>
            )}
            {plates ? (
              <Text style={st.plates}>
                {plates.perSide.length ? `per side: ${plates.perSide.join(' · ')}` : 'bar only'}
                {!plates.loadable
                  ? ` — nearest is ${plates.achievableKg}kg (${plates.delta > 0 ? '+' : ''}${plates.delta})`
                  : ''}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={[st.repsCol, !weighted && st.repsColWide]}>
          <Text style={st.fieldLabel}>reps</Text>
          <View style={st.repsRow}>
            <Pressable
              testID="reps-down"
              accessibilityRole="button"
              accessibilityLabel="One rep fewer"
              onPress={() => setDraft({ reps: Math.max(0, draft.reps - 1) })}
              style={st.stepper}
            >
              <Text style={st.stepperInk}>−</Text>
            </Pressable>
            <Text style={st.repsValue}>{draft.reps}</Text>
            <Pressable
              testID="reps-up"
              accessibilityRole="button"
              accessibilityLabel="One rep more"
              onPress={() => setDraft({ reps: draft.reps + 1 })}
              style={st.stepper}
            >
              <Text style={st.stepperInk}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Text style={st.chipsLabel}>how hard was it</Text>
      <View style={st.chips}>
        {RPE_CHIPS.map(({ value, key }) => {
          const on = draft.felt === value;
          return (
            <Pressable
              key={key}
              testID={`rpe-${key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setDraft({ felt: value })}
              style={[st.chip, on ? st.chipOn : st.chipOff]}
            >
              <Text style={on ? st.chipInkOn : st.chipInkOff}>{value}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        testID="log"
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={() => dispatch({ type: 'logSet' })}
        style={[st.cta, ready ? st.ctaOn : st.ctaOff]}
      >
        <Text style={ready ? st.ctaInkOn : st.ctaInkOff}>Log set</Text>
      </Pressable>
    </View>
  );
}
