# THE HYBRID ENGINE — Handoff Bundle

A local-first PWA training app plus a data migration from a TrainHeroic export.
This bundle is a snapshot for another engineer/agent to continue from.

## What's here

```
app/                        Deployable app source (Netlify). Single-file PWA: all
                            logic is inline in app/index.html (~150KB). Service-worker
                            cache is at v13. netlify/functions/ handle WHOOP OAuth only.
imports/
  THE-hybrid-top100-import.json   Ready-to-import backup: 100 exercises + 167 sessions.
  hybrid-baselines.md             All-time starting-load reference (kg) for key lifts.
harness/                    Headless-Chromium test harness (Playwright). See "Testing".
source-data-trainheroic/    Raw TrainHeroic CSV export (source of truth for regeneration).
```

## App architecture (quick orientation)

- **Storage is local-first.** All training data (S.sessions, S.exercises, S.templates)
  lives in the browser's localStorage on the device. There is NO server-side store for
  workout data. Data does not sync between devices/browsers — each has its own copy.
  ~5MB localStorage ceiling; the whole state is rewritten on every `save()`.
- **Import/export**: Settings → Save & Backup → Import backup. Import MERGES (dedupes by
  id, then case-insensitive name); it never deletes. `mergeImportPayload` /
  `extractImportPayload` in index.html define the accepted envelope
  (`{backupVersion, kind, state:{exercises, sessions, templates, dailyCheckins}}`).
- **Key data shapes**:
  - exercise (library): `{id, name, category, builtIn, source}`
  - template exercise: `{id, exerciseId, name, category, mode, sets, reps, restSec, coachNote}`
  - `mode` ∈ `reps_kg | seconds | reps_seconds | reps | completion`
  - session: `{id, name, date, status, tasks:[...], summary:{duration, sets, tonnage}}`
  - strength task: `{kind:'strength', name, rows:[...]}`; row: `{n, target, mode, reps, weight, seconds, done, extra}`
  - tonnage = Σ(weight×reps) over done rows in weighted modes.

## What was changed in the app (vs the uploaded clean-v1)

Rebuilt the "focused tracking" Logger/Builder layer that had been reset out:
- Per-exercise tracking mode chosen in Builder (5 modes; %1RM intentionally deferred).
- Builder lays each set on its own row; live prescription preview; mode chip per exercise.
- Live Logger renders ONLY the fields for the chosen mode + a dedicated Done column;
  removed the extra-set stepper and rest-prescription line (rest timer kept); the
  exercise cue shows as an instruction banner at the top.
- Supersets respect per-exercise mode; read-only round overview retained.
- Calendar session cards suppress empty stats (no more "00:00 · 0 kg").
- Removed the orphaned extra-set add/remove helpers.
- Legacy templates/sessions with no `mode` default to reps_kg (no migration needed).

Full log: app/changelog.md (top entries).

## The import file (imports/THE-hybrid-top100-import.json)

- **100 exercises**, each with 9+ actually-logged sets (real weight) across the full
  history. Grouped into 8 movement patterns, ordered 1 Squat → 2 Hinge → 3 Push →
  4 Pull → 5 Olympic/Power → 6 Arms → 7 Shoulders → 8 Carries; most-used first within group.
- **167 completed sessions** from the last 18 months (from 2025-01-18). Only rows with
  real weight>0 AND reps>0 are included; empty/weightless rows and sessions are dropped.
- History is restricted to the top-100 movements on purpose: the app auto-adds any
  exercise found in imported history to the library, so a strict 100-exercise library
  requires a 100-exercise history.
- Weights were stored as pounds in the export but are exact-kg conversions; restored to kg.

**To apply cleanly:** deploy the app, then Settings → Danger zone → Reset local data →
Import backup → this file. (Reset first because import can't remove earlier merges.)

## Testing (harness/)

Node + Playwright, drives the real app headlessly against a local static server.

```
cd harness
# lib.mjs serves ../app (set APP_ROOT to override) and exposes withPage()
node flow.mjs        # exercises all 5 tracking modes end-to-end; asserts tonnage
node top100.mjs      # imports the top-100 file; checks picker order, calendar, memory
```
Requires the `playwright` package + a Chromium at PLAYWRIGHT-configured path.
`lib.mjs` imports playwright via an absolute path — adjust for your environment.

## Known gaps / suggested next work

- **No exercise-library browser screen** and **no history/review screen.** The 15 July
  reset removed them, so 100 imported exercises + 167 sessions currently only surface via
  the Builder "Add exercise" dropdown and by tapping individual calendar days. The
  calendar is week-at-a-time — painful for reviewing 18 months. Highest-value next build:
  a searchable exercise library screen (with per-exercise history) and a scrollable
  completed-session history/month view.
- %1RM tracking mode was deferred (would need per-exercise 1RM entry in Builder).
