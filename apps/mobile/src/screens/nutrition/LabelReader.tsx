import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { isEmptyLabel, parseLabelText, type ParsedNutritionLabel } from '@hybrid/nutrition-core';
import { Btn, Card, Input, Kicker, Screen, T, Title } from '../../ui';

/*
 * Reading a nutrition information panel — WITHOUT a camera, deliberately.
 *
 * MacroTrack's `NutritionLabelScannerScreen.kt` photographed the panel and ran
 * ML Kit text recognition on the still. That half does not exist here, and the
 * spike that established why is recorded in the Phase 3d handoff. In short:
 * `expo-camera` has no text recognition, and every route to on-device OCR in
 * React Native is a third-party native module this managed workflow cannot
 * verify without an Android toolchain, a fresh dev-client build and a real
 * device — none of which the build environment has. Shipping an unverified
 * native OCR module would have risked the Metro bundle and the runtime version
 * of an app that is otherwise fine.
 *
 * So the camera is deferred and THE PARSE IS NOT. The parse is the part the
 * reference spent 12 fixtures getting right, and it is pure: text in, macros
 * out. `@hybrid/nutrition-core`'s `parseLabelText` is that logic, ported whole,
 * reachable today by typing or pasting the panel instead of photographing it.
 * When a camera lands, it feeds `parseLabelLines` and this screen keeps working
 * unchanged.
 *
 * This screen SAYS all of that out loud rather than implying a scanner. An
 * athlete who expects a camera and finds a text box has been misled; one who is
 * told the camera is not here yet has been told the truth.
 */

interface Props {
  /** Hand the read values to Create-a-food, pre-filled. */
  onUse: (parsed: ParsedNutritionLabel) => void;
  onCancel: () => void;
}

export function LabelReaderScreen({ onUse, onCancel }: Props) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseLabelText(text), [text]);
  const nothing = isEmptyLabel(parsed);

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Read a label</Title>
      <T className="mt-0.5 text-3 text-muted">
        Type or paste the nutrition information panel and this reads the macros out of it.
      </T>

      <Card tone="quiet" className="mt-1.5">
        <T className="text-3 text-muted">
          There is no camera here yet. Photographing a panel needs on-device text recognition that this app cannot build
          today — the reader itself is finished and works on the text.
        </T>
      </Card>

      <Card tone="raised" className="mt-2">
        <T w="semi" className="text-2 uppercase tracking-widest text-dim">
          The panel
        </T>
        <Input
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          accessibilityLabel="Nutrition panel text"
          placeholder={'Serving size: 30g\nEnergy 520kJ\nProtein 3.2g\nFat, total 2.1g\nCarbohydrate 15.6g'}
          className="mt-1 min-h-[140px] rounded-md border border-line bg-well p-1 text-4 text-text"
        />
        <T className="mt-1 text-3 text-dim">
          One row per line. Energy in kJ is converted for you. Sub-rows like “saturated” and “sugars” are ignored, which
          is what keeps them out of the totals.
        </T>
      </Card>

      <Card tone="raised" className="mt-2">
        <T w="semi" className="text-6 text-text">
          What it read
        </T>

        {nothing ? (
          <T className="mt-1 text-3 text-muted">
            {text.trim()
              ? 'Nothing recognisable yet. The reader wants rows named Energy, Protein, Fat and Carbohydrate.'
              : 'Nothing yet.'}
          </T>
        ) : (
          <View className="mt-1">
            <ReadRow label="Energy" value={parsed.calories} unit="kcal" />
            <ReadRow label="Protein" value={parsed.proteinG} unit="g" />
            <ReadRow label="Carbs" value={parsed.carbsG} unit="g" />
            <ReadRow label="Fat" value={parsed.fatG} unit="g" />
            <ReadRow label="Serving" value={parsed.servingQty} unit={parsed.servingUnit ?? ''} />
          </View>
        )}

        {/* A per-100g panel read as one serving's macros is wrong by however
            large the serving is, and nothing on screen would show it. The
            parser reports the basis rather than assuming one, so it can be
            said here instead of discovered in a week of bad totals. */}
        {!nothing && parsed.basis === 'per_100' ? (
          <T className="mt-1.5 text-3 text-muted">
            This panel only prints a per-100 column, so these are per 100 {parsed.servingUnit === 'ml' ? 'ml' : 'g'}. The
            serving size is set to match.
          </T>
        ) : null}

        {!nothing && parsed.roundedDown ? (
          <T className="mt-1.5 text-3 text-muted">
            A row read “less than 1 g” and was taken as 0. That is the most the label says — correct it if you know
            better.
          </T>
        ) : null}

        {!nothing && parsed.servingQty == null && parsed.basis !== 'per_100' ? (
          <T className="mt-1.5 text-3 text-muted">
            No serving size found, so you will need to enter what these numbers are for on the next screen. Nothing is
            guessed for you.
          </T>
        ) : null}

        <View className="mt-2 flex-row gap-1">
          <View className="min-w-0 flex-1">
            <Btn variant="brass" disabled={nothing} onPress={() => onUse(parsed)} className="w-full">
              Use these numbers
            </Btn>
          </View>
          <View className="min-w-0 flex-1">
            <Btn onPress={onCancel} className="w-full">
              Cancel
            </Btn>
          </View>
        </View>

        <T className="mt-1 text-3 text-dim">
          Nothing is saved until you check it on the next screen. A blank field means the reader was not sure — type it
          yourself rather than trusting a guess.
        </T>
      </Card>
    </Screen>
  );
}

/** One read value, or a plain blank when the parser refused to guess. */
function ReadRow({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <View className="mt-0.5 flex-row items-center justify-between">
      <T className="text-4 text-muted">{label}</T>
      {value == null ? (
        <T className="text-4 text-dim">not found</T>
      ) : (
        <T w="med" num className="text-4 text-text">
          {round(value)}
          {unit ? ` ${unit}` : ''}
        </T>
      )}
    </View>
  );
}

/** One decimal, and no trailing ".0" — 124.28 kcal from a kJ row reads as 124.3. */
const round = (n: number): string => String(Math.round(n * 10) / 10);
