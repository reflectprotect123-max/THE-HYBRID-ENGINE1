import { bearerToken, hasAuthorizationHeader, verifySupabaseAccessToken, SupabaseAuthError } from './supabase.mjs';
import { sessionFromEvent } from './session.mjs';

/*
 * WHO a request belongs to.
 *
 * Everything the WHOOP integration stores is filed under one opaque "owner"
 * string. There are two ways to prove ownership and they are deliberately not
 * interchangeable:
 *
 *  - A browser proves it with the signed `hybrid_sid` cookie. The owner IS the
 *    sid, unchanged from before this file existed, which is the whole reason
 *    every already-connected web athlete stays connected: their blob keys are
 *    byte-identical.
 *  - The native app proves it with a Supabase access token. The owner is the
 *    Supabase user id under a `u:` prefix. A sid is a randomUUID and can never
 *    contain a colon, so the two namespaces cannot collide.
 *
 * The precedence rule is the security-critical part: a request that presents a
 * bearer token gets THAT identity or an error. It is never silently downgraded
 * to the cookie session, because a downgrade would hand a request carrying a
 * forged token whatever connection the cookie riding alongside it happened to
 * own. Nor is the reverse allowed — a signed-in user is never given the cookie
 * session's WHOOP connection, which on a shared browser would be somebody
 * else's.
 */

const USER_PREFIX = 'u:';

/**
 * Resolve the owner for this request.
 *
 * Throws SupabaseAuthError when a bearer token is present but unusable — a
 * forged, expired or unverifiable token is a 401, not an anonymous session.
 */
export async function ownerFromEvent(event) {
  const token = bearerToken(event);
  if (!token) {
    // An Authorization header we cannot parse is a failed attempt to
    // authenticate, not an anonymous request. Treating it as anonymous would
    // reintroduce the downgrade this file exists to prevent, one typo away.
    if (hasAuthorizationHeader(event)) throw new SupabaseAuthError('Malformed Authorization header', { code: 'invalid_token', status: 401 });
    const sid = sessionFromEvent(event);
    return { kind: 'browser', owner: sid, sid, userId: null };
  }
  const { userId } = await verifySupabaseAccessToken(token);
  return { kind: 'user', owner: `${USER_PREFIX}${userId}`, sid: null, userId };
}

/** True when this request tried to authenticate as a Supabase user. */
export function hasBearerToken(event) {
  return bearerToken(event) !== null;
}

/**
 * The response for a failed identity resolution.
 *
 * Every 401 collapses to one code. supabase.mjs distinguishes internally —
 * invalid_signature, invalid_issuer, invalid_role and the rest — because those
 * distinctions are worth having in a log, but returning them to the caller
 * hands anyone probing with crafted tokens a per-check oracle: "signature
 * accepted, issuer wrong" tells them their forgery worked and only the claims
 * need adjusting. The detail stays server-side, which is what supabase.mjs
 * already says it does.
 *
 * 500 and 503 DO stay distinct. They mean this server is misconfigured or
 * Supabase is unreachable — our problem, not the caller's, and the difference
 * is what makes an unset env var findable instead of looking like a bad token.
 */
export function authErrorResponse(error) {
  if (error instanceof SupabaseAuthError) {
    if (error.status === 401) return { status: 401, body: { error: 'unauthorized' } };
    return { status: error.status, body: { error: error.code } };
  }
  return { status: 401, body: { error: 'unauthorized' } };
}

export { SupabaseAuthError };
