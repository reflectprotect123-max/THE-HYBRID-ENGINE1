/*
 * humanizeError: the one place that decides what an error may SAY on the
 * phone. Same vectors as the coach's and web's errors.ts (Tasks 6-7) — every
 * overlapping sentence must stay byte-identical across all three — plus the
 * mobile-only whoop/invite contexts ported from the web module.
 */
import { humanizeError } from './errors';

describe('humanizeError', () => {
  it('maps network failures', () => {
    expect(humanizeError(new TypeError('Failed to fetch'))).toBe(
      "Can't reach the server — check your connection and try again.",
    );
    expect(humanizeError(new Error('Network request failed'))).toBe(
      "Can't reach the server — check your connection and try again.",
    );
  });

  it('maps Supabase auth strings', () => {
    expect(humanizeError({ message: 'Invalid login credentials' })).toBe(
      "That email and password don't match. Check them and try again.",
    );
    expect(humanizeError(new Error('Email not confirmed'))).toBe(
      'Confirm your email first — the link is in your inbox.',
    );
    expect(humanizeError(new Error('User already registered'))).toBe(
      'That email already has an account — sign in instead.',
    );
  });

  it('maps JSON noise and falls back on anything else', () => {
    expect(humanizeError(new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`))).toBe(
      'The server sent back something unexpected — try again in a minute.',
    );
    expect(humanizeError({})).toBe('Something went wrong. Try again, or check your connection.');
    expect(humanizeError(undefined)).toBe('Something went wrong. Try again, or check your connection.');
  });

  it('gives WHOOP failures a calmer, context-specific sentence', () => {
    expect(humanizeError(new Error('Request failed (503)'), 'whoop')).toBe(
      "Can't reach WHOOP right now — your training data on this device is unaffected.",
    );
    expect(humanizeError(new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`), 'whoop')).toBe(
      "Can't reach WHOOP right now — your training data on this device is unaffected.",
    );
    expect(humanizeError(new Error('WHOOP is not connected.'), 'whoop')).toBe(
      "Can't reach WHOOP right now — your training data on this device is unaffected.",
    );
  });

  it('gives an unrecognized invite failure its own sentence, not the generic fallback', () => {
    expect(humanizeError(new Error('some obscure postgrest code'), 'invite')).toBe(
      "That code didn't work — check it with your coach and try again.",
    );
  });

  it('logs the raw error to the console, never the UI', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    humanizeError(new Error('some obscure driver string'), 'sync');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
