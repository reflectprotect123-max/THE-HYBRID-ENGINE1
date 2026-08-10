# PWA parity: retire the native app, make the web app the only app

## Goal

`apps/mobile` (Expo/React Native) and `apps/web` (a Vite PWA, already installable) are two
front ends over the same shared `packages/*` business logic. The goal is to make `apps/web`
do everything `apps/mobile` does today — screen-for-screen, flow-for-flow — so the native app
can be deleted and the PWA becomes the one and only athlete-facing app. Scope is Android/Chrome
only throughout (matches the existing Bluetooth decision); iOS is explicitly out of scope.

"Zero changes" is the standing constraint: this is a *port*, not a redesign. Where mobile and
web already diverge in visual style, the web app's existing conventions win (no new design
system), but user-facing behavior — what screens exist, what they do, how you get to them —
should not change from what the native app does today.

## Current state (verified by investigation, not assumed)

- **Training world** (Home/Train/Library/Progress/Settings, Logger/Planner/Guided
  Builder/Conditioning/History/Calendar/Exercise/Day) already matches 1:1 between mobile and
  web, screen-for-screen and route-for-route. This is close to done already.
- **Bluetooth** (WHOOP heart-rate broadcast, Rogue Echo Bike FTMS telemetry) already has a
  working Web Bluetooth implementation on web (`apps/web/src/screens/Conditioning.tsx`'s
  `connectStrap`, `apps/web/src/native/echoV3.ts`) — not a port, a UX-parity gap (see Phase 1).
- **Nutrition world** is a whole separate mobile navigation context (own 5-tab bar: Log / Food
  / Weight / Coach / Settings, reached via a hard sealed-world swap, not a modal or a route
  under the training nav) with 12 screens. Web has one route (`/nutrition`) with a bare
  quick-add log. This is the large piece of this project.
- **Other mobile-only capabilities**: background GPS tracking, scheduled rest alarms that fire
  with the screen off, camera-based barcode scanning, camera-based nutrition-label OCR,
  keep-awake during a session. Each is addressed below — some have a solid web equivalent,
  two (background GPS, screen-off alarms) have a real browser ceiling that no amount of work
  closes completely.

## Phase 1 — Training-world close-out

Small, bounded gaps on an otherwise-matching surface:

1. **BLE connection-state UX.** Mobile's `HeartRateMonitor.start(onBpm, onState)` reports
   `'scanning' | 'connected' | 'error'` with a specific human-readable message per failure mode
   (permission refused, scan timeout, scan error, connect failure, no BLE stack). Web's
   `connectStrap` today only takes `onBpm` — every failure path falls into a silent `catch {}`,
   so a failed pairing just quietly logs no heart-rate data with no UI feedback. Add an
   `onState` callback to `connectStrap` with the same three-state shape and matching messages,
   wired into Conditioning's existing strap-status UI the same way `RUN.bpm` already is.
2. **Screen Wake Lock.** Mobile calls `expo-keep-awake` during Logger and Conditioning
   sessions so the screen doesn't sleep mid-set. Chrome/Android supports the Screen Wake Lock
   API (`navigator.wakeLock.request('screen')`) directly — request it on session start, release
   on session end/unmount, matching the same call sites (`Logger.tsx`, `Conditioning.tsx`).
3. **GPS tracking (best-effort, per your call).** Mobile's `createGeoTracker` runs in the
   background via `expo-location` + a background task, surviving the screen being off. No
   browser API does this reliably. Web gets `navigator.geolocation.watchPosition` while the
   Conditioning screen is open/foregrounded — good enough for a run/ride actually being watched,
   explicitly not equivalent to mobile's background tracking. No attempt to paper over this
   with a service-worker background-sync trick — that's unreliable enough across real Android
   Chrome versions to not be worth the complexity for what it would actually deliver.
4. **Rest alarms (best-effort, per your call).** Mobile's `scheduleRestAlarm` fires a real OS
   notification with the screen off. Web gets the `Notification` API (works while the tab is
   open or backgrounded within the same browser session) plus the in-tab vibration/visual cue
   web's `rest.tsx` already has — reliable while the phone is actively in use, not guaranteed
   with the screen fully locked. This is a real, disclosed gap, not a silent one.

None of Phase 1 touches `packages/*` — every change is inside `apps/web/src/screens/Conditioning.tsx`,
`apps/web/src/store/rest.tsx`, and `apps/web/src/screens/Logger.tsx`.

## Phase 2 — Nutrition world

### Navigation: replicate the sealed dual-world swap

Mobile's `apps/mobile/src/discipline.ts` holds a `useDiscipline()` hook — a
`useSyncExternalStore` over a module-level `active: WorldId`, persisted under
`hybrid-active-discipline-v1`, plus `hybrid-last-training-world-v1` so Nutrition (which has no
training identity of its own) remembers which training world to return to.
`apps/mobile/src/App.tsx` mounts one of two **entirely separate** navigator trees depending on
`world` — training's `Stack`/`Tabs` or nutrition's `NutritionStack`/`NutritionTabs`, with
distinct, never-unioned tab-param types. This is a hard unmount/remount, called out in mobile's
own comments as "sealed worlds," not conditional route visibility.

Web gets the same shape: a `useDiscipline`-equivalent hook (new, `apps/web/src/discipline.ts`,
same storage-key persistence pattern so a user's world choice on one device isn't relevant to
sync but stays consistent per-browser), and `apps/web/src/App.tsx`'s route table forks by
world — the training routes it already has stay exactly as they are; a new nutrition route
tree and a `NutritionBottomNav` (5 items: Log/Food/Weight/Coach/Settings, mirroring
`components/BottomNav.tsx`'s existing structure) get added alongside, mounted only when
`world === 'nutrition'`.

### Screens (12), grouped by what's actually new

**Thin UI over already-shared logic** (`packages/nutrition-core` /
`packages/nutrition-adapter` / `packages/nutrition-engine` already have every function these
need — confirmed by import-level investigation, not assumed):

- **DailyLog** — day list grouped by meal + running macro totals. Web's `FoodLog.tsx` already
  covers this shape for quick-add; extend it to render entries from every entry kind, not just
  `quick_add`.
- **FoodSearch** — search input + recent/favorite/catalogue-result list, tap to log. Uses
  `foodSearch`, `catalogueResult`, `favoriteKey(s)`, `loggableUnits`,
  `logEntryFrom{CustomFood,Food,Recipe}`, `resolveRecipePerServing`, `upsertCachedFood` (all
  core/adapter) plus `cloud/catalogue`'s `searchCatalogue`, which is a plain network call, not
  RN-specific — portable to web as-is.
- **CustomFood** — form to save a reusable custom food (name, per-serving macros, serving
  unit). Only RN-specific bit is an `Alert` call, swapped for web's existing confirm/toast
  pattern.
- **RecipeBuilder** — recipe name + ingredient search (reuses FoodSearch's lookup) + per-item
  scaled macros + servings count.
- **CheckIn** — weekly review pane: weigh-in/adherence coverage, macro-overshoot/damping,
  accept/adjust producing next week's `MacroProgramDay`. Leans on `nutrition-engine`'s
  `weeklyCheckIn`/`addDays` and adapter's `checkInFor`/`dampingAnchor`/`macroOvershoot` — none
  of this is called anywhere in `apps/web` today, all of it already exists in the packages.
- **Weight** — numeric entry + trend line, via adapter's `liveWeighIns`/`trendSeries`.
- **NutritionSettings** — settings list plus the world-switch control (new web component,
  same role as mobile's `WorldSwitch`).
- **QuickAdd** — already effectively what web's `FoodLog.tsx` add-entry flow does; light
  reconciliation, not a new build.
- **Coach** — dashboard: target ring, expenditure estimate/confidence, goal chips, embeds the
  CheckIn pane. All adapter-driven.
- **Food** — no own logic, a router/composer switching between FoodSearch/QuickAdd/CustomFood/
  RecipeBuilder/BarcodeScanner/LabelReader. Becomes a thin web route-group wrapper.

**New write paths needed** (the functions exist in `nutrition-core`, they're just unused on
web today): `logEntryFromCustomFood`/`logEntryFromFood`/`logEntryFromRecipe` instead of only
`quickAddEntry`, plus a `CustomFood`/`Recipe` CRUD surface via `upsertCachedFood`. This is
wiring, not new domain logic.

**Genuinely new, camera-dependent:**

- **BarcodeScanner** — full-screen camera view, barcode detected → `lookupBarcode` → confirm
  card. Chrome's `BarcodeDetector` API (unreferenced in-repo today, but a stable Chrome/Android
  API, no new dependency) replaces `expo-camera`'s barcode mode.
- **LabelReader** — camera capture → OCR → parsed macro fields pre-filled into an editable
  form, with typed-entry as the existing fallback. Mobile uses `expo-mlkit-ocr`
  (Android-native, on-device); there is **no browser OCR library anywhere in this repo today**.
  **Open call, flagged for your review rather than blocking on it now**: bring in
  `tesseract.js` (a real new dependency, WASM, a few MB) to keep true OCR and honor "zero
  changes" literally, or ship LabelReader as typed-entry-only (drop OCR, keep the manual-entry
  fallback mobile already has as a safety net). My default in this plan is **tesseract.js**,
  because dropping OCR is a real feature loss and the instruction was zero changes — but this
  is the one place in this whole project where "zero changes" costs a new dependency, so it's
  worth you confirming rather than me deciding it silently.

The parser that turns OCR output into macro fields (`parseLabelLines`/`parseLabelText`) is
already shared in `nutrition-core` — only the recognizer (image → text) needs a web
implementation.

### Testing

Every new screen gets a colocated test file, following this repo's established convention
(`src/screens/nutrition/FoodSearch.test.tsx` beside `FoodSearch.tsx`, etc.) and the same
test-double patterns already used elsewhere (`FakeCoachWorkspaceRepository`-style fakes where a
screen reads through a repository/store interface, direct store mocking where it reads
`packages/nutrition-*` functions directly). No new test infrastructure — reuse what
`FoodLog.test.tsx`/`NutritionCard.test.tsx` (if they exist) or the mobile nutrition tests
already establish as the pattern, translated to web's testing setup (Vitest, same as the rest
of `apps/web`).

## Close-out

Once both phases are live and manually verified against a real Android Chrome browser (BLE
pairing, camera permission flows, and the full nutrition world end-to-end are exactly the kind
of thing that needs a real device pass, not just unit tests), delete `apps/mobile` entirely:
the app directory, its CI step (`Bundle the mobile app (Metro + Hermes)` in
`.github/workflows/ci.yml`), and its EAS build configuration. `packages/*` are untouched by the
deletion since `apps/web` already depends on the same packages independently.

## Out of scope

- iOS support (explicit decision — Android/Chrome only, matching the Bluetooth scope).
- The tagged exercise catalogue (tracked separately, unrelated to this project).
- Any redesign of existing training-world screens — this project ports and closes gaps, it
  does not restyle anything that already matches.
