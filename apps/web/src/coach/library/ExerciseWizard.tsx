import type { CatalogueEntry } from '@hybrid/engine';
import type { BlockExercise } from './BlockEditor';
import type { SetRow } from './SetRows';

/** Ninety seconds — the app's own default rest, unchanged from before this file existed. */
export const DEFAULT_REST_SEC = 90;

/** Two and a half minutes — the EMOM default, unchanged. */
export const DEFAULT_EVERY_SEC = 150;

/** "2:30", the way a coach writes an interval. */
export function fmtEvery(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What the wizard's Measure step offers, standing in for a raw `columnA`/
 * `columnB` pair. There is no server-side `Measure` type — this is a UI
 * vocabulary over `@hybrid/engine`'s `COLUMN_TYPES`, the same relationship
 * `SetRows.tsx`'s dropdowns already have to it.
 */
export type Measure = 'reps_weight' | 'reps' | 'seconds' | 'distance';

export const MEASURES: { key: Measure; glyph: string; name: string; sub: string; columnA: string; columnB: string }[] = [
  { key: 'reps_weight', glyph: '⚖', name: 'Reps + Weight', sub: 'most strength work', columnA: 'reps', columnB: 'weight_kg' },
  { key: 'reps', glyph: '💪', name: 'Reps only', sub: 'bodyweight', columnA: 'reps', columnB: '' },
  { key: 'seconds', glyph: '⏱', name: 'Seconds', sub: 'holds, planks', columnA: 'seconds', columnB: '' },
  { key: 'distance', glyph: '📏', name: 'Distance', sub: 'sled, carries', columnA: 'meters', columnB: '' },
];

/** The reverse of a `MEASURES` lookup — reading a stored exercise's columns back into a Measure, for editing. */
export function measureFor(columnA: string, columnB: string): Measure {
  const found = MEASURES.find((m) => m.columnA === columnA && m.columnB === columnB);
  if (found) return found.key;
  if (columnA === 'seconds') return 'seconds';
  if (columnA === 'meters') return 'distance';
  return 'reps';
}

/** The shape of the exercise the wizard last committed in THIS block — defaults for the next ADD only, never for an edit. */
export interface WizardShape {
  measure: Measure;
  sets: number;
  a: string;
  b: string;
}
