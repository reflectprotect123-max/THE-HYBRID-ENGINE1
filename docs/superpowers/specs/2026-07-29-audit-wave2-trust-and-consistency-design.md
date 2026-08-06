# Wave 2 — flow-and-trust fixes, error humanizing, and the consistency batch

**Status:** draft for approval · **Date:** 2026-07-29 · **Depends on:** `docs/superpowers/plans/2026-07-29-critical-functional-fixes.md` fully landed (at drafting time only its Task 1, `ea61e7a`, is committed)

Everything from the four-surface UX audit (coach-ux, athlete-web-ux, mobile-ux,
consistency) that is NOT in the critical-functional wave and is not pure
cosmetic taste. Three themes: fixes that keep the app's promises (a button that
says Start must start; a review screen must review; recorded data must be data
someone gave), one error-humanizing pass per app, and the consistency/hygiene
batch the audits enumerated file-by-file.

## 1. Warm-up sets stop recording an RPE nobody gave (web I1, M10-partial)

Both Loggers walk every set through the RPE step and write `felt: "7.5"`
unconditionally (`apps/web/src/screens/Logger.tsx:388,192`; identical mobile
twin at `apps/mobile/src/screens/Logger.tsx:479,194`). For a warm-up set the
engine then ignores the number everywhere — it is collected, displayed in the
logged list / Recap / History as if the athlete rated it, and used for nothing.
Fix: when `isWarmup(st)`, "Finish Set" confirms directly (no RPE phase) and
`confirmSet` does not write `felt`. Working sets are unchanged (the untouched-
default-on-working-sets question, web M10, is out of scope — see below).

## 2. "Start today's session" starts it (web I2 + mobile twin)

Home's primary CTA and every plan-row Start only navigate to Training, where
the athlete must press a second, identically-worded Start
(`apps/web/src/screens/Home.tsx:131-133`; mobile `Home.tsx:88,130`). Fix: a
shared `sessionFrom(workout, date)` helper per athlete app; Home's Start mints
the active session (guarded: never when one is already active) and lands on
Training in the in-progress state. Training's own `startWorkout` reuses the
same helper so the two paths cannot diverge.

## 3. Conditioning started from a block runs the block's prescription (web I3 + mobile twin, web M4)

The Conditioning screen ignores the `?block=` it was launched from except as a
result sink: format initializes to the module default (`intervals`) and the
banked result hardcodes `effort: fmt === 'steady' ? 'easy' : 'hard'`
(`apps/web/src/screens/Conditioning.tsx:81,157`; mobile `Conditioning.tsx:58,190`).
Fix: resolve the sink block up front; initialize `fmt` from `b.condFmt` and
carry `b.effort` into the `CondResult`. Also (web M4) the block's format
renders as its raw key ("steady") on Training/Recap/History cards — render
`CON_FORMATS[key].name` everywhere the key is shown.

Accepted limitation: a block's `minutes` does not override the earned-level
prescription duration this round — the progression math owns duration, and
overriding it is a conditioning-engine decision, not a UI patch.

## 4. Deleting a session requires a second tap (web I4, partial)

Web Library's "Delete session" fires `removeWorkout` immediately and writes a
sync tombstone — one mis-tap, 20px from Edit, is permanent
(`apps/web/src/screens/Library.tsx:187,86-93`). Mobile already confirms via
`Alert.alert` (`apps/mobile/src/screens/Library.tsx:97`). Fix: web gets an
armed two-tap ("Delete session" → "Really delete?"), the same pattern wave 1
used for the coach's Clear day — no modal, auto-disarm. Planner's per-block ✕
and per-exercise Remove stay one-tap this round (they edit a draft the athlete
is looking at; parked, not endorsed).

## 5. The coach review screen shows the prescription; publish status is readable at a glance (coach I1, I7, M4, consistency 3.2)

- **Review detail:** each exercise row gains the engine's one-line prescription
  (`rxLine(ex)` — "3 × 8 · RPE 8 · rest 1:30") plus the coach's cue; a metcon
  block renders its body text (currently invisible: the ONLY thing it stores);
  a conditioning block renders format name · effort · minutes. Builds on the
  post-wave-1 ReviewScreen (which adds edit/delete/rename).
- **Publish status:** the `role="status"` line is toned — success gets the gold
  treatment with the existing (currently orphaned) `IconSend`, failure gets the
  warn treatment. Signed out, the brass button says "Validate", not "Validate &
  publish" (coach M4 — the label promised a send that cannot happen). The
  Send button is disabled while no athlete is selected, and an empty athlete
  list explains itself instead of rendering an empty `<select>` (3.2).

## 6-8. One error humanizer per app (web I5, coach M3, consistency §2, mobile M4/2.7)

One small `humanizeError(e, context?)` module **per app** — shared wording
conventions, not shared code; no new package; engine untouched. Raw driver
strings (Supabase auth/Postgrest, `Failed to fetch`, JSON parse noise, the
engine's `emit:` contract strings) go to the console; the UI gets a sentence a
person can act on. The plan enumerates all 23 call sites with file:line
(coach: 11 · web: 8 · mobile: 9+3 native). Wording conventions all three
copies follow:

| shape | sentence |
|---|---|
| network / fetch failure | "Can't reach the server — check your connection and try again." |
| invalid credentials | "That email and password don't match. Check them and try again." |
| email not confirmed | "Confirm your email first — the link is in your inbox." |
| already registered | "That email already has an account — sign in instead." |
| `emit:` contract string (coach) | "This session isn't sendable yet — reopen it in the builder and check each block." |
| JSON/parse noise | "The server sent back something unexpected — try again in a minute." |
| WHOOP context (athlete apps) | "Can't reach WHOOP right now — your training data on this device is unaffected." |
| invite code context | "That code didn't work — check it with your coach and try again." |
| fallback | "Something went wrong. Try again, or check your connection." |

Mobile additionally: the three native-bridge sites that pass raw
`react-native-ble-plx` / `expo-location` exception text through to the
mid-workout status slot get fixed humanized strings
(`apps/mobile/src/native/capabilities.ts:133,166,394`), and the Conditioning
screen renders `error`-state HR/GPS messages in the warn tint instead of the
same muted grey as "Looking for your strap…" (mobile M4).

## 9. Terminology & copy consistency (consistency §1, mobile M1 subset)

From the consistency table, everything except the accepted items below:
1.1 web Library's ASCII `+` → fullwidth `＋` (matching its own empty-state copy
and every other add-control); 1.2 mobile Planner's add-block labels get their
full names ("☀ Warm-up / Cooldown", "✎ Metcon / notes") and web's order;
1.4 both Loggers' `'Workout'` title fallback → `'Session'`; 1.5 coach
MoreStep's "The workout, as the athlete reads it" → "The session…"; 1.6 the
coach's rest-seconds field gains a live m:ss preview using the coach's own
(currently dead) `fmtRest` — resolving dead-code finding 6.7 by giving it its
one intended caller; 1.7 mobile History's empty-state tense matches web;
1.8 "Skip Rest" → "Skip rest" (both apps); mobile Recap's "first on record" →
"first one on record".

**Accepted divergences (documented, not fixed):** 1.3 RPE range glyphs
(`7→9` strength vs `5-7` conditioning) — both strings are pinned by the
engine's golden vectors captured from the vanilla app, and they encode
different concepts (an ordered per-set progression vs a band); changing either
means editing golden fixtures for a cosmetic unification. 1.9/4.3
`aria-current` boolean-vs-token is normalized in the hygiene task. Mobile's
"Tap …" vs web's "Use …" Library empty copy stays — platform-appropriate verbs.

## 10. Design-token floor (consistency 5.1, 5.2) + touch-target verification (web I6)

- `#1b1509` (ink on brass) is hand-typed nine times across the three apps.
  Add the token the design doc already names as the gap — `--color-on-accent`
  in `packages/design` (tokens.ts + tokens.css) and `on-accent` in mobile's
  tailwind config — and convert all nine sites. Update `docs/DESIGN-TOKENS.md`.
- Mobile's five hex literals that exactly match existing tokens
  (`Progress.tsx:251,298,316`, `Recap.tsx:116`) resolve through token
  classnames / `color.*` from `@hybrid/design`.
- Touch targets: since the audit, `c868a4a` added a `pointer: coarse`
  min-height:44px rule and `checks/web-touch.mjs` — but the check only drives
  Home and only measures `<button>`s. Extend it to the gym-path screens
  (Training, a seeded Logger, Library) and to anchors/`[role=button]`, then fix
  whatever it finds. The coach app is desktop-only and must stay compact — the
  coarse-pointer scoping already guarantees that; do not pad coach controls.

## 11. Mobile parity, the cheap set (mobile I1, I2, I3, 3.1, I7, I8, I9, M2, M6, M7, I6, M3)

- Training's silent fall-back-to-everything becomes web's honest empty state
  ("Nothing scheduled for today…") plus an "Everything else" section (3.1).
- A header back control (Logger's exact pattern) on the four exit-less
  screens: History, Calendar, Exercise, Conditioning (I1).
- `LoggedList` ported into the mobile Logger card (I2 — ~20 lines on web).
- A minimal rest indicator on Training while the rest timer runs (I3 —
  time-left + Skip, using the existing `useRest`; not a floating overlay).
- One-liners: Calendar month-nav `label`s (I8) and a "Schedule something" CTA
  (I9); Library's "0 blocks" → "conditioning" via `isCondWorkout` (M2);
  History's cond detail gains "· felt RPE n" (M7); Progress's Top-lifts head
  gains "Full history ›" (M6); Settings splits the `saveFailed` vs
  `!isPersistent` messages (I7); sync/WHOOP status lines get
  `accessibilityLiveRegion` (I6); Planner ExerciseCard inputs get
  `accessibilityLabel`s (M3).

Parked from mobile (bigger than this wave): restore-from-backup is wave 1;
History's Top-lifts card (I5) is covered by M6's link; the app-wide error
boundary (M8) is real work deserving its own spec.

## 12. Hygiene and worthwhile polish

- Coach `ui.tsx` dead exports deleted: `ADD`, `IconRight`, `IconLink`,
  `IconRest`, `IconCopy` (6.1-6.6). `IconSend` is NOT deleted — §5 finally
  uses it. `model.ts`'s `fmtRest` is NOT deleted — §9 gives it its caller.
- `aria-current` normalized to the token-or-`undefined` pattern (1.9).
- Worthwhile polish kept: web Exercise picker's `Nothing matches ""` empty
  state (web P1); coach-card ISO dates → `dayLabel` (web P4); Progress finding
  titles wrap instead of truncating mid-claim (web P2); coach `WELL` inputs get
  a visible focus ring (coach P4).
- Polish judged cosmetic-only and dropped: coach P1 (brass rationing), P2
  (tile icon regimes), P3 (rail column order), web P3 (zones "estimated"
  caption), web P5 (History/Progress duplicate card), mobile P2 (delete-on-row
  is a documented improvement), mobile P3 (RouteMap label — decorative next to
  fully accessible numbers), consistency 4.2 (`aria-modal` semantics note),
  5.3/5.4 (off-scale sizing constants — needs a scale decision first).

## Out of scope (parked, from the same audits)

Coach I2 (library-candidate previews), I3 (phantom "Session — no movements"
day), I4 (mandatory RPE in the coach flow), I5 (library-picker anchoring/
keyboard), I6 ("New block" headings), M1/M2/M5-M9 (breadcrumb, flow
persistence, publish layout, Home day-rows, step counts, SR labels on
Duplicate/Chain, Escape handling); web M1 (readiness copy), M2 (History
warm-up marker), M5 (planner cue preview), M6 (tabs keyboard pattern), M7
(calendar day inspection), M8 (RestChip overlap), M9 (dead panel between
exercises), M10 (working-set RPE must-touch); mobile M5 (8 vs 12 sessions),
M8 (error boundary). Each is real; none is in this wave.

## Testing

Pure logic gets TDD: the coach and mobile `humanizeError` modules (vitest /
jest), and `sessionFrom` on mobile (jest). Web has no unit runner ("web e2e
lives in checks/") — its humanizer transcribes the tested coach/mobile
wording and is exercised by a react-smoke assertion (the WHOOP card must show
the humanized offline message, never "Unexpected token"). Flow fixes get
react-smoke coverage: warm-up sets skip the RPE step and store no `felt`,
Home's Start lands in an in-progress session, publish status carries the ok
tone class. `checks/web-touch.mjs` is extended to the gym-path screens. Final
task runs the full verify suite and pushes.
