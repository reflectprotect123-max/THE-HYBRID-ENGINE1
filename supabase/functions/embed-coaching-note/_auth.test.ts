// supabase/functions/embed-coaching-note/_auth.test.ts
//
// Unit tests for the webhook auth and payload-validation logic. Imports
// from ./_auth, never ./index — index.ts cannot be loaded under Node/Vitest
// at all (top-level `jsr:` import, `Deno.serve` at module load), which is
// exactly why the pure logic lives in a sibling file. Same pattern and
// reasoning as index.test.ts / _requestShape.ts.
import { describe, it, expect } from 'vitest';
import { parseWebhookRecord, timingSafeEqualStrings, webhookAuthFailure } from './_auth';

describe('timingSafeEqualStrings', () => {
  it('accepts equal strings', () => {
    expect(timingSafeEqualStrings('s3cret', 's3cret')).toBe(true);
    expect(timingSafeEqualStrings('', '')).toBe(true);
  });
  it('rejects differing strings, wherever they differ', () => {
    expect(timingSafeEqualStrings('s3cret', 'z3cret')).toBe(false); // first char
    expect(timingSafeEqualStrings('s3cret', 's3creT')).toBe(false); // last char
  });
  it('rejects length mismatches, including prefixes and the empty string', () => {
    expect(timingSafeEqualStrings('s3cret', 's3cre')).toBe(false);
    expect(timingSafeEqualStrings('s3cret', 's3cret-and-more')).toBe(false);
    expect(timingSafeEqualStrings('', 's3cret')).toBe(false);
  });
});

describe('webhookAuthFailure', () => {
  it('lets a caller with the exact secret through', () => {
    expect(webhookAuthFailure('s3cret', 's3cret')).toBeNull();
  });
  it('answers 401 for a missing header — the path index.ts had wide open', () => {
    expect(webhookAuthFailure(null, 's3cret')).toEqual({ status: 401, body: 'unauthorized' });
  });
  it('answers 401 for a wrong secret, with the SAME body as a missing one', () => {
    const wrong = webhookAuthFailure('guess', 's3cret');
    const missing = webhookAuthFailure(null, 's3cret');
    expect(wrong).toEqual({ status: 401, body: 'unauthorized' });
    expect(wrong).toEqual(missing);
  });
  it('fails CLOSED when the secret is unset or blank in the environment', () => {
    expect(webhookAuthFailure('anything', undefined)).toEqual({
      status: 500,
      body: 'EMBED_WEBHOOK_SECRET not configured',
    });
    expect(webhookAuthFailure('', '')).toEqual({
      status: 500,
      body: 'EMBED_WEBHOOK_SECRET not configured',
    });
  });
});

describe('parseWebhookRecord', () => {
  it('accepts the database webhook shape and returns only id and body', () => {
    expect(parseWebhookRecord({ record: { id: 'n-1', body: 'deload', extra: 1 } }))
      .toEqual({ id: 'n-1', body: 'deload' });
  });
  it('rejects everything else', () => {
    for (const bad of [
      null, 'x', 42, [], {},
      { record: null }, { record: 'x' },
      { record: {} },
      { record: { id: 'n-1' } },
      { record: { body: 'deload' } },
      { record: { id: 7, body: 'deload' } },
      { record: { id: 'n-1', body: 7 } },
      { record: { id: '', body: 'deload' } },
      { record: { id: 'n-1', body: '' } },
    ]) {
      expect(parseWebhookRecord(bad)).toBeNull();
    }
  });
});
