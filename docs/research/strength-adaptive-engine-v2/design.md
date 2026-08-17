# THE Hybrid Engine — Product and Technical Design

Status: living source of truth for the current Hybrid Engine build.

This document was drafted from the supplied THE-HYBRID-ENGINE1-main archive, its
source files, build notes, changelog, schema, and the TrainHeroic-style builder
screenshots. It describes what is currently implemented, what is intentionally
parked, and what still needs a product decision.

## 1. How Claude must use this document

1. Read this document before changing code.
2. Treat the current implementation sections as facts about the supplied build.
   Treat the open decisions section as unresolved; do not silently choose a
   direction that changes the product.
3. Inspect the existing source before replacing or restructuring it. The app is
   already a working local-first PWA with integrations and a separate coach
   surface. Do not reduce it to a visual mockup.
4. Preserve working behaviour unless a change is explicitly requested.
5. Keep the athlete app and coach app as separate entities with one explicit,
   tested data boundary between them.
6. Never put workout logging/result fields into a coach-authored prescription.
   The coach writes targets; the athlete logger writes actual results.
7. After every material change, run the relevant checks and record the result in
   the changelog or implementation notes.
8. Do not copy TrainHeroic branding, private assets, or proprietary code. The
   screenshots are a reference for layout and interaction quality.

## 2. Product definition

THE Hybrid Engine is a hybrid strength-and-conditioning training system. It has
two connected products:

- Athlete app: a phone-friendly training logger that presents today's work,
  records completed sets and conditioning sessions, adapts conditioning to
  recovery, and shows history/progress.
- Coach app: a TrainHeroic-inspired authoring tool that organises programs into
  weeks, days, and sessions, prescribes exercises set by set, and publishes a
  session to an athlete's calendar.

The app is designed around a short loop:

~~~text
Plan → Schedule → Train → Log → Recover → Review → Progress
~~~

The major product principles are:

- Local-first and usable offline.
- Fast, low-friction interaction on the gym floor.
- A calm, premium, instrument-like visual language rather than a noisy social
  fitness feed.
- Strength and conditioning in one system, including hybrid sessions.
- Recovery information should guide decisions without overwhelming the user.
- Prescription data and logged results must remain separate.

## 3. System boundary

~~~mermaid
flowchart LR
  Coach["Coach app /coach"] -->|Target-only session snapshot| Bridge["HybridEmit boundary"]
  Bridge --> Supabase["Supabase assignments"]
  Supabase --> Athlete["Athlete PWA"]
  Athlete --> Local["Local-first state"]
  WHOOP["WHOOP"] -->|Recovery/API or HR broadcast| Athlete
~~~

### Entity 1 — Athlete PWA

Files:

- index.html — app shell, markup, CSS, screens, and navigation slots.
- app.js — local-first engine, rendering, logging, conditioning, import, sync,
  WHOOP wiring, and interactions.
- service-worker.js — static shell caching and update handling.
- manifest.json and icons/ — install surface.

The athlete application runs locally without an account. Cloud sync and WHOOP
are optional enhancements.

### Entity 2 — Coach app

Files:

- coach/index.html — coach builder shell and TrainHeroic-style layout.
- coach/js/app.js — coach library model, editor rendering, local persistence,
  prescriptions, supersets, auth, cloud library sync, and assignment publishing.
- coach/js/emit.js — the only supported conversion boundary from coach data to
  athlete-phone workout data.
- coach/js/config.js — coach Supabase client configuration.
- coach/coach-builder-trainheroic.html — standalone visual prototype/reference;
  not the primary coach runtime.

### Boundary rule

HybridEmit converts a coach session into the athlete phone's workout shape. It
preserves supported targets such as reps, time, RPE, and supersets, but never
writes athlete-owned result fields such as aVal, aVal2, felt, done, or note into
a target prescription.

## 4. Repository map

| Area | Responsibility |
|---|---|
| index.html | Athlete PWA shell and screen containers |
| app.js | Athlete state, UI, logger, calendar, library, import, conditioning, progress, sync |
| hybrid-engine-design-mock.html | Original athlete design source |
| coach/index.html | Coach builder UI shell |
| coach/js/app.js | Coach authoring and publishing logic |
| coach/js/emit.js | Coach-to-athlete contract |
| supabase-schema.sql | Athlete sync plus coach library, links, programs, assignments, and RLS |
| netlify/functions/ | Server-side WHOOP OAuth, sync, webhook, token storage, and integration status |
| integrations/whoop-adapter.js | Browser-side normalized WHOOP contract |
| native/android-app/ | Android WebView shell with native HR, wake-lock, and file bridges |
| native/windows/ | Tauri Windows wrapper |
| checks/ | PWA, browser, coach, emit, WHOOP, deployment, security, and torture checks |

## 5. Users and roles

### Athlete

The athlete uses the phone app to:

- See today's planned session.
- Start or resume a session.
- Log sets, actual weight, reps, seconds, RPE, completion, and notes.
- Use the rest timer.
- Swap an exercise during a session while retaining targets and logged work.
- Run standalone or hybrid conditioning sessions.
- Review recap, history, exercise history, PRs, and progress.
- Connect WHOOP or use simulated conditioning data.

### Coach

The coach uses the coach app to:

- Create and organise programs.
- Navigate weeks and seven day slots.
- Author sessions.
- Add exercises and set prescriptions.
- Change prescription measurement columns.
- Add cues, suggested swaps, and points of performance.
- Link adjacent exercises into supersets.
- Publish a session to a date on a phone calendar.

### Self-coached user

The same Supabase account can act as both coach and athlete. The coach app's
Assign to phone flow supports this directly.

The database also contains the groundwork for a coach-to-athlete relationship,
token-gated invites, and multiple athletes. The visible coach UI is not yet a
complete multi-athlete management product.

## 6. Athlete navigation and screens

The primary athlete bottom navigation is:

1. Home
2. Training
3. Library
4. Settings

The logger is a detail view of Training, not a separate primary tab.

### Home

Home is designed to be read at a glance. It contains:

- Welcome/header area.
- Sunday-first week strip.
- Today's session or honest rest-day state.
- Start today's session or Resume action.
- WHOOP recovery/strain rings.
- Readiness advice based on recovery and planned-versus-felt RPE.
- Today's heart-rate-zone card.
- Weekly zone targets.
- Small summary/stat cards.
- Quick actions for creating or adding a session.

The week strip can open History for a selected day. Planned days and trained days
are visually distinguished.

### Training

Training is the session map and live workout surface. It shows:

- Session header and recovery interpretation.
- Progress through the session.
- Blocks and exercises.
- Superset groups.
- Prescription summaries.
- One expanded exercise logger at a time.
- A final Mark session complete action.

Tapping an exercise opens its set-by-set table in place. Previous/Next controls
allow guided movement through the session.

### Logger

The logger is intentionally compact and gym-focused.

Each exercise row shows:

- Letter marker: A, B, or C1/C2/C3 for supersets.
- Exercise name.
- Prescription summary.
- Current completion state.

The expanded table uses:

~~~text
SET · TARGET · KG · REPS · RPE · ✓
~~~

Depending on the exercise mode, only relevant fields are displayed. Ticking a
set can autofill blanks from the previous session, starts the programmed rest
timer, and advances naturally through a superset.

The logger owns actual-result fields. It must not mutate the coach target model.

### Library

Library is the central shelf for saved work. It has three internal areas:

- Sessions — saved strength/hybrid session templates.
- Conditioning — standalone conditioning formats and recent sessions.
- Progress — strength, RPE, recovery, zone, and conditioning trends.

The Sessions area contains:

- Search.
- Create Session Template.
- Saved-session rows/cards.
- Exercise summaries.
- Add/schedule action.
- Three-dot menu with edit, duplicate, and delete.

Home's plus action can either create a new strength/conditioning session or add a
saved session from the Library to a chosen date.

### Calendar and scheduling

The app supports recurring weekday scheduling and one-off date scheduling.

- A session can be added to today or a future date.
- Long-pressing a session opens Move, Delete, or Cancel.
- Move uses a date picker and must move the session rather than duplicate it.
- Delete uses confirmation and records deletion tombstones for sync safety.
- A coach-assigned session is removed from its underlying assignment when deleted
  or rescheduled.

### History and recap

History shows completed and incomplete sessions by day, including logged sets,
per-set notes, conditioning results, and session status.

Recap after completion shows:

- Volume.
- Sets completed.
- Planned-versus-felt RPE verdict.
- Heart-rate zones for hybrid sessions.
- Records/PRs.
- Links to exercise history.

### Exercise history and progress

Exercise history is reachable from recap, History rows, the logger history link,
and Progress. It contains best sets, estimated 1RM trends, and past sessions.

Progress contains:

- Session count.
- Weekly volume.
- Day streak.
- Training-volume chart.
- Planned-versus-felt RPE chart.
- WHOOP recovery chart.
- Conditioning zone bars.
- Interval progression cards.
- Top lifts.

Charts are inline SVG and should remain dependency-free unless explicitly changed.

### Conditioning

Conditioning supports:

- Steady-state Zone 2.
- Intervals.
- Tempo.
- Custom format.
- Free run.
- Simulated HR demo.
- WHOOP HR Broadcast through Web Bluetooth on supported browsers.
- Native Android HR bridge through window.AndroidHR.

The screen shows live BPM, current zone, phase/round timer, zone-time banking,
zone-coloured HR trace, and vibration/audio cues where supported.

Results include duration, average/max HR, zone-time breakdown, HR recovery, and
estimated calories. Real sessions affect conditioning progression; demo sessions
do not.

### Import

The importer accepts:

- Written/pasted workout text.
- Photo/screenshot OCR using bundled Tesseract or native Android OCR.
- Voice dictation using browser speech or the native Android bridge.

The parser creates a workout template, asks inline questions only where genuine
ambiguity exists, learns approved shorthand into a synced lexicon, and opens the
result in the Builder.

### Settings

Settings contains:

- Local/cloud sync status.
- Sign in, sign out, password reset, and Sync now.
- WHOOP connect, sync, and disconnect.
- Training profile including age, resting HR, and observed max HR.
- Conditioning zone targets.
- Gym setup: bar weight and owned plates.
- Export backup.
- Import/restore backup with confirmation.
- Reset local data.

## 7. Coach navigation and builder

The coach app is a desktop-oriented authoring surface with a responsive layout.

### Coach shell

- Dark navy top bar.
- Program selector showing the active program name.
- Messages, notifications, avatar, and sync status controls.
- Dark icon rail containing Coach Home, Athletes, Teams, Library, Analytics, Gym
  Tools, and Support.
- Light workout-navigation panel.
- Warm off-white editor workspace.

The current visible implementation makes Library the functional rail item. The
other rail items are visual placeholders until their products are built.

### Week/day navigation

The left workout panel shows:

- Current week label.
- Seven numbered day buttons.
- Rest-day state for empty days.
- Session Preview.
- Session title.
- Exercise letters and prescription summaries.

The top program menu can:

- Switch programs.
- Create a new program.
- Rename the current program.

The week menu can:

- Switch weeks.
- Add a week.

### Coach editor

For a populated day, the editor shows:

- Week/day heading.
- Assign to phone.
- Save.
- Delete session.
- Editable session title.
- Coach Instructions field with character count.
- Section label such as Strength/Power.
- Section selector.
- Trophy/control area and section menu.

Each exercise card contains:

- Letter marker.
- Exercise selector.
- Set count.
- Remove exercise control.
- Exercise Instructions field.
- Video thumbnail/play affordance.
- Edit Swaps link.
- Suggested Swaps text.
- Collapsible Points of Performance list.
- Prescription summary.
- Save Prescription button.
- Editable set-by-set prescription table.
- Add set and Remove set controls.

Adjacent exercises can be linked with a chain control. Linked exercises are
labelled A1/A2, B1/B2, and so on in the preview and are transmitted as a superset
block to the phone.

### Prescription table

The table has a set-number column and configurable measurement columns. Current
measure options are:

- Reps
- Weight (lb)
- Weight (kg)
- Weight (%)
- Weight (LWP+)
- RPE
- Time (min:sec)
- Distance (miles)
- Distance (yd)
- Distance (ft)
- Distance (inches)
- Distance (meters)
- Height (inches)
- Calories (cal)

The dropdown is white, scrollable, and opens over the table. The screenshots
show the same dropdown at different scroll positions.

### Coach assignment

Assign to phone:

1. Coach opens a populated day.
2. Coach selects Assign to phone.
3. Coach selects a calendar date.
4. The session is converted through HybridEmit.
5. The target-only snapshot is inserted into assignments.
6. The athlete app reconciles assignments during sync/foreground.
7. The phone materializes the assignment as a calendar workout.

The coach app requires the same account or an active coach-athlete relationship.

## 8. Data model

### Athlete local state

Local storage key: hybrid-engine-v1.

~~~js
{
  workouts: [
    {
      id,
      name,
      days: [0..6],
      dates: ["YYYY-MM-DD"],
      blocks: [
        {
          id,
          heading,
          minutes,
          format,
          superset,
          exercises: [
            {
              id,
              name,
              mode,
              tempo,
              rest,
              sets: [{ t, rpe }]
            }
          ]
        }
      ]
    }
  ],
  sessions: [
    {
      id,
      workoutId,
      name,
      date: "YYYY-MM-DD",
      status: "active" | "completed" | "incomplete",
      startedAt,
      completedAt,
      blocks: [
        // workout snapshot plus athlete-owned set fields:
        // aVal, aVal2, felt, done, note
      ]
    }
  ],
  settings: {}
}
~~~

Supported athlete strength modes:

- reps_kg — Reps + Kilos.
- amrap — Max reps.
- seconds — Seconds.
- reps_seconds — Reps + Seconds.
- reps — Reps only.
- completion — For completion.

Conditioning blocks use kind: conditioning, condFmt, targetZone, and minutes,
and intentionally have no exercises.

### Coach local state

Local storage key: hybrid-coach-v1.

~~~js
{
  programs: [
    {
      id,
      name,
      weeks: [
        {
          days: [sessionOrNull, sessionOrNull, sessionOrNull,
                 sessionOrNull, sessionOrNull, sessionOrNull,
                 sessionOrNull]
        }
      ]
    }
  ],
  sel: { p, w, d }
}
~~~

~~~js
session = {
  title,
  note,
  section,
  exercises: [
    {
      id,
      name,
      cols: ["Reps", "Weight (lb)"],
      sets: [["5", "155"], ["5", "155"]],
      cues,
      swaps,
      pop: ["Point of performance"],
      link: false
    }
  ]
}
~~~

### Cloud state

Athlete state is stored as one JSON object in app_state, protected by row-level
security. The coach authoring library is stored as one JSON object in
coach_library.

Coach-athlete relationships use token-gated coach_athletes rows. Programs and
cross-account handoff use programs and assignments. An assignment stores a
self-contained phone-shaped session snapshot so the athlete does not depend on
the coach UI remaining open.

### Ownership rule

~~~text
Coach target:   t, rpe, tempo, rest, prescription structure
Athlete result: aVal, aVal2, felt, done, note, completedAt
~~~

This separation is a hard contract.

## 9. Sync and reliability rules

- Local storage is always the first write path.
- Cloud sync is optional and debounced.
- Workouts and sessions merge record-by-record by ID.
- Scheduled days are unioned.
- Logged history is retained.
- Deletions use tombstones so old devices cannot resurrect records.
- Settings merge additively where required, including conditioning history,
  progression, and import lexicon.
- WHOOP daily cache and device registry remain device-local where specified.
- Coach-originated phone workouts are re-derived from assignments and must not be
  pushed back as user-owned coach templates.
- Incoming cloud/backup data is sanitized before installation.
- Storage-full errors must be visible to the user.
- Active sessions must survive reload and stale sessions must be filed as
  incomplete or dropped if empty.

## 10. WHOOP and conditioning rules

WHOOP OAuth, token exchange, refresh, webhook verification, encryption, and
provider API access stay server-side in Netlify Functions.

The browser receives normalized fields only:

- source
- date
- recoveryScore
- sleepPerformance
- hrvMs
- restingHr
- strain
- capturedAt

Heart-rate conditioning uses:

- Tanaka max-HR estimate: 208 − 0.7 × age.
- Heart-Rate Reserve when resting HR is available.
- Percentage-of-max fallback otherwise.
- Recovery, Conditioning, and Overload bands.
- WHOOP recovery-based daily zone adjustment.
- Autoregulated progression for canonical interval formats.

The user can run a simulated-HR demo without a band. Demo sessions must never
change earned progression.

## 11. Visual design language

### Athlete app

- Dark navy/charcoal shell.
- Warm matte surfaces and recessed input wells.
- Brushed brass/gold brand accent.
- Gold represents completed/done states.
- Green is reserved for heart-rate zones.
- Calm typography with tabular figures for live numeric columns.
- One open logger card at a time.
- Clear touch targets, haptic/vibration cues where supported, and reduced-motion
  support.

### Coach app

- Dark navy top bar and icon rail.
- Warm off-white editor surface.
- Light blue-grey exercise header bars.
- White prescription dropdown menus.
- Compact desktop density similar to the supplied screenshots.
- Thin borders, restrained shadows, small rounded corners, and clear hierarchy.

The browser chrome, laptop frame, glare, reflections, and Windows taskbar from
the supplied photographs are not part of the product.

## 12. Current implementation gaps and placeholders

These are facts to preserve in the design backlog rather than silently treating
them as complete:

- Coach rail destinations other than Library are currently visual/placeholder
  states.
- Coach Edit Swaps currently displays a coming-later toast.
- Coach video thumbnails are presentation placeholders, not a complete media
  library.
- The coach editor's + Add section action currently follows the same path as
  adding an exercise and needs a deliberate section/block design.
- The coach editor exposes more measurement types than the athlete logger can
  natively consume. Unsupported types currently fall back to the nearest phone
  mode while the coach snapshot retains the original source information where
  supported by the boundary.
- Full training-block/progression programming remains parked; weekly day-chip
  scheduling exists.
- Android and Windows wrappers exist, but wrapper changes are separate from the
  web application and should not be mixed into ordinary UI work.
- Browser-dependent smoke tests require Playwright. Static PWA, WHOOP, deployment,
  and contract checks are expected to remain green.

## 13. Acceptance criteria

### Athlete

- The app opens without an account and saves locally.
- A user can create a session template, edit it, duplicate it, schedule it, and
  delete it with confirmation.
- A user can add a session to a date and move it without duplicating it.
- A user can start, resume, log, and complete a strength session.
- Set completion starts the correct rest timer.
- The rest timer survives reload/screen lock where the platform supports it.
- Logger fields match the selected exercise mode.
- Per-set notes appear in History.
- A mid-session exercise swap retains targets and logged work.
- A hybrid session can interleave strength and conditioning.
- Conditioning results appear in History and Progress.
- Import from text, photo, and voice handles genuine ambiguity without silently
  inventing values.
- Cloud sync merges two devices without losing scheduled work or history.

### Coach

- A coach can create/select/rename programs.
- A coach can add weeks and navigate seven days per week.
- Empty days show a rest-day state and can receive a new session.
- A coach can edit the session title and instructions.
- A coach can add/remove exercises and sets.
- Each prescription column is selectable from the supported measurement menu.
- Set values are editable and update the live summary.
- Adjacent exercises can be linked/unlinked as supersets.
- A coach can save and delete a session with confirmation.
- Assignment publishes a target-only snapshot to the phone.
- The phone receives the assignment without receiving logger-owned result fields.

### Security and deployment

- No WHOOP client secret or session secret appears in browser files.
- WHOOP callbacks and webhooks remain server-side and authenticated.
- RLS prevents cross-user data access.
- Service worker never caches authenticated function routes.
- PWA, WHOOP, deployment, emit, and security checks remain green.

## 14. Open decisions requiring the product owner

Answer these before Claude performs a large redesign:

1. Is the Coach app now the main priority, or is the athlete app still the main
   product with the coach builder as a secondary surface?
2. Should the TrainHeroic screenshots define only the coach visual design, or
   should their full measurement system also become the athlete logger's system?
3. Should the coach app start with the seeded sandbox program, or should new
   accounts start completely empty like the athlete Library?
4. What are the exact seven foundational movement patterns?
5. Is the target audience only you/self-coached, or must multi-coach/multi-athlete
   management be completed now?
6. Should coach-created sessions become reusable athlete templates, scheduled
   one-off sessions, or both?
7. What should + Add section create: a named block, a new training category, or
   another exercise group?
8. Should exercises have a real media library now, or are video placeholders
   acceptable for the next milestone?
9. Which coach metrics must survive into the phone logger: reps, weight, RPE,
   time, distance, calories, height, percentage, or all of them?
10. What is the required mobile behaviour for the coach builder? Responsive
    desktop layout, mobile editing, or desktop-only authoring?
11. What app name, logo, colours, and terminology are final?
12. Which current features are mandatory for the next release, and which should
    be hidden or parked?

## 15. Required working method for future changes

Before changing code:

1. Identify the affected entity: athlete, coach, bridge, backend, or native
   wrapper.
2. State the user flow being changed.
3. Update this document if the data model or behaviour changes.
4. Implement the smallest coherent change.
5. Test the affected flow in a real browser where possible.
6. Run the relevant static/contract checks.
7. Check mobile and desktop layout for UI changes.
8. Record the change and any remaining limitation.

The final goal is not merely a similar-looking screen. The goal is one coherent
training system in which the builder, schedule, logger, history, recovery data,
cloud sync, and coach-to-athlete handoff all agree on the same data ownership
rules.
