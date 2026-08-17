# Jarvis Takeover Audit

Date: 2026-07-12

## Executive verdict

The Codex handoff was not safe to treat as the production Hybrid Engine. It was an incomplete modular prototype that had not passed its declared release gates and removed a substantial amount of functionality present in the mature Builder Clean application.

The production decision was therefore:

1. Restore the mature Builder Clean/V7 application as the authoritative product.
2. Apply only evidence-backed data-safety and packaging repairs.
3. Preserve the Codex handoff unchanged as reference material.
4. Build a fresh Android wrapper around the mature application.
5. Keep cloud sync explicitly incomplete until it can be integrated without product regression.

## What was wrong with the Codex candidate

- Its own report stated that the release was incomplete.
- ESLint initially failed in the logger timer code.
- Firebase emulator tests were not run.
- Android Gradle build and device tests were not run.
- External deployment was not performed.
- The candidate UI/source was a much smaller prototype and did not retain feature parity with the mature app.
- The delivered Android scaffold was not accepted as the production wrapper.

## Repairs applied to the mature app

### Data and migration safety

- Removed the embedded recovered personal workout from production source.
- Replaced destructive template migration behaviour with preserve-first migration.
- Existing Lift A, Lift B, Conditioning A and Conditioning B content now wins over bundled defaults.
- Historical sessions are no longer deleted by the repaired migration path.
- Unsupported or legacy templates are archived instead of silently dropped.
- Saving a core workout no longer deletes unrelated imported templates.
- Early load cleanup no longer discards legacy template/program information before migration.
- Full reset clears primary state, recovery snapshots, legacy Hybrid keys and cache entries.

### Product preservation

- Retained the mature logger, workout builder, calendar, readiness, history, analytics and backup/restore behaviour.
- Retained the four-workout weekly system.
- Corrected the default schedule to Monday, Tuesday, Thursday and Friday.

### Technical cleanup

- Removed one proven obsolete duplicate exercise-library implementation while preserving the newer active version.
- Added a native-platform guard so service-worker/PWA registration is suppressed inside the Android application.
- Updated release identity and cache naming to V7.1 Jarvis Takeover.

### Android

- Generated a fresh Capacitor 8 Android project from the validated mature web build.
- Confirmed Capacitor dependency alignment with `npx cap doctor android`.
- Synced the deploy build into the Android project.
- Added Hybrid Engine launcher and splash artwork.
- Added a GitHub Actions job that builds and uploads a debug APK in an internet-enabled build environment.

## Release decision

Approved as a repaired **source and deployment candidate**, subject to physical Android testing.

Not approved as a completed cloud-sync release. No claim is made that phone and laptop data currently merge through an account.
