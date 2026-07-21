# THE Hybrid Engine — Build Tree

A complete, chronological record of how this build was produced, step by step,
from the pre-existing app to the package in this ZIP. Written 21 July 2026.
Every step below corresponds to a real git commit on `main` of
`reflectprotect123-max/THE-HYBRID-ENGINE1`, deployed continuously to
https://thehybridengine1.netlify.app.

---

## 0. Starting point (commit `ec6f354` — before this build)

What existed when work began:

- A functional PWA whose UI had **drifted away from the design mock**
  (`hybrid-engine-design-mock.html`) it was originally based on.
- A working backend that was to be preserved untouched throughout:
  six Netlify functions (`whoop-connect`, `whoop-callback`, `whoop-sync`,
  `whoop-webhook`, `integrations-status`, `integrations-disconnect`) plus
  `_lib` helpers — WHOOP OAuth, HMAC-verified webhooks, AES-GCM token
  encryption, Netlify Blobs storage.
- Optional Supabase cloud sync (email/password auth, one JSONB row per user
  under `app_state.hybridEngine` — see `supabase-schema.sql`).
- Local-first data in `localStorage` under key `hybrid-engine-v1`:
  `{ workouts, sessions, settings }`.
- **Accumulated debris**: a stale packaged duplicate of the whole app in
  `app/`, unreferenced `pwa.js` / `native-ui.css` / `integrations-ui.js` /
  `harness/`, two checks that tested code deleted weeks earlier, and repo
  checks that failed out of the box.

The instruction for the build: *the mock is not a reference — the app must
BE the mock, exactly, with the backend intact.*

---

## 1. Ground-up rebuild on the mock (`89d97cc`)

`index.html` rewritten end-to-end:

- **UI layer = the mock, verbatim.** The stylesheet was carried over
  byte-for-byte identical to `hybrid-engine-design-mock.html` (verified by
  diff: zero changed lines). Screens, markup structure, and copy match the
  mock: Home (welcome, week strip, session card, WHOOP mini-card), Training
  (block day view, superset group, prescription lines, gold finish button +
  confetti), Logger (per-mode set columns, targets, RPE felt, rest chip),
  Builder (collapsible blocks, five tracking modes, live prescription line).
- **Engine preserved underneath**: same `hybrid-engine-v1` storage shape
  (existing user data survives untouched), session snapshots with autosave,
  the "nameless template" seed for new workouts, Supabase cloud sync,
  server-side WHOOP via the existing functions, export/import/reset.
- Week strip switched to Sunday-first to match the mock.
- Logger's add/remove-set steppers removed (the mock has none; set counts
  belong to the Builder).
- Cleanup: deleted stale `app/` duplicate, `pwa.js`, `native-ui.css`, and
  two dead checks; rewrote `checks/native-pwa-smoke.mjs` for the real
  architecture; renamed/rewrote `readme.txt` with deployment env vars
  (`APP_BASE_URL`, `APP_SESSION_SECRET`, `WHOOP_CLIENT_ID`,
  `WHOOP_CLIENT_SECRET`) and the production WHOOP callback/webhook URLs.
- Service-worker cache bumped to v31.
- Verified with the repo checks plus a 16-step Playwright run in real
  Chromium (build → preview → log → rest timer → finish → strip update).

## 2. Audit pass (`8e4f89f`)

A deliberate re-audit of step 1 found and fixed three leftovers:

- `whoop-contract.mjs` and `whoop-deployment-smoke.mjs` still defaulted to
  the deleted `app/` folder when run without arguments → both now default
  to the repo root.
- The deployment check pinned the service-worker cache to a hardcoded
  packaging date (2026-07-15) → now accepts any dated `-vNN-YYYY-MM-DD`
  version, so releases don't go red.
- `BUILD-README.txt` still described the deleted architecture → rewritten.

Audit also confirmed: CSS byte-identical to the mock; only intentional
function removals; data model unchanged; backend byte-identical.

## 3. Feature day (`06daeb6`)

Everything from the agreed roadmap except Windows/Android packaging:

- **History**: every week-strip day is tappable → History screen with
  previous/next-day navigation showing each finished session's logged sets
  ("60kg × 12 @RPE 8").
- **Readiness**: Home card combining WHOOP recovery with the last week's
  target-vs-felt RPE gap into one plain-language advice line
  (green light / train as planned / pull back). Hidden until data exists.
- **Weekly scheduling**: "Train on" day chips in the Builder; Home orders
  today's scheduled session first, labels others by their days, says
  "Rest day" honestly; week strip rings upcoming planned days.
- **Rest timer**: persists its end-time (survives reload/screen-lock),
  recomputes from the wall clock, vibrates at zero.
- **Stale sessions**: unfinished sessions from previous days auto-file as
  "incomplete" history (with logged work) or are dropped (empty).
- **Logger**: kg input shows last time's weight as its placeholder.
- **Cloud sync**: "Forgot password?" reset flow (email + in-app update on
  the PASSWORD_RECOVERY event).
- **Calmer Builder**: identical set targets collapse to one "All sets" row
  with a "vary per set →" toggle; tempo/rest hidden behind a
  "+ tempo · rest" disclosure until used; added sets copy the previous
  set's RPE.
- **`checks/browser-smoke.mjs` committed**: an end-to-end Chromium suite
  with its own built-in static server (skips politely without playwright).
- Service worker v32.

## 4. WHOOP dual ring, details hidden (`a24ac28`)

Redesigned the Home WHOOP card to mirror the real WHOOP app:

- Inner ring = recovery in WHOOP's colors (green ≥67, yellow 34–66,
  red <34). Outer ring = strain in WHOOP blue (#0093e7), filling further
  around as the day's strain (0–21 scale) climbs.
- **Numbers hidden by default** (deliberate mental-load decision): the card
  shows only the rings. Tapping reveals recovery %, strain, HRV/RHR/sleep
  and the Readiness line; tapping again hides them. Always starts hidden.
- Settings access moved to the card's WHOOP chip.
- Service worker v33.

## 5. Dead-placeholder purge (`3903a19`)

- Deleted `harness/` (147 lines driving functions that no longer existed,
  with hardcoded paths from another machine) and `integrations-ui.js`
  (293 lines of the previous WHOOP settings panel that no page loaded).
- Repointed the contract/deployment checks at `index.html`, where the live
  WHOOP wiring actually is.
- Kept `integrations/whoop-adapter.js` on purpose: it is the browser-side
  WHOOP boundary contract that the security checks validate against
  (normalized fields only, no provider API, no secrets).

## 6. Training vs Logger, round one (`8a22fc3`)

First attempt at resolving the Training/Logger confusion — both tabs opened
the same session at different zoom levels:

- Training = the map; Logger tab became a guided runner that resumed at the
  next unfinished exercise, showed "exercise N of M", stepped
  Previous/Next, offered "Next exercise →" and in-place session finish.

## 7. Training vs Logger, final answer (`41f0e08`)

Back to the drawing board by request — the real fix was **fewer tabs**:

- **The Logger tab was deleted.** Nav is now Home · Training · Builder.
- The set-by-set logger survives as Training's detail view: tap an exercise
  row to open it; Previous/Next stepping, the "Next exercise →" hand-off,
  and in-place "Mark session complete" all remain. The Training tab stays
  highlighted while logging.
- Service worker v35.

---

## Final architecture (what's in this ZIP)

```
index.html                     The whole app: mock-exact UI + engine.
                               Single file: CSS (mock verbatim + marked
                               additions), 4 rendered screens in nav
                               (home/training/builder + settings/history/
                               logger as secondary screens), localStorage
                               engine, Supabase sync, WHOOP client wiring.
hybrid-engine-design-mock.html The original design mock (the source of truth).
service-worker.js              App-shell cache (v35), network-first,
                               never caches /.netlify/functions/*.
manifest.json, icons/          PWA install surface.
vendor/supabase-2.110.7.js     Vendored Supabase client (only external lib).
supabase-schema.sql            One-table cloud sync schema + RLS policies.
netlify.toml, _redirects,      Deploy config, privacy route, security
_headers                       headers (CSP allows self + supabase only).
privacy.html                   Privacy policy page.
netlify/functions/             The untouched backend: WHOOP OAuth
  whoop-connect/-callback/     (authorization-code + state, session-bound),
  -sync/-webhook,              HMAC-verified deduplicated webhook,
  integrations-status/         AES-GCM-encrypted tokens in Netlify Blobs,
  -disconnect, _lib/*          signed HttpOnly session cookie.
integrations/whoop-adapter.js  Browser-side WHOOP boundary contract
                               (test fixture for the checks).
checks/
  whoop-contract.mjs           115-assertion backend/security contract.
  whoop-deployment-smoke.mjs   Deploy packaging + function syntax checks.
  native-pwa-smoke.mjs         Manifest/SW/app-shell/behavior greps.
  browser-smoke.mjs            25-step headless-Chromium end-to-end suite
                               (own static server; needs `npm i -D playwright`).
readme.txt                     Run/deploy/verify instructions + env vars.
BUILD-README.txt               Feature-level description of the build.
changelog.md                   Human changelog, newest first.
BUILD-TREE.md                  This file.
```

### Data model (localStorage `hybrid-engine-v1`)

```
{
  workouts: [{ id, name, days?[0-6], blocks: [{ id, heading, minutes,
    format, superset, exercises: [{ id, name, mode, tempo, rest,
    sets: [{ t, rpe }] }] }] }],
  sessions: [{ id, workoutId, name, date 'YYYY-MM-DD',
    status 'active'|'completed'|'incomplete', startedAt, completedAt?,
    blocks: <workout snapshot + per-set { aVal, aVal2, felt, done }> }],
  settings: { seedV, ... }
}
```
Modes: `reps_kg`, `seconds`, `reps_seconds`, `reps`, `completion`.
Auxiliary keys: `hybrid-engine-v1-changedAt` (cloud-sync conflict clock),
`hybrid-engine-v1-rest-ends` (persistent rest timer).

### Verification (all green at packaging time)

```
node checks/whoop-contract.mjs
node checks/native-pwa-smoke.mjs
node checks/whoop-deployment-smoke.mjs
node checks/browser-smoke.mjs        # needs playwright installed
```

### Deploy

Netlify, repo root as publish dir, functions auto-bundled (esbuild).
Env vars required: APP_BASE_URL, APP_SESSION_SECRET, WHOOP_CLIENT_ID,
WHOOP_CLIENT_SECRET. Production: https://thehybridengine1.netlify.app

### Planned but intentionally NOT built yet (parked by decision)

- Android app (Trusted Web Activity wrap of the deployed site; sideload
  same-day, Play Store adds review time).
- Windows .exe (Tauri wrap; unsigned unless a code-signing cert is bought).
- Full training-block/progression layer (only simple weekly day-chips
  scheduling was built).
