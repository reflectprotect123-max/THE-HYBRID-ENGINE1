// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LS_KEY, cloudFp, emptyDB, ensureSharedCore, loadDB, saveDB, type Storage } from '@hybrid/engine';
import { emptyNutritionDB, type OcrLine, type ParsedNutritionLabel } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider, saveNutrition } from './nutrition';
import { DbProvider } from './db';
import { storage } from './storage';
import {
  SCAN_CORPUS_CAP,
  SCAN_CORPUS_LS_KEY,
  capScanCorpus,
  clearScanCorpus,
  exportScanCorpus,
  loadScanCorpus,
  recordScan,
  type ScanCorpusRecord,
} from './scanCorpus';
import { FoodScreen } from '../screens/nutrition/Food';
import type { MlkitRecognitionResult, MlkitTextBlock } from '../native/labelOcr';

/*
 * The local corpus of label scans.
 *
 * EVIDENCE, and only evidence. What is proved here is that the pairing the
 * corpus exists for — what OCR produced beside what the athlete said was
 * actually on the packet — is captured faithfully, including the case where
 * nothing was corrected, which is the case that says the reader got it right
 * and is exactly as informative as a failure.
 *
 * And that it stays out of everything. A corpus write must move neither the
 * training fingerprint nor the nutrition slice, or a bounding box per line
 * would ride on every sync of a slice that is meant to hold the athlete's
 * food.
 */

const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

function mount(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <DbProvider>
        <NutritionProvider>{ui}</NutritionProvider>
      </DbProvider>
    </SafeAreaProvider>,
  );
}

/* ---------- a panel, as ML Kit segments one ---------- */

const line = (text: string, x: number, y: number, w: number, h = 34) => ({
  text,
  boundingBox: { x, y, width: w, height: h },
});

const block = (...lines: ReturnType<typeof line>[]): MlkitTextBlock => ({
  text: lines.map((l) => l.text).join('\n'),
  boundingBox: { x: 0, y: 0, width: 1000, height: 600 },
  lines,
});

const LABELS = block(
  line('Serving size: 30 g', 60, 160, 300),
  line('Energy', 60, 220, 130),
  line('Protein', 60, 280, 140),
  line('Fat, total', 60, 340, 170),
  line('Carbohydrate', 60, 460, 220),
);

const VALUES = block(
  line('Per serving', 520, 100, 190),
  line('520 kJ', 520, 222, 120, 30),
  line('3.2 g', 520, 282, 100, 30),
  line('2.1 g', 520, 342, 100, 30),
  line('15.6 g', 520, 462, 120, 30),
);

const PANEL: MlkitRecognitionResult = { blocks: [LABELS, VALUES] };

/* ---------- driving the screen ---------- */

const camera = jest.requireMock('expo-camera') as { __resetPermission: () => void; __resetShutter: () => void };

const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
};

/** Photograph the panel and land on Create-a-food with the read numbers in it. */
const scanPanel = async (result: MlkitRecognitionResult = PANEL) => {
  mount(<FoodScreen recogniseLabel={jest.fn(async () => result)} />);
  fireEvent.press(screen.getByText('Read a label'));
  fireEvent.press(screen.getByText('Scan the panel'));
  fireEvent.press(screen.getByText('Read this panel'));
  await settle();
  fireEvent.press(screen.getByText('Use these numbers'));
};

const saveAs = (name: string) => {
  fireEvent.changeText(screen.getByLabelText('Food name'), name);
  fireEvent.press(screen.getByText('Save food'));
};

const memory = (): Storage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

const seeded = () => ensureSharedCore(emptyDB(), 1_754_000_000_000);

const EMPTY_PARSE: ParsedNutritionLabel = {
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  servingQty: null,
  servingUnit: null,
  basis: 'unknown',
  roundedDown: false,
};

const BLANK = { calories: '', proteinG: '', carbsG: '', fatG: '', servingQty: '', servingUnit: 'g' };

/** A minimal record, for the bookkeeping cases that do not need a whole panel. */
const stub = (n: number, store: Storage): ScanCorpusRecord =>
  recordScan(
    { lines: [{ text: `row ${n}`, left: 0, top: n, right: 10, bottom: n + 10 }], parsed: EMPTY_PARSE, presented: BLANK, confirmed: BLANK },
    store,
    `2026-08-07T00:00:${String(n).padStart(2, '0')}.000Z`,
  );

beforeEach(() => {
  storage.removeItem(SCAN_CORPUS_LS_KEY);
  storage.removeItem(NUTRITION_LS_KEY);
  storage.removeItem(LS_KEY);
  camera.__resetPermission();
  camera.__resetShutter();
  saveDB(storage, seeded(), LS_KEY);
});

describe('recording a confirmed scan', () => {
  it('records an accepted scan with every field marked unchanged', async () => {
    /* THE CASE THAT IS NOT A FAILURE. A scan the athlete accepted whole is the
       only positive evidence the parser can produce, and a corpus that stored
       corrections alone would be a pile of failures with no denominator. */
    await scanPanel();
    saveAs('Muesli');

    const [record] = loadScanCorpus(storage);
    expect(loadScanCorpus(storage)).toHaveLength(1);
    expect(record.changed).toEqual({
      calories: false,
      proteinG: false,
      carbsG: false,
      fatG: false,
      servingQty: false,
      servingUnit: false,
    });
    // ...and the confirmation really is the parse, not a blank slate.
    expect(record.confirmed.proteinG).toBe(3.2);
    expect(record.confirmed.servingQty).toBe(30);
  });

  it('marks exactly the fields the athlete corrected, and no others', async () => {
    await scanPanel();
    fireEvent.changeText(screen.getByLabelText('Protein g'), '4.5');
    fireEvent.changeText(screen.getByLabelText('kcal'), '130');
    saveAs('Muesli');

    const [record] = loadScanCorpus(storage);
    expect(record.changed).toEqual({
      calories: true,
      proteinG: true,
      carbsG: false,
      fatG: false,
      servingQty: false,
      servingUnit: false,
    });
    // Both halves of the pairing survive: what was proposed and what was true.
    expect(record.presented.proteinG).toBe(3.2);
    expect(record.confirmed.proteinG).toBe(4.5);
    expect(record.parsed.proteinG).toBe(3.2);
  });

  it('does not count a re-typed identical number as a correction', async () => {
    /* The form prints a prefill to one decimal, so "3.20" over "3.2" is the
       athlete agreeing with the reader. Scored as a change it would be a
       fabricated parser failure in the one signal this corpus carries. */
    await scanPanel();
    fireEvent.changeText(screen.getByLabelText('Protein g'), '3.20');
    saveAs('Muesli');

    expect(loadScanCorpus(storage)[0].changed.proteinG).toBe(false);
  });

  it('keeps the recognised lines and their boxes exactly as the adapter produced them', async () => {
    // Without the geometry the record cannot show WHY a row was misread, which
    // is the only thing that makes it worth more than a screenshot.
    await scanPanel();
    saveAs('Muesli');

    const { lines } = loadScanCorpus(storage)[0];
    expect(lines).toContainEqual<OcrLine>({ text: 'Protein', left: 60, top: 280, right: 200, bottom: 314 });
    expect(lines).toContainEqual<OcrLine>({ text: '3.2 g', left: 520, top: 282, right: 620, bottom: 312 });
    expect(lines).toHaveLength(10);
  });

  it('records nothing from a typed panel, which had no OCR pass to learn from', () => {
    mount(<FoodScreen />);
    fireEvent.press(screen.getByText('Read a label'));
    fireEvent.changeText(screen.getByLabelText('Nutrition panel text'), 'Serving size: 30g\nProtein 3.2g');
    fireEvent.press(screen.getByText('Use these numbers'));
    saveAs('Muesli');

    expect(loadScanCorpus(storage)).toHaveLength(0);
  });

  it('records nothing from a scan the athlete abandoned', async () => {
    // No confirmation happened, so there is no ground truth to pair anything
    // with — and a scan left dangling must not attach itself to the next food.
    await scanPanel();
    fireEvent.press(screen.getByText('Cancel'));
    fireEvent.press(screen.getByText('New food'));
    fireEvent.changeText(screen.getByLabelText('Serving size'), '50');
    saveAs('Something else');

    expect(loadScanCorpus(storage)).toHaveLength(0);
  });
});

describe('the bound on the corpus', () => {
  it('evicts the oldest first once the cap is reached', () => {
    /* `pruneCondTraces` exists in the engine because inline traces grew until
       every save failed forever. A bounding box per recognised line is the same
       hazard on the same phone. */
    const store = memory();
    for (let i = 0; i < SCAN_CORPUS_CAP + 5; i++) stub(i, store);

    const kept = loadScanCorpus(store);
    expect(kept).toHaveLength(SCAN_CORPUS_CAP);
    expect(kept[0].lines[0].text).toBe('row 5');
    expect(kept[kept.length - 1].lines[0].text).toBe(`row ${SCAN_CORPUS_CAP + 4}`);
  });

  it('drops the oldest again on a byte budget the record count alone cannot bound', () => {
    // One photo that also caught an ingredients list carries hundreds of lines,
    // so a count of 200 is not by itself a size of anything.
    const fat = (n: number): ScanCorpusRecord => ({
      id: `r-${n}`,
      at: `2026-08-07T00:00:0${n}.000Z`,
      lines: Array.from({ length: 40 }, (_, i) => ({ text: 'x'.repeat(200), left: i, top: i, right: i + 1, bottom: i + 2 })),
      parsed: EMPTY_PARSE,
      presented: { calories: null, proteinG: null, carbsG: null, fatG: null, servingQty: null, servingUnit: 'g' },
      confirmed: { calories: null, proteinG: null, carbsG: null, fatG: null, servingQty: null, servingUnit: 'g' },
      changed: { calories: false, proteinG: false, carbsG: false, fatG: false, servingQty: false, servingUnit: false },
    });
    const capped = capScanCorpus(Array.from({ length: 9 }, (_, i) => fat(i)), 9, 30_000);

    expect(capped.length).toBeLessThan(9);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(30_000);
    // Newest survive.
    expect(capped[capped.length - 1].id).toBe('r-8');
  });

  it('keeps the newest record even when it alone exceeds the budget', () => {
    // Otherwise the biggest, most interesting failures are the only ones that
    // could never be recorded.
    const huge: ScanCorpusRecord = {
      id: 'r-huge',
      at: '2026-08-07T00:00:00.000Z',
      lines: [{ text: 'x'.repeat(5000), left: 0, top: 0, right: 1, bottom: 1 }],
      parsed: EMPTY_PARSE,
      presented: { calories: null, proteinG: null, carbsG: null, fatG: null, servingQty: null, servingUnit: null },
      confirmed: { calories: null, proteinG: null, carbsG: null, fatG: null, servingQty: null, servingUnit: null },
      changed: { calories: false, proteinG: false, carbsG: false, fatG: false, servingQty: false, servingUnit: false },
    };
    expect(capScanCorpus([huge], 10, 100)).toEqual([huge]);
  });
});

describe('the corpus and the slices that sync', () => {
  it('leaves the training fingerprint and the nutrition slice untouched', () => {
    /* THE isolation this store exists outside both slices to guarantee. A
       nutrition write must not dirty the training fingerprint; a diagnostic
       write must not dirty either, or every scan becomes a sync push of data
       no other device will ever read. */
    saveNutrition(storage, emptyNutritionDB(), NUTRITION_LS_KEY);
    const engineBefore = storage.getItem(LS_KEY);
    const fpBefore = cloudFp(loadDB(storage, LS_KEY).db);
    // The sync layer's own nutrition fingerprint is `JSON.stringify` of the
    // slice, so this is the value it actually compares.
    const nutritionBefore = storage.getItem(NUTRITION_LS_KEY);

    stub(1, storage);
    stub(2, storage);

    expect(storage.getItem(LS_KEY)).toBe(engineBefore);
    expect(cloudFp(loadDB(storage, LS_KEY).db)).toBe(fpBefore);
    expect(storage.getItem(NUTRITION_LS_KEY)).toBe(nutritionBefore);
    // ...and the writes really happened, so this is not passing by doing nothing.
    expect(loadScanCorpus(storage)).toHaveLength(2);
  });

  it('lives under a key of its own, which is neither slice’s', () => {
    expect(SCAN_CORPUS_LS_KEY).not.toBe(LS_KEY);
    expect(SCAN_CORPUS_LS_KEY).not.toBe(NUTRITION_LS_KEY);
    expect(SCAN_CORPUS_LS_KEY.startsWith(NUTRITION_LS_KEY)).toBe(false);
  });
});

describe('getting the corpus off the phone, and off the phone for good', () => {
  it('exports JSON that says what it is and carries every record', () => {
    stub(1, storage);
    const dump = JSON.parse(exportScanCorpus(storage, '2026-08-07T09:00:00.000Z'));

    expect(dump.kind).toBe('hybrid-label-scan-corpus');
    expect(dump.schema).toBe(1);
    expect(dump.exportedAt).toBe('2026-08-07T09:00:00.000Z');
    // Stated, because a truncated corpus that does not say so reads complete.
    expect(dump.cap).toBe(SCAN_CORPUS_CAP);
    expect(dump.records).toHaveLength(1);
    expect(dump.records[0].lines[0].text).toBe('row 1');
  });

  it('clears, and stays cleared', () => {
    stub(1, storage);
    stub(2, storage);
    clearScanCorpus(storage);

    expect(loadScanCorpus(storage)).toEqual([]);
    expect(storage.getItem(SCAN_CORPUS_LS_KEY)).toBeNull();
    // Nothing else went with it.
    expect(storage.getItem(LS_KEY)).toBeTruthy();
  });

  it('reads an unreadable corpus as an empty one rather than throwing', () => {
    // Diagnostic data may never be the reason a screen fails to render.
    storage.setItem(SCAN_CORPUS_LS_KEY, '{not json');
    expect(loadScanCorpus(storage)).toEqual([]);
    storage.setItem(SCAN_CORPUS_LS_KEY, '{"records":[]}');
    expect(loadScanCorpus(storage)).toEqual([]);
  });
});
