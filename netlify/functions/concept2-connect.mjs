import { createConcept2AuthUrl, CONCEPT2_STATE_LENGTH } from './_lib/concept2.mjs';
import { newState, savePending } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { sessionFromEvent, sessionCookie } from './_lib/session.mjs';
import { ownerFromEvent, authErrorResponse, SupabaseAuthError } from './_lib/identity.mjs';
import { NATIVE_RETURN_URL } from './_lib/config.mjs';
import { json, method, redirect } from './_lib/http.mjs';

/*
 * Starting a Concept2 Logbook authorization — the Concept2 twin of
 * whoop-connect.mjs, and deliberately shaped exactly like it.
 *
 * Two shapes, chosen by an explicit `?client=native` rather than by sniffing
 * the request, because the response shape is a contract and not a guess:
 *
 *  - Browser (no flag): a 302 into Concept2's consent screen with the session
 *    cookie set, because the handshake has to happen in the address bar where
 *    the athlete can see who they are trusting.
 *  - Native (`?client=native`): JSON carrying the authorize URL, which the app
 *    opens itself. It must be JSON because the app has to send an Authorization
 *    header to say who it is, and a browser navigation cannot carry one — the
 *    alternative, putting the token in the query string, writes a live
 *    credential into Concept2's logs and the device's browser history.
 *
 * The native path REQUIRES a verified Supabase user. There is no anonymous
 * native connect: without a verified identity there is nothing to attribute the
 * tokens to when the callback arrives in a browser we will never see again.
 */
export async function handler(event) {
  connectNetlifyBlobs(event);
  const denied = method(event, ['GET']);
  if (denied) return denied;
  const native = event.queryStringParameters?.client === 'native';
  try {
    const sid = sessionFromEvent(event);
    const identity = native ? await ownerFromEvent(event) : { kind: 'browser', owner: sid, sid };
    if (native && identity.kind !== 'user') return json({ error: 'authentication_required' }, 401, { 'cache-control': 'no-store' });

    // CONCEPT2_STATE_LENGTH is 32, not WHOOP's 8 — 8 is a WHOOP-imposed
    // constraint, and Concept2 documents none, so it gets newState's full
    // default length. createConcept2AuthUrl checks the length loudly.
    const state = newState(CONCEPT2_STATE_LENGTH);
    const location = createConcept2AuthUrl(state);
    await savePending('concept2', state, identity);

    // The app is told where the browser will hand control back so it can watch
    // for exactly that URL; it is a constant here, never an argument, so no
    // caller can point the callback anywhere.
    if (native) return json({ authorizeUrl: location, returnUrl: NATIVE_RETURN_URL }, 200, { 'cache-control': 'no-store' });
    return redirect(location, { 'cache-control': 'no-store', 'set-cookie': sessionCookie(sid) });
  } catch (error) {
    console.error('[concept2-connect]', error?.code || 'failed');
    if (native) {
      const response = error instanceof SupabaseAuthError ? authErrorResponse(error) : { status: 500, body: { error: 'connection_unavailable' } };
      return json(response.body, response.status, { 'cache-control': 'no-store' });
    }
    return redirect('/?integration=concept2&status=error&message=connection_unavailable', { 'cache-control': 'no-store' });
  }
}
