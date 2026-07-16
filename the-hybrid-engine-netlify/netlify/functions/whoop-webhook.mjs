import { fetchWhoopSnapshot, isWhoopUnauthorized, mergeWhoopToken, refreshWhoopToken, tokenNeedsRefresh, verifyWhoopWebhook, whoopErrorResponse, whoopWebhookEventKey } from './_lib/whoop.mjs';
import { connectNetlifyBlobs, getJson, setJson } from './_lib/store.mjs';
import { loadToken, saveToken, sidForProvider, syncRecord } from './_lib/oauth.mjs';
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
    return await fetchWhoopSnapshot(token.access_token);
  } catch (error) {
    if (!isWhoopUnauthorized(error) || !token.refresh_token) throw error;
    token = await refreshWithoutDiscardingRotation(sid, token);
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
    const sid = await sidForProvider('whoop', userId);
    const work = (async () => {
      if (!sid) {
        await markProcessed(dedupeKey, payload);
        return;
      }
      const token = await loadToken('whoop', sid);
      if (!token) {
        await markProcessed(dedupeKey, payload);
        return;
      }
      const snapshot = await fetchSnapshotForSession(sid, token);
      await syncRecord('whoop', sid, snapshot);
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
