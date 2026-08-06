import { exchangeConcept2Code, listConcept2Results } from './_lib/concept2.mjs';
import { consumePending, saveToken, syncRecord } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { NATIVE_RETURN_URL } from './_lib/config.mjs';
import { method, redirect } from './_lib/http.mjs';
import { sessionFromEvent } from './_lib/session.mjs';

function result(location) {
  return redirect(location, { 'cache-control': 'no-store' });
}

/*
 * Where the browser goes once the handshake is over.
 *
 * `outcome` is always one of the fixed strings below — never anything from the
 * request — and the destination is chosen from the PENDING RECORD, which we
 * wrote ourselves, rather than from a parameter Concept2 handed back. That is
 * what keeps this from being an open redirect while an authorization code is
 * live.
 *
 * A native authorization ends at the app's own URL scheme: the system browser
 * has no other way to give control back, and it is also the signal the app
 * watches for to go and ask what the server now knows.
 */
function finish(kind, outcome) {
  return kind === 'native' ? result(`${NATIVE_RETURN_URL}?integration=concept2&${outcome}`) : result(`/?integration=concept2&${outcome}`);
}

/*
 * Concept2's provider user id, learned OPPORTUNISTICALLY rather than required.
 *
 * WHOOP's callback asks a dedicated profile endpoint for the user id and fails
 * the whole connection without one. Concept2 has no such endpoint — nothing in
 * the verified research bundle (docs/research/concept2-logbook-bundle)
 * documents a profile call, and the only place the Logbook states a user's
 * identity is the `user_id` field on each logged result. So this peeks at ONE
 * result (`number: 1`) and takes the id from it if the athlete has ever logged
 * anything.
 *
 * Both failure shapes deliberately resolve to null instead of failing the
 * connection: a brand-new Logbook account has zero results and therefore no id
 * to give, and a transient error on this OPTIONAL lookup should not throw away
 * a token exchange that already succeeded. saveToken files a null id without
 * indexing it, and concept2-sync backfills the id (and the provider index)
 * from the first synced result — the id's only job here is that reverse index,
 * nothing else keys on it.
 */
async function resolveProviderUserId(token) {
  try {
    const page = await listConcept2Results(token, { number: 1 });
    const first = Array.isArray(page?.data) ? page.data[0] : null;
    const id = first?.user_id;
    return id === null || id === undefined || String(id).trim() === '' ? null : String(id);
  } catch (error) {
    console.error('[concept2-callback] provider user id lookup failed', error?.code || 'failed');
    return null;
  }
}

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  let kind = 'browser';
  try {
    const q = event.queryStringParameters || {};
    const state = typeof q.state === 'string' ? q.state.trim() : '';
    const sid = sessionFromEvent(event);
    // The state is spent here whatever happens next, and a browser-initiated
    // one must come back in the browser that started it (see pendingIsUsable).
    const pending = await consumePending('concept2', state, sid);
    if (!pending) return result('/?integration=concept2&status=error&message=invalid_oauth_state');
    kind = pending.kind;
    if (q.error) return finish(kind, 'status=denied');
    const code = typeof q.code === 'string' ? q.code.trim() : '';
    if (!code) return finish(kind, 'status=error&message=invalid_oauth_response');
    const token = await exchangeConcept2Code(code);
    const providerUserId = await resolveProviderUserId(token);
    await saveToken('concept2', pending.owner, token, providerUserId);
    await syncRecord('concept2', pending.owner, { provider: 'concept2', connectedAt: new Date().toISOString(), providerUserId });
    return finish(kind, 'status=connected');
  } catch (error) {
    console.error('[concept2-callback]', error?.code || 'failed');
    return finish(kind, 'status=error&message=connection_failed');
  }
}
