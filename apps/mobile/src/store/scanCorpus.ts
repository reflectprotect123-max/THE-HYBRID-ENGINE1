import type { Storage } from '@hybrid/engine';
import { uid } from '@hybrid/engine';
import type { OcrLine, ParsedNutritionLabel } from '@hybrid/nutrition-core';
import { storage } from './storage';

/*
 * A local record of what the label reader SAW and what the athlete then said
 * was true.
 *
 * EVIDENCE, NOT A MODEL. Nothing reads this to make a decision. No parser
 * consults it, no engine sees it, no constraint is derived from it. It exists
 * so that a parser fix can be aimed at real failures on real Australian
 * packets instead of at invented fixtures, and the only thing that ever acts
 * on it is a human reading the exported JSON.
 *
 * WHY IT IS ITS OWN KEY AND ITS OWN MODULE, beside `nutrition.tsx` rather than
 * inside it:
 *
 *  - It must never sync. `cloudFp` hashes the engine blob and the sync layer
 *    fingerprints the nutrition slice with `JSON.stringify`, so a field on
 *    `NutritionDB` would make every scan a nutrition push — and CLAUDE.md is
 *    explicit that a nutrition write must not dirty the training fingerprint,
 *    for exactly the reason that applies here in miniature: diagnostic bulk has
 *    no business in a merge.
 *  - It IS bulk. A bounding box per recognised line, tens of lines per panel.
 *    Putting that through `mergeNutrition` would slow every merge on every
 *    device for data no device but this one will ever look at.
 *  - It is device-local by nature. The corpus is a record of THIS camera on
 *    THESE packets. Merged across devices it would not even mean anything.
 *
 * So: the pattern `discipline.ts` and `nutrition.tsx` already established — a
 * storage key of its own, deliberately not derived from `LS_KEY` or
 * `NUTRITION_LS_KEY`, so nothing can make it look like part of either slice.
 *
 * IT IS BOUNDED, and that is not optional. `pruneCondTraces` exists in the
 * engine because inline HR traces grew until every save failed forever; a
 * bounding box per line is the same shape of hazard on the same phone.
 */

/** Deliberately NOT `NUTRITION_LS_KEY` + a suffix: nothing may make this look
 *  like part of the synced slice. */
export const SCAN_CORPUS_LS_KEY = 'hybrid-label-scan-corpus-v1';

/**
 * How many scans are kept, newest first.
 *
 * A scanned panel is roughly 20–40 recognised lines, and a line serialises to
 * about 75 bytes of text plus four edges — call it 3.5 kB a record with the
 * parse and the confirmation on top. 200 records is therefore ~700 kB worst
 * case and far less in practice, which is small beside the MMKV store and
 * still under the ~1 MB Android caps an intent payload at (the same ceiling
 * the backup export already runs into).
 *
 * 200 is also more foods than a pantry holds, so an athlete scanning
 * everything they eat reaches good coverage before anything is evicted.
 */
export const SCAN_CORPUS_CAP = 200;

/**
 * A hard byte ceiling under the record cap.
 *
 * The record count alone does not bound size: one photo that also caught an
 * ingredients list and a marketing panel can carry hundreds of lines. This is
 * what stops 200 pathological records from being ten megabytes.
 */
export const SCAN_CORPUS_BYTES = 512 * 1024;

/** The fields the reader proposes and the athlete can correct. */
export const SCAN_FIELDS = ['calories', 'proteinG', 'carbsG', 'fatG', 'servingQty', 'servingUnit'] as const;

export type ScanField = (typeof SCAN_FIELDS)[number];

/** The form's own strings, exactly as they sat in the fields. */
export type LabelFormValues = Record<ScanField, string>;

export interface ScanValues {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  servingQty: number | null;
  servingUnit: string | null;
}

export type ScanChanges = Record<ScanField, boolean>;

export interface ScanCorpusRecord {
  id: string;
  at: string;
  /** The recogniser's output, flattened by the adapter and otherwise untouched. */
  lines: OcrLine[];
  /** What the parser made of those lines. */
  parsed: ParsedNutritionLabel;
  /** What was actually in front of the athlete when they confirmed. */
  presented: ScanValues;
  /** What they saved. */
  confirmed: ScanValues;
  /**
   * Per field, whether the athlete moved it.
   *
   * Derived from `presented` and not from `parsed`, because the two differ for
   * an honest reason: a per-100 panel has its serving denominator set to 100 by
   * the prefill, and scoring that as a correction would blame the parser for a
   * decision the app made on its behalf.
   */
  changed: ScanChanges;
}

/** What the confirm step hands over. */
export interface ScanConfirmation {
  lines: OcrLine[];
  parsed: ParsedNutritionLabel;
  presented: LabelFormValues;
  confirmed: LabelFormValues;
}

/* ---------- comparing a proposal against a confirmation ---------- */

/** A form string as a number, or null for blank. A blank macro is not zero. */
const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const text = (s: string): string | null => s.trim().toLowerCase() || null;

export function toScanValues(form: LabelFormValues): ScanValues {
  return {
    calories: num(form.calories),
    proteinG: num(form.proteinG),
    carbsG: num(form.carbsG),
    fatG: num(form.fatG),
    servingQty: num(form.servingQty),
    servingUnit: form.servingUnit.trim() || null,
  };
}

/**
 * Which fields the athlete moved.
 *
 * Compared as VALUES, never as the raw strings: the form prints a prefill
 * rounded to one decimal, so "3.20" typed over "3.2" is the athlete confirming
 * the reader, not correcting it, and recording it as a correction would put a
 * false failure into the only signal this corpus carries.
 */
export function diffScan(presented: LabelFormValues, confirmed: LabelFormValues): ScanChanges {
  const a = toScanValues(presented);
  const b = toScanValues(confirmed);
  return {
    calories: a.calories !== b.calories,
    proteinG: a.proteinG !== b.proteinG,
    carbsG: a.carbsG !== b.carbsG,
    fatG: a.fatG !== b.fatG,
    servingQty: a.servingQty !== b.servingQty,
    servingUnit: text(presented.servingUnit) !== text(confirmed.servingUnit),
  };
}

/* ---------- the bound ---------- */

/**
 * Newest kept, oldest evicted, by count and then by bytes.
 *
 * Records arrive appended, so the newest are at the end. Both limits are
 * applied from the newest end for the same reason: an old scan of a food the
 * athlete has stopped buying is the one worth losing.
 */
export function capScanCorpus(
  records: readonly ScanCorpusRecord[],
  cap = SCAN_CORPUS_CAP,
  budget = SCAN_CORPUS_BYTES,
): ScanCorpusRecord[] {
  const recent = records.slice(Math.max(0, records.length - cap));
  let used = 0;
  let first = recent.length;
  for (let i = recent.length - 1; i >= 0; i--) {
    used += JSON.stringify(recent[i]).length;
    /* The newest record is kept even if it alone exceeds the budget: dropping
       it would silently make the biggest, most interesting failures the only
       ones that never get recorded. */
    if (used > budget && i < recent.length - 1) break;
    first = i;
  }
  return recent.slice(first);
}

/* ---------- storage ---------- */

const isRecord = (v: unknown): v is ScanCorpusRecord => {
  const r = v as ScanCorpusRecord | null;
  return !!r && typeof r.id === 'string' && typeof r.at === 'string' && Array.isArray(r.lines);
};

/** An unreadable corpus is an EMPTY corpus. Diagnostic data may never be the
 *  reason a screen throws. */
export function loadScanCorpus(store: Storage = storage): ScanCorpusRecord[] {
  try {
    const raw = store.getItem(SCAN_CORPUS_LS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

/** False on a full disk. The caller ignores it on purpose — see `recordScan`. */
export function saveScanCorpus(records: readonly ScanCorpusRecord[], store: Storage = storage): boolean {
  try {
    store.setItem(SCAN_CORPUS_LS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

/**
 * Append one confirmed scan.
 *
 * Returns the record for the caller's convenience and swallows every storage
 * failure: this runs on the same tap that saves the athlete's food, and a
 * diagnostic write that could throw would put a failed corpus write between
 * them and their own data.
 */
export function recordScan(
  scan: ScanConfirmation,
  store: Storage = storage,
  at: string = new Date().toISOString(),
): ScanCorpusRecord {
  const record: ScanCorpusRecord = {
    id: uid(),
    at,
    lines: scan.lines,
    parsed: scan.parsed,
    presented: toScanValues(scan.presented),
    confirmed: toScanValues(scan.confirmed),
    changed: diffScan(scan.presented, scan.confirmed),
  };
  saveScanCorpus(capScanCorpus([...loadScanCorpus(store), record]), store);
  return record;
}

export function clearScanCorpus(store: Storage = storage): void {
  try {
    store.removeItem(SCAN_CORPUS_LS_KEY);
  } catch {
    /* nothing to clear that anything else depends on */
  }
}

/** What Settings prints. Bytes come off the raw string rather than a re-encode. */
export function scanCorpusStats(store: Storage = storage): { count: number; bytes: number } {
  let bytes = 0;
  try {
    bytes = store.getItem(SCAN_CORPUS_LS_KEY)?.length ?? 0;
  } catch {
    bytes = 0;
  }
  return { count: loadScanCorpus(store).length, bytes };
}

/**
 * The corpus as the JSON that leaves the phone.
 *
 * Wrapped rather than bare so a file found six months later says what it is,
 * which schema it is, and what the cap was when it was taken — a truncated
 * corpus that does not say it was truncated reads as a complete one.
 */
export function exportScanCorpus(store: Storage = storage, at: string = new Date().toISOString()): string {
  return JSON.stringify(
    { schema: 1, kind: 'hybrid-label-scan-corpus', exportedAt: at, cap: SCAN_CORPUS_CAP, records: loadScanCorpus(store) },
    null,
    1,
  );
}
