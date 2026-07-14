import { loadData, loadToken, sessionFromEvent } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { json, method } from './_lib/http.mjs';
export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  const sid = sessionFromEvent(event);
  const [whoopToken, stravaToken, whoop, strava] = await Promise.all([
    loadToken('whoop', sid),
    loadToken('strava', sid),
    loadData('whoop', sid),
    loadData('strava', sid),
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
  return json({
    whoop: { connected: Boolean(whoopToken), lastSyncAt: whoop?.syncedAt || null, sampleDate: normalized?.date || null, normalized },
    strava: { connected: Boolean(stravaToken), lastSyncAt: strava?.syncedAt || null, activityCount: strava?.activities?.length || 0 },
  });
}
