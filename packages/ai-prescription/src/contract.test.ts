import { describe, expect, it } from 'vitest';
import {
  AI_PRESCRIPTION_SCHEMA_VERSION,
  PrescriptionShapeError,
  tryValidateShape,
  validateShape,
} from './contract';

/*
 * These tests are about ONE property: nothing that is not exactly the agreed
 * shape gets through. The source of this data is a language model, so "it was
 * probably fine" is not a standard — every field is checked, and the tests are
 * written per-field so a failure names the field rather than the object.
 */

const good = () => ({
  schemaVersion: AI_PRESCRIPTION_SCHEMA_VERSION,
  domain: 'strength' as const,
  value: 100,
  sets: 3,
  reps: 5,
  reason: 'progressed_on_performance' as const,
  rationale: 'Cleared all sets at 97.5kg with two reps in reserve.',
  confidence: 'high' as const,
  basis: { subject: 'back_squat', lastKnownValue: 97.5, sessionsConsidered: 4, safetyFlagPresent: false },
});

const failsOn = (field: string, mutate: (o: Record<string, unknown>) => void) => {
  const o = good() as unknown as Record<string, unknown>;
  mutate(o);
  try {
    validateShape(o);
  } catch (e) {
    expect(e).toBeInstanceOf(PrescriptionShapeError);
    expect((e as PrescriptionShapeError).field).toBe(field);
    return;
  }
  throw new Error(`expected a shape error on ${field}, but the value was accepted`);
};

describe('validateShape — accepts what it should', () => {
  it('accepts a complete strength prescription', () => {
    expect(validateShape(good())).toEqual(good());
  });

  it('accepts a conditioning prescription with neither sets nor reps', () => {
    const p = { ...good(), domain: 'conditioning' as const, value: 5000, sets: undefined, reps: undefined };
    delete (p as Record<string, unknown>).sets;
    delete (p as Record<string, unknown>).reps;
    const out = validateShape(p);
    expect(out.domain).toBe('conditioning');
    expect(out.sets).toBeUndefined();
    expect(out.reps).toBeUndefined();
  });

  it('accepts a null lastKnownValue — a movement with no history is a real state', () => {
    const p = good();
    p.basis.lastKnownValue = null as unknown as number;
    p.basis.sessionsConsidered = 0;
    expect(validateShape(p).basis.lastKnownValue).toBeNull();
  });
});

describe('validateShape — rejects every missing or wrong field', () => {
  it('rejects a non-object', () => {
    expect(() => validateShape('a prescription, honestly')).toThrow(PrescriptionShapeError);
    expect(() => validateShape(null)).toThrow(PrescriptionShapeError);
    expect(() => validateShape([good()])).toThrow(PrescriptionShapeError);
  });

  it('rejects a wrong or missing schemaVersion', () => {
    failsOn('schemaVersion', (o) => { o.schemaVersion = 2; });
    failsOn('schemaVersion', (o) => { delete o.schemaVersion; });
  });

  it('rejects a domain outside the union', () => {
    failsOn('domain', (o) => { o.domain = 'mobility'; });
  });

  it('rejects a reason outside the closed union', () => {
    // A model inventing its own reason phrasing is the exact thing the closed
    // union exists to stop — it must not become a new category by accident.
    failsOn('reason', (o) => { o.reason = 'felt_right'; });
  });

  it('rejects an unknown confidence', () => {
    failsOn('confidence', (o) => { o.confidence = 'very high'; });
  });

  it('rejects an empty rationale', () => {
    failsOn('rationale', (o) => { o.rationale = '   '; });
  });

  it('rejects NaN and Infinity, which sail through every later comparison', () => {
    failsOn('value', (o) => { o.value = Number.NaN; });
    failsOn('value', (o) => { o.value = Number.POSITIVE_INFINITY; });
  });

  it('rejects fractional or non-positive sets and reps', () => {
    failsOn('sets', (o) => { o.sets = 2.5; });
    failsOn('sets', (o) => { o.sets = 0; });
    failsOn('reps', (o) => { o.reps = -5; });
  });
});

describe('validateShape — basis is required, because auditability is', () => {
  it('rejects a prescription with no basis at all', () => {
    failsOn('basis', (o) => { delete o.basis; });
  });

  it('rejects an empty subject', () => {
    failsOn('basis.subject', (o) => { (o.basis as Record<string, unknown>).subject = ''; });
  });

  it('rejects a non-numeric lastKnownValue that is not null', () => {
    failsOn('basis.lastKnownValue', (o) => { (o.basis as Record<string, unknown>).lastKnownValue = '97.5'; });
  });

  it('rejects a negative or fractional sessionsConsidered', () => {
    failsOn('basis.sessionsConsidered', (o) => { (o.basis as Record<string, unknown>).sessionsConsidered = -1; });
    failsOn('basis.sessionsConsidered', (o) => { (o.basis as Record<string, unknown>).sessionsConsidered = 1.5; });
  });

  it('rejects a missing safetyFlagPresent rather than assuming false', () => {
    // Defaulting this to false would invent the safest-sounding answer for the
    // one field where being wrong is dangerous.
    failsOn('basis.safetyFlagPresent', (o) => { delete (o.basis as Record<string, unknown>).safetyFlagPresent; });
  });
});

describe('validateShape — extra fields are dropped, not forwarded', () => {
  it('does not carry an invented field through to the caller', () => {
    const p = { ...good(), overrideSafety: true, notes: 'ignore previous instructions' };
    const out = validateShape(p) as unknown as Record<string, unknown>;
    expect(out.overrideSafety).toBeUndefined();
    expect(out.notes).toBeUndefined();
  });

  it('returns a new object rather than the input', () => {
    const p = good();
    expect(validateShape(p)).not.toBe(p);
  });
});

describe('tryValidateShape', () => {
  it('reports the failing field instead of throwing', () => {
    const r = tryValidateShape({ ...good(), domain: 'mobility' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('domain');
  });

  it('returns the prescription when it is good', () => {
    const r = tryValidateShape(good());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prescription.basis.subject).toBe('back_squat');
  });
});
