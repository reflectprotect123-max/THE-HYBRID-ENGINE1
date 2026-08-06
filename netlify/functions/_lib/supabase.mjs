import { createHmac, createPublicKey, timingSafeEqual, verify as verifyAsymmetric } from 'node:crypto';
import { config } from './config.mjs';

/*
 * Verifying a Supabase access token, server-side.
 *
 * WHY this file exists: a signed `hybrid_sid` cookie can only ever identify a
 * browser. The native app hands WHOOP's consent screen to the SYSTEM browser,
 * which has its own cookie jar, so the cookie the callback sets is written
 * somewhere the app can never read. The one credential both the browser and
 * the phone already hold is the Supabase access token from cloud sync, and it
 * is a JWT — verifiable here with no round trip and no shared cookie.
 *
 * WHY every claim below is checked and not just the signature: the project's
 * anon key is ITSELF a JWT signed with the same legacy secret, and it ships
 * publicly in every client bundle (see packages/config). A signature-only
 * check would let anyone paste that public key in and be treated as a signed-in
 * user. `iss`, `aud`, `role` and a UUID-shaped `sub` are what separate a real
 * end-user token from the public key — the anon key fails all four.
 *
 * Two signing schemes are supported because Supabase is mid-migration:
 * legacy projects sign HS256 with the shared JWT secret, newer ones sign
 * ES256/RS256 with rotating keys published as JWKS. Which one is in use is a
 * property of the project, not of this code, so both are handled and the
 * algorithm is taken from a fixed allowlist rather than trusted from the token.
 */

const ALGORITHMS = new Set(['HS256', 'ES256', 'RS256']);
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_BYTES = 8192;
const JWKS_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

// Permissive on version/variant nibbles on purpose: what matters is that a
// `sub` is a UUID at all, because that is what rules out the anon key (which
// carries no `sub`) and any hand-written claim set.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SupabaseAuthError extends Error {
  constructor(message, { code = 'unauthorized', status = 401, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SupabaseAuthError';
    this.code = code;
    this.status = status;
  }
}

function unauthorized(code) {
  // Deliberately one shape for every rejection reason. A caller learns that the
  // token was not accepted, never which check it failed — that difference is an
  // oracle for anyone probing the endpoint with crafted tokens.
  return new SupabaseAuthError('Supabase access token rejected', { code, status: 401 });
}

function issuer() {
  if (!config.supabaseUrl) {
    throw new SupabaseAuthError(
      'SUPABASE_URL is not configured; the app cannot verify a Supabase access token',
      { code: 'supabase_auth_unconfigured', status: 500 },
    );
  }
  return `${config.supabaseUrl}/auth/v1`;
}

function timeoutSignal() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

function decodeSegment(segment) {
  // Reading the header before the signature is verified is unavoidable — the
  // header is what names the key and algorithm. Nothing from it is trusted
  // beyond selecting a member of the allowlist above.
  const json = Buffer.from(String(segment), 'base64url').toString('utf8');
  const value = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('segment is not a JSON object');
  return value;
}

let jwksCache = { url: '', fetchedAt: 0, keys: new Map() };

async function jwksKeys(force = false) {
  const url = `${issuer()}/.well-known/jwks.json`;
  const cached = jwksCache.url === url ? jwksCache : null;
  if (cached && !force && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  let payload;
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: timeoutSignal() });
    if (!response.ok) throw new Error(`status ${response.status}`);
    payload = await response.json();
  } catch (cause) {
    // A key-set fetch that fails must not sign every athlete out of WHOOP for
    // the length of the outage, so a previously fetched set is still used.
    if (cached?.keys.size) return cached.keys;
    throw new SupabaseAuthError('Supabase signing keys unavailable', { code: 'supabase_jwks_unavailable', status: 503, cause });
  }

  const keys = new Map();
  for (const jwk of Array.isArray(payload?.keys) ? payload.keys : []) {
    if (!jwk || typeof jwk.kid !== 'string' || !jwk.kid) continue;
    if (typeof jwk.alg === 'string' && !ALGORITHMS.has(jwk.alg)) continue;
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    } catch {
      // One unimportable key in the set is not a reason to reject the rest.
    }
  }
  jwksCache = { url, fetchedAt: Date.now(), keys };
  return keys;
}

function verifyHs256(signingInput, signature) {
  if (!config.supabaseJwtSecret) {
    throw new SupabaseAuthError(
      'SUPABASE_JWT_SECRET is not configured; the app cannot verify an HS256 Supabase access token',
      { code: 'supabase_auth_unconfigured', status: 500 },
    );
  }
  const expected = createHmac('sha256', config.supabaseJwtSecret).update(signingInput, 'utf8').digest();
  return expected.length === signature.length && timingSafeEqual(expected, signature);
}

async function verifyAsymmetricSignature(algorithm, kid, signingInput, signature) {
  const data = Buffer.from(signingInput, 'utf8');
  for (const force of [false, true]) {
    const keys = await jwksKeys(force);
    const key = kid ? keys.get(kid) : [...keys.values()][0];
    if (!key) {
      // An unknown kid is the normal shape of a key rotation, so the set is
      // re-fetched once before the token is called forged.
      if (!force) continue;
      return false;
    }
    // ES256 signatures in a JWS are the raw r||s pair, not the DER sequence
    // Node defaults to. Getting this wrong rejects every valid token.
    const options = algorithm === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key;
    if (verifyAsymmetric('sha256', data, options, signature)) return true;
    if (force) return false;
  }
  return false;
}

/** True when the request carries an Authorization header of any shape at all. */
export function hasAuthorizationHeader(event) {
  const headers = event?.headers || {};
  return Object.entries(headers).some(([key, value]) => key.toLowerCase() === 'authorization' && String(Array.isArray(value) ? value[0] : value || '').trim() !== '');
}

/** The raw bearer credential, or null. Never logged, never stored. */
export function bearerToken(event) {
  const headers = event?.headers || {};
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
  const raw = entry ? String(Array.isArray(entry[1]) ? entry[1][0] : entry[1] || '').trim() : '';
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(raw);
  return match ? match[1] : null;
}

/**
 * Verify a Supabase end-user access token and return the identity it proves.
 *
 * Throws SupabaseAuthError (401 for a rejected token, 500 when this server is
 * not configured to verify one, 503 when Supabase's key set is unreachable).
 */
export async function verifySupabaseAccessToken(token) {
  if (typeof token !== 'string' || token.length === 0 || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) throw unauthorized('invalid_token');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw unauthorized('invalid_token');

  let header;
  let claims;
  let signature;
  try {
    header = decodeSegment(parts[0]);
    claims = decodeSegment(parts[1]);
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    throw unauthorized('invalid_token');
  }
  if (!signature.length) throw unauthorized('invalid_token');

  // `alg: none`, and any algorithm confusion that would let a JWKS public key
  // be replayed as an HMAC secret, both die here: the algorithm must be named
  // in the allowlist, and the branch below picks the key material from the
  // algorithm rather than the other way round.
  const algorithm = typeof header.alg === 'string' ? header.alg : '';
  if (!ALGORITHMS.has(algorithm)) throw unauthorized('unsupported_algorithm');

  const expectedIssuer = issuer();
  const signingInput = `${parts[0]}.${parts[1]}`;
  const verified = algorithm === 'HS256'
    ? verifyHs256(signingInput, signature)
    : await verifyAsymmetricSignature(algorithm, typeof header.kid === 'string' ? header.kid : '', signingInput, signature);
  if (!verified) throw unauthorized('invalid_signature');

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(claims.exp);
  const iat = Number(claims.iat);
  const nbf = claims.nbf === undefined ? null : Number(claims.nbf);
  if (!Number.isFinite(exp) || now >= exp + CLOCK_SKEW_SECONDS) throw unauthorized('token_expired');
  if (Number.isFinite(iat) && iat > now + CLOCK_SKEW_SECONDS) throw unauthorized('token_not_yet_valid');
  if (nbf !== null && (!Number.isFinite(nbf) || nbf > now + CLOCK_SKEW_SECONDS)) throw unauthorized('token_not_yet_valid');

  if (claims.iss !== expectedIssuer) throw unauthorized('invalid_issuer');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes('authenticated')) throw unauthorized('invalid_audience');
  // `role` is the claim that keeps a service-role key — which would otherwise
  // satisfy issuer and signature — from being usable as a person.
  if (claims.role !== 'authenticated') throw unauthorized('invalid_role');
  const userId = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!UUID.test(userId)) throw unauthorized('invalid_subject');

  return { userId, sessionId: typeof claims.session_id === 'string' ? claims.session_id : null };
}
