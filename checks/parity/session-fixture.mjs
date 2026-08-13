/*
 * `checks/fixtures/session.json` is the PROTOTYPE's session, in the
 * prototype's own shape — it is what `rolling-logger.html` builds in-page
 * during the build phase, dumped. The app does not speak that shape: its
 * session model is `@hybrid/engine`'s `Session`, and the two disagree about
 * almost every field name.
 *
 * That mismatch is not a defect in either one. The prototype is a
 * specification written as a working page, and it was never asked to author
 * `EngineDB` rows. What the run phase needs is one honest translation, in one
 * place, so a gate driving a real app is comparing BEHAVIOUR rather than
 * failing on a field name.
 *
 * The translation is deliberately thin. Where the app's model can hold what
 * the prototype authored, it does; where it cannot, that is recorded here as a
 * named gap rather than papered over, because a gap the translator invents a
 * value for is a gap the gate can no longer see.
 *
 * Known gaps, all of them real and all of them findings rather than bugs in
 * this file:
 *
 * `inc` used to be listed here: the prototype authors an increment per
 * exercise (2.5 for the squat, 2 for the row, 1 for the push-up) and
 * `Exercise` had no field for it, so every movement rounded to the one global
 * `AUTOREG.plateIncrement` and the row was priced at 12.5kg — a dumbbell that
 * does not exist. The gate reported it, `Exercise.inc` now exists, and the
 * field carries across.
 *
 *  - BAR vs DUMBBELL. The prototype knows which; the app's domain model
 *    carries no such fact, which is why `HotCard` gives every loaded set the
 *    same bar-and-plates reading. `bar` is dropped.
 *  - ANCHOR. The prototype stores it; the engine derives it in `anchorFor`
 *    from the opener and the first target. Passing the stored one would let a
 *    stale number outrank the rule, so it is dropped and the engine recomputes.
 */

/** A block's own authored title. `heading` is where `Block` keeps one. */
function withHeading(block, title) {
  return title ? { ...block, heading: title } : block;
}

/**
 * A warm-up or cool-down block.
 *
 * Every piece becomes its own single-set exercise: the prototype runs pieces
 * one after another and the app's queue does the same over
 * one-set-per-exercise, so the shapes line up without inventing rounds.
 *
 * `secs` picks `mode: 'seconds'` and the target is the bare number, which is
 * exactly what `PieceCard` reads back to decide it owns a clock. Everything
 * else is a `'reps'` piece carrying its authored target verbatim.
 */
function warmBlock(block, bi) {
  return withHeading(
    {
      id: `b${bi}`,
      warmup: true,
      exercises: (block.items || []).map((item, ei) => ({
        id: `b${bi}e${ei}`,
        name: item.name,
        mode: item.secs != null ? 'seconds' : 'reps',
        sets: [{ t: item.secs != null ? String(item.secs) : String(item.target ?? ''), rpe: '' }],
      })),
    },
    block.title,
  );
}

/**
 * A strength block.
 *
 * The one field that needs care is `opener`. The engine has no opener field
 * either — `readExercise` reads it as the first working set's `aVal`, falling
 * back to that when nothing is logged yet. So the opener is written there,
 * which is the same place the athlete's own first entry lands. That is not a
 * workaround: it IS the engine's definition of an opener.
 *
 * `mode` follows the opener rather than `bar`: a loaded exercise is
 * `'reps_kg'` and a bodyweight one is `'reps'`, which is what decides whether
 * a weight control appears at all.
 */
function strengthBlock(block, bi) {
  return withHeading(
    {
      id: `b${bi}`,
      superset: !!block.superset,
      exercises: (block.exercises || []).map((ex, ei) => ({
        id: `b${bi}e${ei}`,
        name: ex.name,
        mode: ex.opener > 0 ? 'reps_kg' : 'reps',
        rest: ex.rest,
        inc: ex.inc,
        sets: (ex.targets || []).map((t, si) => ({
          t: String(t.reps),
          rpe: String(t.rpe),
          ...(si === 0 && ex.opener > 0 ? { aVal: String(ex.opener) } : {}),
        })),
      })),
    },
    block.title,
  );
}

/** The prototype's session, as an `@hybrid/engine` `Session`. */
export function toEngineSession(session, { id = 'parity-session', date } = {}) {
  return {
    id,
    date: date ?? new Date().toISOString().slice(0, 10),
    status: 'active',
    name: session.name,
    blocks: (session.blocks || []).map((b, bi) =>
      b.kind === 'warm' || b.kind === 'cool' ? warmBlock(b, bi) : strengthBlock(b, bi),
    ),
  };
}
