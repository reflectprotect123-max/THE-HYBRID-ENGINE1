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
import type { CondBlock, CondResult, Concept2Result, EngineDB, Modality, Session } from './types';
import { pushCondHistory } from './conditioning';

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

/*
 * The import pipeline: plan, then apply.
 *
 * Split in two so the UI can show the athlete what a sync WOULD do ("3 new
 * results") and only touch the database after an explicit confirmation. Both
 * halves are pure over their inputs; `applyConcept2Import` mutates the draft
 * it is given, which is exactly the contract the apps' `update()` stores hand
 * out.
 */

export interface Concept2ImportMerge {
  sessionId: string;
  blockId: string;
  /** 'attach' fills an unlogged block; 'enrich' adds erg-only fields to a result the athlete already logged. */
  mode: 'attach' | 'enrich';
  patch: Partial<CondResult>;
}

export interface Concept2ImportPlan {
  merges: Concept2ImportMerge[];
  /** Results with no session close enough — filed into the standalone conditioning history. */
  standalone: CondResult[];
  /** Already imported, unusable (no id/time), or an unmapped machine type. */
  skipped: number;
}

/**
 * Deterministic record id for an imported result. Deliberately a pure function
 * of the provider id: two devices importing the same result independently
 * produce the SAME record, so the cloud settings merge (union by id) collapses
 * them instead of double-counting.
 */
export function concept2RecordId(externalId: string): string {
  return 'c2-' + externalId;
}

/** Every provider result id already landed anywhere in the database. */
export function importedConcept2Ids(db: EngineDB): Set<string> {
  const ids = new Set<string>();
  const conditioning = db.settings?.conditioning;
  if (Array.isArray(conditioning)) {
    for (const r of conditioning) if (r?.externalId) ids.add(r.externalId);
  }
  for (const s of db.sessions || []) {
    for (const b of s.blocks || []) {
      if (b.kind === 'conditioning' && b.condResult?.externalId) ids.add(b.condResult.externalId);
    }
  }
  return ids;
}

/**
 * Decide where each synced result belongs, without writing anything.
 *
 * A result must carry an `externalId` (the dedupe key), a parseable start
 * time, and a machine type that maps to this app's `Modality` — anything
 * else is counted in `skipped` rather than filed as an anonymous record the
 * athlete can never trace back.
 *
 * A matched block absorbs at most ONE result per plan: the matcher already
 * picks the nearest block for each result, but two results can still both
 * nominate the same block (back-to-back erg pieces near one session), and the
 * second would silently overwrite the first on apply. First one wins, the
 * rest fall through to the standalone history.
 */
export function planConcept2Import(
  results: Concept2Result[],
  db: EngineDB,
  windowMs: number = CONCEPT2_MATCH_WINDOW_MS,
): Concept2ImportPlan {
  const seen = importedConcept2Ids(db);
  const claimed = new Set<string>();
  const plan: Concept2ImportPlan = { merges: [], standalone: [], skipped: 0 };

  for (const result of results || []) {
    const externalId = result?.externalId;
    if (!externalId || seen.has(externalId)) {
      plan.skipped += 1;
      continue;
    }
    // Dedupe inside the batch too — the sync endpoint has no reason to repeat
    // an id, but a repeat that slipped through would import twice.
    seen.add(externalId);

    const converted = concept2ToCondResult(result);
    if (converted.startedAt == null || converted.modality == null) {
      plan.skipped += 1;
      continue;
    }

    const match = matchConcept2Result(result, db.sessions || [], windowMs);
    const block = match && !claimed.has(match.session.id + ' ' + match.block.id) ? match.block : null;

    if (match && block && !block.condResult) {
      claimed.add(match.session.id + ' ' + match.block.id);
      plan.merges.push({
        sessionId: match.session.id,
        blockId: block.id,
        mode: 'attach',
        patch: {
          ...converted,
          id: concept2RecordId(externalId),
          externalId,
          // The block's own prescription, so the attached result reads like
          // one logged in-app rather than format-less.
          fmt: block.condFmt,
        },
      });
      continue;
    }

    if (match && block && block.condResult && !block.condResult.externalId) {
      // The athlete already logged this effort live (timer, HR, felt-RPE) and
      // the erg logged it too. Add only what the erg alone knows — never
      // overwrite what was recorded with the session.
      claimed.add(match.session.id + ' ' + match.block.id);
      const existing = block.condResult;
      const patch: Partial<CondResult> = { externalId };
      if (existing.splits == null && converted.splits != null) patch.splits = converted.splits;
      if (existing.deviceDistanceM == null && converted.deviceDistanceM != null)
        patch.deviceDistanceM = converted.deviceDistanceM;
      if (existing.device == null && converted.device != null) patch.device = converted.device;
      plan.merges.push({ sessionId: match.session.id, blockId: block.id, mode: 'enrich', patch });
      continue;
    }

    plan.standalone.push({
      ...converted,
      id: concept2RecordId(externalId),
      externalId,
      // No in-app prescription existed for this effort, and 'free' is exactly
      // that format.
      fmt: 'free',
    });
  }

  return plan;
}

export interface Concept2ImportCounts {
  attached: number;
  enriched: number;
  standalone: number;
}

/** The one line of feedback an import gives, worded once so both apps say it identically. */
export function concept2ImportSummary(c: Concept2ImportCounts): string {
  const total = c.attached + c.enriched + c.standalone;
  if (!total) return 'Nothing new to add — everything synced is already in your history.';
  const parts: string[] = [];
  if (c.attached) parts.push(`${c.attached} matched to a session`);
  if (c.enriched) parts.push(`${c.enriched} added detail to a logged session`);
  if (c.standalone) parts.push(`${c.standalone} filed on ${c.standalone === 1 ? 'its' : 'their'} own`);
  return `Added ${total} — ${parts.join(', ')}.`;
}

/**
 * Land a plan in the database. Mutates `db` (a store draft) in place.
 *
 * Each merge is re-verified against the draft rather than trusted: the plan
 * may have been computed a render earlier, and a block that has since gained
 * a result must not be overwritten — a stale 'attach' quietly degrades to a
 * skip instead. Imported results feed History/Progress as data only; they
 * carry no HR zone time, so they never touch `conProgress`.
 */
export function applyConcept2Import(
  db: EngineDB,
  plan: Concept2ImportPlan,
  now: number = Date.now(),
): Concept2ImportCounts {
  const counts: Concept2ImportCounts = { attached: 0, enriched: 0, standalone: 0 };

  for (const m of plan.merges) {
    const session = (db.sessions || []).find((s) => s.id === m.sessionId);
    const block = session?.blocks.find((b) => b.id === m.blockId);
    if (!session || !block || block.kind !== 'conditioning') continue;
    if (m.mode === 'attach') {
      if (block.condResult) continue;
      block.condResult = m.patch as CondResult;
      counts.attached += 1;
    } else {
      if (!block.condResult || block.condResult.externalId) continue;
      Object.assign(block.condResult, m.patch);
      counts.enriched += 1;
    }
    session.updatedAt = now;
  }

  for (const rec of plan.standalone) {
    db.settings.conditioning = pushCondHistory(db.settings, rec);
    counts.standalone += 1;
  }
  if (counts.standalone) db.settings.updatedAt = now;

  return counts;
}
