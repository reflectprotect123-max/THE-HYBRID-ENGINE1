/*
 * The tap script: an ordered, target-agnostic list of abstract steps that
 * builds and then runs one session against the round-major logger contract.
 *
 * Every action names a `data-parity` hook. `drive.mjs` is the only thing
 * that touches Playwright — this file just describes intent, so the same
 * list can be pointed at the prototype today and the rebuilt app later
 * without either side knowing about the other.
 *
 * ----------------------------------------------------------------------
 * Two known gaps in the prototype fixture (`rolling-logger.html`), found
 * by reading it before writing selectors against it:
 *
 *   1. The warm-up/cool-down unit toggle ("Seconds" / "Reps" pill) carries
 *      no `data-parity` hook.
 *   2. The warm-up/cool-down piece's "Done" button carries no `data-parity`
 *      hook either (only the strength/superset hot card's controls do).
 *
 * Both are needed to build the required session (a warm-up with one timed
 * and one reps piece) and to run it without waiting out real countdowns.
 * This file is scoped to NOT touch `rolling-logger.html`, so the two gaps
 * are routed through `clickRaw` — a small, explicitly-labelled escape
 * hatch `drive.mjs` uses only for these two cases, never for anything that
 * has a real hook. See task-3-report.md for the full writeup.
 * ----------------------------------------------------------------------
 */

const click = (hook) => ({ type: 'click', hook });
const fill = (hook, value) => ({ type: 'fill', hook, value });
const clickRaw = (selector, why) => ({ type: 'clickRaw', selector, why });
const rpe = (v) => click(`rpe-${String(v).replace('.', '')}`);
const repsUp = () => click('reps-up');

/* Logging any set — mid-block or the block's last — always opens the rest
   takeover (turn:false mid-block with an "up next" card, turn:true at the
   block boundary with the next block's name). Either way it covers the
   hot card until `rest-go` (labelled Skip/Lift or Go/Finish) is pressed,
   so every `log` needs one immediately after it. */
const logAndRest = () => [click('log'), click('rest-go')];

/** Selects the un-hooked warm/cool "Done" button, scoped to the block
 *  currently on screen so it can never match a strength block's hot card
 *  (whose own Done-equivalent, `log`, DOES carry a `data-parity` hook and
 *  is excluded here by `:not([data-parity])`). */
const warmDone = (blockIndex) =>
  `#track > .blockscreen:nth-of-type(${blockIndex + 1}) .hot .logbtn:not([data-parity])`;

function step(label, actions, opts = {}) {
  return { label, actions, record: !!opts.record, block: opts.block };
}

export const steps = [
  /* ============================= BUILD ============================= */
  /* Warm-up: one timed piece, one reps piece — the pair the brief calls
     out, because they take different branches of the hot card (a timed
     piece suppresses `hot-presc`; a reps piece doesn't). */
  step('warm-up: choose kind', [click('add-block'), click('kind-warm')]),
  step('warm-up: add piece 1 (timed)', [fill('name', 'Row'), click('add-piece')]),
  step('warm-up: switch unit to reps', [
    clickRaw('[data-u="reps"]', 'unit toggle has no data-parity hook'),
  ]),
  step('warm-up: add piece 2 (reps)', [fill('name', 'Air Squats'), click('add-piece')]),
  step('warm-up: commit block', [click('done-block')]),

  /* Superset: a barbell movement on a ladder (its last set is a `max` set)
     paired with a straight dumbbell movement (the pair that can rotate). */
  step('superset: choose kind', [click('add-block'), click('kind-ss')]),
  step('superset: first movement (barbell)', [
    fill('name', 'Barbell Back Squat'),
    click('equip-barbell'),
    click('next'),
  ]),
  step('superset: first movement scheme (ladder)', [click('scheme-ladder'), click('next')]),
  step('superset: first movement grid', [click('next')]),
  step('superset: first movement load + rest', [click('next')]),
  step('superset: second movement (dumbbell)', [
    fill('name', 'Dumbbell Row'),
    click('equip-dumbbell'),
    click('next'),
  ]),
  step('superset: second movement scheme (straight)', [click('scheme-straight'), click('next')]),
  step('superset: second movement grid', [click('next')]),
  step('superset: second movement load + rest, commit block', [click('done-block')]),

  /* A bodyweight straight lift — the no-weight path. */
  step('bodyweight lift: choose kind', [click('add-block'), click('kind-lift')]),
  step('bodyweight lift: movement', [
    fill('name', 'Push-up'),
    click('equip-bodyweight'),
    click('next'),
  ]),
  step('bodyweight lift: scheme (straight)', [click('scheme-straight'), click('next')]),
  step('bodyweight lift: grid', [click('next')]),
  step('bodyweight lift: rest, commit block', [click('done-block')]),

  /* Cool-down. */
  step('cool-down: choose kind', [click('add-block'), click('kind-cool')]),
  step('cool-down: add piece', [fill('name', 'Walk'), click('add-piece')]),
  step('cool-down: commit block', [click('done-block')]),

  /* ============================== RUN =============================== */
  step('start session', [click('start')], { record: true, block: 0 }),

  /* --- block 0: warm-up --- */
  step('warm-up: finish piece 1 (Row)', [clickRaw(warmDone(0), 'warm/cool Done button has no data-parity hook')], {
    record: true,
    block: 0,
  }),
  step(
    'warm-up: finish piece 2 (Air Squats)',
    [clickRaw(warmDone(0), 'warm/cool Done button has no data-parity hook')],
    { record: true, block: 0 },
  ),
  step('warm-up: advance past rest', [click('rest-go')], { record: true, block: 1 }),

  /* --- block 1: superset (barbell ladder + dumbbell straight) ---
     Round 1 in the built order (squat leads), then rotate once before
     round 2 so the dumbbell movement leads every round after. Ratings mix
     on-target, easy and hard so the coaching message crosses several
     branches instead of repeating one. Every `log` opens the rest
     takeover, so `logAndRest()` clears it before the step is recorded. */
  step('superset: round 1 — Barbell Back Squat set 1', [rpe(7), ...logAndRest()], { record: true, block: 1 }),
  step('superset: round 1 — Dumbbell Row set 1', [rpe(8), ...logAndRest()], { record: true, block: 1 }),
  step('superset: rotate the pair', [click('grip')], { record: true, block: 1 }),
  step('superset: round 2 — Dumbbell Row set 2', [rpe(7), ...logAndRest()], { record: true, block: 1 }),
  step('superset: round 2 — Barbell Back Squat set 2', [rpe(9), ...logAndRest()], { record: true, block: 1 }),
  step('superset: round 3 — Dumbbell Row set 3', [rpe(7.5), ...logAndRest()], { record: true, block: 1 }),
  step('superset: round 3 — Barbell Back Squat set 3', [rpe(7), ...logAndRest()], { record: true, block: 1 }),
  step('superset: round 4 — Dumbbell Row set 4', [rpe(10), ...logAndRest()], { record: true, block: 1 }),
  step(
    'superset: round 4 — Barbell Back Squat max set',
    [repsUp(), repsUp(), repsUp(), repsUp(), repsUp(), rpe(9), ...logAndRest()],
    { record: true, block: 2 },
  ),

  /* --- block 2: bodyweight straight lift --- */
  step('bodyweight lift: set 1', [rpe(8), ...logAndRest()], { record: true, block: 2 }),
  step('bodyweight lift: set 2 (easy)', [rpe(7), ...logAndRest()], { record: true, block: 2 }),
  step('bodyweight lift: set 3 (hard)', [rpe(9), ...logAndRest()], { record: true, block: 2 }),
  step('bodyweight lift: set 4', [rpe(8), ...logAndRest()], { record: true, block: 3 }),

  /* --- block 3: cool-down --- */
  step('cool-down: finish piece (Walk)', [clickRaw(warmDone(3), 'warm/cool Done button has no data-parity hook')], {
    record: true,
    block: 3,
  }),
  step('finish session', [click('rest-go')], { record: true, block: 3 }),
];
