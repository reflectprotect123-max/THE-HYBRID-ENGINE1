/*
 * Matching a synced Concept2 Logbook result back to this app's own session
 * model, and translating it into the shape a `CondBlock`/`CondResult` wants.
 *
 * A Concept2-logged row/ski/bike effort did not originate from this app's own
 * "Start" button, so there is no `sinkBid`/`sinkBi` id to key off (the way a
 * live FTMS-connected session already matches back to its block). Time
 * proximity is the only signal available, exactly like a WHOOP recovery
 * reading is matched to "today's" session rather than an exact id.
 */
import type { CondBlock, CondResult, Concept2Result, Modality, Session } from './types';

/** Default matching window: wide enough for clock skew and a lagging sync, narrow enough not to grab an unrelated session. */
export const CONCEPT2_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface Concept2Match {
  session: Session;
  block: CondBlock;
}

/** Concept2's raw machine-type vocabulary, mapped explicitly to this app's `Modality` — never passed through untranslated. */
const CONCEPT2_TYPE_TO_MODALITY: Record<string, Modality> = {
  rower: 'row',
  skierg: 'ski',
  bike: 'bike',
};

/**
 * Best time-proximity match for a synced Concept2 result among an athlete's
 * sessions, or `null` if nothing is close enough.
 *
 * A block's own `condResult.startedAt` (the moment that specific effort was
 * started) is preferred over the session's `startedAt` when both exist —
 * a session can hold several conditioning blocks over a longer span, so the
 * block-level timestamp is the more precise signal.
 *
 * Candidates are also filtered by modality compatibility (via
 * `CONCEPT2_TYPE_TO_MODALITY`) so this never relies on the caller having
 * pre-filtered by modality — a Concept2 rower result can only ever match a
 * `row` block, never a same-day run/bike block done nearby in time. A result
 * whose raw type doesn't map to a known `Modality` at all matches nothing.
 */
export function matchConcept2Result(
  result: Concept2Result,
  sessions: Session[],
  windowMs: number = CONCEPT2_MATCH_WINDOW_MS,
): Concept2Match | null {
  if (!result.startedAt) return null;
  const resultTime = Date.parse(result.startedAt);
  if (!Number.isFinite(resultTime)) return null;

  const modality = result.modality ? CONCEPT2_TYPE_TO_MODALITY[result.modality] : undefined;
  if (!modality) return null;

  let best: Concept2Match | null = null;
  let bestDiff = Infinity;

  for (const session of sessions) {
    for (const block of session.blocks) {
      if (block.kind !== 'conditioning') continue;
      if (block.modality !== modality) continue;
      const refTime = block.condResult?.startedAt ?? session.startedAt;
      if (refTime == null || !Number.isFinite(refTime)) continue;
      const diff = Math.abs(refTime - resultTime);
      if (diff <= windowMs && diff < bestDiff) {
        bestDiff = diff;
        best = { session, block };
      }
    }
  }

  return best;
}

/** The Concept2 console name for each machine type, used as `device.model`. */
const CONCEPT2_TYPE_TO_MODEL: Record<string, string> = {
  rower: 'RowErg',
  skierg: 'SkiErg',
  bike: 'BikeErg',
};

function splitsOf(result: Concept2Result): unknown[] | undefined {
  const w = result.workout as { splits?: unknown } | null | undefined;
  const splits = w && Array.isArray(w.splits) ? w.splits : undefined;
  return splits && splits.length ? splits : undefined;
}

/**
 * Convert a normalized Concept2 result into the fields a `CondResult` wants.
 * Pure and partial — the caller merges this onto whatever else a match (or a
 * fresh, unmatched entry) already carries.
 */
export function concept2ToCondResult(result: Concept2Result): Partial<CondResult> {
  const out: Partial<CondResult> = {
    device: {
      manufacturer: 'Concept2',
      model: result.modality ? CONCEPT2_TYPE_TO_MODEL[result.modality] : undefined,
      consoleMetric: 'pace',
    },
  };

  const modality = result.modality ? CONCEPT2_TYPE_TO_MODALITY[result.modality] : undefined;
  if (modality) out.modality = modality;

  const splits = splitsOf(result);
  if (splits) out.splits = splits;

  if (result.startedAt) {
    const t = Date.parse(result.startedAt);
    if (Number.isFinite(t)) out.startedAt = t;
  }
  // Concept2's `time` (→ durationRaw) is in tenths of a second (e.g. `152350`
  // for "4:13:55.0" = 15235.0s); every other engine `dur` is plain seconds.
  if (result.durationRaw != null) out.dur = result.durationRaw / 10;
  // NOT distanceM: that field means "GPS-tracked metres" (types.ts) and is
  // summed into Progress's distance trend. An erg's own distance is real and
  // accurate (unlike FTMS's console-cumulative odometer, which Task 8 left
  // display-only), but it is not a GPS distance — bank it under its own name
  // so it survives without corrupting that invariant. See I2 in the final
  // review for the failure this replaces.
  if (result.distanceRaw != null) out.deviceDistanceM = result.distanceRaw;

  return out;
}
