import { isWhoopUnauthorized, revokeWhoopToken, whoopErrorResponse } from './_lib/whoop.mjs';
import { loadData, loadToken, removeToken } from './_lib/oauth.mjs';
import { ownerFromEvent, authErrorResponse } from './_lib/identity.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { json, method } from './_lib/http.mjs';

export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['POST']);
  if (denied) return denied;
  const provider = event.queryStringParameters?.provider;
  if (provider !== 'whoop' && provider !== 'concept2') return json({ error: 'invalid_provider' }, 400);
  let owner;
  try {
    ({ owner } = await ownerFromEvent(event));
  } catch (error) {
    const response = authErrorResponse(error);
    return json(response.body, response.status);
  }
  if (provider === 'concept2') {
    // Unlike WHOOP below, there is no provider-side revocation call here on
    // purpose: Concept2's documented API (docs/research/concept2-logbook-bundle)
    // has NO token-revocation endpoint, so removing our stored records is the
    // whole operation.
    const data = await loadData('concept2', owner);
    await removeToken('concept2', owner, data?.providerUserId);
    return json({ ok: true, provider: 'concept2' });
  }
  const data = await loadData('whoop', owner);
  const token = await loadToken('whoop', owner);
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
  await removeToken('whoop', owner, data?.providerUserId || token?.athlete?.id);
  return json({ ok: true, provider: 'whoop' });
}
