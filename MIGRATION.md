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
4. **The mobile app has three screens.** Home, Training, Logger and Settings.
   Conditioning, Library, History, Progress, Calendar, Import and Recap exist
   on web only.
5. **Nothing is deployed.** `netlify.toml` still publishes the repo root, so the
   live site is unchanged. Cutting over means building the apps in CI and
   publishing `apps/web/dist` with `apps/coach/dist` at `/coach/`.

## Before cutting over

- Sign in against the real project and drive one full loop: coach publishes →
  athlete pulls the assignment → athlete logs it → coach sees the digest. Then
  diff a real synced account old-vs-new against the same seeded DB.
- Build the Android app on EAS with the **existing keystore** and
  `applicationId com.hybridengine.app` at a versionCode above 27 — get any of
  those wrong and current users get a second app icon instead of an update.
- Test on a real device with a real HR strap: a logged session must round-trip
  to Supabase and appear in the coach view.
- Only then change `netlify.toml`, and only then retire `native/android-app/`.
