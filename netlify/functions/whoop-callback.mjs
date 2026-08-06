import { exchangeWhoopCode, whoopFetch } from './_lib/whoop.mjs';
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
 * wrote ourselves, rather than from a parameter WHOOP handed back. That is what
 * keeps this from being an open redirect while an authorization code is live.
 *
 * A native authorization ends at the app's own URL scheme: the system browser
 * has no other way to give control back, and it is also the signal the app
 * watches for to go and ask what the server now knows.
 */
function finish(kind, outcome) {
  return kind === 'native' ? result(`${NATIVE_RETURN_URL}?${outcome}`) : result(`/?integration=whoop&${outcome}`);
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
    const pending = await consumePending('whoop', state, sid);
    if (!pending) return result('/?integration=whoop&status=error&message=invalid_oauth_state');
    kind = pending.kind;
    if (q.error) return finish(kind, 'status=denied');
    const code = typeof q.code === 'string' ? q.code.trim() : '';
    if (!code) return finish(kind, 'status=error&message=invalid_oauth_response');
    const token = await exchangeWhoopCode(code);
    const profile = await whoopFetch('/user/profile/basic', token.access_token);
    const providerUserId = profile?.user_id ?? profile?.id;
    if (providerUserId === null || providerUserId === undefined || String(providerUserId).trim() === '') throw new Error('WHOOP profile did not include a user id');
    await saveToken('whoop', pending.owner, token, providerUserId);
    await syncRecord('whoop', pending.owner, { provider: 'whoop', connectedAt: new Date().toISOString(), providerUserId, profile: { firstName: profile.first_name || '', lastName: profile.last_name || '' } });
    return finish(kind, 'status=connected');
  } catch (error) {
    console.error('[whoop-callback]', error?.code || 'failed');
    return finish(kind, 'status=error&message=connection_failed');
  }
}
