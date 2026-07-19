import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config, requireConfig } from './config.mjs';

const API = 'https://api.prod.whoop.com/developer/v2';
const AUTH = 'https://api.prod.whoop.com/oauth/oauth2';
const MAX_PAGE_SIZE = 25;
const MAX_WORKOUTS = 30;
const REQUEST_TIMEOUT_MS = 15_000;
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export const WHOOP_STATE_LENGTH = 8;
export const WHOOP_SCOPES = ['offline', 'read:recovery', 'read:cycles', 'read:sleep', 'read:workout', 'read:profile', 'read:body_measurement'];

export class WhoopError extends Error {
  constructor(message, { code = 'whoop_error', kind = 'whoop', status = 0, retryAfter = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WhoopError';
    this.code = code;
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function requireWhoopConfig(...keys) {
  try {
    requireConfig(...keys);
  } catch (error) {
    throw new WhoopError('WHOOP configuration unavailable', { code: 'configuration_error', kind: 'configuration', status: 500, cause: error });
  }
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new WhoopError(`Invalid WHOOP ${field}`, { code: 'invalid_input', kind: 'input', status: 400 });
  return value.trim();
}

function callbackUrl() {
  const value = nonEmptyString(config.whoopCallback, 'callback URL');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid callback URL');
  } catch (error) {
    throw new WhoopError('WHOOP callback URL is invalid', { code: 'configuration_error', kind: 'configuration', status: 500, cause: error });
  }
  return value;
}

function timeoutSignal() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
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

function firstNumber(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function dateOnly(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim();
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  if (direct && Number.isFinite(Date.parse(`${direct}T00:00:00.000Z`))) return direct;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}

function capturedAt(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString();
}

function recordsOf(input) {
  if (Array.isArray(input)) return input.filter((record) => record && typeof record === 'object');
  if (Array.isArray(input?.records)) return input.records.filter((record) => record && typeof record === 'object');
  if (input && typeof input === 'object' && ('score' in input || 'start' in input || 'created_at' in input || 'updated_at' in input)) return [input];
  return [];
}

function selectRecord(records, hasValue) {
  return records.find(hasValue) || records[0] || {};
}

function apiUrl(path) {
  const relative = String(path || '').replace(/^\/+/, '');
  if (!relative) throw new WhoopError('WHOOP API path is invalid', { code: 'invalid_input', kind: 'input', status: 400 });
  const root = new URL(`${API}/`);
  const url = new URL(relative, root);
  if (url.origin !== root.origin || !(url.pathname === root.pathname.slice(0, -1) || url.pathname.startsWith(root.pathname))) {
    throw new WhoopError('WHOOP API path is invalid', { code: 'invalid_input', kind: 'input', status: 400 });
  }
  return url.toString();
}

function normalizeTokenResponse(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.access_token !== 'string' || payload.access_token.trim() === '') {
    throw new WhoopError('WHOOP token response was invalid', { code: 'invalid_token_response', kind: 'oauth', status: 502 });
  }
  const token = { ...payload, access_token: payload.access_token.trim() };
  const expiresIn = finiteNumber(payload.expires_in);
  if (expiresIn !== null && expiresIn > 0) token.expires_at = Date.now() + expiresIn * 1000;
  return token;
}

async function tokenRequest(body) {
  requireWhoopConfig('whoopClientId', 'whoopClientSecret');
  let response;
  try {
    response = await fetch(`${AUTH}/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.whoopClientId, client_secret: config.whoopClientSecret, ...body }),
      signal: timeoutSignal(),
    });
  } catch (error) {
    throw new WhoopError('WHOOP token service unavailable', { code: 'network_error', kind: 'network', status: 503, cause: error });
  }
  if (!response.ok) {
    if (typeof response.text === 'function') await response.text().catch(() => {});
    throw new WhoopError('WHOOP token request failed', { code: 'token_request_failed', kind: 'oauth', status: response.status, retryAfter: headerValue(response.headers, 'retry-after') });
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new WhoopError('WHOOP token response was invalid', { code: 'invalid_token_response', kind: 'oauth', status: 502, cause: error });
  }
  return normalizeTokenResponse(payload);
}

export function createWhoopAuthUrl(state) {
  requireWhoopConfig('whoopClientId');
  const normalizedState = nonEmptyString(state, 'OAuth state');
  if (normalizedState.length !== WHOOP_STATE_LENGTH) throw new WhoopError('Invalid WHOOP OAuth state', { code: 'invalid_state', kind: 'input', status: 400 });
  const url = new URL(`${AUTH}/auth`);
  url.search = new URLSearchParams({ client_id: config.whoopClientId, response_type: 'code', redirect_uri: callbackUrl(), scope: WHOOP_SCOPES.join(' '), state: normalizedState }).toString();
  return url.toString();
}

export const exchangeWhoopCode = (code) => tokenRequest({ grant_type: 'authorization_code', code: nonEmptyString(code, 'authorization code'), redirect_uri: callbackUrl() });
export const refreshWhoopToken = (refreshToken) => tokenRequest({ grant_type: 'refresh_token', refresh_token: nonEmptyString(refreshToken, 'refresh token'), scope: 'offline' });

export function mergeWhoopToken(previous = {}, refreshed = {}) {
  const token = { ...previous, ...refreshed };
  if (!refreshed.refresh_token && previous.refresh_token) token.refresh_token = previous.refresh_token;
  if (!refreshed.expires_at && previous.expires_at) token.expires_at = previous.expires_at;
  return token;
}

export function tokenNeedsRefresh(token, skewMs = 60 * 1000) {
  if (!token?.access_token) return true;
  const expiresAt = finiteNumber(token.expires_at);
  return expiresAt !== null && Date.now() >= expiresAt - skewMs;
}

export async function whoopFetch(path, token) {
  const accessToken = typeof token === 'string' ? token : token?.access_token;
  if (typeof accessToken !== 'string' || accessToken.trim() === '') throw new WhoopError('WHOOP access token missing', { code: 'missing_access_token', kind: 'oauth', status: 401 });
  let response;
  try {
    response = await fetch(apiUrl(path), { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` }, signal: timeoutSignal() });
  } catch (error) {
    throw new WhoopError('WHOOP API unavailable', { code: 'network_error', kind: 'network', status: 503, cause: error });
  }
  if (!response.ok) {
    if (typeof response.text === 'function') await response.text().catch(() => {});
    throw new WhoopError('WHOOP API request failed', { code: 'api_request_failed', kind: 'api', status: response.status, retryAfter: headerValue(response.headers, 'retry-after') });
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (error) {
    throw new WhoopError('WHOOP API response was invalid', { code: 'invalid_api_response', kind: 'api', status: 502, cause: error });
  }
}

export async function revokeWhoopToken(token) {
  const accessToken = typeof token === 'string' ? token : token?.access_token;
  if (typeof accessToken !== 'string' || accessToken.trim() === '') throw new WhoopError('WHOOP access token missing', { code: 'missing_access_token', kind: 'oauth', status: 401 });
  let response;
  try {
    response = await fetch(apiUrl('/user/access'), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: timeoutSignal(),
    });
  } catch (error) {
    throw new WhoopError('WHOOP revoke service unavailable', { code: 'network_error', kind: 'network', status: 503, cause: error });
  }
  if (!response.ok) {
    await response.text?.().catch(() => {});
    throw new WhoopError('WHOOP revoke request failed', { code: 'revoke_failed', kind: 'oauth', status: response.status, retryAfter: headerValue(response.headers, 'retry-after') });
  }
  return true;
}

async function fetchCollection(path, token, maxRecords) {
  const records = [];
  const seenTokens = new Set();
  let nextToken = '';
  let pages = 0;
  while (records.length < maxRecords && pages < 10) {
    const params = new URLSearchParams({ limit: String(Math.min(MAX_PAGE_SIZE, maxRecords - records.length)) });
    if (nextToken) params.set('nextToken', nextToken);
    const separator = String(path).includes('?') ? '&' : '?';
    const page = await whoopFetch(`${path}${separator}${params.toString()}`, token);
    if (!page || typeof page !== 'object') throw new WhoopError('WHOOP collection response was invalid', { code: 'invalid_api_response', kind: 'api', status: 502 });
    if (Array.isArray(page.records)) records.push(...page.records);
    const pageToken = typeof page.next_token === 'string' ? page.next_token : '';
    if (!pageToken || seenTokens.has(pageToken)) break;
    seenTokens.add(pageToken);
    nextToken = pageToken;
    pages += 1;
  }
  if (pages >= 10 && nextToken) throw new WhoopError('WHOOP pagination did not converge', { code: 'pagination_error', kind: 'api', status: 502 });
  return { records: records.slice(0, maxRecords) };
}

export function normalizeWhoopRecovery(input = {}) {
  return {
    source: 'whoop',
    date: dateOnly(input.date),
    recoveryScore: firstNumber(input.recoveryScore),
    sleepPerformance: firstNumber(input.sleepPerformance),
    hrvMs: firstNumber(input.hrvMs),
    restingHr: firstNumber(input.restingHr),
    strain: firstNumber(input.strain),
    capturedAt: capturedAt(input.capturedAt),
  };
}

export function normalizeWhoopPayload({ recovery = {}, cycle = {}, sleep = {}, workout = {} } = {}) {
  const recoveryRecords = recordsOf(recovery);
  const cycleRecords = recordsOf(cycle);
  const sleepRecords = recordsOf(sleep);
  const workoutRecords = recordsOf(workout);
  const recoveryRecord = selectRecord(recoveryRecords, (record) => firstNumber(record.score?.recovery_score, record.recovery_score) !== null);
  const cycleRecord = selectRecord(cycleRecords, (record) => firstNumber(record.score?.strain, record.strain) !== null);
  const nonNapSleeps = sleepRecords.filter((record) => record.nap !== true);
  const sleepRecord = selectRecord(nonNapSleeps.length ? nonNapSleeps : sleepRecords, (record) => firstNumber(record.score?.sleep_performance_percentage, record.sleep_performance_percentage) !== null);
  const workoutRecord = selectRecord(workoutRecords, (record) => firstNumber(record.score?.strain, record.strain) !== null);
  const linkedSleep = recoveryRecord.sleep_id == null ? null : sleepRecords.find((record) => String(record.id) === String(recoveryRecord.sleep_id));
  const linkedCycle = recoveryRecord.cycle_id == null ? null : cycleRecords.find((record) => String(record.id) === String(recoveryRecord.cycle_id));
  const date = recoveryRecord.date || linkedSleep?.start || linkedCycle?.start || sleepRecord.start || cycleRecord.start || workoutRecord.start || recoveryRecord.created_at || sleepRecord.created_at || cycleRecord.created_at || workoutRecord.created_at;
  return normalizeWhoopRecovery({
    date,
    recoveryScore: recoveryRecord.score?.recovery_score ?? recoveryRecord.recovery_score,
    sleepPerformance: sleepRecord.score?.sleep_performance_percentage ?? sleepRecord.sleep_performance_percentage,
    hrvMs: recoveryRecord.score?.hrv_rmssd_milli ?? recoveryRecord.hrv_rmssd_milli,
    restingHr: recoveryRecord.score?.resting_heart_rate ?? recoveryRecord.resting_heart_rate,
    strain: cycleRecord.score?.strain ?? cycleRecord.strain ?? workoutRecord.score?.strain ?? workoutRecord.strain,
  });
}

export async function fetchWhoopSnapshot(token) {
  const [recovery, cycle, sleep, workout] = await Promise.all([
    fetchCollection('/recovery', token, 7),
    fetchCollection('/cycle', token, 7),
    fetchCollection('/activity/sleep', token, 7),
    fetchCollection('/activity/workout', token, MAX_WORKOUTS),
  ]);
  return { recovery, cycle, sleep, workout, normalized: normalizeWhoopPayload({ recovery, cycle, sleep, workout }), syncedAt: new Date().toISOString() };
}

export function verifyWhoopWebhook(rawBody, signature, timestamp, now = Date.now()) {
  requireWhoopConfig('whoopClientSecret');
  const body = typeof rawBody === 'string' ? rawBody : '';
  const providedSignature = typeof signature === 'string' ? signature.trim() : '';
  const providedTimestamp = typeof timestamp === 'string' || typeof timestamp === 'number' ? String(timestamp).trim() : '';
  const timestampNumber = Number(providedTimestamp);
  if (!providedSignature || !/^\d+$/.test(providedTimestamp) || !Number.isSafeInteger(timestampNumber) || timestampNumber <= 0 || Math.abs(now - timestampNumber) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) return false;
  const expected = createHmac('sha256', config.whoopClientSecret).update(`${providedTimestamp}${body}`, 'utf8').digest('base64');
  const actualBytes = Buffer.from(providedSignature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function whoopWebhookEventKey(payload, rawBody = '') {
  const traceId = typeof payload?.trace_id === 'string' ? payload.trace_id.trim() : '';
  return traceId || `body-${createHash('sha256').update(String(rawBody), 'utf8').digest('hex')}`;
}

export function isWhoopUnauthorized(error) {
  return error?.status === 401;
}

export function whoopErrorResponse(error, fallback = 'whoop_failed') {
  if (error?.code === 'configuration_error') return { status: 500, body: { error: 'configuration_error' }, headers: {} };
  if (error?.status === 401 || (error?.kind === 'oauth' && error?.status >= 400 && error?.status < 500)) return { status: 401, body: { error: 'reauthorization_required' }, headers: {} };
  if (error?.status === 429) return { status: 429, body: { error: 'rate_limited' }, headers: error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {} };
  return { status: 502, body: { error: fallback }, headers: {} };
}
