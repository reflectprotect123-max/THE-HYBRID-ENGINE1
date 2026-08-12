import { useCallback, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import type { CachedFood } from '@hybrid/nutrition-core';
import { lookupBarcode, type CatalogueBarcodeLookup } from '../../cloud/catalogue';
import { Btn, Card, Kicker, Screen, T, Title } from '../../ui';

/*
 * Scanning a packaged food's barcode. Ported from MacroTrack's
 * `BarcodeScannerScreen.kt`.
 *
 * THE SAME SCANNER, THROUGH A DIFFERENT DOOR. The reference drove CameraX +
 * `com.google.mlkit:barcode-scanning:17.3.0` by hand. `expo-camera` 17 on
 * Android depends on that exact ML Kit artifact and version and drives CameraX
 * itself, so this is not a weaker substitute — it is the same decoder with the
 * frame plumbing owned by a first-party Expo module instead of by us. The 380
 * lines of analyzer/executor/lifecycle management in the Kotlin screen have no
 * counterpart here because none of it is ours to write any more.
 *
 * WHAT THIS SCREEN REFUSES TO DO, exactly as the reference refused: it hands
 * the raw scanned value to the catalogue and nothing else. It does not decide
 * a UPC is an EAN, does not pad a leading zero, does not fall back to a name
 * search, and does not call Open Food Facts directly. A barcode that nearly
 * matches is a different product, and the wrong product's macros are silent.
 *
 * A BARCODE THAT IS NOT IN THE CATALOGUE IS THE NORMAL CASE, not an error:
 * 5,000 seeded rows against a supermarket means most scans miss. The miss ends
 * at a pre-filled Create-a-food screen carrying the barcode, so the next scan
 * of that product finds it.
 */

/**
 * The symbologies a packaged food actually carries.
 *
 * EAN-13 is the Australian retail default, EAN-8 the small-package form, and
 * UPC-A/UPC-E the North American imports on the same shelves. Code 128 is here
 * because AU house brands print it on variable-weight items. QR, PDF417,
 * Aztec and DataMatrix are deliberately absent: a QR code on a package is a
 * marketing URL, and scanning one would hand the catalogue a string that can
 * never match a barcode column.
 */
const FOOD_BARCODES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'];

type Phase =
  | { kind: 'scanning' }
  | { kind: 'looking'; code: string }
  | { kind: 'missing'; code: string }
  | { kind: 'failed'; code: string; message: string };

interface Props {
  /** The scanned food, resolved from the catalogue. Goes to the log sheet. */
  onFound: (food: CachedFood) => void;
  /** No catalogue row for this barcode — create a food carrying it. */
  onCreateFood: (barcode: string) => void;
  onCancel: () => void;
  /** Injected so a test — and an offline device — needs no network. */
  lookup?: CatalogueBarcodeLookup;
}

export function BarcodeScannerScreen({ onFound, onCreateFood, onCancel, lookup = lookupBarcode }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });

  /* `onBarcodeScanned` fires per FRAME, not per barcode: a code held in view
     for a second is dozens of callbacks. The ref is what makes the first one
     the only one — state would not, because the next frame arrives before a
     re-render has moved `phase` off 'scanning'. The reference guards the same
     hazard with an AtomicBoolean in its analyzer. */
  const busy = useRef(false);

  const scan = useCallback(
    (result: BarcodeScanningResult) => {
      const code = result.data?.trim();
      if (!code || busy.current) return;
      busy.current = true;
      setPhase({ kind: 'looking', code });
      lookup(code)
        .then((food) => {
          if (food) {
            onFound(food);
            return;
          }
          setPhase({ kind: 'missing', code });
        })
        .catch(() => {
          /* The athlete's problem, not PostgREST's wording. "Not in the
             catalogue" and "could not ask the catalogue" are different
             answers and only one of them means the food does not exist. */
          setPhase({
            kind: 'failed',
            code,
            message: 'The shared food catalogue could not be reached, so this barcode could not be looked up.',
          });
        });
    },
    [lookup, onFound],
  );

  const scanAgain = () => {
    busy.current = false;
    setPhase({ kind: 'scanning' });
  };

  /* Null means the permission has not been read back yet — a single frame on
     a real device, but rendering the denied state during it would flash a
     refusal at an athlete who never refused anything. */
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
              ? 'Scanning a barcode needs the camera. Nothing is recorded or uploaded — the frames are read on this phone and discarded.'
              : 'Camera access was denied for this app, so Android will not ask again. Turn it on in system settings, then come back.'}
          </T>
          <View className="mt-2 flex-row gap-1">
            <View className="min-w-0 flex-1">
              {/* A permanently denied permission makes `requestPermission` a
                  silent no-op, which reads as a broken button. Settings is
                  the only route left, so it becomes the only one offered. */}
              <Btn variant="brass" onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()} className="w-full">
                {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
              </Btn>
            </View>
            <View className="min-w-0 flex-1">
              <Btn onPress={onCancel} className="w-full">
                Search instead
              </Btn>
            </View>
          </View>
          <T className="mt-1 text-3 text-dim">
            Everything else in Food works without the camera — search, quick add and your own foods.
          </T>
        </Card>
      </Frame>
    );
  }

  return (
    <Frame onCancel={onCancel}>
      <View className="mt-2 h-[240px] overflow-hidden rounded-lg border border-line bg-well">
        {/* The camera is unmounted while a lookup or a result is on screen.
            Leaving it running behind a card keeps the torch-hot preview and
            the frame callbacks alive for a screen nobody is scanning with. */}
        {phase.kind === 'scanning' ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: FOOD_BARCODES }}
            onBarcodeScanned={scan}
            accessibilityLabel="Barcode camera"
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <T className="text-3 text-dim">Camera paused</T>
          </View>
        )}
      </View>

      {phase.kind === 'scanning' ? (
        <T className="mt-1.5 text-3 text-muted">Hold the package so the barcode fills the frame.</T>
      ) : null}

      {phase.kind === 'looking' ? <T className="mt-1.5 text-3 text-muted">Looking up {phase.code}…</T> : null}

      {phase.kind === 'missing' ? (
        <Card tone="raised" className="mt-2">
          <T w="semi" className="text-6 text-text">
            Not in the catalogue
          </T>
          <T className="mt-1 text-3 text-muted" num>
            {phase.code}
          </T>
          <T className="mt-1 text-3 text-muted">
            The shared catalogue does not have this product yet. Create it from the label and it will be yours to log from
            now on — the barcode is kept, so the next scan finds it.
          </T>
          <View className="mt-2 flex-row gap-1">
            <View className="min-w-0 flex-1">
              <Btn variant="brass" onPress={() => onCreateFood(phase.code)} className="w-full">
                Create this food
              </Btn>
            </View>
            <View className="min-w-0 flex-1">
              <Btn onPress={scanAgain} className="w-full">
                Scan again
              </Btn>
            </View>
          </View>
        </Card>
      ) : null}

      {phase.kind === 'failed' ? (
        <Card tone="raised" className="mt-2">
          <T w="semi" className="text-6 text-text">
            Could not check that barcode
          </T>
          <T className="mt-1 text-3 text-muted">{phase.message}</T>
          <T className="mt-1 text-3 text-dim" num>
            {phase.code}
          </T>
          <View className="mt-2 flex-row gap-1">
            <View className="min-w-0 flex-1">
              <Btn variant="brass" onPress={scanAgain} className="w-full">
                Try again
              </Btn>
            </View>
            <View className="min-w-0 flex-1">
              {/* Offered even here: creating the food is local, works with no
                  connection, and is the one thing that still moves. */}
              <Btn onPress={() => onCreateFood(phase.code)} className="w-full">
                Create this food
              </Btn>
            </View>
          </View>
        </Card>
      ) : null}
    </Frame>
  );
}

function Frame({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Scan a barcode</Title>
      <T className="mt-0.5 text-3 text-muted">
        Finds a packaged food in the shared catalogue by its barcode, then opens it to log.
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
