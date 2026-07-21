THE Hybrid Engine — the design mock, made real (private PWA)

The app is the design mock (hybrid-engine-design-mock.html) built for real:
Home, Training, Logger and Builder render the mock's exact screens, backed by
a persistent local-first engine. Workouts, live sessions and history are
stored on-device (localStorage), with optional Supabase cloud sync and
server-side WHOOP recovery via Netlify functions.

Quick local test
1. Run: python3 -m http.server 4173
2. Visit: http://localhost:4173
3. Service workers and PWA install need localhost or HTTPS, not file://.

Screens
- Home: tappable week strip (each day opens History), today's scheduled
  session card, WHOOP recovery mini-card, and a Readiness line combining
  recovery with the last week's target-vs-felt RPE gap.
- Training: the day view — blocks, supersets, prescription lines, big
  "Mark session complete" button.
- Logger (opened by tapping an exercise in Training — no separate tab):
  set-by-set logging with per-mode columns (KG/Reps/Secs), RPE felt,
  targets per set, last-time box (and last kg as the input placeholder), and
  a rest chip that auto-starts on ✓, survives reload, and vibrates at zero.
- Builder: blocks, exercises, five tracking modes, "Train on" day chips,
  per-set targets with RPE (identical targets collapse to one "All sets"
  row), tempo/rest behind a disclosure, live prescription preview,
  "See how it looks →".
- History: any past day's completed or incomplete sessions with their
  logged sets, with previous/next-day navigation.
- Settings (via the sidebar note or WHOOP card): cloud sync sign-in with
  password reset, WHOOP connect/sync/disconnect, export/import backup,
  reset local data.

Deployment
Deploy the repository root through Netlify Git, the Netlify CLI, or the
Netlify API so netlify/functions is included. A static drag-and-drop upload
publishes the UI but does not activate the functions.

WHOOP deployment
- Set APP_BASE_URL to the exact HTTPS URL of the Netlify site
  (production: https://thehybridengine1.netlify.app).
- Set APP_SESSION_SECRET to a new random secret; keep it server-only.
- Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in Netlify environment variables.
- Register https://thehybridengine1.netlify.app/.netlify/functions/whoop-callback
  as the WHOOP redirect URL.
- Register https://thehybridengine1.netlify.app/.netlify/functions/whoop-webhook
  as the WHOOP webhook URL.
- Privacy policy URL: https://thehybridengine1.netlify.app/privacy.html
- Rotate any WHOOP secret that was ever pasted into chat, source, or a ZIP.
- After deploy, open Settings → WHOOP → Connect, then Sync.

The server stores encrypted provider tokens in Netlify Blobs. The browser and
service worker never receive or cache provider tokens.

Verification
From the repository root, run:

  node checks/native-pwa-smoke.mjs .
  node checks/whoop-contract.mjs .
  node checks/whoop-deployment-smoke.mjs .
  node checks/browser-smoke.mjs       (needs: npm i -D playwright)

This package is a private build artifact, not an access-control layer. Do not
put provider credentials or secrets in the browser, ZIP, or repository.
