# Migration to a unified React ecosystem

Status of the move from three buildless front-ends to one React/React Native
workspace sharing a single engine.

## What exists now

```
packages/config     Supabase + function endpoints, one source for all apps
packages/engine     pure TypeScript. No DOM, no globals, no storage.
packages/design     tokens → Tailwind (web) + NativeWind (native), 8px grid
apps/web            athlete PWA — React 19 + Vite + Tailwind v4
apps/coach          coach builder — React 19 + Vite + Tailwind v4
apps/mobile         Android app — Expo SDK 54, RN 0.81, React 19
```

The vanilla app (`index.html`, `app.js`, `coach/`) is **still present and still
serving the site**. Nothing has been deleted. The React apps build to their own
`dist/` and are not yet wired into the Netlify publish.

## The 8px grid

Enforced by construction rather than by review. Tailwind's `--spacing` base is
set to `8px` in `packages/design/src/tokens.css`, so every spacing utility
resolves to a multiple of 8: `p-1` = 8px, `gap-2` = 16px, `mt-3` = 24px. The
NativeWind config uses the same scale. `p-0.5` (4px) is the only sanctioned
sub-grid step and is written to stand out in review.

## Verification

| What | How | Result |
|---|---|---|
| Engine matches the shipped app | 1,296 golden vectors harvested from the live `app.js` in a real browser (`checks/golden-vectors.mjs`) | 71 tests pass |
| Sync rules | `packages/engine/test/cloud.test.ts` — assignment reconcile, push/pull merge, coach digest bounds | included above |
| The coach→athlete boundary | `packages/engine/test/emit.test.ts` — every forbidden set key is refused | included above |
| The importer | `packages/engine/test/importer.test.ts` — 19 harvested parse cases plus the lexicon | included above |
| React apps actually run | `checks/react-smoke.mjs` serves the built output and drives both apps in Chromium | 26 checks pass |
| Types | `pnpm -r typecheck` across all six packages | clean |
| The vanilla app still works | the six original suites | all pass |
| CSP | built HTML contains zero inline `<script>`; `checks/pentest.mjs` still holds | 22 attacks, 0 findings |

### Regenerating the golden vectors

`node checks/golden-vectors.mjs`

Do this **only** when you have deliberately changed behaviour. The fixtures are
the record of what the shipped app does; regenerating them to make a test pass
is how a silent behaviour change gets shipped.

## Data migration

- **Athlete web** — none needed. The React app reads the same origin, the same
  `hybrid-engine-v1` key, and the same shape, through the same `sanitizeDB`.
- **Coach web** — none needed for current data. `migrateLib` in
  `apps/coach/src/model.ts` additionally reads *pre-blocks* libraries forward
  (a flat `exercises` array with spreadsheet `cols`/`sets` rows), folding any
  weight column into the exercise cue since a planned set has no load field.
- **Mobile** — a genuine gap. The old Android app was a WebView, so an existing
  user's history lives in that WebView's localStorage, which a native app
  cannot read. The migration route is Supabase sync, or Settings → export a
  backup on the web and import it on the phone.

## The four native bridges

The old `native/android-app/MainActivity.java` (649 lines) hung four
`@JavascriptInterface` objects on `window`. `apps/mobile/src/native/capabilities.ts`
replaces them:

| Old bridge | React Native replacement |
|---|---|
| `AndroidHR` — BLE scan/connect/notify, keepAwake, saveFile, scheduleBuzz | `react-native-ble-plx` (HR service `0x180D`), `expo-keep-awake`, `expo-notifications` |
| `AndroidOCR` — ML Kit text recognition | not yet ported — see below |
| `AndroidVoice` — SpeechRecognizer | not yet ported — see below |
| `AndroidSteps` — hardware step counter | `expo-sensors` Pedometer |

## Cloud, WHOOP and the coach loop

Wired and building; the rules are unit-tested, the network paths are not.

- **Auth + sync** (`apps/web/src/cloud/sync.tsx`): pull merges by record, push
  merges against whatever the remote already holds, coach materialisations are
  stripped from both sides of the push, assignments reconcile separately, and
  the coach digest publishes only when a link is active.
- **WHOOP** (`apps/web/src/cloud/whoop.tsx`): status/sync/disconnect through the
  existing Netlify functions; connect is a full-page redirect because the OAuth
  handshake has to happen in the address bar. A failed status call degrades to
  "not connected" — the smoke test asserts the screen still works.
- **Coach publishing** (`apps/coach/src/cloud.tsx`): writes a session SNAPSHOT
  to `assignments`, idempotent per athlete/date. Signed out, the button
  degrades to validate-only so a coach still learns whether the session would
  cross the boundary cleanly.

## What is NOT done

Stated plainly, because a green build is not a finished migration.

1. **The Android app has never been built or run.** There is no Android SDK in
   this environment and EAS needs an account. `pnpm --filter @hybrid/mobile
   typecheck` passes; `eas build --platform android --profile preview` has not
   been attempted. **BLE, notifications and the pedometer are unverified against
   real hardware** — they cannot be verified any other way.
2. **No sync path has touched a real Supabase project.** Every rule is unit
   tested against fixtures and the UI is driven in a browser, but no request has
   been made: not a sign-in, not a push, not an assignment. The first real
   round-trip is the next thing to do, and it is the one that finds schema and
   RLS mismatches.
3. **Photo OCR is Android-only.** The parser is shared, but on the web the
   Photo button explains that rather than doing it — the ML Kit model ships
   with the native app. Dictation works on the web through the Web Speech API
   (Chromium).
4. **The mobile app now carries all twelve screens** — the same set as web.
   What still differs is the *capabilities* behind them, per point 3.
5. **The web is cut over.** `netlify.toml` publishes `apps/web/dist` with the
   coach app folded in at `/coach/`. The pre-React `index.html` and `app.js`
   remain in the tree as the rollback path. See **Deploying** below.

## Still outstanding before this is finished

The web cutover is done. These are not, and none of them can be verified from a
terminal:

- Sign in against the real project and drive one full loop: coach publishes →
  athlete pulls the assignment → athlete logs it → coach sees the digest. Then
  diff a real synced account old-vs-new against the same seeded DB.
- Build the Android app on EAS with the **existing keystore** and
  `applicationId com.hybridengine.app` at a versionCode above 27 — get any of
  those wrong and current users get a second app icon instead of an update.
- Test on a real device with a real HR strap: a logged session must round-trip
  to Supabase and appear in the coach view.
- Only once that EAS build has shipped and been verified, retire
  `native/android-app/`.
- **WHOOP OAuth does not work on mobile.** The Netlify functions identify a
  connection solely by a signed HttpOnly `hybrid_sid` cookie, and
  `Linking.openURL` hands the flow to the system browser, which has a separate
  cookie jar. The fix is to key WHOOP tokens by the Supabase `user_id` instead,
  which means editing `netlify/functions/**` — deliberately untouched by this
  migration.

## Deploying

The site **is** the React monorepo. `netlify.toml` publishes `apps/web/dist`,
with the coach app served from `/coach/` inside it. The pre-React `index.html`
and `app.js` are still in the tree — they are the rollback path — but they are
no longer what deploys.

### What runs in CI

`.github/workflows/ci.yml` runs on every push and pull request: pnpm + Node 22
(pnpm store cached), `pnpm install --frozen-lockfile`, then the same package.json
scripts a human runs — `typecheck`, `test`, `build`, `build-site`, `check:csp` —
followed by Playwright Chromium, `checks/react-smoke.mjs`, `checks/deploy-smoke.mjs`,
and the suites that need no network (`emit-contract`, `pentest`,
`native-pwa-smoke`, `supabase-contract`, `whoop-contract`,
`whoop-deployment-smoke`).

Locally that whole sequence is one command:

```
pnpm run verify
```

Three things worth knowing about it:

- **`check:csp` is a build gate, not a lint.** It fails if either built
  `index.html` contains a `<script>` without a `src`. The deployed CSP is
  `script-src 'self' 'wasm-unsafe-eval'` with no `'unsafe-inline'`, so one
  inline script — a Vite modulepreload polyfill, a PWA registration snippet —
  renders a blank page in production while dev stays green. `vite build` cannot
  catch that. This can.
- **`smoke:deploy` tests the publish directory, not the source.** It serves
  `apps/web/dist` the way Netlify will and boots both apps in Chromium. See
  below for why that is a separate check.
- **Playwright is not a workspace dependency.** The checks import it optionally
  and skip cleanly without it, which is what lets them run on a machine with no
  browser. CI installs it explicitly *and fails the build if any check reports a
  skipped browser section*, so a missing browser can never masquerade as a pass.

### How the publish directory is assembled

Netlify publishes exactly **one** directory. `scripts/build-site.mjs` assembles
everything the origin must serve into `apps/web/dist`, and `netlify.toml` calls
it as part of the build command. Every copy it makes is a live bug if dropped:

| Copy | Why |
|---|---|
| `apps/coach/dist` → `apps/web/dist/coach` | the only way `/coach` exists at all |
| `icons/ fonts/` | `apps/web` has **no `public/` directory**, so its dist ships neither — yet the built `index.html` preloads `/fonts/inter-var.woff2` and the generated `manifest.webmanifest` points at `/icons/icon-192.png` and `/icons/icon-512.png`. Without this the PWA has no icon and is not installable |
| `.well-known/assetlinks.json` | verifies `com.hybridengine.app` for Android App Links; lose it and the installed Android app starts showing a browser address bar |
| `privacy.html` | the Play listing links to it |
| `_headers` and `_redirects` | **Netlify reads these from the publish directory, not the repo root.** Once `publish` stops being `"."` they must be copied in or the CSP and every redirect silently vanish. The site still *works* — which is exactly what makes this the easiest mistake to ship |
| `service-worker.js` (a tombstone) | see **Service-worker handover** below |

They stay at the repo root too: `checks/pentest.mjs` reads `_headers` from
there, so each is a copy, never a move.

The script then **fails the build** if anything the built HTML or the manifest
references is missing from the output. A missing icon otherwise ships silently —
the page still renders.

`apps/coach` is built with `base: '/coach/'` (`apps/coach/vite.config.ts`), so
every URL it emits is already `/coach/assets/…`. That is what makes the fold-in
work: the coach app is served at `/coach/` as *real files*, which Netlify serves
ahead of the athlete app's `/* /index.html 200` fallback. No second site, no
proxy.

Two rewrites keep `/coach/` intact, and both are load-bearing:

- `[[redirects]] from = "/coach/*" to = "/coach/index.html" status = 200` lives
  in **`netlify.toml`, not `_redirects`**, because netlify.toml rules are
  evaluated *before* the `_redirects` file. That ordering is the only thing that
  makes it win over `/* /index.html 200`.
- `navigateFallbackDenylist: [/^\/\.netlify\//, /^\/coach(\/|$)/]` in
  `apps/web/vite.config.ts` stops the athlete *service worker* answering
  `/coach/` navigations with the athlete shell. Netlify getting it right does
  not help once the worker owns the origin.

### Service-worker handover

Everyone already running the app has `/service-worker.js` registered. The React
build uses Workbox at `/sw.js`. If the old path simply 404s, browsers keep the
last worker they successfully fetched — installed clients would sit on the old
cache indefinitely.

So the build writes a **tombstone** at the old path: it takes control, deletes
the caches the old worker created, unregisters itself and reloads. The page then
registers the new worker normally. It is generated in `scripts/build-site.mjs`
rather than committed, so it cannot drift from the cache prefix it deletes.

### Verifying a deploy

`pnpm run smoke:deploy` covers most of this locally — it replicates Netlify's
precedence (real files, then netlify.toml redirects, then `_redirects`), applies
the real `_headers` as response headers, and boots both apps in Chromium under
the real CSP. It exists because **every failure mode of this topology is
silent**: a missing icon still renders, an uncopied `_headers` still serves the
site with no CSP at all, and `/coach/` falling through to the athlete app reads
as a routing quirk rather than a missing product.

What it cannot cover, and you must check against the deployed URL:

1. **`/coach/` after the service worker has installed.** Open `/` first, let the
   worker install, then navigate to `/coach/` **and reload once**. Correct result
   is the title `THE Hybrid System — Coach`. If you get the athlete shell, the
   denylist regressed. A local check cannot reproduce this — it needs a real
   worker that has claimed a real origin.
2. **The functions still answer.** `/.netlify/functions/integrations-status`
   responds. `base` stays `"."`, so `netlify/functions` still deploys — but this
   is one HTTP call and it is the only proof.
3. **A real installed PWA takes the handover.** On a phone that already had the
   old app installed, confirm it picks up the new worker rather than staying on
   the old shell.
4. **Install the PWA from scratch** and confirm the icon is the Hybrid icon, not
   a screenshot of the page.

### Rolling back

One commit, one revert:

```
git revert <the cutover commit> && git push
```

Netlify redeploys the previous configuration and the vanilla app is live again —
nothing was deleted, so the files it needs are all still in the tree.

The one part a revert does **not** undo is the service worker. After the cutover
the athlete origin is controlled by the Workbox worker at `/sw.js`. Reverting
restores the old worker, but a browser that already installed the new one keeps
serving from its cache until it fetches an update. Reverting promptly is fine;
reverting a week later means some users sit on a stale shell for a visit or two.
Verify the swap on a real installed PWA, not just a fresh tab.

### The Android build

`.github/workflows/mobile-eas.yml` is manual-dispatch only and gated on an
`EXPO_TOKEN` repository secret; without the secret it exits green with a notice
rather than failing. It has never completed a real build — there is no Expo
account wired to this repo. `.github/workflows/android-apk.yml` (the old WebView
shell) **must not be deleted** until an EAS build has actually shipped an update
to the installed base; see the header comment in `mobile-eas.yml` for the
applicationId, versionCode and signing-key constraints.
