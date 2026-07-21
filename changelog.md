# Changelog

## Training and Logger get distinct jobs — 21 July 2026

- Training is the map: the whole session at a glance, supersets and
  completion rows ticked in place, and the finish button.
- Logger is the flow: the Logger tab now always resumes at your next
  unfinished exercise (never an arbitrary one), shows "exercise N of M"
  in the header, and steps ‹ Previous / Next › through the session's
  loggable exercises without bouncing back to Training.
- When you tick an exercise's last set, a "Next exercise: … →" button
  appears; when every set in the session is done, the Logger offers
  "Mark session complete" right there.
- Browser smoke grew two steps covering the resume-and-step behavior.
- Bumped the service-worker cache to v34.

## WHOOP-style dual ring, details hidden by default — 21 July 2026

- The Home WHOOP card now draws WHOOP's own picture: inner ring is recovery
  in WHOOP's colors (green ≥67, yellow 34–66, red <34), outer ring is strain
  in WHOOP blue, filling further around as the day's strain (0–21) climbs.
- Numbers stay out of your head: by default the card shows only the rings —
  no percentages, no metrics, no advice. Tapping the card reveals recovery,
  strain, HRV/RHR/sleep and the Readiness line; tapping again hides them.
  Details always start hidden on each visit.
- Settings moved to the WHOOP chip on the card (tap the chip, not the card).
- Browser smoke covers the new behavior: readiness stays hidden after a
  session until the card is tapped, and collapses again on a second tap.
- Bumped the service-worker cache to v33.

## History, readiness, scheduling & a calmer Builder — 21 July 2026

- History: every day in the week strip is now tappable and opens a History
  screen with previous/next-day navigation, showing each finished session's
  exercises with their logged sets (60kg × 12 @RPE 8 style), completed or
  incomplete.
- Readiness card on Home: combines WHOOP recovery with the last week's
  target-vs-felt RPE gap into one plain-language line — green light, train
  as planned, or pull back. Hidden until there is data.
- Weekly scheduling: the Builder gains "Train on" day chips. Home orders
  today's scheduled session first ("Today · Strength + Conditioning"),
  labels the rest by their days, says "Rest day" honestly, and the week
  strip rings upcoming planned days like the mock.
- Rest timer: now survives reload and screen-lock (end-time persisted),
  recomputes from wall clock, and vibrates when it hits zero.
- Stale sessions: an unfinished session from a previous day no longer hogs
  the resume card forever — with logged work it becomes an "incomplete"
  history entry, empty ones are dropped.
- Logger: the kg field shows last time's weight as its placeholder
  ("60 last") so you stop retyping your working weight.
- Calmer Builder: identical set targets collapse into one "All sets" row
  with a "vary per set →" toggle (12/10/8/8-style ramps still expand);
  tempo/rest hide behind a "+ tempo · rest" disclosure until an exercise
  uses them; adding a set now copies the previous set's RPE too.
- Cloud sync: "Forgot password?" flow (reset email + in-app new password).
- New checks/browser-smoke.mjs drives the real app in headless Chromium —
  20 end-to-end steps including the reload-survival rest timer — with a
  built-in static server; it skips politely when playwright isn't installed.
- Bumped the service-worker cache to v32.

## Ground-up rebuild on the design mock — 21 July 2026

- Rebuilt index.html from the ground up as the design mock, exactly: Home
  (welcome, Sunday-first week strip, today's session card, WHOOP mini-card),
  Training (block day view with supersets and prescription lines), Logger
  (set-by-set with per-mode columns, targets, RPE felt, auto rest chip) and
  Builder (collapsible blocks, five tracking modes, live prescription line).
- The whole backend is untouched: all six Netlify functions, WHOOP OAuth,
  Supabase cloud sync (same app_state schema), the hybrid-engine-v1
  localStorage model, the nameless template seed, and export/import backups.
- Logger no longer exposes add/remove-set steppers (the mock has none) — set
  counts live in the Builder.
- The WHOOP home card now renders exactly like the mock's recovery card
  (conic ring plus HRV · RHR · Sleep line) with Strong/Steady/Low labels, and
  quietly re-syncs once a day when the stored sample is stale.
- Removed the stale packaged app/ copy, the unreferenced pwa.js and
  native-ui.css leftovers, and two checks tied to the deleted focused-ui
  architecture; rewrote checks/native-pwa-smoke.mjs for the real
  architecture and refreshed readme.txt (deployment env vars and production
  WHOOP URLs included).
- Bumped the service-worker cache to v31 so installed PWAs pick up the
  rebuild.

## RPE hardening pass — 21 July 2026

- Fixed an edge case where switching an exercise to "For completion" could leave stale target RPE/tempo attached, which then showed a spurious "Felt" column in the logger. Completion mode now clears RPE/tempo on switch and on save, and the runner refuses to show a Felt column for completion exercises even on older saved data.
- Target RPE and Felt RPE inputs now constrain to 1–10 in 0.5 steps and clamp invalid entries on input.

## Desktop sidebar layout — 21 July 2026

- On wide screens (≥940px) the bottom navigation reflows into a left sidebar rail, matching the design mock; below 940px the original bottom-nav PWA layout is unchanged. Purely additive CSS on the existing nav — no markup change, fully reversible, and mobile is byte-for-byte as before.

## Per-set RPE + tempo (FBB-style) — 21 July 2026

- Builder: each set now has an optional target RPE beside its rep/second target, plus an optional Tempo field per exercise (e.g. 30X1). Both are optional — leave them blank and everything behaves exactly as before, with no change to existing saved templates.
- Live logger: when an exercise has target RPE, the strength runner shows the target ("· RPE 8") next to each set and adds a compact "Felt" column so you can log the RPE you actually hit. Exercises with no RPE render identically to before (no extra column).
- Prescriptions everywhere (Builder card, template preview, live runner) now append the RPE range and tempo, e.g. "4 × 12/10/8 · RPE 7→9 · @30X1".
- Data model: exercise gains optional `rpe` (comma list, parallel to `reps`) and `tempo` (string); set rows gain optional `rpe` (target) and `feltRpe` (logged). Fully backward-compatible — no migration, older rows upgrade lazily on load.
- Bumped the service-worker cache to v27.

## UI polish pass — 19 July 2026

- Training no longer says "Training" twice back to back — removed the duplicate title/tagline card at the top of the screen, kept the useful line and the Programs/Resources toggle.
- Quieted the small gold tagline above each screen's title (e.g. "Plan and review" above Calendar) everywhere except Home, so it reads as a light touch rather than repeating marketing copy on every screen.
- In the Builder, the block/exercise action row (Edit, move up/down, Copy, Delete) now wraps cleanly on narrow screens instead of crowding, with a touch more space before Delete so it doesn't sit flush against Copy.

## Recovery balance folded into the WHOOP card — 19 July 2026

- Moved Training impact out of its own card and into the WHOOP recovery snapshot on Home, as a small "Recovery balance" strip right below Sleep/HRV/Resting HR/Strain — Easy, Strength and High-intensity side by side.
- Same real data as before (your logged sessions vs. your synced recovery scores), just folded into the screen where you already look at WHOOP data instead of taking up its own separate card.

## Training impact moved to Home, now a bar chart — 19 July 2026

- Moved the Training impact card from History to Home, right below This week — it's a daily insight, so it belongs on the screen you actually open every day, not buried in your workout history.
- Changed it from a plain list of numbers to an actual bar chart, so the difference between Easy aerobic, Strength and High-intensity conditioning reads at a glance instead of needing to compare digits.
- No change to the underlying data or math — same real sessions, same real synced recovery scores, same small-sample caveat.

## Training impact: next-day recovery by session type — 19 July 2026

- Added a "Training impact" card to History showing your average synced WHOOP recovery the morning after Easy aerobic, Strength, and High-intensity conditioning sessions — using your own logged workouts and your own synced recovery scores, no invented formula.
- Answers "is my training actually affecting my recovery" directly from your real data, instead of guessing at a weighting scheme.
- Shows the session count behind each average and flags when a category has fewer than 5 sessions, since small samples shouldn't be read as a firm conclusion.
- WHOOP sync now also pulls recovery history (same rolling-window / one-time-backfill approach as the strain history added earlier), so this has real data to work with from the first sync after this update.

## Fitness trend chart from WHOOP strain — 19 July 2026

- Added a Fitness trend card to History showing Fitness (42-day trend), Fatigue (7-day trend) and Form, calculated from your daily WHOOP strain — the same idea as TrainingPeaks' Performance Management Chart, built from data you already sync.
- Only appears once WHOOP is connected and syncing; nothing changes if WHOOP isn't connected. Shows a "still gathering data" message until about a week of strain history has built up.
- The first WHOOP sync after this update automatically pulls a longer history (up to ~100 days) once, in the background, so the chart has a real trend to show instead of starting from nothing. Every sync after that stays light (a small rolling window), same as before.
- Purely calculated from your own synced data on your device — no new data leaves your phone beyond the existing WHOOP sync call.

## UI/UX cleanup — 19 July 2026

- Fixed a long-standing bug where reloading the app while it was on the Training tab could show a blank/broken screen. The app now waits until everything has fully loaded before it draws the first screen, instead of racing it.
- Deleting a block or exercise in the Builder now always shows the app's own "Delete this? Yes/No" prompt, matching template deletion. The browser's native pop-up confirmation is no longer used anywhere.
- Removed the "Show advanced" toggle in the Builder. Move up/down, Copy and Delete are now always visible on every block and exercise — nothing is hidden behind an extra tap.

## Nothing locked, free reordering — 19 July 2026

- Retired the built-in "Strength Day 1" and "Strength Day 2" seed templates. They were locked/protected (no Edit or Delete option); existing copies are automatically removed from your saved data the next time the app loads, no action needed.
- No template is locked or protected anymore, for these or any future templates — every template gets a normal Edit and Delete option, with the existing "Delete this template? Yes/No" confirmation before anything is removed.
- Removed the hard rule that kept Warm-up first and Cool-down last in the Builder. All blocks, including Warm-up and Cool-down, can now be freely moved up and down like any other block.

## Cloud sync (Supabase) — 19 July 2026

- Added optional cross-device sync: sign in from Settings → Cloud sync (email + password via Supabase Auth) and your training log syncs to every device you sign into.
- The app stays local-first: it works fully offline from browser storage whether or not you're signed in, and only talks to Supabase when a change needs to sync.
- Data model is one JSON row per account, protected by Supabase Row Level Security — nobody but you can read or write your row, even though the anon key ships in the app (that's expected/safe for Supabase; RLS is the actual boundary).
- Conflict handling is last-write-wins by real content: if the same data exists on both sides nothing happens; if it differs, whichever device has the more recent genuine change wins. Two devices editing offline at the same time can still overwrite each other — there's no merge.
- Requires a one-time setup: create a Supabase project, run `supabase-schema.sql` in its SQL editor, and add the project's URL + anon key to `index.html`.

## Fresh start after TrainHeroic cleanup — 18 July 2026

- Removed the bundled TrainHeroic import, raw export files, old baseline notes and legacy test harness from the working bundle.
- Existing installs now purge all TrainHeroic-derived sessions, exercises and templates on load or import; the new Block 01 strength templates remain.
- Calendar and history start clean without repopulating old TrainHeroic data.

## Logger and Builder tracking rebuild — 18 July 2026

- Rebuilt per-exercise tracking modes in Builder: Reps + Kilos, Seconds, Reps + Seconds, Reps only, and For completion. Each strength exercise stores one saved mode.
- Builder now lays each set on its own row for per-set targets, with a live prescription preview and a tracking-mode chip on each exercise.
- Live Logger renders only the fields for the chosen mode and adds a dedicated Done column. Removed the set-count/extra-set stepper and the rest-prescription line from the strength runner; the programmed rest timer is kept.
- The exercise session cue now appears as an instruction banner at the top of the live logger.
- Superset logger and edit sheet respect each exercise's tracking mode; the read-only round overview is retained.
- Tonnage counts weighted modes only; Seconds, Reps only and For completion contribute no load.
- Legacy templates and sessions without a saved mode default to Reps + Kilos — no data migration required.
- Removed the now-unreachable manual extra-set add/remove helpers left over from the previous logger.
- Bumped the service-worker cache to v12 so installed PWAs pick up the rebuild.
- %1RM mode was intentionally deferred from this pass.

## Logger and Builder reset — 15 July 2026

- Removed the focused Logger/Builder overlay and its late override wiring.
- Returned both routes to the core app foundation for a clean rebuild.
- Removed the focused UI asset from the service-worker shell and bumped the
  cache version.
- Preserved WHOOP, Netlify functions, local storage, history, and recovery.

## Locked Logger and Builder tracking — 15 July 2026

- Reworked the focused Builder so Sets occupy their own row and each strength exercise chooses one saved tracking mode: Reps + Kilos, Reps + %1RM, Seconds, Reps + Seconds, Reps only or For completion.
- Added Builder-owned exercise instructions that appear at the top of the live Logger, plus a read-only superset round overview.
- Made the live Logger render only the fields selected in Builder, with a dedicated Completed column and no mode, set-count, extra-set, history or rest-prescription controls.
- Kept actual result entry, notes, navigation and the programmed rest timer available during the session.
- Bumped the service-worker cache to v6 so the new Logger/Builder reaches installed PWAs.

## First-cycle templates — 15 July 2026

- Added blank native Library templates for Full Body Day 1 — Bench, Full Body Day 2 — Squat and Full Body Day 3 — Deadlift.
- Preserved the recovered exercise order and the Day 2 Pendlay Row naming note.
- Kept all set, rep and load prescriptions empty; the Logger now adds the first set only when the athlete chooses it.
- Added map “+” controls to group adjacent strength exercises into supersets.
- Repaired map movement for instruction blocks so Warm-up can move to the top and Cool-down can move to the bottom.

## Streamlined build — 13 July 2026

- Removed legacy readiness and program-first clutter from the primary flow.
- Home now focuses on active, scheduled and newly created workouts.
- Calendar starts workouts directly without an extra preview step.
- Library cards now use Edit in Builder and Schedule as the primary actions.
- Strength logging is limited to the prescribed work and recorded results.
- Conditioning creation is limited to Easy aerobic and Intervals.
- Removed obsolete seeded templates, archived-template persistence and dead recovery data.
- Corrected the default weekly schedule to Monday, Tuesday, Thursday and Friday.
- Fixed root Netlify PWA manifest paths and reduced duplicate service-worker caching.

## Completion pass — 13 July 2026

- Added deliberate route coverage for Logger, Summary, History and Builder tools.
- Added completed-workout History list and stale-route normalization.
- Protected canonical system templates during imports and kept custom imports visible.
- Throttled interval checkpoints and exposed independent main/recovery save health.
- Replaced the incomparable combined load score with separate strength and conditioning signals.
- Normalized conditioning modality alternatives and added a credential-free WHOOP boundary contract.

## Visual finish — 13 July 2026

- Preserved the existing palette, typography, branding and component structure.
- Added geometry-only mobile safety polish for long labels, narrow grids and fixed navigation spacing.
- Bumped the service-worker cache so the visual-only pass reaches fresh installs and updates.

## Domain and privacy setup — 14 July 2026

- Added the public privacy policy page at `/privacy.html`.
- Added the `/privacy` route and no-cache headers for the policy page.
- Documented explicit HTTPS configuration for the WHOOP callback URLs.
## 2026-07-14 — Function-enabled integrations

- Added Netlify Functions for WHOOP OAuth, token refresh, sync, disconnect, and webhook handling.
- Added encrypted server-side token storage using Netlify Blobs; no provider secrets or tokens enter the static app.
- Added a compact Connected data entry point inside Settings without changing the main navigation, colors, or core logging flow.
- Added OAuth state/session protection, WHOOP HMAC verification, webhook deduplication, and a cache version bump.
- Hardened WHOOP V2 pagination, date normalization, timeout/error handling, rotating refresh-token races, stale webhook rejection, and provider revocation on disconnect.
- Added a WHOOP Sync control and compact recovery, sleep, HRV, resting-heart-rate and strain summary in Settings.
- Fixed Netlify Lambda-compatible Blobs initialization so OAuth state, encrypted tokens, sync records and webhook deduplication can persist in production Functions.
- Switched the Blobs store to Lambda-compatible eventual consistency so integration status reads do not require an unavailable uncached edge URL.
- Added a WHOOP-style Today recovery card to Home with recovery score, sleep, HRV, resting heart rate, strain, connection states and one-tap sync.
## Strength Block 01 logger update

- Added the fixed 4-week strength block with two sessions and the agreed exercise prescriptions.
- Added simple Working Max and Last-session context to the live strength logger.
- Bumped the service-worker cache so installed PWAs receive the updated logger.
