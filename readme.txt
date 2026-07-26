THE Hybrid System — local-first training PWA + coach website

Two entities share one Supabase project:
  1. The athlete app (repo root) — a local-first PWA. Workouts, live sessions
     and history live on-device (localStorage), with optional cloud sync and
     server-side WHOOP recovery via Netlify functions. Wrapped as an Android
     app (native/android-app) that adds BLE heart rate, on-device OCR, voice
     input and a step counter.
  2. The coach website (coach/) — a desktop builder served in place at
     /coach/. Authors programs -> weeks -> days -> sessions and publishes them
     to an athlete's calendar. See coach/GO-LIVE.md.

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
- Logger: not a separate screen — every exercise in Training is a row that
  expands in place into a set-by-set accordion, with per-mode columns
  (KG/Reps/Secs), RPE felt, per-set targets and notes, a last-time line (last
  kg becomes the input placeholder), a plate calculator, exercise swap, and a
  rest chip that auto-starts on ✓, survives reload, and vibrates at zero.
- Library: saved sessions, conditioning formats, progress and per-exercise
  history, behind one tab with sub-tabs.
- Calendar: month grid — schedule sessions ahead, see planned vs trained days.
  Long-press any session card (Home or Library) for Move / Delete.
- Import (Builder > "Import from text or photo"): paste any written
  workout — or attach a screenshot/photo, read on-device by a bundled
  OCR engine — and it parses into a template. It asks only about genuine
  ambiguity (inline, in the draft), learns your shorthand into a synced,
  editable lexicon, and opens the result in the Builder.
- Builder: blocks, exercises, six tracking modes (incl. Max reps / AMRAP), "Train on" day chips,
  per-set targets with RPE (identical targets collapse to one "All sets"
  row), tempo/rest behind a disclosure, live prescription preview,
  "See how it looks →".
- Conditioning: live heart-rate zone training. Connect WHOOP via its
  Bluetooth HR Broadcast (Chrome on Android / desktop — Web Bluetooth),
  pick a format (steady-state Zone 2, 8x30/90 intervals, 10x15/60 tempo),
  then train against a live zone gauge, big BPM, phase/round timer with
  vibration cues, and a live zone-colored HR line. Finishing saves the
  session (downsampled trace, capped at 40) and shows results: zone-time
  donut, whole-session HR graph colored by zone, max/avg HR, 60s HR
  recovery, and estimated calories. Zones derive from max HR (220-age or
  a tested override — Settings > Training profile). A simulated-HR demo
  runs anywhere, no band needed.
- Progress: everything you log turned into trends — stat tiles (sessions,
  kg this week, day streak), an 8-week training-volume bar chart, a
  planned-vs-felt RPE two-line chart, and a 14-day WHOOP recovery line.
  All drawn as inline SVG (no libraries, CSP-safe) with hover tooltips;
  shows a calm empty state until the first session is finished.
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
- Set SUPABASE_URL to the project URL (the same one in packages/config, e.g.
  https://orysjncrksmdfabpuftd.supabase.co). Public; it is only used to pin the
  expected token issuer and to fetch the published signing keys.
- SUPABASE_JWT_SECRET is NOT NEEDED for this project and is deliberately unset.
  Settings -> JWT Keys shows the current signing key as ECC (P-256), i.e. ES256,
  with the legacy HS256 key demoted to "previous". Asymmetric keys publish their
  public half at <SUPABASE_URL>/auth/v1/.well-known/jwks.json, which the server
  fetches on its own, so SUPABASE_URL alone is sufficient. The variable is still
  read, and the HS256 branch still works, for a project that has not migrated —
  set it only if Settings -> JWT Keys shows HS256 as the CURRENT key.
- SUPABASE_URL is REQUIRED FOR THE ANDROID/iOS APP and unused by the browser. The phone hands WHOOP's consent screen to the system browser,
  which has a separate cookie jar, so a session cookie can never identify it;
  the app authenticates with its Supabase access token instead and the server
  verifies that token here. Without these two variables the app's WHOOP calls
  fail loudly with supabase_auth_unconfigured; the web flow is unaffected.
- Register https://thehybridengine1.netlify.app/.netlify/functions/whoop-callback
  as the WHOOP redirect URL.
- Register https://thehybridengine1.netlify.app/.netlify/functions/whoop-webhook
  as the WHOOP webhook URL.
- Privacy policy URL: https://thehybridengine1.netlify.app/privacy.html
- Rotate any WHOOP secret that was ever pasted into chat, source, or a ZIP.
- Nothing extra is registered with WHOOP for the phone: the redirect URL above
  is still the only one. Once the callback has the tokens it bounces the system
  browser to hybridengine://whoop (apps/mobile/app.json -> expo.scheme), which
  is what returns the athlete to the app.
- After deploy, open Settings → WHOOP → Connect, then Sync.

The server stores encrypted provider tokens in Netlify Blobs. The browser and
service worker never receive or cache provider tokens.

Verification
From the repository root, run:

  node checks/native-pwa-smoke.mjs .
  node checks/whoop-contract.mjs .
  node checks/whoop-deployment-smoke.mjs .
  node checks/browser-smoke.mjs       (needs: npm i -D playwright)
  node checks/torture.mjs             (edge cases / abuse of the session engine)
  node checks/pentest.mjs             (adversarial; needs playwright for the browser half)
  node checks/emit-contract.mjs       (coach -> phone shape contract; dual-mode)
  node checks/coach-smoke.mjs         (the coach builder, fully offline)

All eight should pass before shipping. The last two are the only automated
coverage of the coach entity.

This repository is not an access-control layer. Do not put provider
credentials or secrets in the browser or the repository.
