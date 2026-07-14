THE Hybrid System — Native Logger + Builder private PWA

This package contains the local-first training app. Open index.html for a
quick UI preview. To test installation and offline mode, serve this folder
from localhost or HTTPS; service workers do not run from file:// URLs.

Quick local test
1. Run: python3 -m http.server 4173
2. Visit: http://localhost:4173
3. On a supported browser, use the install affordance when it appears.

The app keeps the existing training model and persistence layer intact while
adding a native-feeling mobile shell, focused Logger/Builder flows, install
prompt handling, offline status, safe PWA updates, and a cache that excludes
authenticated integration functions.

Builder
- Strength and Conditioning are separate flows.
- Strength supports sets, reps, reps per side, rep ranges, AMRAP, %1RM,
  seconds, for-completion targets, rest, side, and tempo/hold prescriptions.
- Conditioning supports minutes, seconds, distance, calories, rounds, and
  for-completion targets.
- Builder intentionally has no load/kilos field or previous-best panel.

Logger
- Strength logging is set-by-set with load and reps.
- Easy aerobic and Intervals have separate result fields.
- Completed sets start the rest timer automatically, with manual duration
  controls still available. Workout timer, autosave, active-session recovery,
  and history remain enabled.

Deployment
Deploy the package through Netlify Git, the Netlify CLI, or the Netlify API
with the app folder as the publish root. Netlify functions are included under
netlify/functions; a static drag-and-drop upload publishes the UI but does not
activate the functions.

WHOOP deployment
- Set APP_BASE_URL to the exact HTTPS URL of the Netlify site.
- Set APP_SESSION_SECRET to a new random secret; keep it server-only.
- Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in Netlify environment variables.
- Register APP_BASE_URL/.netlify/functions/whoop-callback as the WHOOP redirect.
- Register APP_BASE_URL/.netlify/functions/whoop-webhook as the WHOOP webhook.
- Rotate any WHOOP secret that was ever pasted into chat, source, or a ZIP.
- After deploy, use Settings → Connected data → WHOOP → Connect, then run Sync.

The server stores encrypted provider tokens in Netlify Blobs. The browser and
service worker never receive or cache provider tokens.

Verification
From the source workspace, run:

  node checks/native-pwa-smoke.mjs
  node checks/whoop-contract.mjs

This package is a private build artifact, not an access-control layer. Do not
put provider credentials or secrets in the browser, ZIP, or repository.
