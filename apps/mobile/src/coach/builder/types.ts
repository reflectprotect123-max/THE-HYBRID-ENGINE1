/*
 * The day builder's VALUE SHAPES, with no UI attached.
 *
 * On the web these live inside the components that render them —
 * `BlockEditor.tsx` exports `BlockValue`, `SetRows.tsx` exports `SetRow`. That
 * is fine there, where one file can hold both. It is not fine across a port:
 * React Native cannot import a file containing `<div>`, so a native builder
 * that reached for `BlockValue` would drag the entire web component tree with
 * it.
 *
 * So the shapes are extracted here first. `day-workout.ts` and
 * `session-list.ts` — the two pure modules that copy over unchanged — import
 * from this and from nothing else, which is what makes them copyable at all.
 *
 * Every declaration below is character-for-character the web's, deliberately.
 * The two builders must agree on what a block IS, or a session authored on one
 * reopens wrong on the other.
 */
import type { CondFmtKey, EffortKey, Modality } from '@hybrid/engine';

/**
 * The block kinds a coach can add.
 *
 * The mockup's own `BLOCK_CATEGORIES`, verbatim and in order, plus one the
 * owner asked for on 12 August 2026: `Mixed modal`. It is a conditioning block
 * with no single modality and no interval structure — one continuous effort,
 * heart rate recorded start to finish, against a target duration. Rest is not
 * prescribed; the athlete's rest timer is there if they want it.
 */
export const BLOCK_CATEGORIES = [
  'Strength/Power',
  'Conditioning',
  'Mixed modal',
  'Warm-up',
  'Cooldown',
  'Mobility',
] as const;

/** The categories that author a `CondBlock` rather than exercises and sets. */
export const CONDITIONING_CATEGORIES: readonly string[] = ['Conditioning', 'Mixed modal'];

/**
 * What a conditioning block holds. Every field maps onto one the engine's
 * `CondBlock` already has, so nothing here is a shape this app invented:
 * `minutes` and `targetDistanceM` are strings only because they are text
 * inputs mid-edit — `day-workout.ts` is where they become numbers, and where a
 * value that is not a number is dropped rather than stored as NaN.
 */
export interface CondValue {
  /** `CondFmtKey`. */
  fmt: string;
  /** `Modality`, or '' for mixed / unlabelled — which is what Mixed modal is. */
  modality: string;
  /** `EffortKey`. The engine derives the HR zone from it; the coach never picks a zone directly. */
  effort: string;
  minutes: string;
  targetDistanceM: string;
}

export const CONDITIONING_FORMATS = ['steady', 'intervals', 'tempo', 'free'] as const;
export const CONDITIONING_EFFORTS = ['easy', 'medium', 'hard'] as const;
export const CONDITIONING_MODALITIES = ['', 'row', 'run', 'ski', 'bike', 'air_bike'] as const;

/** A new block's conditioning defaults, which differ by category. */
export function newCondValue(category: string): CondValue {
  return category === 'Mixed modal'
    // Free: one continuous effort, no interval structure. No modality, because
    // "mixed" is precisely the absence of one — `types.ts` calls that
    // "unlabeled/general conditioning".
    ? { fmt: 'free', modality: '', effort: 'medium', minutes: '30', targetDistanceM: '' }
    : { fmt: 'steady', modality: '', effort: 'easy', minutes: '20', targetDistanceM: '' };
}

export interface BlockExercise {
  id: string;
  name: string;
  /** What each of the two set columns measures — see `@hybrid/engine`'s COLUMN_TYPES. */
  columnA: string;
  columnB: string;
  sets: SetRow[];
}

export interface BlockValue {
  id: string;
  category: string;
  exercises: BlockExercise[];
  /** Present only for a conditioning category; see `CONDITIONING_CATEGORIES`. */
  conditioning?: CondValue;
}

/** A, B, C … — the mockup letters exercises within a block rather than numbering them. */
function letterFor(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

export interface BlockExercise {
  id: string;
  name: string;
  /** What each of the two set columns measures — see `@hybrid/engine`'s COLUMN_TYPES. */
  columnA: string;
  columnB: string;
  sets: SetRow[];
}

export interface BlockValue {
  id: string;
  category: string;
  exercises: BlockExercise[];
  /** Present only for a conditioning category; see `CONDITIONING_CATEGORIES`. */
  conditioning?: CondValue;
}

export interface SetRow {
  id: string;
  /** First column's value, in whatever `columnA` measures. */
  a: string;
  /** Second column's value, in whatever `columnB` measures. */
  b: string;
}

/**
 * Three empty rows, matching the mockup's note and the app's existing default
 * (`GuidedBuilder` seeds `sets: 3`). A different default here would hand the
 * same coach a different session depending on which screen they opened.
 */
export function newSetRows(exerciseId: string): SetRow[] {
  return [0, 1, 2].map((i) => ({ id: `${exerciseId}-s${i}`, a: '', b: '' }));
}

/** What the whole day holds: the coach's note, and the blocks. */
export interface DayBuilderValue {
  instructions: string;
  blocks: BlockValue[];
}

/* Referenced so the engine type imports above are not unused in a file that
   only declares shapes. `CondValue.fmt`/`.modality`/`.effort` are strings
   because they are mid-edit form values; these are what they become. */
export type CondFmt = CondFmtKey;
export type CondEffort = EffortKey;
export type CondModality = Modality;
