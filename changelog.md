# Changelog

## First-cycle templates — 15 July 2026

- Added blank native Library templates for Full Body Day 1 — Bench, Full Body Day 2 — Squat and Full Body Day 3 — Deadlift.
- Preserved the recovered exercise order and the Day 2 Pendlay Row naming note.
- Kept all set, rep and load prescriptions empty; the Logger now adds the first set only when the athlete chooses it.
- Added map “+” controls to group adjacent strength exercises into supersets.
- Repaired map movement for instruction blocks so Warm-up can move to the top and Cool-down can move to the bottom.

## Streamlined build — 13 July 2026

- Removed legacy readiness, Coach Tools and program-first clutter from the primary flow.
- Home now focuses on active, scheduled and newly created workouts.
- Calendar starts workouts directly without an extra preview step.
- Library cards now use Edit in Builder and Schedule as the primary actions.
- Strength logging no longer exposes RIR or estimated 1RM controls.
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
- Documented the live Netlify domain and planned WHOOP/Strava callback URLs.
## 2026-07-14 — Function-enabled integrations

- Added Netlify Functions for WHOOP and Strava OAuth, token refresh, sync, disconnect, and webhook handling.
- Added encrypted server-side token storage using Netlify Blobs; no provider secrets or tokens enter the static app.
- Added a compact Connected data entry point inside Settings without changing the main navigation, colors, or core logging flow.
- Added OAuth state/session protection, WHOOP HMAC verification, Strava challenge verification, webhook deduplication, and a cache version bump.
- Hardened WHOOP V2 pagination, date normalization, timeout/error handling, rotating refresh-token races, stale webhook rejection, and provider revocation on disconnect.
- Added a WHOOP Sync control and compact recovery, sleep, HRV, resting-heart-rate and strain summary in Settings.
- Fixed Netlify Lambda-compatible Blobs initialization so OAuth state, encrypted tokens, sync records and webhook deduplication can persist in production Functions.
- Switched the Blobs store to Lambda-compatible eventual consistency so integration status reads do not require an unavailable uncached edge URL.
- Added a WHOOP-style Today recovery card to Home with recovery score, sleep, HRV, resting heart rate, strain, connection states and one-tap sync.
