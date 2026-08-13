import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Action, BlockView, HotSet, RestState } from '@hybrid/session-authoring';
import { Dial } from './Dial';
import { RIPPLE, pressed } from './press';
import { useLoggerStyles } from './styles';

/*
 * The screen while the athlete waits between sets.
 *
 * `RestState.kind` is the one fact this file must never blur: `'set'` is a
 * real clock, `'block'` is the page turning between blocks with nothing to
 * count down (`total: 0`). The prototype originally drew a spent `0:00` dial
 * on a block turn and it read as a timer that had run out rather than as a
 * block ending — fixed there, and the fix is the point of this file: a
 * `'block'` turn renders no dial at all.
 *
 * No decision logic lives here. `rest`, `hot`, `blocks` and `blockIndex` are
 * `useSession`'s own view, read and formatted, never recomputed — the "what's
 * next" line is `view.hot`/`view.draft` for a timed rest (already the UPCOMING
 * set, because `logSet` advances the hook's `hot` before the rest ever
 * renders) and the next `BlockView.title` for a block turn.
 */

function Chevron() {
  const st = useLoggerStyles();
  return (
    <View style={st.chevron}>
      <View style={st.chevronUp} />
      <View style={st.chevronDown} />
    </View>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export function RestTakeover({
  rest,
  hot,
  draftKg,
  blocks,
  blockIndex,
  dispatch,
}: {
  rest: RestState;
  /** The upcoming set — `view.hot`, already advanced past the set just logged. */
  hot: HotSet | null;
  /** The upcoming set's prefilled weight — `view.draft`'s own `kg`. */
  draftKg: number | null;
  blocks: BlockView[];
  blockIndex: number;
  dispatch: (action: Action) => void;
}) {
  const st = useLoggerStyles();
  const timed = rest.kind === 'set';
  const nextBlock = blocks[blockIndex + 1] ?? null;

  // The countdown's one and only owner: mounted only while a rest is up, so
  // the interval starts and stops with it — nothing else in this app
  // dispatches `tick`. A page turn has no clock, so it is spared the dispatch
  // entirely rather than sent a no-op every second.
  useEffect(() => {
    if (!timed) return;
    const id = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(id);
  }, [timed, dispatch]);

  const frac = rest.total > 0 ? Math.max(0, Math.min(1, rest.left / rest.total)) : 0;

  const leave = () => {
    if (rest.kind === 'block') {
      if (nextBlock) dispatch({ type: 'goToBlock', index: blockIndex + 1 });
      else dispatch({ type: 'dismissRest' });
      return;
    }
    dispatch({ type: 'dismissRest' });
  };

  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel="Resting"
      style={st.takeover}
    >
      <Text style={st.takeoverKind}>{timed ? 'rest' : 'block done'}</Text>

      {timed ? (
        <View testID="rest-dial" style={st.dialWrap}>
          <Dial frac={frac}>
            <Text style={st.dialInk}>{fmt(Math.max(0, rest.left))}</Text>
          </Dial>
        </View>
      ) : (
        <View style={st.dialSpacer} />
      )}

      {timed && hot ? (
        <View style={st.nextCard}>
          <Text style={st.nextKind}>up next</Text>
          <Text style={st.nextName}>{hot.exerciseName}</Text>
          <Text style={st.nextBig}>
            {draftKg ? `${draftKg} kg × ` : ''}
            {hot.planned.reps}
          </Text>
          <Text style={st.nextWhy}>{hot.message}</Text>
        </View>
      ) : null}

      {!timed ? (
        <View style={st.nextCard}>
          <Text style={st.nextKind}>next block</Text>
          <Text style={st.nextName}>{nextBlock ? nextBlock.title : 'Session done'}</Text>
        </View>
      ) : null}

      <View style={st.takeoverActions}>
        {timed && rest.left > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fifteen seconds more"
            android_ripple={RIPPLE}
            onPress={() => dispatch({ type: 'extendRest', seconds: 15 })}
            style={pressed(st.ghost)}
          >
            <Text style={st.ghostInk}>+15</Text>
          </Pressable>
        ) : null}
        <Pressable testID="rest-go" accessibilityRole="button" android_ripple={RIPPLE} onPress={leave} style={pressed(st.takeoverCta)}>
          <Text style={st.takeoverCtaInk}>
            {rest.kind === 'block' ? (nextBlock ? 'Go' : 'Finish') : rest.left > 0 ? 'Skip' : 'Lift'}
          </Text>
          {/* The prototype's `.cbtn` carries a chevron after its label. Drawn
              from two rotated bars for the same reason the done tick is: a
              glyph would land in the element's text and the behaviour gate
              reads that text. */}
          <Chevron />
        </Pressable>
      </View>
    </View>
  );
}
