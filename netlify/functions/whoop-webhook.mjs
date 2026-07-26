import { fetchWhoopSnapshot, isWhoopUnauthorized, mergeWhoopToken, refreshWhoopToken, tokenNeedsRefresh, verifyWhoopWebhook, whoopErrorResponse, whoopWebhookEventKey } from './_lib/whoop.mjs';
import { connectNetlifyBlobs, getJson, setJson } from './_lib/store.mjs';
import { loadToken, ownersForProvider, saveToken, syncRecord } from './_lib/oauth.mjs';
import { json, method } from './_lib/http.mjs';

const SUPPORTED_EVENTS = new Set(['workout.updated', 'workout.deleted', 'sleep.updated', 'sleep.deleted', 'recovery.updated', 'recovery.deleted']);

function eventHeader(event, name) {
  const wanted = name.toLowerCase();
  for (const headers of [event?.headers, event?.multiValueHeaders]) {
    const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === wanted);
    if (entry) return Array.isArray(entry[1]) ? String(entry[1][0] || '') : String(entry[1] || '');
  }
  return '';
}

function rawBody(event) {
  const body = event?.body == null ? '' : Buffer.isBuffer(event.body) ? event.body.toString('utf8') : String(event.body);
  if (!event?.isBase64Encoded) return body;
  try {
    return Buffer.from(body, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

async function tokenSavedByAnotherSync(owner, currentToken) {
  try {
    const latest = await loadToken('whoop', owner);
    return latest?.access_token && latest.access_token !== currentToken?.access_token ? latest : null;
  } catch {
    return null;
  }
}

async function refreshWithoutDiscardingRotation(owner, currentToken) {
  const alreadyRefreshed = await tokenSavedByAnotherSync(owner, currentToken);
  if (alreadyRefreshed && !tokenNeedsRefresh(alreadyRefreshed)) return alreadyRefreshed;
  try {
    const refreshed = await refreshWhoopToken(currentToken.refresh_token);
    const nextToken = mergeWhoopToken(currentToken, refreshed);
    await saveToken('whoop', owner, nextToken);
    return nextToken;
  } catch (error) {
    const savedByAnotherSync = await tokenSavedByAnotherSync(owner, currentToken);
    if (savedByAnotherSync) return savedByAnotherSync;
    throw error;
  }
}

async function fetchSnapshotForOwner(owner, initialToken) {
  let token = initialToken;
  if (tokenNeedsRefresh(token) && token.refresh_token) token = await refreshWithoutDiscardingRotation(owner, token);
  try {
    return await fetchWhoopSnapshot(token.access_token);
  } catch (error) {
    if (!isWhoopUnauthorized(error) || !token.refresh_token) throw error;
    token = await refreshWithoutDiscardingRotation(owner, token);
    return fetchWhoopSnapshot(token.access_token);
  }
}

async function markProcessed(key, payload) {
  await setJson(key, { status: 'processed', processedAt: new Date().toISOString(), traceId: payload.trace_id || null });
}

export async function handler(event, context) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['POST']);
  if (denied) return denied;
  const raw = rawBody(event);
  if (raw === null) return json({ error: 'invalid_body' }, 400);
  try {
    if (!verifyWhoopWebhook(raw, eventHeader(event, 'x-whoop-signature'), eventHeader(event, 'x-whoop-signature-timestamp'))) return json({ error: 'invalid_signature' }, 401);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    const type = typeof payload?.type === 'string' ? payload.type.trim() : '';
    if (!SUPPORTED_EVENTS.has(type)) return json({ ok: true, ignored: true });
    const userId = payload?.user_id;
    const objectId = payload?.id;
    if (userId === null || userId === undefined || String(userId).trim() === '' || objectId === null || objectId === undefined || String(objectId).trim() === '') return json({ error: 'invalid_webhook_payload' }, 400);
    const eventKey = whoopWebhookEventKey(payload, raw);
    const dedupeKey = `webhook:event:whoop:${eventKey}`;
    if (await getJson(dedupeKey)) return json({ ok: true, duplicate: true });
    /*
     * One WHOOP account can be held by more than one local owner — a browser
     * session and the same person's signed-in phone are different owners by
     * design (see _lib/identity.mjs). Every one of them is refreshed, because a
     * webhook that only reached whichever surface connected most recently would
     * leave the other showing yesterday's recovery with no way to tell.
     */
    const owners = await ownersForProvider('whoop', userId);
    const work = (async () => {
      for (const owner of owners) {
        const token = await loadToken('whoop', owner);
        // A stale index entry (revoked, disconnected elsewhere) is skipped
        // rather than failing the whole event for the owners that are live.
        if (!token) continue;
        const snapshot = await fetchSnapshotForOwner(owner, token);
        await syncRecord('whoop', owner, snapshot);
      }
      await markProcessed(dedupeKey, payload);
    })();
    if (typeof context?.waitUntil === 'function') {
      const tracked = work.catch((error) => console.error('[whoop-webhook]', error?.code || error?.status || 'processing_failed'));
      try {
        context.waitUntil(tracked);
      } catch {
        await tracked;
      }
      return json({ ok: true, accepted: true });
    }
    await work;
    return json({ ok: true });
  } catch (error) {
    const response = whoopErrorResponse(error, 'webhook_processing_failed');
    return json(response.body, response.status, response.headers);
  }
}
