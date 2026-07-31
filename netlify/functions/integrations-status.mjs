import { loadData, loadToken } from './_lib/oauth.mjs';
import { ownerFromEvent, authErrorResponse } from './_lib/identity.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { json, method } from './_lib/http.mjs';

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  // An anonymous browser is fine and answers `connected: false`. A request that
  // presents a bearer token and fails verification is NOT fine and must not be
  // answered as if it were anonymous.
  let owner;
  try {
    ({ owner } = await ownerFromEvent(event));
  } catch (error) {
    const response = authErrorResponse(error);
    return json(response.body, response.status);
  }
  const [whoopToken, whoop, concept2Token, concept2] = await Promise.all([
    loadToken('whoop', owner),
    loadData('whoop', owner),
    loadToken('concept2', owner),
    loadData('concept2', owner),
  ]);
  const normalized = whoop?.normalized && typeof whoop.normalized === 'object'
    ? {
        source: 'whoop',
        date: String(whoop.normalized.date || '').slice(0, 10),
        recoveryScore: Number.isFinite(Number(whoop.normalized.recoveryScore)) ? Number(whoop.normalized.recoveryScore) : null,
        sleepPerformance: Number.isFinite(Number(whoop.normalized.sleepPerformance)) ? Number(whoop.normalized.sleepPerformance) : null,
        hrvMs: Number.isFinite(Number(whoop.normalized.hrvMs)) ? Number(whoop.normalized.hrvMs) : null,
        restingHr: Number.isFinite(Number(whoop.normalized.restingHr)) ? Number(whoop.normalized.restingHr) : null,
        strain: Number.isFinite(Number(whoop.normalized.strain)) ? Number(whoop.normalized.strain) : null,
        capturedAt: whoop.normalized.capturedAt || null,
      }
    : null;
  // Concept2's stored snapshot can hold up to 500 normalized results, and this
  // endpoint is a cheap poll — so status reports counts and timestamps only,
  // and the full list stays behind concept2-sync's own response.
  const concept2Results = Array.isArray(concept2?.normalized) ? concept2.normalized : [];
  return json({
    whoop: { connected: Boolean(whoopToken), lastSyncAt: whoop?.syncedAt || null, sampleDate: normalized?.date || null, normalized },
    concept2: {
      connected: Boolean(concept2Token),
      lastSyncAt: concept2?.syncedAt || null,
      resultCount: concept2Results.length,
      latest: concept2Results[0]?.startedAt || null,
    },
  });
}
