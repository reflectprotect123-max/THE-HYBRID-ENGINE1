# THE Hybrid System

A local-first training and nutrition app: an athlete PWA and an Android app,
over one shared engine and one Supabase project. Three worlds — Strength,
Conditioning and Nutrition — one athlete.

Everything works offline. The cloud is a sync target, never the source of
truth — the app on the device owns the data and merges toward the server.

---

## Where to look when something is wrong

The fastest way into this repo. Find the symptom, go to the file.

| Symptom | Look in |
|---|---|
| Wrong weight suggested for a set | `packages/engine/src/logger.ts` → `prefillPrimary`, then `packages/engine/src/lift.ts` → `nextWorkingWeight` |
| Weight didn't go up / down after a session | `packages/engine/src/lift.ts` → `liftAdapt` |
| Wrong HR zone, or zones look off | `packages/engine/src/hr.ts` → `conZones` (Tanaka 208 − 0.7×age, or Karvonen when a resting HR is set) |
| Conditioning got harder/easier unexpectedly | `packages/engine/src/conditioning.ts` → `conAdapt`, `conPrescription` |
| Rest timer wrong, or no rest between a superset | `packages/engine/src/logger.ts` → `advanceAfterSet`, `ssGroups` |
| Exercises labelled A1/A2 wrongly | `packages/engine/src/logger.ts` → `sessionLetters` |
| A session vanished, or a deleted one came back | `packages/engine/src/db.ts` → `mergeEngines`, `mergeSettings`, tombstones in `settings.deletedIds` |
| Data lost on sync between devices | `packages/engine/src/db.ts` → `pickSession` / `pickWorkout`, then `cloud.ts` |
| A backup won't load | `packages/engine/src/db.ts` → `restoreDb`; UI in `apps/web/src/screens/Settings.tsx` |
| A day shows as trained when it wasn't | `packages/engine/src/session.ts` → `hasLoggedWork`; expiry in `packages/engine/src/db.ts` → `expireStaleSessions` |
| Chart is a flat wall, or exaggerates | `packages/engine/src/num.ts` → `barScale` (floating baseline) |
| e1RM looks wrong | `packages/engine/src/num.ts` → `epley`; history in `packages/engine/src/session.ts` → `exLogFor` |
| No insights appear, or one looks wrong | `packages/engine/src/insights.ts` → `insights`; the sample-size and noise floors are `packages/engine/src/constants.ts` → `INSIGHTS` |
| Web deploy doesn't reach an installed app | `apps/web/src/UpdateBanner.tsx`; check with `node checks/pwa-update.mjs` |
| Phone doesn't get an update | `.github/workflows/mobile-ota.yml`. Native changes need a new APK — `mobile-eas.yml` |
| WHOOP connect or sync fails | `netlify/functions/whoop-*`; check with `node checks/whoop-contract.mjs` |
| A screen renders blank / title-only | The screen in `apps/*/src/screens/`. See `apps/mobile/src/screens/screens.test.tsx` — that class of bug has bitten before |
| Auto-Coached changed nothing despite an active constraint | The coach bench's **Why today** panel, or `apps/web/src/coach/trace.ts` → `buildDecisionTrace` for the outcome rules |

### Nutrition

| Symptom | Look in |
|---|---|
| A day's calories or macros add up wrong | `packages/nutrition-core/src/day.ts` → `entriesForDay`, `macroTotals` (a deleted entry is stamped, never spliced — see `isLive`) |
| A logged meal vanished, or a deleted one came back | `packages/nutrition-core/src/db.ts` → `mergeNutrition`; the merge is additive and resolves by the newer edit stamp |
| A logged meal's macros changed after the fact | Nothing may re-derive them. `packages/nutrition-core/src/log.ts` → `logEntryFromFood`, `quickAddEntry` snapshot at log time |
| The calorie/macro target looks wrong | `packages/nutrition-engine/src/engine.ts` → `estimateExpenditure`, `calorieTarget`, `macroTargets`. Parity with the Python reference is a merged contract — see the defect list in `handoff.md` before "fixing" one |
| The weight trend reads flatter than the scale does | `packages/nutrition-engine/src/engine.ts` → `weightTrend`, `linearSlope`. Sparse weigh-ins repeat the last weight and bias expenditure LOW; `packages/nutrition-adapter/src/slice.ts` → `weighInCoverage` is what surfaces it |
| The engine says "holding" and never updates | `packages/nutrition-engine/src/engine.ts` → `coverageExplanation`. Holding is a normal outcome, not a failure |
| Home's nutrition card and the coach bench disagree | They must not — both read `packages/nutrition-adapter/src/summary.ts` → `nutritionSummary` |
| Nutrition changed a training plan | It may not. `packages/whole-athlete-state/src/state.ts` → `deriveAthleteState` takes nutrition as context only, and the Coordinator never sees it |
| Barcode scanning fails | `apps/mobile/src/screens/nutrition/BarcodeScanner.tsx` — needs a real camera and a native build (`runtimeVersion` 3), so it can never arrive over the air |
| A nutrition label reads wrong | `packages/nutrition-core/src/label.ts` → `parseLabelText`, `parseLabelLines`. There is no camera behind it yet — see `apps/mobile/src/screens/nutrition/LabelReader.tsx` |
| The food catalogue is empty or a search finds nothing | The catalogue is server-side and relational: [`docs/NUTRITION_CATALOGUE.md`](docs/NUTRITION_CATALOGUE.md). Local matching is `packages/nutrition-core/src/search.ts` → `foodSearch` |

**Rule of thumb:** if it is a decision about *training*, it is in
`packages/engine` and has a test. If it is a decision about *macros*, it is in
`packages/nutrition-engine` and has a fixture proving it agrees with the Python
reference. If it is about *pixels*, it is in `apps/*/src`. Almost nothing that
matters lives in a screen.

---

## Layout

```
packages/engine     legacy-compatible training model and safe local merge boundary.
packages/shared-core shared facts, versioned namespaces and cross-app contracts.
packages/whole-athlete-state recovery/life context, constraints and data quality.
packages/strength-engine specialist Strength ownership and proposal boundary.
packages/conditioning-engine specialist Conditioning ownership and proposal boundary.
packages/coordinator deterministic weekly reconciliation and reason codes.
packages/coordinator-adapter app projection from specialist proposals to a plan.
packages/nutrition-core athlete-side nutrition model: log entries, weigh-ins,
                    macro programs, check-ins — sanitize and merge. No
                    prescription lives here.
packages/nutrition-engine the deterministic adaptive engine: weight trend,
                    expenditure, coverage, targets. A function-for-function
                    port of the Python reference, with generated parity
                    fixtures. Depends on no training package.
packages/nutrition-adapter the only sanctioned bridge between nutrition and
                    everything else: one shared projection for the app
                    surfaces, and nutrition FACTS for whole-athlete-state.
packages/design     colour, type and spacing tokens on an 8px grid.
packages/config     Supabase URL/anon key and site origin.
packages/guided-flow the pure step-sequencing logic shared by the web and
                    mobile guided session builders.

apps/web            the athlete PWA. This is the deployed origin.
apps/mobile         the Android app (Expo/EAS), with BLE heart rate.

checks/             executable checks. Not unit tests — these drive real
                    browsers, real crypto and the real schema.
netlify/functions   the server half: WHOOP OAuth and webhooks. Provider
                    tokens live here encrypted, never in the browser.
docs/               design tokens, the migration record, the changelog.
```

The rebuild status, rollout gates and product commands are in
[`docs/ARCHITECTURE_STATUS.md`](docs/ARCHITECTURE_STATUS.md). Claude Code's
operating contract is in [`CLAUDE.md`](CLAUDE.md), and the Supabase cross-app
boundary is staged in
[`supabase/migrations/20260804_fitness_ecosystem_contracts.sql`](supabase/migrations/20260804_fitness_ecosystem_contracts.sql).
The staging compatibility matrix and rollback procedure are in
[`docs/MIGRATION_ROLLOUT.md`](docs/MIGRATION_ROLLOUT.md).

The Android build paths and signing rules are in
[`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md). A local debug APK uses
`pnpm android:debug`; a signed APK/AAB uses the EAS workflow and the existing
release keystore.

### The engine, module by module

| Module | Owns |
|---|---|
| `session.ts` | Session/block/exercise shape, volume, PRs, `hasLoggedWork` |
| `logger.ts` | The guided set flow — which set is next, prefill, superset chains |
| `lift.ts` | Earned working weight: `liftAdapt`, `nextWorkingWeight` |
| `autoreg.ts` | Per-set autoregulation from felt RPE |
| `conditioning.ts` | Formats, prescription, the earned conditioning baseline |
| `hr.ts` | Max HR, zones, recovery-driven daily adjustment |
| `balance.ts` | Strength vs conditioning readout |
| `insights.ts` | What changed about you at matched effort: `insights` |
| `db.ts` | Load/sanitize/merge/restore. The trust boundary for shape |
| `cloud.ts` | Supabase row ↔ engine record mapping |
| `emit.ts` | Coach model → athlete session |
| `num.ts` | Epley, `barScale`, formatting |
| `plates.ts` | Plate maths |
| `storage.ts` | Storage adapters (web localStorage, RN async) |
| `constants.ts`, `types.ts` | Shared shape and vocabulary |

---

## Screens

Web routes and the mobile stack carry the same names.

| Screen | Route | Does |
|---|---|---|
| Home | `/` | Readiness, today's plan, start conditioning, mini trends |
| Training | `/training` | The day's session — blocks, exercises, mark complete |
| Logger | `/log/:bi/:ei` | One set at a time: target, felt RPE, rest, superset link |
| Library | `/library` | Three tabs — **Sessions** (startable), **Exercises** (every logged movement), **Mobility** (prep, reference only) |
| Exercise | `/exercise/:name` | One movement's whole history and e1RM trend |
| Planner | `/planner/:id` | Edit a saved session — blocks, sets, targets, conditioning |
| Conditioning | `/conditioning` | Live HR zone training against a gauge |
| Progress | `/progress` | Weekly volume, top lifts, recovery trends |
| History | `/history` | Any past day's logged sets |
| Calendar | `/calendar` | Month grid: planned vs trained |
| Recap | `/recap/:id` | What just happened, and what it earned |
| Nutrition | `/nutrition` | One day of food: totals against target, add, edit, delete |
| Settings | `/settings` | Profile, cloud, WHOOP, backup **and restore** |

Home carries the nutrition card above the zone card
(`apps/web/src/screens/nutrition/NutritionCard.tsx`) and the coach bench carries
a read-only nutrition panel (`apps/web/src/coach/NutritionPanel.tsx`).

### The nutrition world, on the phone

The web has one nutrition screen; the phone has the world. Its own tab layout,
its own accent, and the flows that need hardware:

| Screen | Does |
|---|---|
| Daily Log | The day's food, by meal — the screen the world opens on |
| Food Search / Quick Add | Catalogue, custom foods, recipes, favourites; or four numbers |
| Custom Food / Recipe Builder | Foods and recipes the athlete owns |
| Weight | Weigh-ins, and the smoothed trend they feed |
| Check-in | The weekly proposal: accept, decline, or a held week that says what is missing |
| Coach | The macro program, the expenditure estimate, and the engine's own explanation |
| Barcode scanner | `expo-camera` + ML Kit. Native — never ships over the air |
| Label reader | The parse, without the camera. See the file header for the kill and what would revive it |

---

## Running it

```bash
pnpm install
pnpm run dev:web           # athlete PWA
pnpm --filter @hybrid/mobile start   # phone
```

Service workers and PWA install need `localhost` or HTTPS — not `file://`.

## Verifying it

```bash
pnpm run verify            # typecheck, all tests, build, both smokes
```

Then the suites that need no network and no secrets:

```bash
node checks/pentest.mjs              # real function crypto, then raw-HTML sinks
node checks/supabase-contract.mjs    # every query against the real schema + RLS
node checks/supabase-auth.mjs        # forged tokens against the verifier
node checks/whoop-contract.mjs       # OAuth URLs, and no secret client-side
node checks/pwa-update.mjs           # a deploy actually reaches an installed app
node checks/react-smoke.mjs          # the athlete app, the food log and the
                                     # coach bench's nutrition panel, in a
                                     # real browser
node checks/contrast.mjs             # text meets contrast on all three palettes
node checks/web-touch.mjs            # touch targets on coarse pointers
node checks/mobile-touch.mjs         # ditto, React Native
node checks/migrations-apply.mjs     # every migration against a real Postgres,
                                     # RLS and owner-reference policies proven
node checks/docs.mjs                 # this file's paths and symbols still exist
```

`checks/react-smoke.mjs` builds a second, coach-enabled bundle into
`apps/web/dist-coach` (gitignored, never deployed) because `/coach` fails closed
without `VITE_COACH_USER_IDS` and would otherwise redirect away unchecked.

The live three-domain sync round trip — strength, conditioning and nutrition for
one athlete against the real backend — is `apps/web/test/sync-e2e.live.test.ts`.
It skips unless `SB_E2E=1` and runs from the manually-dispatched `sync-e2e`
workflow, because it needs network egress and creates a disposable auth user.

`.github/workflows/ci.yml` runs exactly this on every push, and **fails if a
browser section skips** — a suite that quietly tested nothing is worse than one
that failed.

---

## Deployment

Deploy the repository root through Netlify Git, the CLI, or the API so
`netlify/functions` is included. A static drag-and-drop upload publishes the UI but
does not activate the functions.

The web app is `registerType: 'prompt'`: a new version installs and waits, and
`apps/web/src/UpdateBanner.tsx` offers the reload rather than taking it. That
is deliberate — the app is used mid-set with a live rest timer, and reloading
underneath a working set is worse than waiting.

The phone takes JS/asset changes over EAS Update automatically on push. Any
**native** change — a new native module, a permission, an icon, an SDK bump —
cannot ship that way and needs a fresh APK from `mobile-eas.yml`.

### WHOOP

- `APP_BASE_URL` — the exact HTTPS site URL (prod: `https://thehybridengine1.netlify.app`).
- `APP_SESSION_SECRET` — a fresh random secret, server-only.
- `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` — Netlify environment variables.
- `SUPABASE_URL` — pins the expected token issuer and fetches published signing
  keys. **Required for the phone**, unused by the browser: the phone hands
  consent to the system browser, which has its own cookie jar, so a session
  cookie can never identify it — it authenticates with its Supabase access
  token instead.
- `SUPABASE_JWT_SECRET` is deliberately unset. This project's current signing
  key is ECC P-256 (ES256), which publishes its public half at
  `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. Set it only if Settings → JWT
  Keys shows HS256 as the *current* key.

Register as the WHOOP redirect and webhook URLs:

```
https://thehybridengine1.netlify.app/.netlify/functions/whoop-callback
https://thehybridengine1.netlify.app/.netlify/functions/whoop-webhook
```

Privacy policy: `https://thehybridengine1.netlify.app/privacy.html`

Once the callback holds tokens it bounces the system browser to
`hybridengine://whoop` (`apps/mobile/app.json` → `expo.scheme`), which returns
the athlete to the app. Nothing extra is registered with WHOOP for the phone.

Rotate any WHOOP secret ever pasted into chat, source, or a ZIP.

The server keeps encrypted provider tokens in Netlify Blobs. The browser and
the service worker never receive or cache them.

### Concept2 Logbook

- `CONCEPT2_CLIENT_ID` / `CONCEPT2_CLIENT_SECRET` — Netlify environment
  variables, read the same way as the WHOOP pair above. A deploy missing
  either returns `configuration_error` on every connect attempt.

Register as the Concept2 redirect URL:

```
https://thehybridengine1.netlify.app/.netlify/functions/concept2-callback
```

Same token-storage, deep-link, and secret-rotation model as WHOOP above: the
server keeps encrypted tokens in Netlify Blobs, the browser and service worker
never receive or cache them, and the callback bounces the system browser back
to `hybridengine://whoop` (stamped `integration=concept2` so mobile can tell
the two providers' returns apart). Rotate any Concept2 secret ever pasted into
chat, source, or a ZIP.

---

## Conventions worth knowing before you change anything

- **Training decisions live in the engine, not in screens.** If you find
  yourself computing a weight, a zone or a progression inside a component,
  it belongs in `packages/engine` where both apps and the tests can see it.
- **Spacing resolves through an 8px scale** in both apps (`p-2` is 16px). The
  rare 4px optical nudge is written `-0.5` and is meant to stand out.
- **A screen must always render something.** Empty states are a feature; a
  title over a void is the bug `apps/mobile/src/screens/screens.test.tsx` exists for.
- **Never invent training.** A prescription is not a performance, and a day
  with no record is a gap, not a rest day. Several tests exist only to hold
  this line.
- **A truncated chart axis must say so.** See `barScale`.

This repository is not an access-control layer. Do not put provider
credentials or secrets in the browser or the repository.
