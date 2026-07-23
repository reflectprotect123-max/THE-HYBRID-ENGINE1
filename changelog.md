# Changelog

## The Library Release — three tabs, a real Library, Home you can read at a glance — 25 July 2026

The app reorganised around how you actually use it: a home you glance at, a place
you train, and one shelf that holds everything else.

**Three tabs: Home · Training · Library.** The bottom bar is down to three. Builder,
Conditioning and Progress all moved under a new **Library** — each on its own tab
(Sessions · Conditioning · Progress), styled like the athlete app: a LIBRARY title,
a search box, a "Create Session Template" card, and a row per saved session with its
exercise summary, an **Add** button and a ⋮ menu (edit · duplicate · delete).

**Home shows today.** Your saved sessions live in the Library now, not scattered on
the front page — Home shows only what's actually on for today, plus a new **Today's
heart-rate zones** card (the conditioning front page, surfaced) sitting right by your
WHOOP rings. Those rings are now **bright neon** — a glowing cyan strain ring around a
neon recovery ring — so recovery reads in a glance.

**A + button that schedules.** Tap **+** on Home to add a session to today or any day
ahead: **Create Session** (pick Strength or Conditioning, then build it as you go) or
**Add From Library** (drop a saved session onto the chosen day). Sessions can be
scheduled for a specific date, not just a recurring weekday.

**Gone: the demo template.** The app no longer seeds a blank six-block placeholder —
you start clean and add exactly what you want. Any leftover copy of the old seed is
cleared automatically.

## The Athlete Release — new Logger, recap, PRs, custom conditioning — 24 July 2026

The phone app rebuilt around one loop: show today's work, log it fast, adapt to
your recovery, prove your progress. Four phases in one release:

**The Logger (the blessed design, live).** The session view IS the logger now:
every exercise a collapsed row — letter chips (A, B; supersets share a letter as
C1/C2/C3), live state, rx summary — and tapping one opens its per-set table in
place: SET · TARGET (your prescription, ghosted) · KG · REPS · RPE · ✓. Ticking
a set autofills blanks from last time, starts the rest ring, and supersets flow
to the next movement automatically. One card open at a time; the whole day
readable at a glance.

**The app remembers.** Finish a session and a recap screen marks the moment:
volume, sets done, planned-vs-felt RPE verdict, HR zones if the day was hybrid —
and any records you set. New per-exercise history: best set, estimated-1RM
(Epley) trend chart, every past session; reachable from the recap, History day
rows, the logger's "history ›" link, and a new Top lifts card on Progress.

**Conditioning depth.** A Custom format (your rounds / work / rest, editable on
the setup screen) and a Free run mode (open-ended — just track HR, finish when
done). Both record zones and HR recovery like everything else; the earned
progression stays reserved for the three canonical formats.

**Reliability + readiness.** The rest-timer buzz now fires from a native alarm
even when the screen is off (WebView timers throttle — the phone itself keeps
time now). The session header shows your recovery and what it means today
("green light — push the top sets" / "take −1 RPE today and win anyway"), and
Home gains the one dominant tap: Start today's session / Resume.

Native shell **v2.8.0 (versionCode 13)**. Service-worker cache v54. All six
suites green, logger tests rewritten to the new behaviors.


## Always-visible Settings — 23 July 2026

Fixed a real gap: **Settings** (cloud sync, WHOOP, profile, export/import backup)
was only reachable through the WHOOP chip on Home — which only appears once WHOOP
is connected and synced. If you weren't on WHOOP, there was no way to open Settings
at all. Added a permanent **gear button in the Home header** that opens Settings
regardless of WHOOP state.

Native shell **v2.7.1 (versionCode 12)**. Service-worker cache v53.


## Weekly zone targets, live zone-time, transitions & a proper rest ring — 23 July 2026

Four bigger UI/UX builds:

- **Weekly zone targets (Morpheus banking).** Home and Progress now show three
  rings — Recovery / Conditioning / Overload — filling toward a weekly
  target-minutes goal (60 / 45 / 12 by default), banked from your sessions. Turns
  the trend charts into something to hit.
- **Live "time in zone" + streak.** During a conditioning session the live screen
  shows a colour bar of the minutes you've banked in each zone so far, and a
  "🔥 in zone" flame appears while you're holding your target zone.
- **Screen transitions.** Navigating now fades-and-lifts each screen in (respects
  reduced-motion) so the app feels less like hard page swaps.
- **Rest timer, redesigned.** The rest chip is now a circular countdown ring around
  the clock — glanceable from across the gym — and it survives a reload with the
  ring intact.
- **Logger orientation.** A session-progress bar ("3 of 7 done · 43%") sits under
  the header so you always know how far through the workout you are.

Native shell **v2.7.0 (versionCode 11)**. Service-worker cache v52. All six suites
green, plus a new regression test for the weekly zone-target maths.


## Visual polish pass — 23 July 2026

Small, high-value UI/UX touch-ups after the debug sweep:

- **Home "Last recovery"** now shows your actual recovery %, colour-coded
  (green / amber / red), instead of a blank dash when a WHOOP score is available.
- **Live conditioning gauge** — the big BPM number now stacks cleanly over "BPM"
  and the current zone name, and the zone name is painted in its own zone colour
  (blue / green / red) instead of wrapping awkwardly.
- **Phase bar** reads the format name during warm-up instead of a meaningless
  "Round 0 / N".
- **Progress → Conditioning** leads with an "Interval progression" card showing the
  level you've earned per format and the target it now serves (e.g. Intervals ·
  Lv 3 · 9×35s / 85s) — the autoregulation made visible in your trends.

Native shell **v2.6.2 (versionCode 10)**. Service-worker cache v51. All six suites green.


## Debug pass: crash fixes + a real cloud-sync data-loss fix — 23 July 2026

A full debug sweep (static review across three subsystems + a runtime driver that
exercises every flow and edge case). Findings, all fixed:

- **Cloud sync silently dropped settings — data loss.** The sync fingerprint only
  hashed workouts and sessions, so anything stored under settings — your
  **progression levels, standalone conditioning history, and HR profile
  (resting/observed max)** — never reached the cloud, and could be **overwritten by
  a stale second device** on reconcile. Now settings are part of the fingerprint
  (minus the device-local WHOOP daily cache), and a new merge keeps additive data
  safe on both push and pull: progression never regresses (max level per format),
  conditioning history and the learned import lexicon are unioned, never clobbered.
- **Conditioning blocks could crash the app.** A conditioning block has no
  exercises; several core functions (Home volume/RPE stats, readiness card,
  Builder name list, session auto-create, "last time" lookup, preview) iterated
  exercises without guarding, so a hybrid workout coming from cloud/import/in-session
  could blank a screen. All guarded. The root cause — the data sanitizer injecting a
  phantom blank exercise into every conditioning block on load — is fixed too.
- **Cloud pull and backup import now sanitize** incoming data (a second device or a
  hand-edited backup can't install malformed blocks).
- **Storage-full is no longer silent** — a full device now surfaces a clear "not
  saved" warning instead of pretending the save worked.
- **Result mis-filing hardened** — a conditioning result now finds its block by id
  (survives reordering), and an explicit tested max HR is authoritative (no silent
  auto-raise over a number you entered).

- Native shell **v2.6.1 (versionCode 9)**. Service-worker cache v50.

Verified: all six suites green, plus new regression tests for the settings-sync
fingerprint, the additive merge, and the no-phantom-exercise sanitizer; and a
runtime driver that pushes 14 flows/edge-cases with zero console errors.


## Intervals that progress themselves — the Morpheus autoregulation model — 23 July 2026

Your interval sessions now get harder as *you* get fitter — and back off when you
don't — instead of staying frozen at 8×30/90 forever. This is how Morpheus does
it: not a fixed ladder, but **autoregulation** from the metrics we already record.

Two coupled loops:
- **An earned baseline.** After every real session, the app reads that session's
  metrics — time held in the Conditioning/Overload zones, your 60-second HR
  recovery versus your recent median, whether it was sustainable — and steps a
  hidden per-format **level** up when your body shows it adapted. Miss the mark
  twice and it eases back so you keep progressing rather than stalling. When it
  climbs, it rotates the levers for balanced overload: **add a round → lengthen
  work → trim rest**, each capped.
- **A daily readiness gate.** Today's actual prescription is your earned baseline
  *scaled by your WHOOP recovery*, on the same 80/40 bands the zones use. A red
  day deloads **today only** (a round off, or longer rest) without touching your
  hard-earned level; a green day serves the full thing.

Nothing changes silently: the conditioning screen shows today's exact
prescription and why (`9×35s / 85s · Level 3 · strong recovery`), the results
screen tells you when you stepped up and what's next, and the Builder block
previews what it'll serve. Demo runs never move your baseline, and a level-0
profile is byte-for-byte the old session — so nothing you've done changes until
you earn it.

- Native shell **v2.6 (versionCode 8)**. Service-worker cache v49.

Verified: all six suites green — the smoke test asserts level-0 equals the base
session, that a strong on-target session steps the level up, and that a
red-recovery day deloads today without changing the earned baseline.


## The hybrid session + Morpheus-grade heart-rate zones — 23 July 2026

Strength and conditioning stop being two separate apps. One workout can now
interleave set-by-set lifting with live heart-rate conditioning pieces — the
Morpheus "mixed" model — and the whole zone engine was rebuilt to match how
Morpheus actually trains.

**Heart-rate zones — the best-evidence formula.**
- **Max HR** now uses **Tanaka (208 − 0.7 × age)**, the meta-analysis-validated
  formula that beats 220 − age (which overestimates for the young and
  underestimates past ~40), and **auto-raises** to any higher beat you hit in a
  session — exactly what Morpheus does.
- **Zones compute on Heart-Rate Reserve** (Karvonen: `resting + pct × (max −
  resting)`) whenever your resting HR is known — from Settings or straight from
  WHOOP — the gold-standard, fitness-individualised method. It falls back to
  %max cleanly with no band.
- Three bands are now **Recovery / Conditioning / Overload = blue / green / red**
  (Morpheus's palette; colour-blind-checked), and they **re-zone every day with
  your WHOOP recovery, asymmetrically**: a low-recovery day broadens blue and
  drops the overload line so "hard" arrives sooner; a high-recovery day expands
  green and lifts overload so you can safely push.
- Settings shows the method in use, a resting-HR input, and today's bpm ranges.

**One hybrid workout.**
- Builder gains **♥ Add conditioning** — a block with a format (steady /
  intervals / tempo) and a target zone, no exercises.
- The session runs strength rows and a live heart-rate conditioning row in one
  place; finishing the conditioning piece writes its result onto the block and
  returns you to the workout. Standalone conditioning (the Conditioning tab) is
  unchanged.
- History and Progress show conditioning from both hybrid sessions and
  standalone runs. Existing workouts and saved data are untouched (blocks
  default to strength).
- Native shell **v2.5 (versionCode 7)**. Service-worker cache v48.

Verified: all six suites green (browser-smoke now builds and runs a full
strength-plus-conditioning session, and asserts the Tanaka value, the HRR/%max
method switch, and the blue/green/red bands).


## Importer gains voice: just say your workout — 23 July 2026

Third way into the importer, alongside type/paste and photo: **speak it.**

- **Say it** button → dictation streams into the box live, then runs the
  same parser + review + learning. Speak an exercise at a time (natural
  pauses = clean lines).
- **Speech is tidied for the parser:** number words → digits ("four by
  eight" → 4x8), "at RPE eight" → @RPE8, "three minutes" → 3min, "thirty
  seconds" → 30s, "into/then" → new lines, "a hundred kg" → 100kg. Run-on
  sentences are split before each "<number> <movement>".
- **Two engines, one behaviour:** the installed app uses Android's
  on-device SpeechRecognizer via a new native bridge (free, offline,
  auto-restarts for continuous dictation); Chrome uses the Web Speech
  API; unsupported browsers say so. Mic permission handled natively.
- Native shell **v2.3 (versionCode 5)** adds the voice bridge +
  RECORD_AUDIO. Service-worker cache v47.

Honest scope: voice is a fast *capture* — brilliant one-exercise-at-a-time,
and the review screen catches anything a run-on mangles. Verified: all six
suites green (browser-smoke now also asserts prose-as-notes and the voice
tidy pipeline).


## One coherent app: dashboard Home, conditioning everywhere, polish — 23 July 2026

The full UX pass (Tier A–C from the audit):

- **Home is a dashboard now.** Below your plan: quick actions (Start
  conditioning · Import a workout) and glanceable stats (kg this week,
  day streak, last recovery) once you have data. The seed card reads
  "Session template" instead of "Untitled workout". Dead space gone.
- **Conditioning feeds Progress:** a new Conditioning section with
  stacked zone-minutes-by-week bars (Low/Moderate/High), an HR-recovery
  trend, and an average-HR trend. Demo sessions are excluded.
- **Conditioning shows in History:** finished sessions appear on their
  day next to strength work — duration, avg/max HR, HR recovery — and
  tap through to the full results view.
- **One visual language for the body:** recovery bands now share the
  zone palette (green/gold/red) and the strain ring uses the same blue
  as the Low zone — no more neon one-offs.
- **Recovery-driven zones (Morpheus-style):** strong recovery (≥67%)
  nudges work thresholds up 2%, poor recovery (<34%) eases them 4% —
  labelled on the setup screen so it's never silent.
- **Live-session niceties:** a 5s "Get ready" countdown before every
  session, audio cues on phase changes (high beep = work, low = recover)
  alongside the vibration, and a Skip › button to jump an interval.
- **Warmer empty states:** History's quiet days get a proper card;
  Settings' WHOOP errors read like English, not HTTP.
- **Accessibility:** visible gold focus rings on everything interactive,
  aria-labels on back buttons, dim-text contrast raised.
- Service-worker cache bumped to v44. All six suites green (browser-smoke
  32 steps, unchanged assertions all still pass).


## Importer: write it or photograph it — it becomes a template — 23 July 2026

Builder gains "Import from text or photo". Type or paste a workout in any
style — or attach a screenshot/photo — and it becomes a real, editable
template. Free and fully on-device.

- **Meaning-only questions.** It never nags about blank weights or reps
  (those fill at logging time, as always). Only genuine ambiguity — an
  unknown movement, "power primer 3x3" (exercise or section?), a probable
  typo like "test 45s" — appears as an amber chip INSIDE the draft, fixed
  in place. Clean input builds instantly with zero questions.
- **It learns your shorthand.** Every confirmed fix becomes a rule in
  your lexicon (synced with your account): your abbreviations, spellings
  and movements. Two-tier on purpose: vocabulary is learned forever;
  "that section contained X this time" is never generalised. The lexicon
  is visible and editable (tap ✕ to unlearn).
- **Photo/screenshot OCR, on-device.** Self-hosted tesseract.js (WASM)
  reads the image locally — first use downloads ~7 MB, then it's cached.
  The photo never leaves the device; screenshots of typed text read
  near-perfectly (a synthetic screenshot round-trips to a saved template
  in under 2 seconds in tests). Works in the installed Android app, in
  Chrome, and in the Windows app alike.
- **Base library of ~110 movements** with aliases (DL/RDL/OHP/KB/T2B…),
  plus notation for sets×reps, ranges (8-10), per-set lists (8,8,6,6),
  EMOM/AMRAP, "into"/"then 3 rounds" circuits, A1/A2 supersets, timed
  holds, carries, each-side and @RPE.
- Saving opens the template straight in the Builder for a final look.
- Native shell v2.1 (versionCode 3): the in-app file chooser now honors
  the page's accept types, so photo picking works for the importer while
  backup import still filters to JSON.
- CSP: script-src gains 'wasm-unsafe-eval' (WebAssembly only — inline
  script remains blocked; pentest suite unchanged and green).
- Service-worker cache bumped to v43. The OCR engine is deliberately NOT
  in the offline app shell — it loads on demand and browser-caches.

Verified: all six suites pass (browser-smoke 32 steps, incl. a full
importer round-trip with learning assertions), plus a real-OCR
end-to-end: screenshot → text → draft → saved template, no errors.


## Native Android app v2: live heart rate INSIDE the installed app — 22 July 2026

The installed Android app can now do live WHOOP heart rate — no Chrome
needed. The old TWA wrapper could never expose Bluetooth, so it has been
replaced by a small native shell (plain Java, zero dependencies) with a
BLE bridge.

- **window.AndroidHR bridge:** native scan → connect to WHOOP's HR
  Broadcast (BLE heart-rate service) → second-by-second BPM streamed into
  the Conditioning screen. Auto-connects when it sees a WHOOP; shows a
  chooser if several straps are broadcasting; auto-reconnects on dropouts.
- **Runtime permissions handled natively** (Bluetooth on Android 12+,
  location-scoped scan on 7–11), including the "turn Bluetooth on" prompt.
- **Same package, same signing key, versionCode 2** — installing the new
  APK over the old app is a normal in-place update; nothing is lost.
- Native niceties the WebView needed: backup **export** via the system
  file saver, backup **import** via the file chooser, screen keep-awake
  during live sessions, deep links, dark chrome everywhere.
- The web app detects the bridge and prefers it; in plain browsers it
  still uses Web Bluetooth, and the simulated demo works everywhere.
  Service-worker cache bumped to v42.
- CI rebuilt: the Android workflow now compiles the native shell with
  Gradle and publishes to the same `android-latest` release link.

Verified: all six suites pass (31-step browser smoke incl. the
Conditioning demo). The Bluetooth path itself needs real hardware — first
on-device pairing is the remaining validation step.


## Conditioning: live WHOOP heart-rate zone training — 22 July 2026

A fifth tab. Start a conditioning session, connect your WHOOP over
Bluetooth, and train by live heart rate — Morpheus-style.

- **Live capture, for real.** Uses WHOOP's official HR Broadcast (standard
  BLE Heart Rate Service) + Web Bluetooth. Second-by-second BPM with
  automatic reconnect if the signal drops. Works in Chrome on Android and
  desktop; the app detects unsupported browsers and says so plainly.
- **Three formats:** Steady-state (Zone 2 · 20 min), Intervals (8×30s/90s),
  Tempo (10×15s/60s) — warm-up and cool-down included, vibration cues on
  every phase change, round counter, phase clock.
- **Live screen** built once and updated in place (no flicker): zone gauge
  arc, big BPM colored by zone, avg/max, elapsed, and a live HR line
  colored by zone as it draws.
- **Results:** zone-time donut, whole-session HR graph colored by zone,
  max/avg HR, **60-second HR recovery** (peak-to-minute drop — the
  conditioning-fitness marker), and estimated calories. Sessions persist
  (2s-downsampled trace, capped at 40) and ride the normal cloud sync.
- **Zones from your physiology:** 3 bands (Low/Moderate/High) off max HR —
  220 − age by default, tested-max override in Settings → Training profile.
- **Demo mode** with simulated HR runs anywhere — try the whole flow
  without a band (also how CI exercises it, since headless browsers have
  no Bluetooth).
- Wake lock held during live sessions; service-worker cache bumped to v41;
  browser-smoke gains a Conditioning step (nav is now five tabs).

Verified: browser-smoke (31), torture (16), pentest (0 findings), and the
contract/deployment/pwa checks all pass.


## Progress view + Tier-3 polish: trends, skeletons, grain — 22 July 2026

Adds a fourth tab — **Progress** — that turns everything you log into a
picture over time, plus the last layer of visual finish.

- **Progress trends.** Three charts, all drawn as clean inline SVG (no
  libraries, CSP-safe): training **volume by week** (8-week bars), **planned
  vs felt RPE** (two-line, with a legend and direct end-labels), and **WHOOP
  recovery** over the last 14 days. Three stat tiles up top: sessions, kg
  this week, and current day-streak. Each chart has native hover tooltips
  and a single axis with a recessive grid.
- WHOOP recovery/strain is now **persisted daily** (`whoopDaily`, capped at
  120 days) every time status loads or a sync lands, so the recovery trend
  builds itself in the background with no extra work.
- **Empty state.** Before your first finished session, Progress shows a calm
  "nothing to chart yet" card instead of a blank screen; a tip nudges you to
  log target RPE so the planned-vs-felt trend can appear.
- **Skeleton loader.** The WHOOP card now shows a shimmering placeholder that
  matches its real shape while recovery loads, so the layout never jumps.
- **Grain + press feedback.** A barely-there film grain over the whole app
  and tactile :active states finish the Tier-3 pass. All honour
  prefers-reduced-motion.
- Service-worker cache bumped to v40.

Verified: browser-smoke (30), torture (16), pentest (0 findings), and the
contract/deployment/pwa checks all pass.


## UI/UX polish: real Inter, animated ring, press feedback, wake lock — 22 July 2026

- Loaded the real Inter typeface (self-hosted variable woff2, 72 KB) that
  the design was drawn for — previously it silently fell back to system
  fonts. Sharpens every number, heading and the tabular rest timer.
  CSP-safe (font-src 'self') and cached for offline.
- The WHOOP dual ring now animates up from zero to its value on render
  (registered @property arcs), instead of snapping. Honours
  prefers-reduced-motion.
- Tactile press feedback across cards, chips, buttons, nav and the week
  strip; a little confirmation pop when a set is ticked; a slightly
  richer screen-transition ease. All subtle and mock-faithful.
- Wake Lock: the screen stays awake on the Training/Logger screens during
  a live session, so your phone won't sleep between sets. Released when
  you leave; re-acquired when you return.
- Service-worker cache bumped to v39 (adds the font to the offline shell).

Verified: browser-smoke (29), torture (16), pentest (0 findings), and the
contract/deployment/pwa checks all pass.


## CSP hardening: no inline script, no unsafe-inline — 21 July 2026

Closes the one serious finding from the pen-test: the CSP previously
allowed script-src 'unsafe-inline', so any future XSS could read the
Supabase token from localStorage.

- Moved the entire app from an inline <script> into an external app.js,
  loaded with `defer` after the Supabase client. The page now has zero
  inline JavaScript.
- Replaced all 78 inline on* handlers (onclick/oninput/onchange) with a
  small CSP-safe event-delegation layer: markup carries
  data-click/-input/-change="fn" plus a JSON data-args array, with
  @self/@value/@checked/@event sentinels resolved at dispatch. Each site
  behaves exactly as before.
- Tightened the CSP to `script-src 'self'` — dropped 'unsafe-inline'.
  (style-src keeps it; inline styles are not a script-execution vector.)
- Service worker caches app.js; cache bumped to v38. Checks updated to
  read app.js; native-pwa-smoke now also asserts the shell has no inline
  script and no inline handlers, and that the delegation layer exists.

Verified: pen-test now reports 0 findings (was 1); browser-smoke (29),
torture (16), and all four contract/deploy/pwa checks pass.

## Hardening: XSS, corrupt storage, empty sessions — 21 July 2026

Ran a full workout end-to-end plus an adversarial torture pass. Four
real bugs surfaced and were fixed:

- **Stored XSS (serious):** an exercise name / tempo / set-target
  containing HTML executed when the Builder card rendered its
  prescription line, and in the logger's per-set target line. Both
  spots now escape the value (the prescription line elsewhere already
  went through the escaping path). Hostile input is shown as text.
- **Corrupt localStorage crashed boot:** a stored blob with the wrong
  types (workouts not an array, sessions a string, a workout with no
  blocks) threw on load. load() now runs every record through
  sanitizeDB(), coercing shapes and dropping junk, so the app always
  boots to a clean Home.
- **Empty session was "complete":** a session with no exercises passed
  the all-sets-done check by vacuous truth. sessionAllDone() now
  requires at least one exercise, and the Builder refuses to preview a
  workout with no blocks/exercises.

Three of these are now covered by committed browser-smoke steps.
Service-worker cache bumped to v37.

## Max reps (AMRAP) — 21 July 2026

- New "Max reps" tracking mode in the Builder for lifts where every set is
  max reps at whatever's on the bar: set rows show "max reps" instead of a
  target input, the prescription line reads "3 × max", and the logger keeps
  KG / Reps / RPE felt columns so the achieved numbers still get recorded.
- Mixed schemes work too: typing "max" (or just "m") as any single set's
  target renders prescriptions like "12/10/max" and shows "target max reps"
  for that set in the logger.
- History summaries and the Strength/Conditioning card labels treat Max
  reps work as strength.
- Two new browser-smoke steps; service-worker cache bumped to v36.

## One training destination: the Logger tab is gone — 21 July 2026

- The nav is now Home · Training · Builder. Training is the single place
  you go to train; the set-by-set logger opens by tapping an exercise row
  and keeps its Previous/Next stepping, "Next exercise →" hand-off, and
  in-place "Mark session complete" — it just isn't a competing tab anymore.
- While logging, the Training tab stays highlighted (the logger is its
  detail view).
- Browser smoke asserts the three-tab nav and the tap-in/step-through flow.
- Bumped the service-worker cache to v35.

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
