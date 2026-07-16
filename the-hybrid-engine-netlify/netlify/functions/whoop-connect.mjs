import { createWhoopAuthUrl, WHOOP_STATE_LENGTH } from './_lib/whoop.mjs';
import { newState, savePending } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { sessionFromEvent, sessionCookie } from './_lib/session.mjs';
import { method, redirect } from './_lib/http.mjs';

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  try {
    const sid = sessionFromEvent(event);
    const state = newState(WHOOP_STATE_LENGTH);
    const location = createWhoopAuthUrl(state);
    await savePending('whoop', state, sid);
    return redirect(location, { 'cache-control': 'no-store', 'set-cookie': sessionCookie(sid) });
  } catch (error) {
    console.error('[whoop-connect]', error?.code || 'failed');
    return redirect('/?integration=whoop&status=error&message=connection_unavailable', { 'cache-control': 'no-store' });
  }
}
