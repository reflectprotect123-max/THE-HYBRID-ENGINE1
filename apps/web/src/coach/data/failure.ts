/**
 * What actually went wrong, in words a person can act on.
 *
 * THE BUG THIS FIXES, found live on 15 August 2026. Every failure path on the
 * coach bench was written as:
 *
 *     cause instanceof Error ? cause.message : 'The invite could not be created.'
 *
 * and a Supabase failure is NOT an Error. `supabase-js` resolves with
 * `{ data, error }` where `error` is a PLAIN OBJECT — `{ message, code,
 * details, hint }` — so `instanceof Error` is false every single time and the
 * branch that runs is always the fallback. The screen therefore said "The
 * invite could not be created." for a permission denial, a constraint
 * violation, a network drop and an expired session ALIKE.
 *
 * That is worse than showing nothing. It looks like a considered message, so
 * nobody opens the network tab, and the one piece of information that would
 * have identified the failure in seconds is discarded at the only point where
 * it was still available. It cost a live debugging session: the owner clicked
 * a button, got a sentence, and neither of us could tell whether the cause was
 * RLS, a missing membership, or a bad argument.
 *
 * So this reads a failure from any of the shapes that actually reach a catch
 * block here, in the order they are worth trusting.
 */

/** The shape `supabase-js` puts in `error`. Not an Error, deliberately. */
interface PostgrestLikeError {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');

/**
 * A sentence for the screen.
 *
 * `fallback` is used ONLY when the cause carries no readable message at all —
 * which is the case it was always meant for, rather than the default it had
 * become.
 *
 * The Postgres `code` is appended when it exists and the message does not
 * already contain it. That is not noise: `23505` (unique violation) and
 * `42501` (insufficient privilege) are the difference between "you already did
 * this" and "you are not allowed to", and the human-readable halves of those
 * two can look very similar in a hurry.
 */
export function failureMessage(cause: unknown, fallback: string): string {
  if (typeof cause === 'string') return text(cause) || fallback;

  if (cause instanceof Error) {
    /* An Error MAY also be a wrapped Postgrest failure — supabase-js throws
       these from `.throwOnError()` — so its extra fields are still worth
       reading. */
    const message = text(cause.message) || fallback;
    return withCode(message, (cause as unknown as PostgrestLikeError).code);
  }

  if (cause && typeof cause === 'object') {
    const e = cause as PostgrestLikeError;
    /* `message` first, then `details`, then `hint`. A permission denial often
       carries an empty message and a populated hint, and a hint is far better
       than the fallback. */
    const message = text(e.message) || text(e.details) || text(e.hint);
    if (message) return withCode(message, e.code);
  }

  return fallback;
}

function withCode(message: string, code: unknown): string {
  const c = text(code);
  if (!c || message.includes(c)) return message;
  return `${message} (${c})`;
}
