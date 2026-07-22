THE Hybrid Engine — mock-exact private PWA build

The app is hybrid-engine-design-mock.html made real: index.html renders the
mock's screens (Home, Training, Builder in the nav; the Logger opens as Training's detail view) on top of a
persistent local-first engine. For a quick preview, open index.html in a
browser. For install/offline behavior, serve from HTTPS or localhost; browsers
do not allow service workers or PWA installation from file:// URLs.

The app is local-first. "Private" here means the training log stays in the
browser unless you sign into cloud sync, use an integration, or export a
backup; it does not make a public web host private by itself.

Home
- Welcome header, Sunday-first week strip (today highlighted, trained days
  ringed), today's session card with ~minutes / RPE-based / Tempo work chips,
  and the WHOOP recovery mini-card (conic ring · HRV · RHR · Sleep).

Training
- The mock's day view: blocks with headings, minutes and format lines,
  superset groups with "Mark round complete", prescription lines
  (e.g. 4 × 12/10/8/8 · RPE 7→10 · @30X1 · rest 3:00), and the gold
  "Mark session complete" button with confetti.

Logger (opened from an exercise row in Training; steps Previous/Next through the session)
- Set-by-set logging with per-mode columns: Reps + Kilos, Max reps,
  Seconds, Reps + Seconds, Reps only, For completion.
- Per-set targets, an "RPE felt" column, a "Last time" history box, and a
  rest chip that auto-starts when a set is ticked (tap to stop). Set counts
  are edited in the Builder — the Logger has no add/remove-set controls,
  matching the mock.

Builder
- Collapsible blocks with minutes/format/superset, exercises with the six
  tracking modes (including Max reps for AMRAP work — every set at max,
  or type "max" as any single set's target), tempo and rest fields, per-set targets with RPE, a live
  prescription preview line, and "See how it looks →" into the Training view.
- "+ New workout" always starts from the full nameless template frame.

Engine
- localStorage key hybrid-engine-v1: workouts, live sessions (autosaved
  set-by-set), completed history, settings. Active-session recovery on reload.
- Optional Supabase cloud sync (email/password) storing the same state under
  app_state.hybridEngine — see supabase-schema.sql.
- WHOOP stays server-side behind Netlify functions; the browser only ever
  sees normalized recovery samples.
- Service worker caches only the static app shell; authenticated function
  routes are never cached. Updates are picked up via a dated cache version.

Deployment
- Netlify: deploy the repository root through Git, the Netlify CLI, or the
  Netlify API so `netlify/functions` is included. A static upload does not
  activate server functions.
- Set `APP_BASE_URL`, `APP_SESSION_SECRET`, `WHOOP_CLIENT_ID`, and
  `WHOOP_CLIENT_SECRET` as Netlify environment variables. Register the WHOOP
  callback and webhook URLs under `APP_BASE_URL/.netlify/functions/`.
- Rotate any provider secret that was previously exposed. Never put secrets in
  this ZIP, the browser, or a public repository.
- Local PWA test: run `python3 -m http.server 4173` from the repository root,
  then visit http://localhost:4173.
- Run `node checks/native-pwa-smoke.mjs`, `node checks/whoop-contract.mjs`
  and `node checks/whoop-deployment-smoke.mjs` from the repository root
  before shipping.
