import { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { isEmptyLabel, parseLabelLines, parseLabelText, type ParsedNutritionLabel } from '@hybrid/nutrition-core';
import { recogniseLabel, toOcrLines, type LabelRecogniser } from '../../native/labelOcr';
import { Btn, Card, Input, Kicker, Screen, T, Title } from '../../ui';

/*
 * Reading a nutrition information panel — photographed, or typed.
 *
 * MacroTrack's `NutritionLabelScannerScreen.kt` photographed the panel and ran
 * ML Kit text recognition on the still. Phase 3d could not find a verifiable
 * on-device OCR path in a managed Expo workflow and shipped the typed half
 * alone. That survey missed `expo-mlkit-ocr`, which is a real Expo module —
 * `expo-module.config.json`, a config plugin, and an Android implementation on
 * `com.google.mlkit:text-recognition:16.0.1`, the SAME artifact and version the
 * Kotlin app pinned. So this is not an approximation of the reference scanner;
 * it is the same recogniser reached through an Expo module instead of through
 * hand-written CameraX plumbing, exactly as the barcode scanner next door is.
 *
 * ON-DEVICE, AND THAT IS THE POINT. This is used standing in a supermarket
 * aisle, on every food the athlete buys. A cloud vision call would be a
 * round-trip per label on a connection that is worst precisely where this gets
 * used. Nothing here leaves the phone.
 *
 * TWO DOORS, ONE READER. The photograph feeds `parseLabelLines`, which takes
 * positioned lines; typing feeds `parseLabelText`. Both are the same parser
 * behind the same fixtures, so the camera path cannot drift from the typed one.
 * THE TYPED PATH IS NOT A LEGACY: it is where every failure lands. A blurry
 * photo, a curved packet, a denied permission, an old APK without the native
 * module — each of those ends at a text box, never at a dead end.
 *
 * NOTHING IS WRITTEN FROM A SCAN. An OCR read is a proposal: it is shown, with
 * its basis and its rounding flag, and the athlete presses the button. The
 * reference confirmed too, and for the same reason — a misread digit that goes
 * straight into the log is a wrong macro nobody ever sees again.
 */

interface Props {
  /** Hand the read values to Create-a-food, pre-filled. */
  onUse: (parsed: ParsedNutritionLabel) => void;
  onCancel: () => void;
  /** Injected by tests; the screen defaults to the real on-device recogniser. */
  recognise?: LabelRecogniser;
}

type Phase =
  /** The text box: the entry point, and the floor every failure lands on. */
  | { kind: 'typing' }
  | { kind: 'camera' }
  | { kind: 'reading' }
  /** A photograph that parsed. Shown for confirmation; nothing is written yet. */
  | { kind: 'read'; parsed: ParsedNutritionLabel }
  | { kind: 'unreadable'; reason: string };

/**
 * What a photograph that produced nothing usable says.
 *
 * Told apart on purpose. "The camera could not take the photo", "no text was
 * found on it" and "text was found but no macro rows in it" are three different
 * problems with three different next moves, and collapsing them into "scan
 * failed" leaves the athlete re-taking the same useless photo.
 */
const NO_PHOTO = 'The camera could not take a photo of the panel.';
const NO_TEXT = 'No text could be made out on that photo. It is usually the focus or the light.';
const NO_ROWS =
  'Text was read, but no Energy, Protein, Fat or Carbohydrate rows were found in it — the panel may have been cut off or at too steep an angle.';

export function LabelReaderScreen({ onUse, onCancel, recognise = recogniseLabel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'typing' });
  const camera = useRef<CameraView>(null);
  /* The shutter is a real async round-trip. Without this a second tap while the
     first is in flight takes a second photo and races two OCR passes into the
     same state — the same hazard the barcode scanner guards per frame. */
  const busy = useRef(false);

  const typed = useMemo(() => parseLabelText(text), [text]);

  const capture = useCallback(async () => {
    const view = camera.current;
    if (!view || busy.current) return;
    busy.current = true;
    /* The phase is NOT moved to 'reading' before the shutter: that unmounts the
       CameraView this call is being made on, and takePictureAsync would be
       resolving against a view that no longer exists. The preview stays up
       until there is a photo in hand. */
    try {
      const photo = await view.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!photo?.uri) {
        setPhase({ kind: 'unreadable', reason: NO_PHOTO });
        return;
      }
      setPhase({ kind: 'reading' });
      const lines = toOcrLines(await recognise(photo.uri));
      if (!lines.length) {
        setPhase({ kind: 'unreadable', reason: NO_TEXT });
        return;
      }
      const parsed = parseLabelLines(lines);
      /* A panel that yields nothing is a failed scan, not a screen full of
         blanks with a live "Use these numbers" under it. */
      if (isEmptyLabel(parsed)) {
        setPhase({ kind: 'unreadable', reason: NO_ROWS });
        return;
      }
      setPhase({ kind: 'read', parsed });
    } catch {
      /* Every way this throws — a camera the OS took away, a native module a
         runtime-3 APK does not have, an image ML Kit could not decode — is the
         same thing to the athlete: this photo did not work, and the text box
         still does. */
      setPhase({ kind: 'unreadable', reason: NO_PHOTO });
    } finally {
      busy.current = false;
    }
  }, [recognise]);

  const toTyping = () => setPhase({ kind: 'typing' });
  const toCamera = () => setPhase({ kind: 'camera' });

  if (phase.kind === 'camera') {
    if (!permission) {
      return (
        <Frame onCancel={onCancel}>
          <T className="mt-2 text-3 text-muted">Checking camera access…</T>
        </Frame>
      );
    }
    if (!permission.granted) {
      return (
        <Frame onCancel={onCancel}>
          <Card tone="raised" className="mt-2">
            <T w="semi" className="text-6 text-text">
              Camera access is off
            </T>
            <T className="mt-1 text-3 text-muted">
              {permission.canAskAgain
                ? 'Photographing a panel needs the camera. The photo is read on this phone and never uploaded or saved.'
                : 'Camera access was denied for this app, so Android will not ask again. Turn it on in system settings, then come back.'}
            </T>
            <View className="mt-2 flex-row gap-1">
              <View className="min-w-0 flex-1">
                {/* A permanently denied permission makes `requestPermission` a
                    silent no-op, which reads as a broken button. */}
                <Btn
                  variant="brass"
                  onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
                  className="w-full"
                >
                  {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
                </Btn>
              </View>
              <View className="min-w-0 flex-1">
                <Btn onPress={toTyping} className="w-full">
                  Type it instead
                </Btn>
              </View>
            </View>
            <T className="mt-1 text-3 text-dim">
              The reader works either way. Typing the panel gives exactly the same numbers as photographing it.
            </T>
          </Card>
        </Frame>
      );
    }
    return (
      <Frame onCancel={onCancel}>
        <View className="mt-2 h-[300px] overflow-hidden rounded-lg border border-line bg-well">
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" accessibilityLabel="Label camera" />
        </View>
        <T className="mt-1.5 text-3 text-muted">
          Fill the frame with the nutrition information panel and hold still. Flat and square to the packet reads far
          better than close — a curved label is what usually fails.
        </T>
        <View className="mt-2 flex-row gap-1">
          <View className="min-w-0 flex-1">
            <Btn variant="brass" onPress={() => void capture()} className="w-full">
              Read this panel
            </Btn>
          </View>
          <View className="min-w-0 flex-1">
            <Btn onPress={toTyping} className="w-full">
              Type it instead
            </Btn>
          </View>
        </View>
      </Frame>
    );
  }

  if (phase.kind === 'reading') {
    return (
      <Frame onCancel={onCancel}>
        <Card tone="quiet" className="mt-2">
          <T className="text-3 text-muted">Reading the panel on this phone…</T>
        </Card>
      </Frame>
    );
  }

  if (phase.kind === 'unreadable') {
    return (
      <Frame onCancel={onCancel}>
        <Card tone="raised" className="mt-2">
          <T w="semi" className="text-6 text-text">
            Could not read that panel
          </T>
          <T className="mt-1 text-3 text-muted">{phase.reason}</T>
          <View className="mt-2 flex-row gap-1">
            <View className="min-w-0 flex-1">
              <Btn variant="brass" onPress={toCamera} className="w-full">
                Take another photo
              </Btn>
            </View>
            <View className="min-w-0 flex-1">
              {/* Always offered, and never a worse answer: it is the same
                  reader, and it cannot fail on focus or glare. */}
              <Btn onPress={toTyping} className="w-full">
                Type it instead
              </Btn>
            </View>
          </View>
          <T className="mt-1 text-3 text-dim">Nothing was read, so nothing was filled in or saved.</T>
        </Card>
      </Frame>
    );
  }

  if (phase.kind === 'read') {
    return (
      <Frame onCancel={onCancel}>
        <Card tone="quiet" className="mt-1.5">
          <T className="text-3 text-muted">
            Read off the photo. Check it against the packet before you use it — a misread digit looks exactly like a
            correct one.
          </T>
        </Card>
        <ReadOut parsed={phase.parsed} onUse={() => onUse(phase.parsed)}>
          <View className="min-w-0 flex-1">
            <Btn onPress={toCamera} className="w-full">
              Photo again
            </Btn>
          </View>
          <View className="min-w-0 flex-1">
            <Btn onPress={toTyping} className="w-full">
              Type it instead
            </Btn>
          </View>
        </ReadOut>
      </Frame>
    );
  }

  return (
    <Frame onCancel={onCancel}>
      <Card tone="raised" className="mt-2">
        <T w="semi" className="text-6 text-text">
          Photograph the panel
        </T>
        <T className="mt-1 text-3 text-muted">
          The text is recognised on this phone, with no connection and nothing uploaded. You confirm every number before
          it goes anywhere.
        </T>
        <View className="mt-2">
          <Btn variant="brass" onPress={toCamera} className="w-full">
            Scan the panel
          </Btn>
        </View>
      </Card>

      <Card tone="raised" className="mt-2">
        <T w="semi" className="text-2 uppercase tracking-widest text-dim">
          Or type the panel
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

      <ReadOut parsed={typed} onUse={() => onUse(typed)} />
    </Frame>
  );
}

function Frame({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Read a label</Title>
      <T className="mt-0.5 text-3 text-muted">
        Photograph the nutrition information panel, or type it, and this reads the macros out of it.
      </T>
      {children}
      <View className="mt-2">
        <Btn onPress={onCancel} className="w-full">
          Back to search
        </Btn>
      </View>
    </Screen>
  );
}

/**
 * What the reader got, and the one button that acts on it.
 *
 * Shared by both doors so a photographed panel and a typed one are confirmed
 * against the same display, showing the same caveats. The parser reports its
 * `basis` and its `roundedDown` flag rather than hiding either, and this is
 * where they get said out loud — a per-100 panel read as one serving is wrong
 * by however large the serving is, and nothing else on screen would show it.
 */
function ReadOut({
  parsed,
  onUse,
  children,
}: {
  parsed: ParsedNutritionLabel;
  onUse: () => void;
  /** Extra ways out, beside the confirm button. */
  children?: React.ReactNode;
}) {
  const nothing = isEmptyLabel(parsed);
  return (
    <Card tone="raised" className="mt-2">
      <T w="semi" className="text-6 text-text">
        What it read
      </T>

      {nothing ? (
        <T className="mt-1 text-3 text-muted">
          Nothing recognisable yet. The reader wants rows named Energy, Protein, Fat and Carbohydrate.
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

      {!nothing && parsed.basis === 'per_100' ? (
        <T className="mt-1.5 text-3 text-muted">
          This panel only prints a per-100 column, so these are per 100 {parsed.servingUnit === 'ml' ? 'ml' : 'g'}. The
          serving size is set to match.
        </T>
      ) : null}

      {!nothing && parsed.basis === 'per_serving' ? (
        <T className="mt-1.5 text-3 text-muted">These are per serving, which is the column this panel prints first.</T>
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
          <Btn variant="brass" disabled={nothing} onPress={onUse} className="w-full">
            Use these numbers
          </Btn>
        </View>
        {children}
      </View>

      <T className="mt-1 text-3 text-dim">
        Nothing is saved until you check it on the next screen. A blank field means the reader was not sure — type it
        yourself rather than trusting a guess.
      </T>
    </Card>
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
