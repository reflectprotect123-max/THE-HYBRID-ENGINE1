import { describe, expect, it } from 'vitest';
import { failureMessage } from './failure';

/*
 * THE REGRESSION, in one line.
 *
 * Every failure path on the coach bench read `cause instanceof Error ?
 * cause.message : 'something could not be done'`. A supabase-js failure is a
 * PLAIN OBJECT — `{ message, code, details, hint }` — so that test is false
 * every time and the fallback always won. The screen said the same sentence
 * for a permission denial, a constraint violation and a dropped connection.
 *
 * The first case below is the one that cost a live debugging session: a real
 * Postgres error arrived carrying everything needed to identify it, and the
 * screen threw all of it away.
 */

describe('failureMessage', () => {
  it('reads a supabase-js error, which is NOT an Error instance', () => {
    const cause = { message: 'not permitted', code: '42501', details: null, hint: null };
    expect(cause instanceof Error).toBe(false); // the whole bug, asserted
    expect(failureMessage(cause, 'The invite could not be created.')).toBe('not permitted (42501)');
  });

  it('still reads a real Error', () => {
    expect(failureMessage(new Error('network down'), 'fallback')).toBe('network down');
  });

  it('appends the Postgres code, because 23505 and 42501 read alike in a hurry', () => {
    expect(failureMessage({ message: 'duplicate key', code: '23505' }, 'x')).toBe('duplicate key (23505)');
  });

  it('does not repeat a code the message already carries', () => {
    expect(failureMessage({ message: 'failed with 42501', code: '42501' }, 'x')).toBe('failed with 42501');
  });

  it('falls back to details, then hint, when message is empty', () => {
    expect(failureMessage({ message: '', details: 'row violates policy' }, 'x')).toBe('row violates policy');
    expect(failureMessage({ message: '  ', details: '', hint: 'grant execute first' }, 'x')).toBe(
      'grant execute first',
    );
  });

  it('uses the fallback ONLY when there is nothing readable — its actual job', () => {
    expect(failureMessage(null, 'fallback')).toBe('fallback');
    expect(failureMessage(undefined, 'fallback')).toBe('fallback');
    expect(failureMessage({}, 'fallback')).toBe('fallback');
    expect(failureMessage({ message: '   ' }, 'fallback')).toBe('fallback');
  });

  it('accepts a bare string, which is what a rejected promise sometimes carries', () => {
    expect(failureMessage('plain rejection', 'fallback')).toBe('plain rejection');
    expect(failureMessage('   ', 'fallback')).toBe('fallback');
  });
});
