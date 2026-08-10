// Jest injects describe/it/expect/beforeEach as globals — see the sibling
// tests, none of which import a runner.
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LS_KEY, emptyDB, ensureSharedCore, saveDB } from '@hybrid/engine';
import { parseLabelLines, sanitizeNutritionDB, type NutritionDB } from '@hybrid/nutrition-core';
import { NUTRITION_LS_KEY, NutritionProvider } from '../store/nutrition';
import { DbProvider } from '../store/db';
import { storage } from '../store/storage';
import { FoodScreen } from '../screens/nutrition/Food';
import { toOcrLines, type MlkitRecognitionResult, type MlkitTextBlock } from './labelOcr';

/*
 * Photographing a nutrition panel.
 *
 * Two things are proved here and they are different things.
 *
 * THE ADAPTER, hard. ML Kit hands back nested blocks of lines with `{x, y,
 * width, height}` boxes; `parseLabelLines` wants a flat list with `{left, top,
 * right, bottom}` edges. Every one of the ways those two shapes fail to line up
 * is a way to read the wrong number off a real packet, so each gets its own
 * case: the nesting, the geometry, the boxes the native module can legally omit
 * and the type says it cannot.
 *
 * THE SCREEN, around the camera. The camera itself is a native surface that
 * does not exist in node, but every decision is on this side of it: one photo
 * per tap, a confirmation before anything is written, and a scan that failed
 * landing on the text box rather than on nothing.
 *
 * WHAT NEITHER PROVES is whether ML Kit can actually read a curved, glossy,
 * badly-lit Australian packet. Nothing in a repository can. That is a phone,
 * a supermarket and a person, and it is listed in the handoff.
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

/* ---------- a real panel, as ML Kit would segment it ---------- */

/** One recognised line, positioned. `h` defaults to the panel's line height. */
const line = (text: string, x: number, y: number, w: number, h = 34) => ({
  text,
  boundingBox: { x, y, width: w, height: h },
});

const block = (...lines: ReturnType<typeof line>[]): MlkitTextBlock => ({
  text: lines.map((l) => l.text).join('\n'),
  boundingBox: { x: 0, y: 0, width: 1000, height: 600 },
  lines,
});

/**
 * A standard FSANZ two-column panel, segmented THE WAY ML KIT ACTUALLY DOES IT:
 * one block per column, not one per row.
 *
 * This is the shape that makes the adapter's flattening load-bearing. Read
 * block by block, the text is "Energy / Protein / Fat, total …" and then
 * "520 kJ / 3.2 g / 2.1 g …" — two lists that pair with nothing. Only after
 * every line is flattened into one pile and re-grouped by vertical position
 * does "Protein" find "3.2 g".
 */
const LABELS = block(
  line('Serving size: 30 g', 60, 160, 300),
  line('Energy', 60, 220, 130),
  line('Protein', 60, 280, 140),
  line('Fat, total', 60, 340, 170),
  line('- Saturated', 60, 400, 190),
  line('Carbohydrate', 60, 460, 220),
  line('- Sugars', 60, 520, 150),
);

const PER_SERVE = block(
  line('Per serving', 520, 100, 190),
  line('520 kJ', 520, 222, 120, 30),
  line('3.2 g', 520, 282, 100, 30),
  line('2.1 g', 520, 342, 100, 30),
  line('0.9 g', 520, 402, 100, 30),
  line('15.6 g', 520, 462, 120, 30),
  line('4.1 g', 520, 522, 100, 30),
);

const PER_100 = block(
  line('Per 100 g', 760, 100, 180),
  line('1733 kJ', 760, 222, 140, 30),
  line('10.7 g', 760, 282, 120, 30),
  line('7.0 g', 760, 342, 110, 30),
  line('3.0 g', 760, 402, 110, 30),
  line('52.1 g', 760, 462, 120, 30),
  line('13.7 g', 760, 522, 120, 30),
);

const PANEL: MlkitRecognitionResult = {
  text: [LABELS, PER_SERVE, PER_100].map((b) => b.text).join('\n'),
  blocks: [LABELS, PER_SERVE, PER_100],
};

/** 520 kJ / 4.184, which is what the panel's first column actually says. */
const KCAL_PER_SERVE = 520 / 4.184;

/* ---------- the adapter ---------- */

describe('ML Kit result to parser lines', () => {
  it('turns an origin-and-size box into the four edges the parser reads', () => {
    // The only arithmetic in the adapter, and the one that silently produces a
    // plausible-looking wrong row if it is off.
    const [only] = toOcrLines({ blocks: [block(line('Protein', 60, 280, 140, 34))] });
    expect(only).toEqual({ text: 'Protein', left: 60, top: 280, right: 200, bottom: 314 });
  });

  it('flattens every block, so a two-column panel pairs each label with its own value', () => {
    const parsed = parseLabelLines(toOcrLines(PANEL));

    expect(parsed.calories).toBeCloseTo(KCAL_PER_SERVE, 3);
    expect(parsed.proteinG).toBe(3.2);
    expect(parsed.fatG).toBe(2.1);
    expect(parsed.carbsG).toBe(15.6);
    expect(parsed.servingQty).toBe(30);
    expect(parsed.servingUnit).toBe('g');
    expect(parsed.basis).toBe('per_serving');
    // The leftmost value column, not the per-100 one beside it.
    expect(parsed.proteinG).not.toBe(10.7);
    // The sub-rows stayed sub-rows.
    expect(parsed.fatG).not.toBe(0.9);
    expect(parsed.carbsG).not.toBe(4.1);
  });

  it('reads the same panel when the blocks and their lines come back reversed', () => {
    /* ML Kit promises no reading order, and on a photo taken at a slight angle
       it does not deliver one. Reversing everything is the cheapest proof that
       nothing here depends on the order it happened to arrive in. */
    const reversed: MlkitRecognitionResult = {
      blocks: [PER_100, PER_SERVE, LABELS].map((b) => ({ ...b, lines: [...(b.lines ?? [])].reverse() })),
    };
    expect(parseLabelLines(toOcrLines(reversed))).toEqual(parseLabelLines(toOcrLines(PANEL)));
  });

  it('drops a line whose bounding box the native module left empty', () => {
    /* NOT hypothetical and NOT what the TypeScript says. When ML Kit returns a
       null Rect the Android source resolves `"boundingBox" to emptyMap()`, so
       JS gets `{}`. Coerced to zeroes that line sits at the photo's top-left
       corner, joins whatever row is highest, and can hand the reader a value
       from nowhere. */
    const withJunk: MlkitRecognitionResult = {
      blocks: [...(PANEL.blocks ?? []), block({ text: '9.9 g', boundingBox: {} } as ReturnType<typeof line>)],
    };
    const lines = toOcrLines(withJunk);

    expect(lines.some((l) => l.text === '9.9 g')).toBe(false);
    expect(lines).toEqual(toOcrLines(PANEL));
    expect(parseLabelLines(lines).proteinG).toBe(3.2);
  });

  it('drops a line with a non-finite coordinate rather than positioning it at NaN', () => {
    const lines = toOcrLines({
      blocks: [block(line('Protein', 60, 280, 140), { text: '3.2 g', boundingBox: { x: NaN, y: 282, width: 100, height: 30 } })],
    });
    expect(lines.map((l) => l.text)).toEqual(['Protein']);
  });

  it('drops a zero-height box, which would otherwise collapse the parser’s row tolerance', () => {
    /* The subtle one. The parser scales its row tolerance to the SMALLEST line
       height it is given, so a single degenerate box drags that anchor to the
       12px floor — and on a full-resolution photo, where a label and its value
       sit tens of pixels apart vertically, a 12px tolerance stops them grouping
       into the same row at all. One junk box would turn a good scan into an
       empty one, which is a failure that looks like a bad photo. */
    const big = block(
      line('Protein', 200, 900, 420, 90),
      line('3.2 g', 1600, 930, 300, 84),
      line('Carbohydrate', 200, 1200, 700, 90),
      line('15.6 g', 1600, 1230, 340, 84),
    );
    const junk = block(line('|', 40, 40, 6, 0));

    const clean = parseLabelLines(toOcrLines({ blocks: [big] }));
    expect(clean.proteinG).toBe(3.2);
    expect(clean.carbsG).toBe(15.6);

    // Same answer with the junk line in the result, because it never arrives.
    const withJunk = parseLabelLines(toOcrLines({ blocks: [big, junk] }));
    expect(withJunk).toEqual(clean);
  });

  it('reads a panel whose rows came back with the label and value on one line', () => {
    /* ML Kit's Line is "words on one baseline", and on a tightly-set panel the
       label and its per-serving figure ARE one baseline — so the row arrives as
       "Protein 3.2 g" with the per-100 figure as a separate line beside it.
       Taking the cell next to the label reads 10.7 g and calls it a serving's
       protein: three times the truth, off a photo that worked. */
    const merged: MlkitRecognitionResult = {
      blocks: [
        block(
          line('Per serving', 520, 100, 190),
          line('Serving size: 30 g', 60, 160, 300),
          line('Energy 520 kJ', 60, 220, 300),
          line('Protein 3.2 g', 60, 280, 300),
          line('Fat, total 2.1 g', 60, 340, 300),
          line('Carbohydrate 15.6 g', 60, 460, 300),
        ),
        block(
          line('Per 100 g', 760, 100, 180),
          line('1733 kJ', 760, 222, 140, 30),
          line('10.7 g', 760, 282, 120, 30),
          line('7.0 g', 760, 342, 110, 30),
          line('52.1 g', 760, 462, 120, 30),
        ),
      ],
    };
    const parsed = parseLabelLines(toOcrLines(merged));

    expect(parsed.calories).toBeCloseTo(KCAL_PER_SERVE, 3);
    expect(parsed.proteinG).toBe(3.2);
    expect(parsed.fatG).toBe(2.1);
    expect(parsed.carbsG).toBe(15.6);
    expect(parsed.servingQty).toBe(30);
    expect(parsed.basis).toBe('per_serving');
    // The per-100 column, which is what sits in the cell beside each label.
    expect(parsed.proteinG).not.toBe(10.7);
    expect(parsed.carbsG).not.toBe(52.1);
  });

  it('reads a merged panel with no second column at all', () => {
    // A one-column panel photographed close up: every row is a single line.
    const oneColumn: MlkitRecognitionResult = {
      blocks: [
        block(
          line('Energy 520 kJ', 60, 220, 300),
          line('Protein 3.2 g', 60, 280, 300),
          line('Fat, total 2.1 g', 60, 340, 300),
          line('Carbohydrate 15.6 g', 60, 400, 300),
        ),
      ],
    };
    const parsed = parseLabelLines(toOcrLines(oneColumn));

    expect(parsed.calories).toBeCloseTo(KCAL_PER_SERVE, 3);
    expect(parsed.proteinG).toBe(3.2);
    expect(parsed.fatG).toBe(2.1);
    expect(parsed.carbsG).toBe(15.6);
  });

  it('ignores a block that carries text but no lines', () => {
    /* A block's `text` is its lines joined by newlines. Fed in as one "line" it
       would become a row holding a label from one line and a number from
       another — exactly the mis-pairing the positional entry point exists to
       stop. Contributing nothing is the honest answer. */
    const textOnly: MlkitTextBlock = {
      text: 'Protein\n3.2 g',
      boundingBox: { x: 0, y: 0, width: 500, height: 200 },
    };
    expect(toOcrLines({ blocks: [textOnly] })).toEqual([]);
    expect(toOcrLines({ blocks: [{ ...textOnly, lines: [] }] })).toEqual([]);
  });

  it('drops lines with nothing but whitespace in them', () => {
    const lines = toOcrLines({ blocks: [block(line('   ', 60, 100, 40), line(' Protein ', 60, 280, 140))] });
    // ...and trims the ones it keeps, so the parser's label match is not
    // fighting stray spaces.
    expect(lines.map((l) => l.text)).toEqual(['Protein']);
  });

  it('yields nothing, rather than throwing, for a result with no blocks at all', () => {
    // Every one of these has crossed the native bridge, so none of them can be
    // assumed away by the type.
    expect(toOcrLines(undefined)).toEqual([]);
    expect(toOcrLines(null)).toEqual([]);
    expect(toOcrLines({})).toEqual([]);
    expect(toOcrLines({ blocks: null })).toEqual([]);
    expect(toOcrLines({ text: 'Protein 3.2 g', blocks: [] })).toEqual([]);
  });
});

/* ---------- the screen ---------- */

const camera = jest.requireMock('expo-camera') as {
  __setPermission: (p: { granted: boolean; canAskAgain: boolean; status: string } | null) => void;
  __resetPermission: () => void;
  __setShutter: (fn: (options?: unknown) => Promise<unknown>) => void;
  __resetShutter: () => void;
  __photo: { uri: string };
};

const readSlice = (): NutritionDB => sanitizeNutritionDB(JSON.parse(storage.getItem(NUTRITION_LS_KEY) || '{}'));

const openReader = () => fireEvent.press(screen.getByText('Read a label'));
const openCamera = () => fireEvent.press(screen.getByText('Scan the panel'));
const shoot = () => fireEvent.press(screen.getByText('Read this panel'));

const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
};

beforeEach(() => {
  storage.removeItem(NUTRITION_LS_KEY);
  storage.removeItem(LS_KEY);
  camera.__resetPermission();
  camera.__resetShutter();
  saveDB(storage, ensureSharedCore(emptyDB(), 1_754_000_000_000), LS_KEY);
});

describe('photographing a label', () => {
  it('recognises the photo it took, and shows what it read before writing anything', async () => {
    const recognise = jest.fn(async () => PANEL);
    mount(<FoodScreen recogniseLabel={recognise} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    // The URI of the photo just taken, not a re-used or invented one.
    expect(recognise).toHaveBeenCalledWith(camera.__photo.uri);
    expect(screen.getByText('What it read')).toBeTruthy();
    expect(screen.getByText('3.2 g')).toBeTruthy();
    expect(screen.getByText('15.6 g')).toBeTruthy();
    expect(screen.getByText('124.3 kcal')).toBeTruthy();
    // Nothing has been written: no food, no log entry, no draft.
    expect(readSlice().customFoods).toHaveLength(0);
    expect(readSlice().logEntries).toHaveLength(0);
    expect(screen.queryByText('New food')).toBeNull();
  });

  it('carries the scan into Create-a-food only once it is confirmed', async () => {
    mount(<FoodScreen recogniseLabel={jest.fn(async () => PANEL)} />);
    openReader();
    openCamera();
    shoot();
    await settle();
    fireEvent.press(screen.getByText('Use these numbers'));

    expect(screen.getByText('New food')).toBeTruthy();
    expect(screen.getByLabelText('kcal').props.value).toBe('124.3');
    expect(screen.getByLabelText('Protein g').props.value).toBe('3.2');
    expect(screen.getByLabelText('Carbs g').props.value).toBe('15.6');
    expect(screen.getByLabelText('Fat g').props.value).toBe('2.1');
    expect(screen.getByLabelText('Serving size').props.value).toBe('30');
  });

  it('says which column it read, so a per-100 panel is not banked as one serving', async () => {
    // The parser reports its basis rather than assuming one; that is only worth
    // anything if the screen says it.
    const per100: MlkitRecognitionResult = {
      blocks: [
        block(line('Per 100 g', 520, 100, 180), line('Energy', 60, 220, 130), line('Protein', 60, 280, 140)),
        block(line('1733 kJ', 520, 222, 140, 30), line('10.7 g', 520, 282, 120, 30)),
      ],
    };
    mount(<FoodScreen recogniseLabel={jest.fn(async () => per100)} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    expect(screen.getByText(/only prints a per-100 column/i)).toBeTruthy();
    fireEvent.press(screen.getByText('Use these numbers'));
    expect(screen.getByLabelText('Serving size').props.value).toBe('100');
  });

  it('says when a photographed row read "less than 1 g" and was taken as zero', async () => {
    const lessThan: MlkitRecognitionResult = {
      blocks: [
        block(line('Per serving', 520, 100, 190), line('Protein', 60, 280, 140), line('Fat, total', 60, 340, 170)),
        block(line('3.2 g', 520, 282, 100, 30), line('Less than 1 g', 520, 342, 240, 30)),
      ],
    };
    mount(<FoodScreen recogniseLabel={jest.fn(async () => lessThan)} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    expect(screen.getByText(/less than 1 g/i)).toBeTruthy();
  });

  it('takes one photo per tap even when the shutter is still in flight', async () => {
    // Two photos racing two OCR passes into one piece of state is the same
    // hazard the barcode scanner guards per frame; here it is per tap.
    let release: (() => void) | null = null;
    camera.__setShutter(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ uri: 'file:///cache/label-panel.jpg', width: 100, height: 100 });
        }),
    );
    const recognise = jest.fn(async () => PANEL);
    mount(<FoodScreen recogniseLabel={recognise} />);
    openReader();
    openCamera();
    shoot();
    shoot();
    shoot();
    await act(async () => {
      release?.();
    });
    await settle();

    expect(recognise).toHaveBeenCalledTimes(1);
  });
});

describe('a scan that cannot be read', () => {
  const expectFallback = () => {
    expect(screen.getByText('Could not read that panel')).toBeTruthy();
    // Never a dead end: the typed reader is the same reader.
    fireEvent.press(screen.getByText('Type it instead'));
    expect(screen.getByLabelText('Nutrition panel text')).toBeTruthy();
  };

  it('falls back to typing when no text was found on the photo', async () => {
    mount(<FoodScreen recogniseLabel={jest.fn(async () => ({ text: '', blocks: [] }))} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    expect(screen.getByText(/no text could be made out/i)).toBeTruthy();
    expectFallback();
  });

  it('tells "no text at all" apart from "text, but no macro rows in it"', async () => {
    // Different problems with different next moves. Collapsed into one message
    // the athlete re-takes the same useless photo.
    const ingredients: MlkitRecognitionResult = {
      blocks: [block(line('INGREDIENTS: Wheat flour, sugar,', 60, 100, 800), line('vegetable oil, salt.', 60, 160, 500))],
    };
    mount(<FoodScreen recogniseLabel={jest.fn(async () => ingredients)} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    expect(screen.getByText(/no Energy, Protein, Fat or Carbohydrate rows/i)).toBeTruthy();
    expect(screen.queryByText(/no text could be made out/i)).toBeNull();
    expectFallback();
  });

  it('falls back to typing when the recogniser itself throws', async () => {
    /* A missing native module on an old APK throws here, and so does an image
       ML Kit cannot decode. To the athlete both are "this photo did not work",
       and the text box still does. */
    const recognise = jest.fn(async () => {
      throw new Error('Cannot find native module "ExpoMlkitOcr"');
    });
    mount(<FoodScreen recogniseLabel={recognise} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    expectFallback();
  });

  it('falls back to typing when the camera could not produce a photo', async () => {
    camera.__setShutter(async () => {
      throw new Error('Camera unavailable');
    });
    const recognise = jest.fn(async () => PANEL);
    mount(<FoodScreen recogniseLabel={recognise} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    expect(recognise).not.toHaveBeenCalled();
    expectFallback();
  });

  it('writes nothing from a failed scan, and offers another photo', async () => {
    mount(<FoodScreen recogniseLabel={jest.fn(async () => ({ blocks: [] }))} />);
    openReader();
    openCamera();
    shoot();
    await settle();

    expect(screen.getByText(/nothing was read, so nothing was filled in or saved/i)).toBeTruthy();
    expect(readSlice().customFoods).toHaveLength(0);
    fireEvent.press(screen.getByText('Take another photo'));
    expect(screen.getByLabelText('Label camera')).toBeTruthy();
  });

  it('re-photographs after a good read, in case the first one caught the wrong panel', async () => {
    const recognise = jest
      .fn<Promise<MlkitRecognitionResult>, [string]>()
      .mockResolvedValueOnce({ blocks: [] })
      .mockResolvedValueOnce(PANEL);
    mount(<FoodScreen recogniseLabel={recognise} />);
    openReader();
    openCamera();
    shoot();
    await settle();
    fireEvent.press(screen.getByText('Take another photo'));
    shoot();
    await settle();

    expect(recognise).toHaveBeenCalledTimes(2);
    expect(screen.getByText('3.2 g')).toBeTruthy();
  });
});

describe('the label camera permission', () => {
  it('asks, rather than showing a dead preview, when permission has not been granted', () => {
    camera.__setPermission({ granted: false, canAskAgain: true, status: 'undetermined' });
    mount(<FoodScreen />);
    openReader();
    openCamera();

    expect(screen.getByText('Camera access is off')).toBeTruthy();
    expect(screen.getByText('Allow camera')).toBeTruthy();
    expect(screen.queryByText('Open settings')).toBeNull();
    expect(screen.queryByLabelText('Label camera')).toBeNull();
  });

  it('routes to system settings once Android will not ask again', () => {
    camera.__setPermission({ granted: false, canAskAgain: false, status: 'denied' });
    const open = jest.spyOn(Linking, 'openSettings').mockImplementation(async () => {});
    mount(<FoodScreen />);
    openReader();
    openCamera();

    expect(screen.queryByText('Allow camera')).toBeNull();
    fireEvent.press(screen.getByText('Open settings'));
    expect(open).toHaveBeenCalled();
  });

  it('shows neither state while the permission is still being read back', () => {
    // A single frame on a device, but rendering the refusal during it flashes a
    // denial at someone who has refused nothing.
    camera.__setPermission(null);
    mount(<FoodScreen />);
    openReader();
    openCamera();

    expect(screen.getByText('Checking camera access…')).toBeTruthy();
    expect(screen.queryByText('Camera access is off')).toBeNull();
  });

  it('leaves the typed reader fully usable when the camera is refused outright', () => {
    // The whole point of keeping both doors: a denied permission costs the
    // convenience, not the feature.
    camera.__setPermission({ granted: false, canAskAgain: false, status: 'denied' });
    mount(<FoodScreen />);
    openReader();
    openCamera();
    fireEvent.press(screen.getByText('Type it instead'));

    fireEvent.changeText(
      screen.getByLabelText('Nutrition panel text'),
      'Serving size: 30g\nEnergy 520kJ\nProtein 3.2g\nFat, total 2.1g\nCarbohydrate 15.6g',
    );
    fireEvent.press(screen.getByText('Use these numbers'));
    expect(screen.getByLabelText('Protein g').props.value).toBe('3.2');
  });
});
