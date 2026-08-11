import { describe, expect, it } from 'vitest';
import { COLUMN_TYPES, availableSecondColumns, isColumnPairValid } from './setColumns';

/*
 * A set row measures two things. Measuring the same thing twice is not a layout
 * problem — it produces a set claiming "8 reps and 8 reps", which is bad data
 * that survives into every read of it. The mockup states the rule in its own
 * words: "picking the same thing for both would be a real logging mistake, so
 * the second column greys out and locks until the two differ again."
 *
 * The rule lives here, beside the vocabulary, rather than in whichever
 * component happens to render the second dropdown.
 */
describe('COLUMN_TYPES', () => {
  it('is the mockup list, in order', () => {
    expect(COLUMN_TYPES.map((c) => c.value)).toEqual([
      'reps',
      'reps_range',
      'weight_kg',
      'weight_pct',
      'seconds',
      'meters',
    ]);
  });

  it('keeps the mockup labels and placeholders verbatim', () => {
    expect(COLUMN_TYPES[1].label).toBe('Reps (min–max)');
    expect(COLUMN_TYPES[1].placeholder).toBe('e.g. 8-10');
    expect(COLUMN_TYPES[3].label).toBe('Weight (% of e1RM)');
    expect(COLUMN_TYPES[3].placeholder).toBe('% e1RM');
  });

  it('gives every column a placeholder, so no input ships unlabelled', () => {
    COLUMN_TYPES.forEach((c) => {
      expect(c.placeholder.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    });
  });
});

describe('availableSecondColumns', () => {
  it('excludes whatever the first column already measures', () => {
    const values = availableSecondColumns('reps').map((c) => c.value);
    expect(values).not.toContain('reps');
    expect(values).toContain('weight_kg');
    expect(values.length).toBe(COLUMN_TYPES.length - 1);
  });

  it('offers everything when the first column is unset', () => {
    expect(availableSecondColumns('').length).toBe(COLUMN_TYPES.length);
  });

  it('offers everything when the first column is not a known measure', () => {
    expect(availableSecondColumns('nonsense').length).toBe(COLUMN_TYPES.length);
  });
});

describe('isColumnPairValid', () => {
  it('rejects a pair measuring the same thing', () => {
    expect(isColumnPairValid('reps', 'reps')).toBe(false);
    expect(isColumnPairValid('weight_kg', 'weight_kg')).toBe(false);
  });

  it('accepts a pair measuring different things', () => {
    expect(isColumnPairValid('reps', 'weight_kg')).toBe(true);
  });

  it('accepts an incomplete pair — an unset column is not a duplicate', () => {
    expect(isColumnPairValid('reps', '')).toBe(true);
    expect(isColumnPairValid('', 'reps')).toBe(true);
    expect(isColumnPairValid('', '')).toBe(true);
  });
});
