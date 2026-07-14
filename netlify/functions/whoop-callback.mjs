import { exchangeWhoopCode, whoopFetch } from './_lib/whoop.mjs';
import { consumePending, saveToken, syncRecord } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { method, redirect } from './_lib/http.mjs';
import { sessionFromEvent } from './_lib/session.mjs';

function result(location) {
  return redirect(location, { 'cache-control': 'no-store' });
}

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  try {
    const q = event.queryStringParameters || {};
    const state = typeof q.state === 'string' ? q.state.trim() : '';
    const sid = sessionFromEvent(event);
    const pending = await consumePending('whoop', state, sid);
    if (!pending) return result('/?integration=whoop&status=error&message=invalid_oauth_state');
    if (q.error) return result('/?integration=whoop&status=denied');
    const code = typeof q.code === 'string' ? q.code.trim() : '';
    if (!code) return result('/?integration=whoop&status=error&message=invalid_oauth_response');
    const token = await exchangeWhoopCode(code);
    const profile = await whoopFetch('/user/profile/basic', token.access_token);
    const providerUserId = profile?.user_id ?? profile?.id;
    if (providerUserId === null || providerUserId === undefined || String(providerUserId).trim() === '') throw new Error('WHOOP profile did not include a user id');
    await saveToken('whoop', pending.sid, token, providerUserId);
    await syncRecord('whoop', pending.sid, { provider: 'whoop', connectedAt: new Date().toISOString(), providerUserId, profile: { firstName: profile.first_name || '', lastName: profile.last_name || '' } });
    return result('/?integration=whoop&status=connected');
  } catch (error) {
    console.error('[whoop-callback]', error?.code || 'failed');
    return result('/?integration=whoop&status=error&message=connection_failed');
  }
}
