# THE Hybrid System

A local-first training app: an athlete PWA and an Android app, over one
shared engine and one Supabase project.

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
| A screen renders blank / title-only | The screen in `apps/*/src/screens/`. See `apps/mobile/test/screens.test.tsx` — that class of bug has bitten before |

**Rule of thumb:** if it is a decision about *training*, it is in
`packages/engine` and has a test. If it is about *pixels*, it is in
`apps/*/src`. Almost nothing that matters lives in a screen.

---

## Layout

```
packages/engine     every training decision. No DOM, no globals, no React.
                    The one place web and mobile must agree.
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
| Settings | `/settings` | Profile, cloud, WHOOP, backup **and restore** |

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
node checks/react-smoke.mjs          # the three apps in a real browser
node checks/contrast.mjs             # text meets contrast on the real palette
node checks/web-touch.mjs            # touch targets on coarse pointers
node checks/mobile-touch.mjs         # ditto, React Native
```

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
  title over a void is the bug `apps/mobile/test/screens.test.tsx` exists for.
- **Never invent training.** A prescription is not a performance, and a day
  with no record is a gap, not a rest day. Several tests exist only to hold
  this line.
- **A truncated chart axis must say so.** See `barScale`.

This repository is not an access-control layer. Do not put provider
credentials or secrets in the browser or the repository.
