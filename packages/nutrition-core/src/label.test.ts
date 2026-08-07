import { describe, expect, it } from 'vitest';
import { isEmptyLabel, parseLabelLines, parseLabelText, type OcrLine } from './label';

/*
 * The nutrition-panel parser.
 *
 * The first block is MacroTrack's own `NutritionLabelParserTest.kt`, fixture
 * for fixture — this is the port's proof, and if one of these changes answer
 * the port drifted from the app it came from. The blocks after it are the
 * shapes the Kotlin suite never had to face: the manual text path, and the
 * Australian panel conventions (kJ-only, comma decimals, "less than 1 g",
 * per-100g-only) that the camera version could assume its way past and this
 * one cannot.
 */

/** The clean four-row panel the reference suite uses throughout. */
const CLEAN: OcrLine[] = [
  { text: 'Energy', left: 0, top: 100, right: 80, bottom: 120 },
  { text: '124Cal (520kJ)', left: 200, top: 100, right: 320, bottom: 120 },
  { text: 'Protein', left: 0, top: 130, right: 80, bottom: 150 },
  { text: '3.2g', left: 200, top: 130, right: 250, bottom: 150 },
  { text: 'Fat, total', left: 0, top: 160, right: 90, bottom: 180 },
  { text: '2.1g', left: 200, top: 160, right: 250, bottom: 180 },
  { text: 'Carbohydrate', left: 0, top: 190, right: 100, bottom: 210 },
  { text: '15.6g', left: 200, top: 190, right: 260, bottom: 210 },
];

describe('parseLabelLines — ported from NutritionLabelParserTest.kt', () => {
  it('parses a clean four-row label', () => {
    const r = parseLabelLines(CLEAN);
    expect(r.calories).toBeCloseTo(124, 3);
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.fatG).toBeCloseTo(2.1, 3);
    expect(r.carbsG).toBeCloseTo(15.6, 3);
    expect(r.servingQty).toBeNull();
    expect(r.servingUnit).toBeNull();
    expect(isEmptyLabel(r)).toBe(false);
  });

  it('converts kilojoules to calories when no Cal reading is present', () => {
    const r = parseLabelLines([
      { text: 'Energy', left: 0, top: 100, right: 80, bottom: 120 },
      { text: '836kJ', left: 200, top: 100, right: 260, bottom: 120 },
    ]);
    expect(r.calories).toBeCloseTo(199.809, 2);
  });

  it('does not confuse saturated fat or sugars with the total row', () => {
    const r = parseLabelLines([
      { text: 'Fat, total', left: 0, top: 160, right: 90, bottom: 180 },
      { text: '9.4g', left: 200, top: 160, right: 250, bottom: 180 },
      { text: '- saturated', left: 10, top: 190, right: 100, bottom: 210 },
      { text: '6.1g', left: 200, top: 190, right: 250, bottom: 210 },
      { text: 'Carbohydrate', left: 0, top: 220, right: 100, bottom: 240 },
      { text: '22.0g', left: 200, top: 220, right: 260, bottom: 240 },
      { text: '- sugars', left: 10, top: 250, right: 100, bottom: 270 },
      { text: '18.5g', left: 200, top: 250, right: 260, bottom: 270 },
    ]);
    expect(r.fatG).toBeCloseTo(9.4, 3);
    expect(r.carbsG).toBeCloseTo(22.0, 3);
  });

  it('survives lines returned out of top-to-bottom order', () => {
    // OCR does not guarantee reading order; the same eight lines, shuffled.
    const r = parseLabelLines([CLEAN[7], CLEAN[0], CLEAN[6], CLEAN[5], CLEAN[1], CLEAN[4], CLEAN[2], CLEAN[3]]);
    expect(r.calories).toBeCloseTo(124, 3);
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.fatG).toBeCloseTo(2.1, 3);
    expect(r.carbsG).toBeCloseTo(15.6, 3);
  });

  it('parses serving size from parenthetical grams', () => {
    const r = parseLabelLines([
      { text: 'Serving size: 2 biscuits (30g)', left: 0, top: 50, right: 300, bottom: 70 },
      { text: 'Energy', left: 0, top: 100, right: 80, bottom: 120 },
      { text: '124Cal', left: 200, top: 100, right: 260, bottom: 120 },
    ]);
    expect(r.servingQty).toBeCloseTo(30, 3);
    expect(r.servingUnit).toBe('g');
  });

  it('leaves serving size null when no serving size line is present', () => {
    const r = parseLabelLines(CLEAN);
    expect(r.servingQty).toBeNull();
    expect(r.servingUnit).toBeNull();
  });

  it('chooses the per-serving column over a per-100g column when both are present', () => {
    // FSANZ prints per-serving first. The leftmost value cell is the one read,
    // never whichever cell happens to be widest or last.
    const r = parseLabelLines([
      { text: 'Protein', left: 0, top: 100, right: 80, bottom: 120 },
      { text: '3.2g', left: 200, top: 100, right: 250, bottom: 120 },
      { text: '10.7g', left: 300, top: 100, right: 350, bottom: 120 },
    ]);
    expect(r.proteinG).toBeCloseTo(3.2, 3);
  });

  it('does not confuse comma-phrased saturated fat or sugars with the total row', () => {
    const r = parseLabelLines([
      { text: 'Fat, total', left: 0, top: 160, right: 90, bottom: 180 },
      { text: '9.4g', left: 200, top: 160, right: 250, bottom: 180 },
      { text: 'Fat, saturated', left: 0, top: 190, right: 100, bottom: 210 },
      { text: '6.1g', left: 200, top: 190, right: 250, bottom: 210 },
      { text: 'Carbohydrate', left: 0, top: 220, right: 100, bottom: 240 },
      { text: '22.0g', left: 200, top: 220, right: 260, bottom: 240 },
      { text: 'Carbohydrate, sugars', left: 0, top: 250, right: 140, bottom: 270 },
      { text: '18.5g', left: 200, top: 250, right: 260, bottom: 270 },
    ]);
    expect(r.fatG).toBeCloseTo(9.4, 3);
    expect(r.carbsG).toBeCloseTo(22.0, 3);
  });

  it('leaves fat blank rather than using the saturated sub-row when the total is unreadable', () => {
    // Without the "saturat" guard this returns 6.1 — a wrong number where a
    // blank belongs. That is the failure the guard exists for.
    const r = parseLabelLines([
      { text: 'Fat, total', left: 0, top: 160, right: 90, bottom: 180 },
      { text: '??', left: 200, top: 160, right: 250, bottom: 180 },
      { text: 'Fat, saturated', left: 0, top: 190, right: 100, bottom: 210 },
      { text: '6.1g', left: 200, top: 190, right: 250, bottom: 210 },
    ]);
    expect(r.fatG).toBeNull();
  });

  it('leaves carbs blank rather than using the sugars sub-row when the total is unreadable', () => {
    const r = parseLabelLines([
      { text: 'Carbohydrate', left: 0, top: 220, right: 100, bottom: 240 },
      { text: '??', left: 200, top: 220, right: 260, bottom: 240 },
      { text: 'Carbohydrate, sugars', left: 0, top: 250, right: 140, bottom: 270 },
      { text: '18.5g', left: 200, top: 250, right: 260, bottom: 270 },
    ]);
    expect(r.carbsG).toBeNull();
  });

  it('still groups macro rows correctly when half the recognized lines are much taller', () => {
    // Eight tall filler lines against eight table lines. A median-based row
    // tolerance tips onto the tall ones here and chain-merges the table into
    // one row; anchoring on the minimum line height does not.
    const filler: OcrLine[] = Array.from({ length: 8 }, (_, i) => ({
      text: `Filler line ${i}`,
      left: 0,
      top: i * 150,
      right: 300,
      bottom: i * 150 + 100,
    }));
    const table: OcrLine[] = [
      { text: 'Energy', left: 0, top: 1300, right: 80, bottom: 1320 },
      { text: '124Cal', left: 200, top: 1300, right: 260, bottom: 1320 },
      { text: 'Protein', left: 0, top: 1330, right: 80, bottom: 1350 },
      { text: '3.2g', left: 200, top: 1330, right: 250, bottom: 1350 },
      { text: 'Fat, total', left: 0, top: 1360, right: 90, bottom: 1380 },
      { text: '2.1g', left: 200, top: 1360, right: 250, bottom: 1380 },
      { text: 'Carbohydrate', left: 0, top: 1390, right: 100, bottom: 1410 },
      { text: '15.6g', left: 200, top: 1390, right: 260, bottom: 1410 },
    ];
    const r = parseLabelLines([...filler, ...table]);
    expect(r.calories).toBeCloseTo(124, 3);
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.fatG).toBeCloseTo(2.1, 3);
    expect(r.carbsG).toBeCloseTo(15.6, 3);
  });

  it('returns an empty result when nothing recognizable is found', () => {
    const r = parseLabelLines([
      { text: 'Ingredients: wheat flour, sugar, vegetable oil', left: 0, top: 300, right: 400, bottom: 320 },
      { text: 'Best before 12/2027', left: 0, top: 340, right: 200, bottom: 360 },
    ]);
    expect(isEmptyLabel(r)).toBe(true);
  });

  it('returns an empty result for no lines at all', () => {
    expect(isEmptyLabel(parseLabelLines([]))).toBe(true);
  });
});

describe('parseLabelText — the manual path', () => {
  it('reads a whole panel typed one row per line', () => {
    const r = parseLabelText(
      [
        'NUTRITION INFORMATION',
        'Servings per package: 12',
        'Serving size: 30g',
        'Energy 520kJ',
        'Protein 3.2g',
        'Fat, total 2.1g',
        '- saturated 0.4g',
        'Carbohydrate 15.6g',
        '- sugars 1.2g',
        'Sodium 45mg',
      ].join('\n'),
    );
    expect(r.calories).toBeCloseTo(124.28, 1);
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.fatG).toBeCloseTo(2.1, 3);
    expect(r.carbsG).toBeCloseTo(15.6, 3);
    expect(r.servingQty).toBeCloseTo(30, 3);
    expect(r.servingUnit).toBe('g');
  });

  it('keeps the per-serving column when a paste preserved both columns', () => {
    const r = parseLabelText(
      ['            Per serving   Per 100g', 'Energy      520kJ        1733kJ', 'Protein     3.2g         10.7g'].join('\n'),
    );
    expect(r.calories).toBeCloseTo(124.28, 1);
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.basis).toBe('per_serving');
  });

  it('reports a per-100g-only panel as per_100 rather than calling it a serving', () => {
    // Logging a per-100g figure as one serving's macros is wrong by however
    // large the serving is. The basis is reported so the caller can say so.
    const r = parseLabelText(['Per 100g', 'Energy 1733kJ', 'Protein 10.7g', 'Fat, total 7.0g', 'Carbohydrate 52.1g'].join('\n'));
    expect(r.basis).toBe('per_100');
    expect(r.proteinG).toBeCloseTo(10.7, 3);
  });

  it('is not fooled by "Servings per package" on a per-100-only panel', () => {
    // Every FSANZ panel prints that line, including one with no per-serving
    // column at all. Reading it as evidence of a serving column stored a
    // per-100 figure as one serving's macros — wrong by however large the
    // serving is, which is the exact failure `basis` exists to prevent.
    const r = parseLabelText(
      ['Servings per package: 8', 'Serving size: 30g', 'Per 100g', 'Energy 1733kJ', 'Protein 10.7g'].join('\n'),
    );
    expect(r.basis).toBe('per_100');
    expect(r.proteinG).toBeCloseTo(10.7, 3);
  });

  it('still reads a real per-serving heading first, whatever else the panel prints', () => {
    const r = parseLabelText(
      ['Servings per package: 8', 'Per serving   Per 100g', 'Energy  520kJ  1733kJ', 'Protein 3.2g  10.7g'].join('\n'),
    );
    expect(r.basis).toBe('per_serving');
  });

  it('falls back to the package line only when no per-100 heading was read', () => {
    const r = parseLabelText(['Servings per package: 8', 'Energy 520kJ', 'Protein 3.2g'].join('\n'));
    expect(r.basis).toBe('per_serving');
  });

  it('reports an unheaded panel as unknown rather than assuming a basis', () => {
    expect(parseLabelText('Energy 520kJ\nProtein 3.2g').basis).toBe('unknown');
  });

  it('returns empty for blank or whitespace-only input', () => {
    expect(isEmptyLabel(parseLabelText(''))).toBe(true);
    expect(isEmptyLabel(parseLabelText('   \n\n  \t '))).toBe(true);
  });

  it('returns empty for a paragraph with no macro rows', () => {
    expect(isEmptyLabel(parseLabelText('Ingredients: wheat flour, sugar.\nBest before 12/2027'))).toBe(true);
  });

  it('agrees with the positioned path on the same panel', () => {
    // The two entry points share one reader on purpose; this is what stops
    // the manual path drifting from the camera path it stands in for.
    const viaText = parseLabelText('Energy 124Cal (520kJ)\nProtein 3.2g\nFat, total 2.1g\nCarbohydrate 15.6g');
    const viaLines = parseLabelLines(CLEAN);
    expect(viaText.calories).toBeCloseTo(viaLines.calories!, 6);
    expect(viaText.proteinG).toBeCloseTo(viaLines.proteinG!, 6);
    expect(viaText.fatG).toBeCloseTo(viaLines.fatG!, 6);
    expect(viaText.carbsG).toBeCloseTo(viaLines.carbsG!, 6);
  });
});

describe('Australian panel conventions', () => {
  it('converts a kJ-only panel, which is the common case here', () => {
    const r = parseLabelText('Energy 1733kJ');
    expect(r.calories).toBeCloseTo(414.2, 1);
  });

  it('prefers the Cal figure over the kJ figure when the panel prints both', () => {
    expect(parseLabelText('Energy 124Cal (520kJ)').calories).toBeCloseTo(124, 3);
  });

  it('reads a comma decimal separator as a decimal point', () => {
    const r = parseLabelText('Energy 520,5kJ\nProtein 3,2g\nFat, total 2,1g\nCarbohydrate 15,6g');
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.fatG).toBeCloseTo(2.1, 3);
    expect(r.carbsG).toBeCloseTo(15.6, 3);
    expect(r.calories).toBeCloseTo(124.4, 1);
  });

  it('does not read a thousands separator as a decimal point', () => {
    // "1,733 kJ" is 1733, not 1.733. Getting this wrong understates energy by
    // three orders of magnitude and would look plausible on a small serving.
    expect(parseLabelText('Energy 1,733kJ').calories).toBeCloseTo(414.2, 1);
    expect(parseLabelText('Carbohydrate 1,250g').carbsG).toBeCloseTo(1250, 3);
  });

  it('reads "Less than 1g" as zero and says it rounded down', () => {
    const r = parseLabelText('Protein 3.2g\nFat, total Less than 1g\nCarbohydrate 15.6g');
    expect(r.fatG).toBe(0);
    expect(r.roundedDown).toBe(true);
  });

  it('reads the "<1g" form the same way', () => {
    const r = parseLabelText('Fat, total <1g');
    expect(r.fatG).toBe(0);
    expect(r.roundedDown).toBe(true);
  });

  it('does not flag roundedDown when every row printed a figure', () => {
    expect(parseLabelText('Protein 3.2g\nFat, total 2.1g').roundedDown).toBe(false);
  });

  it('leaves fat null when the panel has no fat row at all', () => {
    const r = parseLabelText('Energy 520kJ\nProtein 3.2g\nCarbohydrate 15.6g');
    expect(r.fatG).toBeNull();
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.carbsG).toBeCloseTo(15.6, 3);
  });

  it('reads a serving size in millilitres', () => {
    const r = parseLabelText('Serving size: 250ml\nEnergy 400kJ');
    expect(r.servingQty).toBeCloseTo(250, 3);
    expect(r.servingUnit).toBe('ml');
  });

  it('takes the parenthetical mass over the count in a "2 biscuits (30g)" serving', () => {
    const r = parseLabelText('Serving size: 2 biscuits (30g)');
    expect(r.servingQty).toBeCloseTo(30, 3);
    expect(r.servingUnit).toBe('g');
  });

  it('does not mistake "Servings per package" for a serving size', () => {
    expect(parseLabelText('Servings per package: 12').servingQty).toBeNull();
  });

  it('ignores sodium, fibre and every other row it was not asked for', () => {
    const r = parseLabelText('Sodium 45mg\nDietary fibre 2.4g\nCalcium 120mg');
    expect(isEmptyLabel(r)).toBe(true);
  });

  it('reads an all-caps panel', () => {
    const r = parseLabelText('ENERGY 520KJ\nPROTEIN 3.2G\nFAT, TOTAL 2.1G\nCARBOHYDRATE 15.6G');
    expect(r.calories).toBeCloseTo(124.28, 1);
    expect(r.proteinG).toBeCloseTo(3.2, 3);
    expect(r.fatG).toBeCloseTo(2.1, 3);
    expect(r.carbsG).toBeCloseTo(15.6, 3);
  });

  it('reads an em-dash sub-row without mistaking it for the total', () => {
    const r = parseLabelText('Fat, total 9.4g\n— saturated 6.1g');
    expect(r.fatG).toBeCloseTo(9.4, 3);
  });
});

/*
 * Thousands separators, both forms. The comma case was already fixed once;
 * the SPACE case is the identical defect and survived that fix, because
 * Australian panels print energy both ways and only one had a test.
 *
 * A miss here is not a parse failure — it is a plausible wrong number.
 * "1 733 kJ" read as 733 kJ understates energy by 58% and looks entirely
 * ordinary on screen, which is precisely the failure the confirm step exists
 * to catch and the one an athlete is least likely to notice by scan 80.
 */
describe('thousands separators', () => {
  const energy = (text: string) => parseLabelText(`${text}\nProtein 3.2 g\nFat 2.1 g\nCarbohydrate 15.6 g`).calories;
  const KCAL_1733 = 1733 / 4.184;

  it('reads a comma-grouped energy value whole', () => {
    expect(energy('Energy 1,733kJ')).toBeCloseTo(KCAL_1733, 6);
  });

  it('reads a SPACE-grouped energy value whole — the SI form on AU panels', () => {
    expect(energy('Energy 1 733 kJ')).toBeCloseTo(KCAL_1733, 6);
  });

  it('reads the non-breaking and thin spaces OCR actually returns', () => {
    expect(energy('Energy 1 733 kJ')).toBeCloseTo(KCAL_1733, 6);
    expect(energy('Energy 1 733 kJ')).toBeCloseTo(KCAL_1733, 6);
  });

  it('does not fuse two genuinely separate numbers', () => {
    // Four digits after the space, so this is not a thousands group.
    expect(energy('Energy 620 kJ 1733')).toBeCloseTo(620 / 4.184, 6);
  });
});
