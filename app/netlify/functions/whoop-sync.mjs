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

async function fetchSnapshotForSession(sid, initialToken) {
  let token = initialToken;
  if (tokenNeedsRefresh(token) && token.refresh_token) token = await refreshWithoutDiscardingRotation(sid, token);
  try {
    return { token, snapshot: await fetchWhoopSnapshot(token.access_token) };
  } catch (error) {
    if (!isWhoopUnauthorized(error) || !token.refresh_token) throw error;
    token = await refreshWithoutDiscardingRotation(sid, token);
    return { token, snapshot: await fetchWhoopSnapshot(token.access_token) };
  }
}

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  try {
    const sid = sessionFromEvent(event);
    const token = await loadToken('whoop', sid);
    if (!token) return json({ connected: false }, 401);
    const { snapshot } = await fetchSnapshotForSession(sid, token);
    await syncRecord('whoop', sid, snapshot);
    return json({ connected: true, provider: 'whoop', normalized: snapshot.normalized, syncedAt: snapshot.syncedAt });
  } catch (error) {
    const response = whoopErrorResponse(error, 'sync_failed');
    return json(response.body, response.status, response.headers);
  }
}
