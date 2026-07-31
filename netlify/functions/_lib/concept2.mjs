import { config, requireConfig } from './config.mjs';
import { tokenNeedsRefresh } from './whoop.mjs';

/*
 * Concept2 Logbook provider module — the Concept2-shaped twin of
 * _lib/whoop.mjs. Same defensive conventions (error class, config guard,
 * non-empty-string validation, request timeout, API-root guard, token
 * normalization), different provider contract:
 *
 *   - OAuth scopes are COMMA-delimited ("user:read,results:read"), not
 *     space-delimited like WHOOP's. This is Concept2's documented format —
 *     do not "fix" it to match WHOOP.
 *   - Every API GET must send the versioned Accept header
 *     `application/vnd.c2logbook.v1+json`, not plain application/json.
 *   - A 404 from the strokes endpoint is DATA, not an error: it means the
 *     result is summary-only (manually entered, or synced without per-stroke
 *     capture). getConcept2Strokes returns null for that case; every other
 *     non-2xx from any endpoint still throws Concept2Error.
 *
 * Endpoint shapes and field mappings come from the verified research bundle
 * at docs/research/concept2-logbook-bundle (code/src/concept2-api.mjs and
 * KNOWN_GAPS.md), ported into this repo's structure.
 */

const BASE = 'https://log.concept2.com';
const API = `${BASE}/api`;
const AUTH = `${BASE}/oauth`;
const ACCEPT = 'application/vnd.c2logbook.v1+json';
const REQUEST_TIMEOUT_MS = 15_000;

/*
 * Unlike WHOOP_STATE_LENGTH (8, a WHOOP-imposed constraint — see the note in
 * _lib/oauth.mjs), Concept2 documents no state-length restriction, so this
 * uses newState()'s full default length.
 */
export const CONCEPT2_STATE_LENGTH = 32;
export const CONCEPT2_SCOPES = ['user:read', 'results:read'];

// Provider-agnostic (plain token-shape inspection, no WHOOP config or errors)
// — reused rather than duplicated, and re-exported so Concept2 callers import
// everything from one module.
export { tokenNeedsRefresh };

export class Concept2Error extends Error {
  constructor(message, { code = 'concept2_error', kind = 'concept2', status = 0, retryAfter = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'Concept2Error';
    this.code = code;
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function requireConcept2Config(...keys) {
  try {
    requireConfig(...keys);
  } catch (error) {
    throw new Concept2Error('Concept2 configuration unavailable', { code: 'configuration_error', kind: 'configuration', status: 500, cause: error });
  }
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Concept2Error(`Invalid Concept2 ${field}`, { code: 'invalid_input', kind: 'input', status: 400 });
  return value.trim();
}

function callbackUrl() {
  const value = nonEmptyString(config.concept2Callback, 'callback URL');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid callback URL');
  } catch (error) {
    throw new Concept2Error('Concept2 callback URL is invalid', { code: 'configuration_error', kind: 'configuration', status: 500, cause: error });
  }
  return value;
}

function timeoutSignal() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

function fetchFunction(fetchImpl) {
  if (fetchImpl === undefined) return fetch;
  if (typeof fetchImpl !== 'function') throw new Concept2Error('Concept2 fetch implementation is invalid', { code: 'invalid_input', kind: 'input', status: 400 });
  return fetchImpl;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const wanted = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  return entry ? String(entry[1]) : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : null;
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function syncedAtOf(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString();
}

function apiUrl(path) {
  const relative = String(path || '').replace(/^\/+/, '');
  if (!relative) throw new Concept2Error('Concept2 API path is invalid', { code: 'invalid_input', kind: 'input', status: 400 });
  const root = new URL(`${API}/`);
  const url = new URL(relative, root);
  if (url.origin !== root.origin || !(url.pathname === root.pathname.slice(0, -1) || url.pathname.startsWith(root.pathname))) {
    throw new Concept2Error('Concept2 API path is invalid', { code: 'invalid_input', kind: 'input', status: 400 });
  }
  return url.toString();
}

/*
 * The Logbook API's success and error bodies are read as text and parsed —
 * rather than response.json() — because Concept2 serves non-JSON error pages
 * for some failures and the research bundle's verified client reads bodies
 * this way; an empty body maps to null.
 */
async function readJsonBody(response, message) {
  let text;
  try {
    text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
  } catch (error) {
    throw new Concept2Error(message, { code: 'invalid_api_response', kind: 'api', status: 502, cause: error });
  }
  if (text === '' || text === undefined || text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Concept2Error(message, { code: 'invalid_api_response', kind: 'api', status: 502, cause: error });
  }
}

function normalizeTokenResponse(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.access_token !== 'string' || payload.access_token.trim() === '') {
    throw new Concept2Error('Concept2 token response was invalid', { code: 'invalid_token_response', kind: 'oauth', status: 502 });
  }
  const token = { ...payload, access_token: payload.access_token.trim() };
  const expiresIn = finiteNumber(payload.expires_in);
  if (expiresIn !== null && expiresIn > 0) token.expires_at = Date.now() + expiresIn * 1000;
  return token;
}

async function tokenRequest(body, fetchImpl) {
  requireConcept2Config('concept2ClientId', 'concept2ClientSecret');
  const doFetch = fetchFunction(fetchImpl);
  let response;
  try {
    response = await doFetch(`${AUTH}/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.concept2ClientId, client_secret: config.concept2ClientSecret, ...body }),
      signal: timeoutSignal(),
    });
  } catch (error) {
    throw new Concept2Error('Concept2 token service unavailable', { code: 'network_error', kind: 'network', status: 503, cause: error });
  }
  if (!response.ok) {
    if (typeof response.text === 'function') await response.text().catch(() => {});
    throw new Concept2Error('Concept2 token request failed', { code: 'token_request_failed', kind: 'oauth', status: response.status, retryAfter: headerValue(response.headers, 'retry-after') });
  }
  const payload = await readJsonBody(response, 'Concept2 token response was invalid');
  return normalizeTokenResponse(payload);
}

export function createConcept2AuthUrl(state) {
  requireConcept2Config('concept2ClientId');
  const normalizedState = nonEmptyString(state, 'OAuth state');
  if (normalizedState.length !== CONCEPT2_STATE_LENGTH) throw new Concept2Error('Invalid Concept2 OAuth state', { code: 'invalid_state', kind: 'input', status: 400 });
  const url = new URL(`${AUTH}/authorize`);
  url.search = new URLSearchParams({ client_id: config.concept2ClientId, response_type: 'code', redirect_uri: callbackUrl(), scope: CONCEPT2_SCOPES.join(','), state: normalizedState }).toString();
  return url.toString();
}

export const exchangeConcept2Code = (code, { fetchImpl } = {}) =>
  tokenRequest({ grant_type: 'authorization_code', redirect_uri: callbackUrl(), code: nonEmptyString(code, 'authorization code'), scope: CONCEPT2_SCOPES.join(',') }, fetchImpl);
export const refreshConcept2Token = (refreshToken, { fetchImpl } = {}) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: nonEmptyString(refreshToken, 'refresh token'), scope: CONCEPT2_SCOPES.join(',') }, fetchImpl);

export function mergeConcept2Token(previous = {}, refreshed = {}) {
  const token = { ...previous, ...refreshed };
  if (!refreshed.refresh_token && previous.refresh_token) token.refresh_token = previous.refresh_token;
  if (!refreshed.expires_at && previous.expires_at) token.expires_at = previous.expires_at;
  return token;
}

export async function concept2Fetch(path, token, { params = null, fetchImpl } = {}) {
  const accessToken = typeof token === 'string' ? token : token?.access_token;
  if (typeof accessToken !== 'string' || accessToken.trim() === '') throw new Concept2Error('Concept2 access token missing', { code: 'missing_access_token', kind: 'oauth', status: 401 });
  const doFetch = fetchFunction(fetchImpl);
  const url = new URL(apiUrl(path));
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await doFetch(url.toString(), { headers: { accept: ACCEPT, authorization: `Bearer ${accessToken}` }, signal: timeoutSignal() });
  } catch (error) {
    throw new Concept2Error('Concept2 API unavailable', { code: 'network_error', kind: 'network', status: 503, cause: error });
  }
  if (!response.ok) {
    if (typeof response.text === 'function') await response.text().catch(() => {});
    throw new Concept2Error('Concept2 API request failed', { code: 'api_request_failed', kind: 'api', status: response.status, retryAfter: headerValue(response.headers, 'retry-after') });
  }
  if (response.status === 204) return null;
  return readJsonBody(response, 'Concept2 API response was invalid');
}

export const listConcept2Results = (token, { page, number, from, to, type, updatedAfter, fetchImpl } = {}) =>
  concept2Fetch('/users/me/results', token, { params: { page, number, from, to, type, updated_after: updatedAfter }, fetchImpl });

export const getConcept2Result = (resultId, token, { include, fetchImpl } = {}) =>
  concept2Fetch(`/users/me/results/${encodeURIComponent(nonEmptyString(String(resultId ?? ''), 'result id'))}`, token, { params: { include }, fetchImpl });

/*
 * Stroke data exists only for results captured with per-stroke recording.
 * The Logbook answers 404 for a summary-only or manually-entered result —
 * documented, expected, confirmed in the research bundle's KNOWN_GAPS.md —
 * so that one status maps to null ("no stroke data"), never to a thrown
 * error. Every other failure still throws.
 */
export async function getConcept2Strokes(resultId, token, { fetchImpl } = {}) {
  const id = nonEmptyString(String(resultId ?? ''), 'result id');
  try {
    return await concept2Fetch(`/users/me/results/${encodeURIComponent(id)}/strokes`, token, { fetchImpl });
  } catch (error) {
    if (error instanceof Concept2Error && error.status === 404) return null;
    throw error;
  }
}

/*
 * Field mapping ported from the research bundle's normalizeResult(). The
 * `modality` field carries Concept2's RAW machine type ('rower', 'skierg',
 * 'bike', ...) — mapping it onto this app's Modality union is deliberately
 * NOT this module's job; the conditioning-block matcher does that where the
 * engine types are in scope.
 */
export function normalizeConcept2Result(result, { strokes = null, syncedAt } = {}) {
  const wrapped = result && typeof result === 'object' ? result : {};
  const source = wrapped.data && typeof wrapped.data === 'object' && !Array.isArray(wrapped.data) ? wrapped.data : wrapped;
  return {
    provider: 'concept2_logbook',
    externalId: source.id == null ? null : String(source.id),
    providerUserId: source.user_id == null ? null : String(source.user_id),
    modality: stringOrNull(source.type),
    startedAt: stringOrNull(source.date_utc) ?? stringOrNull(source.date),
    durationRaw: finiteNumber(source.time),
    distanceRaw: finiteNumber(source.distance),
    durationDisplay: stringOrNull(source.time_formatted),
    workoutType: stringOrNull(source.workout_type) ?? 'unknown',
    source: stringOrNull(source.source),
    verified: source.verified ?? null,
    ranked: source.ranked ?? null,
    privacy: stringOrNull(source.privacy),
    workout: source.workout ?? null,
    metadata: source.metadata ?? null,
    strokes,
    strokeDataAvailable: strokes !== null,
    syncedAt: syncedAtOf(syncedAt),
  };
}

export function isConcept2Unauthorized(error) {
  return error?.status === 401;
}

export function concept2ErrorResponse(error, fallback = 'concept2_failed') {
  if (error?.code === 'configuration_error') return { status: 500, body: { error: 'configuration_error' }, headers: {} };
  if (error?.status === 401 || (error?.kind === 'oauth' && error?.status >= 400 && error?.status < 500)) return { status: 401, body: { error: 'reauthorization_required' }, headers: {} };
  if (error?.status === 429) return { status: 429, body: { error: 'rate_limited' }, headers: error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {} };
  return { status: 502, body: { error: fallback }, headers: {} };
}
