# Migration to a unified React ecosystem

Status of the move from three buildless front-ends to one React/React Native
workspace sharing a single engine.

## What exists now

```
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
| Engine matches the shipped app | 1,262 golden vectors harvested from the live `app.js` in a real browser (`checks/golden-vectors.mjs`), asserted by `packages/engine/test/golden.test.ts` | 33 tests pass |
| React apps actually run | `checks/react-smoke.mjs` serves the built output and drives both apps in Chromium | 15 checks pass |
| Types | `pnpm -r typecheck` across all five packages | clean |
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

## What is NOT done

Stated plainly, because a green build is not a finished migration.

1. **The Android app has never been built or run.** There is no Android SDK in
   this environment and EAS needs an account. `pnpm --filter @hybrid/mobile
   typecheck` passes; `eas build --platform android --profile preview` has not
   been attempted. **BLE, notifications and the pedometer are unverified against
   real hardware** — they cannot be verified any other way.
2. **The importer is not ported.** The `IMP_*` parser family, photo OCR and
   voice input all still live only in `app.js`. The parser is pure logic and
   belongs in `packages/engine`; OCR and voice are platform modules.
3. **Screens not yet rebuilt:** Planner/plan editor, Calendar, Recap, Import,
   and the Progress charts. History carries the 8-week lift delta; the rest of
   Progress does not exist in React yet.
4. **Cloud sync is not wired into the React apps.** `mergeEngines`, tombstones
   and `cloudFp` are ported and tested, but nothing calls them — there is no
   Supabase client, no auth, and no WHOOP integration in `apps/web` yet.
5. **Nothing is deployed.** `netlify.toml` still publishes the repo root, so the
   live site is unchanged. Cutting over means building the apps in CI and
   publishing `apps/web/dist` with `apps/coach/dist` at `/coach/`.

## Before cutting over

- Wire Supabase auth + sync into `apps/web`, and diff a real synced account
  old-vs-new against the same seeded DB.
- Port the importer, then the remaining screens.
- Build the Android app on EAS with the **existing keystore** and
  `applicationId com.hybridengine.app` at a versionCode above 27 — get any of
  those wrong and current users get a second app icon instead of an update.
- Test on a real device with a real HR strap: a logged session must round-trip
  to Supabase and appear in the coach view.
- Only then change `netlify.toml`, and only then retire `native/android-app/`.
