/*
 * The one place that decides what an error may SAY to a coach.
 *
 * Raw driver strings — Supabase auth codes, Postgrest noise, fetch internals,
 * the engine's emit contract — are for the console. The UI gets a sentence a
 * non-engineer can act on. Wording is kept in step with the athlete apps'
 * errors.ts by convention (see the wave-2 spec table), never by import.
 */
export function humanizeError(e: unknown, context?: string): string {
  const raw =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object' && 'message' in e
        ? String((e as { message?: unknown }).message ?? '')
        : '';
  // The raw string still exists exactly once — where a developer looks.
  console.warn('[' + (context || 'error') + ']', e);
  const m = raw.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') || m.includes('network request failed'))
    return "Can't reach the server — check your connection and try again.";
  if (m.includes('invalid login credentials')) return "That email and password don't match. Check them and try again.";
  if (m.includes('email not confirmed')) return 'Confirm your email first — the link is in your inbox.';
  if (m.includes('already registered')) return 'That email already has an account — sign in instead.';
  if (m.includes('emit:')) return "This session isn't sendable yet — reopen it in the builder and check each block.";
  if (m.includes('unexpected token') || m.includes('not valid json'))
    return 'The server sent back something unexpected — try again in a minute.';
  return 'Something went wrong. Try again, or check your connection.';
}
