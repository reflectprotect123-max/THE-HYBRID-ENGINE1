THE — Hybrid System
Native Logger + Builder private PWA package

Production deployment target: https://thehybridengine1.netlify.app

Upload the ZIP contents to the site root. The app is local-first and stores workouts in the browser.
Direct file opening is suitable for a UI preview only; installability and offline
behavior require HTTPS or localhost.

Primary flow: Home → Library → Calendar → Settings.
Build or edit a workout in Builder, schedule it, then log the session.

Conditioning supports Easy aerobic and Intervals. Strength sessions record sets, reps, weight and notes.

Export a backup before changing devices or clearing browser data.

Public privacy policy: https://thehybridengine1.netlify.app/privacy.html

Completed sessions keep strength volume separate from conditioning internal
load. Conditioning alternatives are normalized to a primary modality plus
options. Optional WHOOP and Strava connections are handled by the server-side
Netlify functions when deployed with functions enabled; provider credentials and
tokens are not stored in this package or in browser local app state.

Production integration endpoints (register these exact HTTPS URLs):
WHOOP OAuth callback / Redirect URL: https://thehybridengine1.netlify.app/.netlify/functions/whoop-callback
WHOOP webhook: https://thehybridengine1.netlify.app/.netlify/functions/whoop-webhook
Strava OAuth callback: https://thehybridengine1.netlify.app/.netlify/functions/strava-callback
Strava webhook: https://thehybridengine1.netlify.app/.netlify/functions/strava-webhook

This app directory is the Netlify base/deployment root. Keep the publish
directory as `.` and the Functions directory as `netlify/functions`; the
checked-in `netlify.toml` makes both paths explicit. Deploy through Netlify
Git, the Netlify CLI, or the Netlify API. A static drag-and-drop upload will
publish the UI but will not activate server functions.

Set these exact Netlify environment variables with the Functions runtime
scope (values are never stored in this package):
APP_BASE_URL=https://thehybridengine1.netlify.app
APP_SESSION_SECRET=<long random secret>
WHOOP_CLIENT_ID=<WHOOP Client ID>
WHOOP_CLIENT_SECRET=<WHOOP Client Secret and webhook signing secret>
STRAVA_CLIENT_ID=<Strava Client ID>
STRAVA_CLIENT_SECRET=<Strava Client Secret>
STRAVA_WEBHOOK_VERIFY_TOKEN=<Strava webhook verify token>

Set `APP_BASE_URL` explicitly, without a trailing slash, so callback and
webhook URLs use the production target even if Netlify's automatic `URL`
value or a site alias differs. The function code does not read a separate
`WHOOP_WEBHOOK_SECRET` variable.

The functions are ES modules and require Node 18 or newer. For a deterministic
current Netlify runtime, set `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` in the Netlify
UI, CLI, or API with the Functions scope, then redeploy. This runtime setting
belongs in Netlify environment configuration, not in `netlify.toml`.

WHOOP dashboard steps: add the OAuth Redirect URL above; add the webhook URL
above and select webhook model v2 to match the v2 API used by the functions;
then copy the app Client ID and Client Secret into the matching Netlify
variables. A WHOOP user must complete OAuth before webhook events can be
delivered. Do not enable site-wide Netlify Password Protection on this
production site while provider callbacks/webhooks need public access; protect
previews instead or use a separate public integration endpoint.
