import { createStravaAuthUrl } from './_lib/strava.mjs';
import { newState, savePending } from './_lib/oauth.mjs';
import { connectNetlifyBlobs } from './_lib/store.mjs';
import { sessionFromEvent, sessionCookie } from './_lib/session.mjs';
import { redirect, safeError } from './_lib/http.mjs';
export async function handler(event) { connectNetlifyBlobs(event); try { const sid = sessionFromEvent(event); const state = newState(); await savePending('strava', state, sid); return redirect(createStravaAuthUrl(state), { 'set-cookie': sessionCookie(sid) }); } catch (error) { return redirect(`/?integration=strava&status=error&message=${encodeURIComponent(safeError(error))}`); } }
