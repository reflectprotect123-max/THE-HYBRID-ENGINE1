THE Hybrid System — Native Logger + Builder private PWA

This package contains the local-first training app. Open index.html for a
quick UI preview. To test installation and offline mode, serve this folder
from localhost or HTTPS; service workers do not run from file:// URLs.

Quick local test
1. Run: python3 -m http.server 4173
2. Visit: http://localhost:4173
3. On a supported browser, use the install affordance when it appears.

The app keeps the logger, calendar, history, backup and recovery layers intact
while using one canonical Training surface: Programs and Resources. Resources
contains the Exercise Library and Mobility Library.

Training behavior
- Training is the second navigation item after Home.
- Programs contains session templates and the Builder entry point.
- Resources contains Exercise Library and Mobility Library.
- Scheduled sessions remain snapshots so deleting a template does not delete
  logged history.
- RPE remains valid conditioning guidance and is not stripped during load.

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
