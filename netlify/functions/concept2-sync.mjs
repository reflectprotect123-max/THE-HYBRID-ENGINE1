import { concept2ErrorResponse, getConcept2Strokes, isConcept2Unauthorized, listConcept2Results, mergeConcept2Token, normalizeConcept2Result, refreshConcept2Token, tokenNeedsRefresh } from './_lib/concept2.mjs';
import { loadData, loadToken, loadTokenRecord, saveToken, syncRecord } from './_lib/oauth.mjs';
import { ownerFromEvent, authErrorResponse } from './_lib/identity.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { json, method } from './_lib/http.mjs';

async function tokenSavedByAnotherSync(owner, currentToken) {
  try {
    const latest = await loadToken('concept2', owner);
    return latest?.access_token && latest.access_token !== currentToken?.access_token ? latest : null;
  } catch {
    return null;
  }
}

async function refreshWithoutDiscardingRotation(owner, currentToken) {
  const alreadyRefreshed = await tokenSavedByAnotherSync(owner, currentToken);
  if (alreadyRefreshed && !tokenNeedsRefresh(alreadyRefreshed)) return alreadyRefreshed;
  try {
    const refreshed = await refreshConcept2Token(currentToken.refresh_token);
    const nextToken = mergeConcept2Token(currentToken, refreshed);
    await saveToken('concept2', owner, nextToken);
    return nextToken;
  } catch (error) {
    const savedByAnotherSync = await tokenSavedByAnotherSync(owner, currentToken);
    if (savedByAnotherSync) return savedByAnotherSync;
    throw error;
  }
}

/*
 * WHOOP's sync re-fetches a rolling window of DAILY summaries, so each sync
 * simply replaces the last. Concept2 syncs DISCRETE workout results, so the
 * window is incremental instead: once a sync has completed, later syncs ask
 * only for results updated since it (`updated_after`, interpreted by the
 * Logbook in GMT), overlapped by a minute so clock skew between our
 * `syncedAt` and the Logbook's update stamps cannot drop a result — the
 * merge-by-externalId below makes the overlap harmless. The first sync (or an
 * explicit `?backfill=1`, mirroring WHOOP's flag) has no timestamp to start
 * from and asks for a 90-day `from` window instead, so the training history
 * is meaningful right away.
 */
const BACKFILL_WINDOW_DAYS = 90;
const UPDATED_AFTER_OVERLAP_MS = 60 * 1000;

/*
 * Per-sync API budget. The results list is paged (documented default 50, max
 * 250 per page, pagination under meta.pagination), and each result's stroke
 * series is its own request, so an unbounded sync could fan out into hundreds
 * of calls inside one function invocation. The bounds below cap a sync at
 * MAX_RESULT_PAGES list calls plus STROKES_FETCH_LIMIT strokes calls; an
 * incremental sync rarely approaches either, and a 90-day backfill that does
 * simply syncs summary-only records past the cap (see buildSnapshot).
 */
const RESULTS_PER_PAGE = 100;
const MAX_RESULT_PAGES = 3;
const STROKES_FETCH_LIMIT = 25;
const MAX_STORED_RESULTS = 500;

function gmtStamp(ms) {
  // The Logbook's documented updated_after format: "YYYY-MM-DD HH:MM:SS", GMT.
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function dateOnly(ms) {
  // The documented from/to format: "YYYY-MM-DD".
  return new Date(ms).toISOString().slice(0, 10);
}

function startedAtMs(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

async function listResultsWindow(token, params) {
  const results = [];
  for (let page = 1; page <= MAX_RESULT_PAGES; page += 1) {
    const payload = await listConcept2Results(token, { ...params, number: RESULTS_PER_PAGE, page });
    const data = Array.isArray(payload?.data) ? payload.data : [];
    results.push(...data);
    if (data.length < RESULTS_PER_PAGE) break;
    const totalPages = Number(payload?.meta?.pagination?.total_pages);
    if (Number.isFinite(totalPages) && page >= totalPages) break;
  }
  return results;
}

/*
 * One synced snapshot: the freshly fetched results, normalized, merged over
 * whatever earlier syncs already stored.
 *
 * Strokes are fetched for the newest STROKES_FETCH_LIMIT results so their
 * `strokeDataAvailable` flag reflects the Logbook's real answer (a 404 there
 * means summary-only — data, not an error). The RAW stroke series is then
 * dropped before storing: nothing downstream consumes it (Task 13 matches on
 * modality/startedAt/duration/distance/workout.splits), and a long row's
 * per-stroke array would bloat every stored record and sync response for a
 * field nobody reads — it can always be re-fetched by id on demand. Results
 * past the fetch cap keep the flag from their previously stored record rather
 * than being stamped false for a question that was never asked.
 */
async function buildSnapshot(token, params, prior) {
  const raw = await listResultsWindow(token, params);
  raw.sort((a, b) => startedAtMs(b?.date_utc ?? b?.date) - startedAtMs(a?.date_utc ?? a?.date));
  const priorNormalized = Array.isArray(prior?.normalized) ? prior.normalized : [];
  const priorById = new Map(priorNormalized.filter((entry) => entry?.externalId).map((entry) => [entry.externalId, entry]));
  const syncedAt = new Date().toISOString();

  const fresh = await Promise.all(raw.map(async (result, index) => {
    const fetchStrokes = index < STROKES_FETCH_LIMIT && result?.id !== null && result?.id !== undefined;
    const strokes = fetchStrokes ? await getConcept2Strokes(result.id, token) : null;
    const normalized = normalizeConcept2Result(result, { strokes, syncedAt });
    if (!fetchStrokes) {
      const previous = priorById.get(normalized.externalId);
      if (typeof previous?.strokeDataAvailable === 'boolean') normalized.strokeDataAvailable = previous.strokeDataAvailable;
    }
    normalized.strokes = null;
    return normalized;
  }));

  const freshIds = new Set(fresh.map((entry) => entry.externalId));
  const carried = priorNormalized.filter((entry) => entry?.externalId && !freshIds.has(entry.externalId));
  const normalized = [...fresh, ...carried]
    .sort((a, b) => startedAtMs(b?.startedAt) - startedAtMs(a?.startedAt))
    .slice(0, MAX_STORED_RESULTS);

  const providerUserId = fresh.find((entry) => entry.providerUserId !== null && entry.providerUserId !== undefined)?.providerUserId ?? prior?.providerUserId ?? null;
  return { provider: 'concept2', normalized, providerUserId, syncedAt };
}

async function fetchSnapshotForOwner(owner, initialToken, params, prior) {
  let token = initialToken;
  if (tokenNeedsRefresh(token) && token.refresh_token) token = await refreshWithoutDiscardingRotation(owner, token);
  try {
    return { token, snapshot: await buildSnapshot(token, params, prior) };
  } catch (error) {
    if (!isConcept2Unauthorized(error) || !token.refresh_token) throw error;
    token = await refreshWithoutDiscardingRotation(owner, token);
    return { token, snapshot: await buildSnapshot(token, params, prior) };
  }
}

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  let owner;
  try {
    ({ owner } = await ownerFromEvent(event));
  } catch (error) {
    const response = authErrorResponse(error);
    return json(response.body, response.status);
  }
  try {
    const record = await loadTokenRecord('concept2', owner);
    const token = record?.token || null;
    if (!token) return json({ connected: false }, 401);
    const prior = await loadData('concept2', owner);
    const lastSyncedMs = Date.parse(prior?.syncedAt ?? '');
    const backfill = event.queryStringParameters?.backfill === '1' || !Number.isFinite(lastSyncedMs);
    const params = backfill
      ? { from: dateOnly(Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000) }
      : { updatedAfter: gmtStamp(lastSyncedMs - UPDATED_AFTER_OVERLAP_MS) };
    const { token: finalToken, snapshot } = await fetchSnapshotForOwner(owner, token, params, prior);
    // A grant connected before any results existed was saved with a null
    // provider user id (Concept2 has no profile endpoint to ask — see
    // concept2-callback.mjs). The first sync that sees a result learns the id
    // here and re-saves the token so the provider index points back at this
    // owner, exactly as a WHOOP connection is indexed from its callback.
    if ((record.providerUserId === null || record.providerUserId === undefined) && snapshot.providerUserId !== null) {
      await saveToken('concept2', owner, finalToken, snapshot.providerUserId);
    }
    await syncRecord('concept2', owner, snapshot);
    return json({ connected: true, provider: 'concept2', normalized: snapshot.normalized, syncedAt: snapshot.syncedAt });
  } catch (error) {
    const response = concept2ErrorResponse(error, 'sync_failed');
    return json(response.body, response.status, response.headers);
  }
}
