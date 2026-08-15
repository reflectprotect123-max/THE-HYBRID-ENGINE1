# THE Hybrid System

A local-first training and nutrition system: **three apps over one engine and
one Supabase project.**

| App | What it is | Where it runs |
|---|---|---|
| `apps/mobile` | The athlete product | Android, built with EAS |
| `apps/web` | Two builds from one source — the **coach workspace** (desktop-first, phone-supported) and a **branded athlete app** | Two Netlify sites |

Three worlds — Strength, Conditioning and Nutrition — one athlete.

Everything works offline. The cloud is a sync target, never the source of
truth — the app on the device owns the data and merges toward the server.

**Nothing arbitrates a week automatically.** A coach programs a week and
publishes it; an athlete with no coach has no planned week and their phone says
so. The Coordinator and the auto-coach were deleted on 14 August 2026, safety
stop included, deliberately. See [`CLAUDE.md`](CLAUDE.md).

---

## Where to look when something is wrong

The fastest way into this repo. Find the symptom, go to the file.

| Symptom | Look in |
|---|---|
| Wrong weight suggested for a set | `packages/engine/src/logger.ts` → `prefillPrimary`, then `packages/engine/src/lift.ts` → `nextWorkingWeight` |
| Weight didn't go up / down after a session | `packages/engine/src/lift.ts` → `liftAdapt` |
| Wrong HR zone, or zones look off | `packages/engine/src/hr.ts` → `conZones` (Tanaka 208 − 0.7×age, or Karvonen when a resting HR is set) |
| Conditioning got harder/easier unexpectedly | `packages/engine/src/conditioning.ts` → `conAdapt`, `conPrescription` |
| Conditioning never progresses at all | `packages/engine/src/conditioning.ts` → `conAdapt`. It returns early on zero zone seconds: **no heart-rate data means no level earned AND no miss recorded**, so a strapless session is invisible to progression rather than a failed one. Most sessions are strapless. Which formats can progress at all is `packages/engine/src/constants.ts` → `PROGRESSED_FORMATS` |
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
| WHOOP connect or sync fails | `netlify/functions/whoop-*`; check with `node checks/whoop-contract.mjs` |
| A screen renders blank / title-only | The screen in `apps/web/src/screens/`. That class of bug has bitten before |
| A session ran despite an active pain or illness flag | Nothing holds a session as of 14 August 2026 — `@hybrid/auto-coach` was deleted, safety stop included. `@hybrid/whole-athlete-state` still RAISES the flag (`pain_hold_active`, `illness_flag_active`); no layer acts on it. See CLAUDE.md, "The auto-coach is deleted" |

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
| Nutrition changed a training plan | It may not. `packages/whole-athlete-state/src/state.ts` → `deriveAthleteState` takes nutrition as context only. `checks/coach-contract.mjs` rule 3 enforces the boundary — it followed the Coordinator to the auto-coach to whole-athlete-state as each was deleted, and that third home is the stable one |
| Barcode scanning fails | `apps/web/src/screens/nutrition/BarcodeScanner.tsx` (Chrome's `BarcodeDetector` API) → `apps/web/src/native/barcodeScanner.ts`. Android/Chrome only |
| A nutrition label reads wrong | `packages/nutrition-core/src/label.ts` → `parseLabelText`, `parseLabelLines`. The recognizer is `apps/web/src/native/labelOcr.ts` (`tesseract.js`, on-device WASM) |
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
                    It RAISES pain and illness flags; since 14 August 2026
                    nothing consumes them.
packages/strength-engine specialist Strength ownership.
packages/conditioning-engine specialist Conditioning ownership.
packages/product-scope the two product identities and their capability lists.
                    A fact table, not a decision layer.
packages/session-authoring the shared session-authoring logic behind the
                    builders.
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
packages/guided-flow the pure step-sequencing logic behind the guided session
                    builder.

apps/mobile         the Android athlete app — training, nutrition, the
                    round-major session logger, BLE heart rate and FTMS.
apps/web            ONE source, TWO deployed builds. Unscoped it is the coach
                    workspace; VITE_HYBRID_PRODUCT=conditioning makes it the
                    branded athlete app. Camera barcode/label scanning, BLE,
                    GPS.
checks/             executable checks. Not unit tests — these drive real
                    browsers, real crypto and the real schema.
netlify/functions   the server half: WHOOP and Concept2 OAuth and webhooks.
                    Provider tokens live here encrypted, never in the browser.
scripts/            build and deploy assembly. scripts/deploy-site.mjs is the
                    one that decides WHICH site a deploy is.
supabase/migrations the cross-app contract: RLS-owned core, domain snapshots,
                    idempotent events, coach rosters and weekly plans.
docs/               design tokens, the migration record, the changelog.
```

**Deleted, and named here because the code still reads as though they exist**:
`packages/coordinator`, `packages/coordinator-adapter` and
`packages/auto-coach`, all on 14 August 2026. Rows they wrote are still
readable and `athlete_weekly_plans` still accepts `writer = 'coordinator'`;
nothing produces one.

The rebuild status, rollout gates and product commands are in
[`docs/ARCHITECTURE_STATUS.md`](docs/ARCHITECTURE_STATUS.md). Claude Code's
operating contract is in [`CLAUDE.md`](CLAUDE.md), and the Supabase cross-app
boundary is staged in
[`supabase/migrations/20260804_fitness_ecosystem_contracts.sql`](supabase/migrations/20260804_fitness_ecosystem_contracts.sql).
The staging compatibility matrix and rollback procedure are in
[`docs/MIGRATION_ROLLOUT.md`](docs/MIGRATION_ROLLOUT.md).

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

### The athlete app (`apps/web`, branded builds only)

These routes are declared **only when `IS_SCOPED_BUILD` is true** — that is, on
a branded build. The unscoped dashboard build redirects every one of them to
`/coach`, which is what "the athlete web app is parked" means and still means
for the coach site.

| Screen | Route | Does |
|---|---|---|
| Home | `/` | Readiness, today's plan, start conditioning, mini trends |
| Training | `/training` | The day's session — blocks, exercises, mark complete |
| Library | `/library` | Three tabs — **Sessions** (startable), **Exercises** (every logged movement), **Mobility** (prep, reference only) |
| Exercise | `/exercise/:name` | One movement's whole history and e1RM trend |
| Conditioning | `/conditioning` | Live HR zone training against a gauge, with the BLE strap and the GPS tracker |
| Progress | `/progress` | Weekly volume, top lifts, recovery trends |
| History | `/history` | Any past day's logged sets |
| Calendar | `/calendar` | Month grid: planned vs trained |
| Recap | `/recap/:id` | What just happened, and what it earned |
| Nutrition | `/nutrition` | Quick day-of-food summary, reachable from Home without leaving the training world |
| Settings | `/settings` | Profile, cloud, WHOOP, backup **and restore**, and the switch into the nutrition world |

**There is no strength LOGGER or session editor on web.** `Logger`, `Planner`
and `GuidedBuilder` left on 13 August 2026 — the logger was deleted outright
(`apps/mobile` carries a newer round-major one), and the two authoring screens
MOVED into the coach bench, which is what closed the last two lane-contract
crossings. On a conditioning build `navTabs` yields Home / Cond / Library /
Progress / Settings, with no Train tab at all.

### The coach workspace (`/coach`, unscoped build)

Ten routes, composed at 1440px and each also proven to hold at 420px:
`/coach` (the Command Center) and the four pillars `readiness`, `strength`,
`conditioning`, `nutrition`, plus `library`, `settings`, `progression`,
`day/:date` and `week/:athleteId/:weekStart`. `checks/screens.mjs` shoots every
one at BOTH widths and fails on horizontal overflow; run it and quote the
number it prints rather than this paragraph.

`apps/web/src/coach/library/DayBuilder.tsx` is the one authoring surface. Do
not add a second — two builders is the state the 14 August deletion ended.

Home carries the nutrition card above the zone card
(`apps/web/src/screens/nutrition/NutritionCard.tsx`). The coach bench's
read-only nutrition surface is the Nutrition pillar
(`apps/web/src/coach/pillars/Nutrition.tsx`) — the old `NutritionPanel` was
deleted on 14 August 2026 with CoachShell and the /coach/legacy route.

### The nutrition world

Training and nutrition are two sealed route trees on the one PWA, switched by
`apps/web/src/discipline.ts`'s `useDiscipline()`/`setDiscipline()` — a control
in `Settings.tsx` and `NutritionSettings.tsx` (`apps/web/src/components/WorldSwitch.tsx`)
flips between them. Its own bottom nav
(`apps/web/src/components/NutritionBottomNav.tsx`: Log / Food / Weight / Coach /
Settings), its own accent, and — now that everything lives in one browser —
real camera access for the flows that need hardware:

| Screen | Route | Does |
|---|---|---|
| Daily Log | /nutrition/log | The day's food, by meal — the world opens here |
| Food | /nutrition/food | Router over search, quick add, custom food, recipe builder, barcode scanner, label reader |
| Food Search / Quick Add | (within Food) | Catalogue, custom foods, recipes, favourites; or four numbers |
| Custom Food / Recipe Builder | (within Food) | Foods and recipes the athlete owns |
| Barcode scanner | (within Food) | `apps/web/src/native/barcodeScanner.ts` — Chrome's `BarcodeDetector` API |
| Label reader | (within Food) | `apps/web/src/native/labelOcr.ts` — `tesseract.js`, on-device WASM OCR |
| Weight | /nutrition/weight | Weigh-ins, and the smoothed trend they feed |
| Coach | /nutrition/coach | The macro program, the expenditure estimate, the engine's own explanation, and the embedded weekly Check-in (accept, decline, or a held week that says what is missing) |
| Settings | /nutrition/settings | Nutrition-scoped settings, and the switch back to training |

---

## Running it

```bash
pnpm install
pnpm run dev:web           # apps/web — the coach workspace
```

For the branded athlete app rather than the bench, set the product:

```bash
VITE_HYBRID_PRODUCT=conditioning pnpm run dev:web
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
node checks/react-smoke.mjs          # all THREE bundles in a real browser: the
                                     # coach site, a coach-enabled one, and a
                                     # branded conditioning one
node checks/screens.mjs              # every /coach route at 1440px AND 420px,
                                     # plus the athlete screens; fails on
                                     # horizontal overflow
node checks/contrast.mjs             # text meets contrast on all three palettes
node checks/web-touch.mjs            # touch targets on coarse pointers
node checks/migrations-apply.mjs     # every migration against a real Postgres,
                                     # RLS and owner-reference policies proven
node checks/docs.mjs                 # this file's paths and symbols still exist
```

`checks/react-smoke.mjs` builds two extra bundles, both gitignored and never
deployed. `apps/web/dist-coach` carries a `VITE_COACH_USER_IDS` allowlist,
because `/coach` fails closed without one and would otherwise redirect away
unchecked. `apps/web/dist-conditioning-smoke` is the branded athlete build, and
it is what proves the claims that are only true of that build: the athlete app
serves at the root rather than the bench, `/coach` bounces, the athlete
manifest is offered, and **no Train tab reaches a conditioning build**.

The live three-domain sync round trip — strength, conditioning and nutrition for
one athlete against the real backend — is `apps/web/src/cloud/sync-e2e.live.test.ts`.
It skips unless `SB_E2E=1` and runs from the manually-dispatched `sync-e2e`
workflow, because it needs network egress and creates a disposable auth user.

`.github/workflows/ci.yml` runs exactly this on every push, and **fails if a
browser section skips** — a suite that quietly tested nothing is worse than one
that failed.

---

## Deployment

**Two Netlify sites, one `netlify.toml`, chosen by an environment variable.**

```
HYBRID_SITE unset (or 'coach')   the coach workspace
HYBRID_SITE=conditioning         the branded athlete app
```

Set it per site in the Netlify UI. Nothing else needs configuring: no base
directory, no build command, no publish directory. `scripts/deploy-site.mjs`
reads the variable and assembles either site into `apps/web/dist`, and it FAILS
on an unrecognised value rather than defaulting — a typo'd `HYBRID_SITE`
silently publishing the coach workspace to the athlete's domain is the worst
outcome available.

Locally:

```bash
pnpm run deploy:coach          # assembles the coach site
pnpm run deploy:conditioning   # assembles the athlete site + the lab
```

Both write to `apps/web/dist`, so running one overwrites the other, and
`checks/deploy-smoke.mjs` reads that directory — rebuild before trusting it.

**Do not add a second `netlify.toml` in a subdirectory.** That is Netlify's own
documented monorepo pattern, it was implemented here, and it could not be
SELECTED: the base-directory picker refuses a folder that does not look like a
project, and adding a `package.json` to make it look like one did not persuade
it either. The same detection also offered `apps/lab` and
`packages/conditioning-engine` as sites of their own during setup, which is
worth knowing before adding any config file to a subdirectory: it is not inert,
it advertises that folder as deployable.

Deploy through Netlify Git, the CLI, or the API so `netlify/functions` is
included. A drag-and-drop upload publishes the UI and does not auto-update on a
push; it can carry functions only if the dropped folder brings its own
`netlify.toml` and `netlify/functions`.

The web app is `registerType: 'prompt'`: a new version installs and waits, and
`apps/web/src/UpdateBanner.tsx` offers the reload rather than taking it. That
is deliberate — the app is used mid-set with a live rest timer, and reloading
underneath a working set is worse than waiting.

Each site needs its OWN `APP_BASE_URL` — the coach site's value would return an
athlete to the wrong origin — and each origin's callback must be registered
with WHOOP and Concept2, which is not a Netlify setting and cannot be diagnosed
from inside this repository.

The Android app is built by `.github/workflows/mobile-eas.yml`, which triggers
`eas build` on Expo's servers. The APK is downloaded from Expo, not from a
GitHub artifact.

### WHOOP

- `APP_BASE_URL` — the exact HTTPS site URL (prod: `https://thehybridengine1.netlify.app`).
- `APP_SESSION_SECRET` — a fresh random secret, server-only.
- `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` — Netlify environment variables.
- `SUPABASE_URL` — pins the expected token issuer and fetches published signing
  keys. Optional for the browser, which identifies itself with the signed
  session cookie and never needs it — see `netlify/functions/_lib/config.mjs`.
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
  it belongs in `packages/engine` where the tests can see it.
- **Spacing resolves through an 8px scale** (`p-2` is 16px). The rare 4px
  optical nudge is written `-0.5` and is meant to stand out.
- **A screen must always render something.** Empty states are a feature; a
  title over a void is a real bug — a route that renders `null` reads as
  "loading" forever, not "nothing here yet."
- **Never invent training.** A prescription is not a performance, and a day
  with no record is a gap, not a rest day. Several tests exist only to hold
  this line.
- **A truncated chart axis must say so.** See `barScale`.

This repository is not an access-control layer. Do not put provider
credentials or secrets in the browser or the repository.
