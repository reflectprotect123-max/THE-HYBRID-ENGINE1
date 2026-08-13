/**
 * The shape a model must return before anything here will look at it.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * What makes an AI prescribing layer safe is not the prompt. It is that the
 * model's output is a STRUCT, checked before use, and an output that fails the
 * check is REJECTED — falling through to the deterministic engine — rather than
 * repaired, coerced, or obeyed. Prose that something parses is the failure mode
 * this package exists to make impossible.
 *
 * This file is the frozen half of that. `validateShape` answers "is this the
 * right shape"; `validate.ts` answers the much harder "is this safe to give a
 * human body". Keep them apart: a shape error is a bug in the integration, a
 * bounds error is the model being wrong about training, and conflating them
 * makes both harder to diagnose.
 *
 * THREE OTHER STREAMS BUILD AGAINST THIS TYPE
 *
 * The model layer binds its structured output to it, the service layer carries
 * it over the wire, and the evidence base supplies the numbers its bounds are
 * checked against. All three IMPORT it. None of them keeps its own copy of the
 * shape — a second copy of a contract drifts, silently, and the drift surfaces
 * as a production rejection nobody can explain.
 *
 * NOTHING HERE CALLS A MODEL. This package is provider-agnostic by
 * construction: it defines the shape, checks the shape, and measures the shape.
 * If an SDK import ever appears in this directory, something has gone wrong.
 */

export const AI_PRESCRIPTION_SCHEMA_VERSION = 1 as const;

/** Matches the engine's own split. A prescription is for one or the other. */
export type PrescriptionDomain = 'strength' | 'conditioning';

/**
 * Why the model decided what it decided, as a CLOSED union.
 *
 * Closed on purpose. A free-text reason cannot be counted, cannot be filtered,
 * and cannot be shown to a coach as a consistent label — and a model asked for
 * free text will happily invent a new phrasing every call. The rationale field
 * below carries the sentence; this carries the category.
 */
export type PrescriptionReason =
  | 'progressed_on_performance'
  | 'held_on_performance'
  | 'regressed_on_performance'
  | 'deload_scheduled'
  | 'held_on_fatigue'
  | 'held_on_readiness'
  | 'introduced_movement'
  | 'maintained_no_signal';

/**
 * How sure the model is. Coarse on purpose — a float invites a threshold
 * argument nobody can settle, and three buckets is all the resolver needs.
 * `low` is a fallback trigger, not a warning label (see resolve.ts).
 */
export type PrescriptionConfidence = 'low' | 'medium' | 'high';

/**
 * The FACTS the decision was made from.
 *
 * Required, never optional, and this is the single most important field in the
 * type. A prescription that cannot say what it was based on is not auditable:
 * a coach cannot check it, a bug cannot be traced to bad input rather than bad
 * reasoning, and "the model felt like it" becomes an acceptable answer. It is
 * also what lets a rejection be specific — `validate.ts` compares the claimed
 * basis against the athlete context it was actually given, so a model that
 * hallucinates a history it was never shown is caught rather than trusted.
 */
export interface PrescriptionBasis {
  /** Exercise or modality key this decision is about. Must exist in the app's
   *  own catalogue — checked in `validate.ts`, not here. */
  subject: string;
  /** The last working value the model claims to have seen (kg, or metres, or
   *  seconds — whatever the subject's unit is). Null when there is no history,
   *  which is a real and common state, not a missing value. */
  lastKnownValue: number | null;
  /** How many sessions of history informed this. Zero is legitimate for a new
   *  movement and must not be dressed up as more. */
  sessionsConsidered: number;
  /** Whether a pain or illness flag was live in the context the model was
   *  given. The model reporting this WRONG is itself a rejection — it means the
   *  safety context did not reach it. */
  safetyFlagPresent: boolean;
}

/**
 * What the model wants the athlete to do.
 *
 * Deliberately narrow. This is a prescription for ONE subject in one session —
 * not a week, not a session plan, not a program. Placement stays with the coach
 * or the Coordinator, and a type that could express a week would invite a model
 * to try to write one.
 */
export interface AiPrescription {
  schemaVersion: typeof AI_PRESCRIPTION_SCHEMA_VERSION;
  domain: PrescriptionDomain;
  /** The prescribed working value, in the subject's own unit. */
  value: number;
  /** Sets and reps for strength; for conditioning, the piece count and its
   *  target. Both optional because a conditioning prescription may be a single
   *  continuous effort with neither. */
  sets?: number;
  reps?: number;
  reason: PrescriptionReason;
  /** One sentence, for a human. Never parsed, never branched on. */
  rationale: string;
  confidence: PrescriptionConfidence;
  basis: PrescriptionBasis;
}

/** Thrown by `validateShape`. Carries the offending field so a caller can log
 *  which part of the contract the model broke without re-deriving it. */
export class PrescriptionShapeError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'PrescriptionShapeError';
  }
}

const REASONS: ReadonlySet<string> = new Set<PrescriptionReason>([
  'progressed_on_performance',
  'held_on_performance',
  'regressed_on_performance',
  'deload_scheduled',
  'held_on_fatigue',
  'held_on_readiness',
  'introduced_movement',
  'maintained_no_signal',
]);

const CONFIDENCES: ReadonlySet<string> = new Set<PrescriptionConfidence>(['low', 'medium', 'high']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A real, usable number. Rejects NaN and Infinity, which JSON.parse will
 *  happily hand back through a string coercion and which would then sail
 *  through every `>` and `<` comparison in the bounds check. */
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function requireBasis(value: unknown): PrescriptionBasis {
  if (!isRecord(value)) throw new PrescriptionShapeError('basis', 'basis is required — a prescription must say what it was based on');
  if (typeof value.subject !== 'string' || !value.subject.trim()) {
    throw new PrescriptionShapeError('basis.subject', 'basis.subject must be a non-empty string');
  }
  if (value.lastKnownValue !== null && !isFiniteNumber(value.lastKnownValue)) {
    throw new PrescriptionShapeError('basis.lastKnownValue', 'basis.lastKnownValue must be a finite number or null');
  }
  if (!isFiniteNumber(value.sessionsConsidered) || !Number.isInteger(value.sessionsConsidered) || value.sessionsConsidered < 0) {
    throw new PrescriptionShapeError('basis.sessionsConsidered', 'basis.sessionsConsidered must be a non-negative integer');
  }
  if (typeof value.safetyFlagPresent !== 'boolean') {
    throw new PrescriptionShapeError('basis.safetyFlagPresent', 'basis.safetyFlagPresent must be a boolean');
  }
  return {
    subject: value.subject,
    lastKnownValue: value.lastKnownValue as number | null,
    sessionsConsidered: value.sessionsConsidered,
    safetyFlagPresent: value.safetyFlagPresent,
  };
}

/**
 * Shape check only. Throws `PrescriptionShapeError` on the first failure.
 *
 * Returns a NEWLY BUILT object rather than the input, carrying only known
 * fields. Extra properties a model invents are dropped rather than passed
 * along: returning the caller's object would let an unknown field reach
 * whatever consumes this, and "we ignored it" and "we forwarded it" are very
 * different guarantees when the source is an LLM.
 */
export function validateShape(value: unknown): AiPrescription {
  if (!isRecord(value)) throw new PrescriptionShapeError('.', 'a prescription must be an object');

  if (value.schemaVersion !== AI_PRESCRIPTION_SCHEMA_VERSION) {
    throw new PrescriptionShapeError('schemaVersion', `schemaVersion must be ${AI_PRESCRIPTION_SCHEMA_VERSION}`);
  }
  if (value.domain !== 'strength' && value.domain !== 'conditioning') {
    throw new PrescriptionShapeError('domain', "domain must be 'strength' or 'conditioning'");
  }
  if (!isFiniteNumber(value.value)) {
    throw new PrescriptionShapeError('value', 'value must be a finite number');
  }
  if (value.sets !== undefined && (!isFiniteNumber(value.sets) || !Number.isInteger(value.sets) || value.sets <= 0)) {
    throw new PrescriptionShapeError('sets', 'sets, when present, must be a positive integer');
  }
  if (value.reps !== undefined && (!isFiniteNumber(value.reps) || !Number.isInteger(value.reps) || value.reps <= 0)) {
    throw new PrescriptionShapeError('reps', 'reps, when present, must be a positive integer');
  }
  if (typeof value.reason !== 'string' || !REASONS.has(value.reason)) {
    throw new PrescriptionShapeError('reason', 'reason must be one of the known reason codes');
  }
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) {
    throw new PrescriptionShapeError('rationale', 'rationale must be a non-empty string');
  }
  if (typeof value.confidence !== 'string' || !CONFIDENCES.has(value.confidence)) {
    throw new PrescriptionShapeError('confidence', "confidence must be 'low', 'medium' or 'high'");
  }

  const basis = requireBasis(value.basis);

  return {
    schemaVersion: AI_PRESCRIPTION_SCHEMA_VERSION,
    domain: value.domain,
    value: value.value,
    ...(value.sets !== undefined ? { sets: value.sets as number } : {}),
    ...(value.reps !== undefined ? { reps: value.reps as number } : {}),
    reason: value.reason as PrescriptionReason,
    rationale: value.rationale,
    confidence: value.confidence as PrescriptionConfidence,
    basis,
  };
}

/** Non-throwing wrapper, for the resolver's hot path where a rejection is an
 *  expected outcome rather than an exception. */
export function tryValidateShape(value: unknown): { ok: true; prescription: AiPrescription } | { ok: false; field: string; message: string } {
  try {
    return { ok: true, prescription: validateShape(value) };
  } catch (e) {
    if (e instanceof PrescriptionShapeError) return { ok: false, field: e.field, message: e.message };
    return { ok: false, field: '.', message: e instanceof Error ? e.message : 'unknown shape failure' };
  }
}
