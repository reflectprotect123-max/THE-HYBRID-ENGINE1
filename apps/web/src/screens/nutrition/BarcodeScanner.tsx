import { useCallback, useEffect, useRef, useState } from 'react';
import { uid, ymd } from '@hybrid/engine';
import { loggableUnits, type CachedFood } from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { lookupBarcode, type CatalogueBarcodeLookup } from '../../cloud/catalogue';
import { requestCameraStream, stopCameraStream } from '../../native/camera';
import { isBarcodeDetectorSupported, detectBarcode } from '../../native/barcodeScanner';
import { Button, Card, Kicker, ScreenTitle, Chip } from '../../ui';
import { cacheFood, entryFromFood } from './entry';

/*
 * Scan a packaged food's barcode — ported from mobile's `BarcodeScannerScreen`
 * (`apps/mobile/src/screens/nutrition/BarcodeScanner.tsx`), which drives
 * `expo-camera`'s ML Kit barcode reader; this drives Chrome/Android's
 * `BarcodeDetector` (`../../native/barcodeScanner.ts`) against the SAME
 * `lookupBarcode` read (`../../cloud/catalogue.ts`) mobile and `FoodSearch`
 * use — no barcode-lookup logic is duplicated here.
 *
 * WHAT THIS SCREEN REFUSES TO DO, exactly as mobile's refuses: it hands the
 * raw scanned value to the catalogue and nothing else. No padding, no UPC/EAN
 * coercion, no name-search fallback. A barcode that nearly matches is a
 * different product, and the wrong product's macros are silent.
 *
 * A BARCODE THAT IS NOT IN THE CATALOGUE IS THE NORMAL CASE, not an error —
 * the catalogue is a few thousand rows against a supermarket.
 *
 * ARCHITECTURAL DEVIATION FROM MOBILE, disclosed: mobile hands a found food to
 * a parent, which reopens `FoodSearchScreen`'s own log sheet, and a miss
 * routes to `CustomFoodScreen` with a `barcode` prefill. `Food.tsx` on web
 * renders every pane with no cross-pane props (`<BarcodeScanner />`, exactly
 * as `<LabelReader />` is rendered — see that screen's own disclosed
 * deviation), and `CustomFood.tsx` (Task 2.7) has no prefill prop to carry a
 * scanned barcode into. So this screen owns its own quantity/unit/meal log
 * sheet for a match — the same `entryFromFood`/`cacheFood` pass-through
 * `FoodSearch.tsx` calls, so a scanned log is byte-for-byte the same write a
 * searched-and-tapped log produces — and a miss tells the athlete to add the
 * product from the New food tab rather than attempting a prefill this app's
 * web form cannot accept.
 *
 * THE CAMERA IS STOPPED, not merely hidden, while a lookup or a result is on
 * screen — `requestCameraStream`/`stopCameraStream` (Task 2.11's `camera.ts`)
 * make that a `useEffect` cleanup rather than a torch left running behind a
 * card nobody is scanning with.
 */

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const;

/** How often a frame is pulled off the live feed and checked for a barcode. */
const SCAN_INTERVAL_MS = 350;

type Phase =
  | { kind: 'scanning' }
  | { kind: 'looking'; code: string }
  | { kind: 'found'; food: CachedFood }
  | { kind: 'missing'; code: string }
  | { kind: 'failed'; code: string; message: string };

type PermissionState = 'idle' | 'requesting' | 'denied';

interface Draft {
  quantity: string;
  unit: string;
  units: string[];
  meal: string;
}

interface Props {
  /** Injected by tests; the screen defaults to the real catalogue read. */
  lookup?: CatalogueBarcodeLookup;
  /** Injected by tests; the screen defaults to the real camera. */
  requestStream?: typeof requestCameraStream;
  /** Injected by tests; the screen defaults to the real `BarcodeDetector`. */
  detect?: typeof detectBarcode;
}

export function BarcodeScanner({ lookup = lookupBarcode, requestStream = requestCameraStream, detect = detectBarcode }: Props = {}) {
  const { update } = useNutrition();
  const supported = isBarcodeDetectorSupported();
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const [permission, setPermission] = useState<PermissionState>('idle');
  const [retryToken, setRetryToken] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [logError, setLogError] = useState('');
  const [logged, setLogged] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /* `detect` fires every `SCAN_INTERVAL_MS`, not once — a code held in view
     for a second is several ticks. The ref is what makes the first tick the
     only one that starts a lookup; state would not, since the next tick can
     fire before a re-render has moved `phase` off 'scanning'. Mirrors
     mobile's `busy` ref guarding the same hazard against per-frame callbacks. */
  const busy = useRef(false);

  const stopCamera = useCallback(() => {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!supported || phase.kind !== 'scanning') return;
    let cancelled = false;
    setPermission('requesting');
    requestStream()
      .then((stream) => {
        if (cancelled) {
          stopCameraStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPermission('idle');
      })
      .catch(() => {
        if (!cancelled) setPermission('denied');
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, requestStream, stopCamera, supported, retryToken]);

  const scan = useCallback(
    (code: string) => {
      if (busy.current) return;
      busy.current = true;
      setPhase({ kind: 'looking', code });
      lookup(code)
        .then((food) => {
          if (food) {
            setPhase({ kind: 'found', food });
            const units = Object.keys(loggableUnits(food, food.servings));
            const unit = units[0] ?? 'serving';
            setDraft({ quantity: '1', unit, units, meal: 'other' });
            return;
          }
          setPhase({ kind: 'missing', code });
        })
        .catch(() => {
          // The athlete's problem, not PostgREST's wording — "not in the
          // catalogue" and "could not ask the catalogue" are different
          // answers and only one of them means the food does not exist.
          setPhase({
            kind: 'failed',
            code,
            message: 'The shared food catalogue could not be reached, so this barcode could not be looked up.',
          });
        });
    },
    [lookup],
  );

  useEffect(() => {
    if (!supported || phase.kind !== 'scanning' || permission !== 'idle') return;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || busy.current || !video.videoWidth) return;
      detect(video)
        .then((value) => {
          const code = value?.trim();
          if (code) scan(code);
        })
        .catch(() => {
          /* A detector failure on one frame is not a scan failure — the next
             tick tries again against a fresh frame. */
        });
    }, SCAN_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [detect, permission, phase.kind, scan, supported]);

  const scanAgain = () => {
    busy.current = false;
    setDraft(null);
    setLogError('');
    setPhase({ kind: 'scanning' });
  };

  const commit = () => {
    if (phase.kind !== 'found' || !draft) return;
    const quantity = Number(draft.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLogError('Enter how much you had — a number greater than zero.');
      return;
    }
    const at = new Date().toISOString();
    const ctx = { id: uid(), logDate: ymd(new Date()), meal: draft.meal, at };
    const food = phase.food;
    try {
      update((n) => {
        const entry = entryFromFood(ctx, food, quantity, draft.unit);
        n.logEntries.push(entry);
        // Cached ON THE WAY PAST, only now that it has actually been logged —
        // same rule as `FoodSearch.tsx`'s `commit`.
        cacheFood(n, food);
      });
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'That could not be logged.');
      return;
    }
    setLogged(`${food.name} added to ${draft.meal}.`);
    scanAgain();
  };

  if (!supported) {
    return (
      <Frame>
        <Card tone="raised" className="mt-2">
          <p className="text-6 font-[750] text-text">Barcode scanning isn't available</p>
          <p className="mt-1 text-3 text-muted">
            This browser does not support camera barcode scanning. Search for the food by name instead, or use Read
            label to capture its nutrition panel.
          </p>
        </Card>
      </Frame>
    );
  }

  return (
    <Frame>
      {logged ? <p className="mt-1.5 text-3 text-ok">{logged}</p> : null}

      {phase.kind === 'scanning' && permission === 'denied' ? (
        <Card tone="raised" className="mt-2">
          <p className="text-6 font-[750] text-text">Camera access is off</p>
          <p className="mt-1 text-3 text-muted">
            Scanning a barcode needs the camera. Nothing is recorded or uploaded — the frames are read on this
            device and discarded. Allow camera access for this site, then try again.
          </p>
          <div className="mt-2 flex gap-1">
            <Button variant="brass" className="flex-1" onClick={() => setRetryToken((t) => t + 1)}>
              Allow camera
            </Button>
          </div>
          <p className="mt-1 text-3 text-dim">Everything else in Food works without the camera — search, quick add and your own foods.</p>
        </Card>
      ) : null}

      {phase.kind === 'scanning' && permission !== 'denied' ? (
        <>
          <div className="mt-2 h-[240px] overflow-hidden rounded-lg border border-line bg-well">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay playsInline muted aria-label="Barcode camera" className="h-full w-full object-cover" />
          </div>
          <p className="mt-1.5 text-3 text-muted">Hold the package so the barcode fills the frame.</p>
        </>
      ) : null}

      {phase.kind === 'looking' ? (
        <Card tone="quiet" className="mt-2">
          <p className="text-3 text-muted">Looking up {phase.code}…</p>
        </Card>
      ) : null}

      {phase.kind === 'found' && draft ? (
        <LogSheet food={phase.food} draft={draft} error={logError} onChange={setDraft} onSave={commit} onCancel={scanAgain} />
      ) : null}

      {phase.kind === 'missing' ? (
        <Card tone="raised" className="mt-2">
          <p className="text-6 font-[750] text-text">Not in the catalogue</p>
          <p className="num mt-1 text-3 text-muted">{phase.code}</p>
          <p className="mt-1 text-3 text-muted">
            The shared catalogue does not have this product yet. Add it from the New food tab and it will be yours
            to log from now on.
          </p>
          <div className="mt-2 flex gap-1">
            <Button variant="brass" className="flex-1" onClick={scanAgain}>
              Scan again
            </Button>
          </div>
        </Card>
      ) : null}

      {phase.kind === 'failed' ? (
        <Card tone="raised" className="mt-2">
          <p className="text-6 font-[750] text-text">Could not check that barcode</p>
          <p className="mt-1 text-3 text-muted">{phase.message}</p>
          <p className="num mt-1 text-3 text-dim">{phase.code}</p>
          <div className="mt-2 flex gap-1">
            <Button variant="brass" className="flex-1" onClick={scanAgain}>
              Try again
            </Button>
          </div>
        </Card>
      ) : null}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Scan a barcode</ScreenTitle>
      <p className="mt-0.5 text-3 text-muted">
        Finds a packaged food in the shared catalogue by its barcode, then opens it to log.
      </p>
      {children}
    </>
  );
}

/** Quantity, unit and meal — the log sheet a matched barcode opens into. Same
 *  shape as `FoodSearch.tsx`'s own log sheet, since it writes the same entry. */
function LogSheet({
  food,
  draft,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  food: CachedFood;
  draft: Draft;
  error: string;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Card tone="raised" className="mt-2">
      <p className="text-5 font-[700] text-text">{food.name}</p>
      {food.brand ? <p className="mt-0.5 text-3 text-muted">{food.brand}</p> : null}
      <div className="mt-1.5">
        <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">Quantity</span>
        <input
          value={draft.quantity}
          onChange={(e) => onChange({ ...draft, quantity: e.target.value })}
          aria-label="Quantity"
          inputMode="decimal"
          className="num mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none focus:border-gold-line"
        />
      </div>
      {draft.units.length > 1 ? (
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {draft.units.map((u) => (
            <Chip key={u} on={draft.unit === u} onClick={() => onChange({ ...draft, unit: u })}>
              {u}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-0.5">
        {MEALS.map((m) => (
          <Chip key={m} on={draft.meal === m} onClick={() => onChange({ ...draft, meal: m })}>
            {m}
          </Chip>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-3 text-bad">{error}</p> : null}
      <div className="mt-2 flex gap-1">
        <Button variant="brass" className="flex-1" onClick={onSave}>
          Add to log
        </Button>
        <Button className="flex-1" onClick={onCancel}>
          Scan again
        </Button>
      </div>
    </Card>
  );
}
