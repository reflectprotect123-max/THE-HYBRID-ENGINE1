import { Fragment } from 'react';
import { Pressable, Text, View } from 'react-native';
import { isLiftMode, type LoggedSet, type StrengthBlock } from '@hybrid/engine';
import type { Action, Draft, HotSet, RoundSet, RoundView } from '@hybrid/session-authoring';
import { HotCard } from './HotCard';
import { PieceCard } from './PieceCard';
import { useLoggerStyles } from './styles';

/*
 * The rounds of the block currently on screen.
 *
 * `rounds` comes straight from `useSession`'s view, in the order it will
 * actually run — round-major, a superset's pair alternating rather than one
 * movement finishing before the other starts. This file recomputes none of
 * that: it walks `rounds` in the order given and paints each `RoundSet` by its
 * `status`, `planned` and `logged`, never indexing back into `block` for a
 * set's values. The engine already parsed them once, in the package's
 * `view.ts`; this file only formats what it was handed.
 *
 * `block.warmup` picks a different set of rows for the very same `rounds`: a
 * done/upcoming piece is a plain label-and-target row (no RPE, no grip —
 * neither means anything for prep), and the live piece is `PieceCard` rather
 * than `HotCard`. Skip/add-set is the one region common to both.
 *
 * Receipts number WITHIN this block, in the order they are laid out. That is
 * not an implementation detail: `checks/parity/drive.mjs` reads `receipt-<i>`
 * scoped to the block on screen, and numbering them across the session would
 * make every block after the first disagree with the baseline.
 */

const isSupersetRound = (round: RoundView) => round.sets.length > 1;
const roundStarted = (round: RoundView) => round.sets.some((s) => s.status === 'done');
const roundIsLive = (round: RoundView) => round.sets.some((s) => s.status === 'live');

/** `L.kg × L.reps @ L.felt`, the prototype's receipt line, off `RoundSet.logged`. */
function receiptValue(ex: { mode: string }, logged: NonNullable<RoundSet['logged']>): string {
  const parts: string[] = [];
  if (logged.kg) parts.push(`${logged.kg}${isLiftMode(ex.mode) ? 'kg' : ''}`);
  if (logged.reps) parts.push(`× ${logged.reps}`);
  const load = parts.join(' ');
  return logged.felt ? (load ? `${load} @ ${logged.felt}` : `@ ${logged.felt}`) : load;
}

/** A piece's target for a done/upcoming row — a `'seconds'` piece is authored
 *  as a bare number of seconds, so it reads as time; every other mode reads as
 *  written. */
function pieceTarget(mode: string, text: string): string {
  return mode === 'seconds' ? `${text}s` : text;
}

export function BlockScreen({
  block,
  title,
  rounds,
  onRotate,
  hot,
  draft,
  dispatch,
}: {
  block: StrengthBlock<LoggedSet>;
  /** The block's title, from the hook's own `BlockView.title` — a superset's
   *  "Press + Raise" join stays in one place. */
  title: string;
  rounds: RoundView[];
  onRotate: (blockId: string) => void;
  /** `useSession`'s `view.hot`, straight through. Null whenever no round in
   *  `rounds` is `'live'`. */
  hot: HotSet | null;
  /** The athlete's in-progress entry for `hot` — `view.draft`. */
  draft: Draft | null;
  dispatch: (action: Action) => void;
}) {
  const st = useLoggerStyles();
  const warmup = !!block.warmup;
  const superset = !!block.superset;
  let receiptIndex = 0; // within THIS block, layout order

  const pieces = warmup ? rounds.flatMap((round) => round.sets) : [];

  return (
    <View style={st.block}>
      <Text style={st.blockTitle}>{title}</Text>
      {warmup ? (
        <Text style={st.blockNote}>
          {pieces.length} pieces · nothing here counts toward your weights
        </Text>
      ) : null}

      {warmup
        ? pieces.map((set) => {
            const ex = block.exercises[set.exerciseIndex];
            if (!ex) return null;
            const key = `${set.exerciseIndex}-${set.setIndex}`;

            if (set.status === 'done') {
              const testID = `receipt-${receiptIndex}`;
              receiptIndex += 1;
              return (
                <View key={key} testID={testID} style={st.receipt}>
                  <View style={st.receiptTick}>
                    <Text style={st.receiptTickInk}>✓</Text>
                  </View>
                  <Text numberOfLines={1} style={st.receiptLabel}>
                    {set.exerciseName}
                  </Text>
                  <Text style={st.receiptValue}>{pieceTarget(ex.mode, set.planned.reps)}</Text>
                </View>
              );
            }

            if (set.status === 'live') {
              // A live row with no matching `hot` would mean the hook
              // contradicted itself, so nothing renders rather than guessing.
              if (!hot || hot.exerciseIndex !== set.exerciseIndex || hot.setIndex !== set.setIndex) return null;
              return <PieceCard key={key} hot={hot} mode={ex.mode} dispatch={dispatch} />;
            }

            return (
              <View key={key} style={st.upcoming}>
                <Text style={st.upcomingLabel}>{set.exerciseName}</Text>
                <Text style={st.upcomingValue}>{pieceTarget(ex.mode, set.planned.reps)}</Text>
              </View>
            );
          })
        : rounds.map((round) => {
            const showGrip = superset && roundIsLive(round) && !roundStarted(round);

            return (
              <Fragment key={round.round}>
                {isSupersetRound(round) ? (
                  <Text style={st.roundLabel}>Round {round.round + 1}</Text>
                ) : null}

                {round.sets.map((set) => {
                  const ex = block.exercises[set.exerciseIndex];
                  if (!ex) return null;

                  const label = superset ? set.exerciseName : `Set ${set.setIndex + 1}`;
                  const key = `${set.exerciseIndex}-${set.setIndex}`;

                  if (set.status === 'done' && set.logged) {
                    const testID = `receipt-${receiptIndex}`;
                    receiptIndex += 1;
                    return (
                      <View key={key} testID={testID} style={st.receipt}>
                        <View style={st.receiptTick}>
                          <Text style={st.receiptTickInk}>✓</Text>
                        </View>
                        <Text numberOfLines={1} style={st.receiptLabel}>
                          {label}
                        </Text>
                        <Text style={st.receiptValue}>{receiptValue(ex, set.logged)}</Text>
                      </View>
                    );
                  }

                  if (set.status === 'live') {
                    if (
                      !hot ||
                      !draft ||
                      hot.exerciseIndex !== set.exerciseIndex ||
                      hot.setIndex !== set.setIndex
                    ) {
                      return null;
                    }
                    return (
                      <HotCard
                        key={key}
                        hot={hot}
                        draft={draft}
                        dispatch={dispatch}
                        label={label}
                        weighted={isLiftMode(ex.mode)}
                      />
                    );
                  }

                  return (
                    <View key={key} style={[st.upcoming, showGrip && st.upcomingGripped]}>
                      {showGrip ? (
                        <Pressable
                          testID="grip"
                          accessibilityRole="button"
                          accessibilityLabel="Do this movement first"
                          onPress={() => onRotate(block.id)}
                          style={st.grip}
                        >
                          <GripIcon />
                        </Pressable>
                      ) : null}
                      <Text style={st.upcomingLabel}>{label}</Text>
                      <Text style={st.upcomingValue}>
                        {set.planned.reps} @ RPE {set.planned.rpe}
                      </Text>
                    </View>
                  );
                })}
              </Fragment>
            );
          })}

      {hot ? <SkipAddRow dispatch={dispatch} /> : null}
    </View>
  );
}

/**
 * Skip / add-set.
 *
 * The prototype has no dedicated region for either control, so they sit below
 * whatever the block is showing — the one place still true for every block,
 * since the row renders only while there is an owed set (`hot`) to skip or add
 * another of. Both dispatch straight through to the reducer; neither is
 * decided here.
 */
function SkipAddRow({ dispatch }: { dispatch: (action: Action) => void }) {
  const st = useLoggerStyles();
  return (
    <View style={st.skipRow}>
      <Pressable
        testID="skip-set"
        accessibilityRole="button"
        onPress={() => dispatch({ type: 'skipSet' })}
        style={st.pill}
      >
        <Text style={st.pillInk}>Skip</Text>
      </Pressable>
      <Pressable
        testID="add-set"
        accessibilityRole="button"
        onPress={() => dispatch({ type: 'addSet' })}
        style={st.pill}
      >
        <Text style={st.pillInk}>+ Add set</Text>
      </Pressable>
    </View>
  );
}

/** Six dots, two columns of three — the prototype's `grip` glyph. A
 *  drag-only affordance is unreachable without a pointer, and on a phone
 *  there is no hover either, so this is a real button with a tap target
 *  rather than a decoration. */
function GripIcon() {
  const st = useLoggerStyles();
  return (
    <View style={st.gripGlyph}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={st.gripDot} />
      ))}
    </View>
  );
}
