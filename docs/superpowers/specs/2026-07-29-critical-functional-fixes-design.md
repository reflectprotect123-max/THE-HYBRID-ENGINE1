# Critical functional fixes — audit round 1

**Status:** approved scope (user picked "Critical functional" from the audit) · **Date:** 2026-07-29

Five fixes from the four-surface UX audit. Everything here is a functional
gap, not polish: each one either loses a coach's or athlete's work, records
wrong data, or makes a shipped feature unusable.

## 1. Coach instructions reach the athlete

`Workout.note` is authored on the coach publish screen, survives emit and
migration — and is rendered nowhere. Fix: both athlete Loggers show a
"From your coach" panel when `session.note` is non-empty, above the first
block's content (web `apps/web/src/screens/Logger.tsx` under the header;
mobile `apps/mobile/src/screens/Logger.tsx` equivalent position). Read-only,
plain text, styled like an exercise cue. No display when empty.

## 2. The builder can edit what it authored

The guided flow is append-only. Fix, all on the review screen (the flow's
home base), reusing the existing steps rather than inventing an editor:

- **Tap an exercise row → edit it.** Re-enters the guided steps
  (movement → sets → reps → RPE → more) pre-filled from the exercise;
  committing REPLACES that exercise in place. Same screens, same gate.
- **Delete.** An ✕ on each exercise row (removing a block's last exercise
  removes the block); an ✕ on cond/metcon block headers. One tap, no modal —
  the review screen itself shows the result, and the day is still there.
- **Rename the session.** The review header's title becomes an input bound
  to `session.name`.
- **Reset a day to rest.** A "Clear day" action on the WeekGrid's filled
  cell, guarded by a confirm (this one IS destructive-at-a-distance:
  `setDay(null)`).

## 3. Conditioning gets authored, not hardcoded

Picking "Conditioning" currently commits `newCondBlock()` (intervals /
medium) with no questions. Fix: a `cond-detail` step between block-type and
review — format chips (`CON_FORMATS`: steady / intervals / tempo / custom /
free), effort chips (`CON_EFFORTS`: easy / medium / hard, with
`targetZone` kept in lockstep), minutes stepper (optional). Commit builds
the CondBlock from those choices. `COND_SEQUENCE` becomes
`['block-type', 'cond-detail', 'review']`.

## 4. The custom reps input stops eating keystrokes

`RepsStep`'s `value={CHIPS.includes(value) ? '' : value}` self-clears the
field whenever the draft value matches a chip, so typing "50" yields "0"
("5" matches a chip and is wiped) and "8-12" yields "-12". Fix: the input
owns its text locally; chips and input both write the draft, neither
erases the other's in-progress typing.

## 5. Mobile backups can come back

Mobile Settings exports via the share sheet but has no restore. Fix: a
paste-based restore in `BackupCard` — a text area for the backup JSON and a
"Restore" action that parses, validates through the same
`loadDB`-compatible shape check the boot path uses, states what it found
("N sessions, history through …"), and requires one explicit confirm
before overwriting the live DB (then `saveDB` immediately). Failure shows a
plain-language message, never a raw parse error. No new dependencies (the
same constraint that shaped export).

## Out of scope (parked from the same audit, awaiting approval)

Flow/trust fixes (review-screen detail, warm-up RPE recording, Home CTA,
conditioning-start format, publish status styling, delete confirm), the
shared error humanizer, and the consistency/hygiene batch.

## Testing

Pure logic (cond-detail sequencing/gating, reps input behavior, restore
validation) gets unit tests. The editing flows and coach-note display get
react-smoke coverage; mobile restore gets a jest test around the
parse/validate/import function.
