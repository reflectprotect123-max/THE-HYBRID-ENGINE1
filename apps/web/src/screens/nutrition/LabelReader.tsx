import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '@hybrid/engine';
import {
  isEmptyLabel,
  parseLabelLines,
  parseLabelText,
  type CustomFood as CustomFoodRecord,
  type ParsedNutritionLabel,
} from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { recognizeLabel } from '../../native/labelOcr';
import { requestCameraStream, stopCameraStream, captureFrame } from '../../native/camera';
import { Button, Card, Kicker, ScreenTitle } from '../../ui';
import { macro, positiveQty } from './fields';

/*
 * Read a label: camera capture → OCR → parsed macro fields pre-filled into an
 * editable form, with the typed panel as the existing fallback — ported from
 * mobile's `LabelReaderScreen` (`apps/mobile/src/screens/nutrition/LabelReader.tsx`).
 *
 * TWO DOORS, ONE READER, same as mobile: a photograph feeds `parseLabelLines`
 * (via `recognizeLabel`, this task's tesseract.js wrapper); typing feeds
 * `parseLabelText`. Both are the same shared `@hybrid/nutrition-core` parser
 * behind the same fixtures, so the camera path cannot drift from the typed
 * one, and neither is reimplemented here.
 *
 * ARCHITECTURAL DEVIATION FROM MOBILE, disclosed: mobile's screen only reads
 * and hands `(parsed, lines)` to a parent, which routes to `CustomFoodScreen`
 * with a `prefill` prop. Web's `CustomFood.tsx` (Task 2.7) has no `prefill`
 * prop and extending it is outside this task's file list, so this screen owns
 * its own save-as-custom-food form instead of routing elsewhere — it prefills
 * the same four macros plus serving size/unit from the parse, exactly as
 * mobile's `fromLabel` does for a per-serving panel, and still requires a food
 * name before saving (a label alone never has one). A per-100 panel's serving
 * unit is left for the athlete to set explicitly (see `fields.tsx` for
 * `positiveQty`/`macro`), matching mobile's "never guess a denominator" rule.
 *
 * NOTHING IS WRITTEN FROM A SCAN. An OCR read pre-fills a form; nothing is
 * saved until the athlete presses Save — the same confirm-first rule mobile's
 * screen documents.
 */

type Phase =
  | { kind: 'entry' }
  | { kind: 'camera' }
  | { kind: 'reading' }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'form'; parsed: ParsedNutritionLabel };

type PermissionState = 'idle' | 'requesting' | 'denied';

const NO_PHOTO = 'The camera could not take a photo of the panel.';
const NO_TEXT = 'No text could be made out on that photo. It is usually the focus or the light.';
const NO_ROWS =
  'Text was read, but no Energy, Protein, Fat or Carbohydrate rows were found in it — the panel may have been cut off or at too steep an angle.';

interface Props {
  /** Injected by tests; the screen defaults to the real on-device recogniser. */
  recognize?: (imageSource: Blob | ImageBitmap) => Promise<Awaited<ReturnType<typeof recognizeLabel>>>;
  /** Injected by tests; the screen defaults to the real camera. */
  requestStream?: typeof requestCameraStream;
}

export function LabelReader({ recognize = recognizeLabel, requestStream = requestCameraStream }: Props = {}) {
  const { update } = useNutrition();
  const [phase, setPhase] = useState<Phase>({ kind: 'entry' });
  const [text, setText] = useState('');
  const [permission, setPermission] = useState<PermissionState>('idle');
  const [saved, setSaved] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busy = useRef(false);

  const typed = useMemo(() => parseLabelText(text), [text]);

  const stopCamera = useCallback(() => {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (phase.kind !== 'camera') return;
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
  }, [phase.kind, requestStream, stopCamera]);

  const toEntry = () => {
    stopCamera();
    setPhase({ kind: 'entry' });
  };
  const toCamera = () => setPhase({ kind: 'camera' });

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busy.current) return;
    busy.current = true;
    try {
      const frame = await captureFrame(video);
      if (!frame) {
        setPhase({ kind: 'unreadable', reason: NO_PHOTO });
        return;
      }
      setPhase({ kind: 'reading' });
      const lines = await recognize(frame);
      if (!lines.length) {
        setPhase({ kind: 'unreadable', reason: NO_TEXT });
        return;
      }
      const parsed = parseLabelLines(lines);
      if (isEmptyLabel(parsed)) {
        setPhase({ kind: 'unreadable', reason: NO_ROWS });
        return;
      }
      stopCamera();
      setPhase({ kind: 'form', parsed });
    } catch {
      setPhase({ kind: 'unreadable', reason: NO_PHOTO });
    } finally {
      busy.current = false;
    }
  }, [recognize, stopCamera]);

  const useTyped = () => {
    if (isEmptyLabel(typed)) return;
    setPhase({ kind: 'form', parsed: typed });
  };

  if (phase.kind === 'camera') {
    return (
      <Frame onCancel={toEntry}>
        {permission === 'denied' ? (
          <Card tone="raised" className="mt-2">
            <p className="text-6 font-[750] text-text">Camera access is off</p>
            <p className="mt-1 text-3 text-muted">
              Photographing a panel needs the camera. The photo is read on this device, never uploaded, and the photo
              itself is not kept. Allow camera access for this site, then try again.
            </p>
            <div className="mt-2 flex gap-1">
              <Button variant="brass" className="flex-1" onClick={toCamera}>
                Try again
              </Button>
              <Button className="flex-1" onClick={toEntry}>
                Type it instead
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <div className="mt-2 h-[300px] overflow-hidden rounded-lg border border-line bg-well">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} autoPlay playsInline muted aria-label="Label camera" className="h-full w-full object-cover" />
            </div>
            <p className="mt-1.5 text-3 text-muted">
              Fill the frame with the nutrition information panel and hold still. Flat and square to the packet reads
              far better than close.
            </p>
            <div className="mt-2 flex gap-1">
              <Button variant="brass" className="flex-1" onClick={() => void capture()} disabled={permission !== 'idle'}>
                Read this panel
              </Button>
              <Button className="flex-1" onClick={toEntry}>
                Type it instead
              </Button>
            </div>
          </>
        )}
      </Frame>
    );
  }

  if (phase.kind === 'reading') {
    return (
      <Frame onCancel={toEntry}>
        <Card tone="quiet" className="mt-2">
          <p className="text-3 text-muted">Reading the panel on this device…</p>
        </Card>
      </Frame>
    );
  }

  if (phase.kind === 'unreadable') {
    return (
      <Frame onCancel={toEntry}>
        <Card tone="raised" className="mt-2">
          <p className="text-6 font-[750] text-text">Could not read that panel</p>
          <p className="mt-1 text-3 text-muted">{phase.reason}</p>
          <div className="mt-2 flex gap-1">
            <Button variant="brass" className="flex-1" onClick={toCamera}>
              Take another photo
            </Button>
            <Button className="flex-1" onClick={toEntry}>
              Type it instead
            </Button>
          </div>
          <p className="mt-1 text-3 text-dim">Nothing was read, so nothing was filled in or saved.</p>
        </Card>
      </Frame>
    );
  }

  if (phase.kind === 'form') {
    return <SaveForm parsed={phase.parsed} onSaved={(name) => { setSaved(`${name} saved. Search for it to log it.`); setPhase({ kind: 'entry' }); }} onCancel={toEntry} update={update} />;
  }

  return (
    <Frame onCancel={toEntry}>
      {saved ? <p className="mt-1.5 text-3 text-ok">{saved}</p> : null}
      <Card tone="raised" className="mt-2">
        <p className="text-6 font-[750] text-text">Photograph the panel</p>
        <p className="mt-1 text-3 text-muted">
          The text is recognised on this device, with no connection and nothing uploaded. You confirm every number
          before it goes anywhere.
        </p>
        <div className="mt-2">
          <Button variant="brass" className="w-full" onClick={toCamera}>
            Scan the panel
          </Button>
        </div>
      </Card>

      <Card tone="raised" className="mt-2">
        <p className="text-2 font-[750] uppercase tracking-[.1em] text-dim">Or type the panel</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          aria-label="Nutrition panel text"
          placeholder={'Serving size: 30g\nEnergy 520kJ\nProtein 3.2g\nFat, total 2.1g\nCarbohydrate 15.6g'}
          className="mt-1 min-h-[140px] w-full rounded-md border border-line bg-well p-1 text-4 text-text outline-none placeholder:text-dim focus:border-gold-line"
        />
        <p className="mt-1 text-3 text-dim">
          One row per line. Energy in kJ is converted for you. Sub-rows like "saturated" and "sugars" are ignored.
        </p>
        <div className="mt-2">
          <Button variant="brass" className="w-full" disabled={isEmptyLabel(typed)} onClick={useTyped}>
            Use these numbers
          </Button>
        </div>
      </Card>
    </Frame>
  );
}

function Frame({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Read a label</ScreenTitle>
      <p className="mt-0.5 text-3 text-muted">
        Photograph the nutrition information panel, or type it, and this reads the macros out of it.
      </p>
      {children}
      <div className="mt-2">
        <Button className="w-full" onClick={onCancel}>
          Back to search
        </Button>
      </div>
    </>
  );
}

const COMMON_UNITS = ['g', 'ml', 'serving'] as const;

/** A prefilled number, or blank. Never "0" — a missing macro is not zero. */
const initial = (n: number | null): string => (n == null ? '' : String(n));

/**
 * The editable macro form a scan (or a typed panel) lands on. Prefilled from
 * `parsed`, but every field is a plain editable text input, matching
 * `CustomFood.tsx`'s save shape and rounding rules exactly, since this is the
 * same record type.
 */
function SaveForm({
  parsed,
  onSaved,
  onCancel,
  update,
}: {
  parsed: ParsedNutritionLabel;
  onSaved: (name: string) => void;
  onCancel: () => void;
  update: (fn: (draft: import('@hybrid/nutrition-core').NutritionDB) => void | false) => void;
}) {
  const per100 = parsed.basis === 'per_100';
  const volumetric = (parsed.servingUnit ?? '').toLowerCase() === 'ml' || (parsed.servingUnit ?? '').toLowerCase() === 'l';
  const initialUnit = per100 ? (volumetric ? 'ml' : 'g') : (parsed.servingUnit ?? 'g');
  const initialQty = per100 ? '100' : initial(parsed.servingQty);

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [servingQty, setServingQty] = useState(initialQty);
  const [servingUnit, setServingUnit] = useState(initialUnit);
  const [calories, setCalories] = useState(initial(parsed.calories));
  const [proteinG, setProtein] = useState(initial(parsed.proteinG));
  const [carbsG, setCarbs] = useState(initial(parsed.carbsG));
  const [fatG, setFat] = useState(initial(parsed.fatG));
  const [error, setError] = useState('');

  const trimmedName = name.trim();
  const trimmedUnit = servingUnit.trim();
  const qty = positiveQty(servingQty);

  const save = () => {
    if (!trimmedName) {
      setError('Give the food a name.');
      return;
    }
    if (qty == null) {
      setError('Enter the serving size these numbers are for — a number greater than zero.');
      return;
    }
    if (!trimmedUnit) {
      setError('Enter the unit that serving is measured in.');
      return;
    }
    setError('');
    const at = new Date().toISOString();
    const created: CustomFoodRecord = {
      id: uid(),
      userId: '',
      name: trimmedName,
      brand: brand.trim() || null,
      barcode: null,
      servingQty: qty,
      servingUnit: trimmedUnit,
      calories: macro(calories),
      proteinG: macro(proteinG),
      carbsG: macro(carbsG),
      fatG: macro(fatG),
      nutrients: {},
      source: 'user_custom',
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    update((n) => {
      n.customFoods.push(created);
    });
    onSaved(trimmedName);
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>What it read</ScreenTitle>
      <p className="mt-0.5 text-3 text-muted">
        Check these against the packet before saving — a misread digit looks exactly like a correct one. A blank field
        means nothing was read; type it yourself rather than trusting a guess.
      </p>

      {parsed.basis === 'per_100' ? (
        <p className="mt-1.5 text-3 text-muted">
          This panel only prints a per-100 column, so these are per 100 {volumetric ? 'ml' : 'g'}. The serving size is
          set to match.
        </p>
      ) : null}
      {parsed.basis === 'per_serving' ? (
        <p className="mt-1.5 text-3 text-muted">These are per serving, which is the column this panel prints first.</p>
      ) : null}
      {parsed.roundedDown ? (
        <p className="mt-1.5 text-3 text-muted">
          A row read "less than 1 g" and was taken as 0. That is the most the label says — correct it if you know
          better.
        </p>
      ) : null}

      <Card tone="raised" className="mt-2">
        <TextRow label="Food name" value={name} onChange={setName} placeholder="e.g. Rolled oats" />
        <TextRow label="Brand" value={brand} onChange={setBrand} placeholder="Optional" />

        <div className="mt-1.5 flex gap-1">
          <NumCell label="Serving size" value={servingQty} onChange={setServingQty} />
          <div className="min-w-0 flex-1">
            <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">Unit</span>
            <div className="mt-1 flex flex-wrap gap-0.5">
              {COMMON_UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-label={`unit ${u}`}
                  onClick={() => setServingUnit(u)}
                  className={
                    'rounded-full border px-1.5 py-0.5 text-3 ' +
                    (trimmedUnit === u ? 'border-gold-line bg-gold-line/15 text-text' : 'border-line text-muted')
                  }
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-2 text-3 text-muted">
          Nutrition for {qty == null ? 'that serving' : `${qty} ${trimmedUnit || 'unit'}`}
        </p>
        <div className="mt-1 grid grid-cols-4 gap-1">
          <NumCell label="Calories" value={calories} onChange={setCalories} />
          <NumCell label="Protein g" value={proteinG} onChange={setProtein} />
          <NumCell label="Carbs g" value={carbsG} onChange={setCarbs} />
          <NumCell label="Fat g" value={fatG} onChange={setFat} />
        </div>

        {error ? <p className="mt-1.5 text-3 text-bad">{error}</p> : null}

        <div className="mt-2 flex gap-1">
          <Button variant="brass" className="flex-1" onClick={save}>
            Save food
          </Button>
          <Button className="flex-1" onClick={onCancel}>
            Scan another
          </Button>
        </div>
      </Card>
    </>
  );
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mt-1.5">
      <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none placeholder:text-dim focus:border-gold-line"
      />
    </div>
  );
}

function NumCell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        inputMode="decimal"
        className="num mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none focus:border-gold-line"
      />
    </div>
  );
}
