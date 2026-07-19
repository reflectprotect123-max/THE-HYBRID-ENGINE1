import { isWhoopUnauthorized, revokeWhoopToken, whoopErrorResponse } from './_lib/whoop.mjs';
import { loadData, loadToken, removeToken, sessionFromEvent } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { json, method } from './_lib/http.mjs';

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['POST']);
  if (denied) return denied;
  const provider = event.queryStringParameters?.provider;
  if (provider !== 'whoop') return json({ error: 'invalid_provider' }, 400);
  const sid = sessionFromEvent(event);
  const data = await loadData('whoop', sid);
  const token = await loadToken('whoop', sid);
  if (token?.access_token) {
    try {
      await revokeWhoopToken(token.access_token);
    } catch (error) {
      if (!isWhoopUnauthorized(error)) {
        const response = whoopErrorResponse(error, 'revoke_failed');
        return json(response.body, response.status, response.headers);
      }
    }
  }
  await removeToken('whoop', sid, data?.providerUserId || token?.athlete?.id);
  return json({ ok: true, provider: 'whoop' });
}
