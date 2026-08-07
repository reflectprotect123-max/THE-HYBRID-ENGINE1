import { quickAddEntry, type FoodLogEntry, type IsoDate, type IsoTimestamp } from '@hybrid/nutrition-core';
import { macro } from '@hybrid/nutrition-adapter';

/*
 * The web food log's write path, kept out of the component so it can be tested
 * in this app's node-environment Vitest suite (`apps/web/vitest.config.ts`
 * collects `test/**\/*.test.ts` only — there is no DOM here, and the rule that
 * matters is not a rendering rule).
 *
 * THE CONSTRAINT THIS FILE EXISTS TO PROTECT: web and mobile write the SAME
 * athlete's food log. An entry logged on a laptop and an entry logged on a
 * phone must be the same record — same fields, same provenance, same
 * `sourceSnapshot` keys — or the merge starts reconciling two record shapes and
 * the athlete's history depends on which device they had with them.
 *
 * So nothing here builds a `FoodLogEntry` literal. `quickAddEntry` from
 * `@hybrid/nutrition-core` is the one snapshot builder, exactly as
 * `apps/mobile/src/screens/nutrition/DailyLog.tsx` calls it, and `macro` is the
 * shared parse. This module only turns strings from inputs into its arguments.
 * `apps/web/test/nutrition-log.test.ts` pins the equality.
 *
 * WEB HAS NO CAMERA. Barcode and nutrition-label entry stay mobile-only, so the
 * only kind this screen can produce is `quick_add` — the kind that carries no
 * source id and no micronutrient map because there is genuinely no source
 * behind it. A web screen offering "scan" would be a button that cannot work.
 */

/** What the entry form is holding. Strings, because they come from inputs. */
export interface Draft {
  /** Empty for a new entry; the entry's own id when editing one. */
  id: string;
  displayName: string;
  meal: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

export const blankDraft = (meal: string): Draft => ({
  id: '',
  displayName: '',
  meal,
  calories: '',
  proteinG: '',
  carbsG: '',
  fatG: '',
});

export const draftOf = (e: FoodLogEntry): Draft => ({
  id: e.id,
  displayName: e.displayName,
  meal: e.meal,
  calories: String(e.calories),
  proteinG: String(e.proteinG),
  carbsG: String(e.carbsG),
  fatG: String(e.fatG),
});

/** The four macros plus the name, parsed. Shared by the create and edit paths
 *  so an edit cannot store a number a create would have rejected. */
export function draftFields(draft: Draft): {
  displayName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
} | null {
  const displayName = draft.displayName.trim();
  // An entry with no name is unreadable in the list and unfindable later. The
  // Save button is disabled on this too; this is the guard behind it.
  if (!displayName) return null;
  return {
    displayName,
    calories: macro(draft.calories),
    proteinG: macro(draft.proteinG),
    carbsG: macro(draft.carbsG),
    fatG: macro(draft.fatG),
  };
}

/**
 * A brand-new entry from a draft, or null when the draft is not loggable.
 *
 * `userId` is left blank on purpose, as everywhere else in this slice:
 * ownership is the sync layer's and RLS's at the namespace level, a
 * client-guessed id would be wrong for everything logged before a sign-in, and
 * the merge keys log entries by `id`.
 */
export function entryFromDraft(
  draft: Draft,
  ctx: { id: string; logDate: IsoDate; at: IsoTimestamp },
): FoodLogEntry | null {
  const fields = draftFields(draft);
  if (!fields) return null;
  return quickAddEntry({ id: ctx.id, logDate: ctx.logDate, meal: draft.meal, at: ctx.at }, fields);
}

/**
 * `YYYY-MM-DD` as a LOCAL calendar date.
 *
 * Parsed field by field rather than by `new Date(date)`, which reads a bare ISO
 * date as UTC midnight and lands on the previous day for every athlete west of
 * Greenwich — a whole day of food filed one day early. Same reasoning, same
 * behaviour, as the phone app's Daily Log.
 */
export const parseLocalDay = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
};

/** `date` ± whole days, staying on the local calendar `ymd` and `today` use. */
export const shiftDay = (date: string, days: number, ymd: (d: Date) => string): string => {
  const d = parseLocalDay(date);
  d.setDate(d.getDate() + days);
  return ymd(d);
};

/** `YYYY-MM-DD` as the athlete's own locale reads it. */
export const dayLabel = (date: string): string =>
  parseLocalDay(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
