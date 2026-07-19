import { fetchWhoopSnapshot, isWhoopUnauthorized, mergeWhoopToken, refreshWhoopToken, tokenNeedsRefresh, whoopErrorResponse } from './_lib/whoop.mjs';
import { loadToken, saveToken, sessionFromEvent, syncRecord } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { json, method } from './_lib/http.mjs';

async function tokenSavedByAnotherSync(sid, currentToken) {
  try {
    const latest = await loadToken('whoop', sid);
    return latest?.access_token && latest.access_token !== currentToken?.access_token ? latest : null;
  } catch {
    return null;
  }
}

async function refreshWithoutDiscardingRotation(sid, currentToken) {
  const alreadyRefreshed = await tokenSavedByAnotherSync(sid, currentToken);
  if (alreadyRefreshed && !tokenNeedsRefresh(alreadyRefreshed)) return alreadyRefreshed;
  try {
    const refreshed = await refreshWhoopToken(currentToken.refresh_token);
    const nextToken = mergeWhoopToken(currentToken, refreshed);
    await saveToken('whoop', sid, nextToken);
    return nextToken;
  } catch (error) {
    const savedByAnotherSync = await tokenSavedByAnotherSync(sid, currentToken);
    if (savedByAnotherSync) return savedByAnotherSync;
    throw error;
  }
}

async function fetchSnapshotForSession(sid, initialToken, historyDays) {
  let token = initialToken;
  if (tokenNeedsRefresh(token) && token.refresh_token) token = await refreshWithoutDiscardingRotation(sid, token);
  try {
    return { token, snapshot: await fetchWhoopSnapshot(token.access_token, { historyDays }) };
  } catch (error) {
    if (!isWhoopUnauthorized(error) || !token.refresh_token) throw error;
    token = await refreshWithoutDiscardingRotation(sid, token);
    return { token, snapshot: await fetchWhoopSnapshot(token.access_token, { historyDays }) };
  }
}

// A regular sync only asks WHOOP for a short rolling window of daily strain
// and recovery (cheap, fast). The very first sync for an account instead
// asks for a much longer backfill window so the fitness/fatigue trend chart
// and the training-impact comparison have enough history to be meaningful
// right away, rather than starting from nothing. Triggered by the client
// passing ?backfill=1 exactly once per account.
const REGULAR_SYNC_HISTORY_DAYS = 10;
const BACKFILL_SYNC_HISTORY_DAYS = 100;

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  try {
    const sid = sessionFromEvent(event);
    const token = await loadToken('whoop', sid);
    if (!token) return json({ connected: false }, 401);
    const backfill = event.queryStringParameters?.backfill === '1';
    const historyDays = backfill ? BACKFILL_SYNC_HISTORY_DAYS : REGULAR_SYNC_HISTORY_DAYS;
    const { snapshot } = await fetchSnapshotForSession(sid, token, historyDays);
    await syncRecord('whoop', sid, snapshot);
    return json({ connected: true, provider: 'whoop', normalized: snapshot.normalized, dailyStrain: snapshot.dailyStrain, dailyRecovery: snapshot.dailyRecovery, syncedAt: snapshot.syncedAt });
  } catch (error) {
    const response = whoopErrorResponse(error, 'sync_failed');
    return json(response.body, response.status, response.headers);
  }
}
