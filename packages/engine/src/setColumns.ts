export interface ColumnType {
  value: string;
  label: string;
  placeholder: string;
}

/**
 * The six things a set column can measure, from the approved mockup's
 * `COLUMN_TYPES`.
 *
 * This is a vocabulary for a model that already exists rather than a new one:
 * `LoggedSet` carries `aVal` ("primary recorded value — kg for reps_kg,
 * seconds for seconds") and `aVal2` ("secondary recorded value — reps, when
 * the mode has two"). The set row is a UI over those two slots.
 */
export const COLUMN_TYPES: readonly ColumnType[] = [
  { value: 'reps', label: 'Reps', placeholder: 'reps' },
  { value: 'reps_range', label: 'Reps (min–max)', placeholder: 'e.g. 8-10' },
  { value: 'weight_kg', label: 'Weight (kg)', placeholder: 'kg' },
  { value: 'weight_pct', label: 'Weight (% of e1RM)', placeholder: '% e1RM' },
  { value: 'seconds', label: 'Seconds', placeholder: 'sec' },
  { value: 'meters', label: 'Meters', placeholder: 'm' },
] as const;

/**
 * What the second column may still measure once the first has chosen.
 *
 * An unset or unrecognised first column narrows nothing — there is no
 * duplicate to avoid yet, and silently hiding an option because of a value
 * that is not a measure would be a bug the coach could not explain.
 */
export function availableSecondColumns(first: string): ColumnType[] {
  if (!first) return [...COLUMN_TYPES];
  return COLUMN_TYPES.filter((c) => c.value !== first);
}

/**
 * Two columns may not measure the same thing — see `COLUMN_TYPES`. An
 * incomplete pair is incomplete, not invalid: a coach mid-edit has not made a
 * mistake yet, and flagging one would be noise.
 */
export function isColumnPairValid(first: string, second: string): boolean {
  if (!first || !second) return true;
  return first !== second;
}
