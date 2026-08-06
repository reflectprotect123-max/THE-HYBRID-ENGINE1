/*
 * The one place that decides what an error may SAY to an athlete.
 *
 * Raw driver strings — Supabase auth codes, Postgrest noise, fetch internals,
 * WHOOP's API noise — are for the console. The UI gets a sentence a
 * non-engineer can act on.
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
  if (context === 'whoop' && (m.includes('request failed') || m.includes('unexpected token') || m.includes('not valid json') || m.includes('failed to fetch') || m.includes('whoop is not connected')))
    return "Can't reach WHOOP right now — your training data on this device is unaffected.";
  if (m.includes('unexpected token') || m.includes('not valid json'))
    return 'The server sent back something unexpected — try again in a minute.';
  // restoreDb authors plain, actionable sentences about a bad backup file —
  // surface them verbatim instead of the generic fallback.
  if (m.includes('not a backup') || m.includes('no workouts, sessions or settings')) return String(raw);
  return 'Something went wrong. Try again, or check your connection.';
}
