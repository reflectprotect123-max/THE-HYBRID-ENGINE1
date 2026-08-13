import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Action, RoundSet } from '@hybrid/session-authoring';
import { useLoggerStyles } from './styles';

/*
 * The live piece of a warm-up / cool-down block.
 *
 * A piece is a prep movement, not a working set: nothing here may reach a
 * working weight or an e1RM, so unlike `HotCard` this file renders no rating
 * chips and no coaching line.
 *
 * It is handed a `RoundSet` rather than a `HotSet`, and that is the whole
 * point rather than a convenience. `sessionView` deliberately leaves `hot`
 * NULL for a prep block — `hot` carries the fold's word on a set, and a piece
 * has nothing for the fold to judge — so a card that waited for a matching
 * `HotSet` before rendering waited forever, and the live piece simply never
 * appeared. It could not be seen until something drove the real screens over
 * a real prep block, which is what the parity harness is for. Taking the
 * `RoundSet` fixes the defect and makes the rule structural at the same time:
 * this component cannot read a coaching message, because it is never given
 * one.
 *
 * Completion is `completePiece`, not `logSet`. The web body of this card
 * predated that action and had to satisfy `logSet`'s felt-rating gate by
 * fabricating a `felt` of 0 nobody was asked to give; the action exists now
 * and the fabrication is gone with it. `completePiece` is also what keeps the
 * rule `CLAUDE.md` cares most about intact — a prep block never becomes a
 * working set and never reaches the coaching rule.
 *
 * A `mode: 'seconds'` piece runs a countdown; every other mode is a target and
 * a Done button. The clock is local to this component on purpose: it starts
 * when this card mounts as the live piece and stops for good when it unmounts.
 * A block switch unmounts the card, which is the only pause a piece's clock
 * gets — there is no store in scope that could resume it from the same second,
 * so returning to the block restarts the piece at its full target.
 */

const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function PieceCard({
  piece,
  mode,
  dispatch,
}: {
  /** The live row from `view.rounds` — its name and its authored target are
   *  the only two fields a piece has. */
  piece: RoundSet;
  /** `block.exercises[piece.exerciseIndex].mode` — only `'seconds'` gets a
   *  clock. */
  mode: string;
  dispatch: (action: Action) => void;
}) {
  const st = useLoggerStyles();
  const target = parseInt(piece.planned.reps, 10) || 0;
  const timed = mode === 'seconds' && target > 0;

  const [left, setLeft] = useState(target);
  const [running, setRunning] = useState(timed);

  // Held in a ref so the zero-watcher below can fire it without listing it as
  // a dependency and re-arming on every render.
  const finish = useRef(() => {});
  finish.current = () => dispatch({ type: 'completePiece' });

  useEffect(() => {
    if (!timed || !running) return;
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [timed, running]);

  // Reaching zero finishes the piece on its own, exactly like the prototype's
  // `finishWarm` called from inside `startWarm`'s own interval.
  useEffect(() => {
    if (!timed || !running || left > 0) return;
    setRunning(false);
    finish.current();
  }, [timed, running, left]);

  return (
    <View style={st.card}>
      <Text testID="hot-name" style={st.hotName}>
        {piece.exerciseName}
      </Text>

      {/* A timed piece's target IS the big clock — printing it twice is noise,
          the same call the prototype's `renderWarm` makes. */}
      {timed ? null : (
        <Text testID="hot-presc" style={st.hotPresc}>
          {piece.planned.reps}
        </Text>
      )}

      {timed ? (
        <View style={st.clockRow}>
          <Text testID="warm-clock" style={st.clock}>
            {fmtSecs(left)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={running ? 'Pause' : 'Start'}
            onPress={() => setRunning((r) => !r)}
            style={st.pill}
          >
            <Text style={st.pillInk}>{running ? 'Pause' : 'Start'}</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        testID="piece-done"
        accessibilityRole="button"
        onPress={() => finish.current()}
        style={[st.cta, st.ctaOn]}
      >
        <Text style={st.ctaInkOn}>Done</Text>
      </Pressable>
    </View>
  );
}
