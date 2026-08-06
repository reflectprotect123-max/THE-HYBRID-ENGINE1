/**
 * Coach-bench access rule, kept pure so the policy is testable without
 * rendering anything.
 *
 * The allowlist is VITE_COACH_USER_IDS: comma-separated Supabase user ids set
 * in the deploy environment. The rules, in order:
 *
 *  - allowlist set  → the signed-in user id must be on it, in dev and prod
 *    alike (so the gate itself can be exercised locally).
 *  - allowlist empty → dev builds allow anyone (a fresh clone must be able to
 *    open the bench without a Supabase account); production denies everyone,
 *    because an unset env var must fail closed, not open.
 */
export function coachAllowed(
  userId: string | null | undefined,
  allowlist: string | undefined,
  isDev: boolean,
): boolean {
  const ids = (allowlist ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return isDev;
  return userId != null && ids.includes(userId);
}
