import { useCallback, useEffect, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isCond, isText, type LoggedSet, type Session, type StrengthBlock } from '@hybrid/engine';
import { useSession, type Action, type SessionView } from '@hybrid/session-authoring';
import { Tap } from '../../ui';
import { useLoggerHost, useWakeLock } from './bridge';
import { BlockStrip } from './BlockStrip';
import { BlockScreen } from './BlockScreen';
import { RestTakeover } from './RestTakeover';
import { FinishCard } from './FinishCard';
import { useLoggerStyles } from './styles';

/*
 * The screen shell for `@hybrid/session-authoring`'s `useSession`.
 *
 * The hook owns every decision about running a session — which set is live,
 * what it should weigh, what order a superset runs in. This file owns none of
 * that. What it owns is the wiring the hook cannot: writing the session back
 * to the app's store, holding the screen awake, and bridging the hook's own
 * rest model onto the store that actually fires the rest-complete notification
 * and drives the global rest chip.
 *
 * The side effects arrive through `./bridge`, which Metro resolves per
 * platform. See that file for why.
 */

/**
 * Wire `useSession` to this app's side effects.
 *
 * `useSession` hands back a derived VIEW plus the concrete `Session` it holds
 * inside. This shell renders the view and persists the session; it duplicates
 * no part of `useSession`'s own state machine to get one. Running a second
 * reducer loop beside the hook to manufacture a session was a real bug on the
 * web build before the hook started returning it.
 */
export function useLoggerBridge(
  initial: Session,
  updateSession: (id: string, fn: (s: Session) => void | false) => void,
  startRest: (seconds: number) => void,
  stopRest: () => void,
  addRest: (seconds: number) => void,
): { view: SessionView; dispatch: (action: Action) => void; session: Session } {
  const { dispatch, session, ...view } = useSession(initial);

  // Persist: write-through on change. `reduce` returns the SAME session
  // reference when an action changes nothing, `setDraft` included, so a draft
  // being typed never reaches here — only an action that actually logged,
  // rotated, added or finished a set produces a new reference and a write.
  const lastPersisted = useRef(initial);
  useEffect(() => {
    if (session === lastPersisted.current) return;
    lastPersisted.current = session;
    updateSession(session.id, (ds) => {
      Object.assign(ds, session);
      ds.updatedAt = Date.now();
    });
  }, [session, updateSession]);

  // Bridge rest to the store that owns the notification and the chip. A
  // `'set'` rest arms it with the same seconds the hook is about to paint; a
  // `'block'` page turn is not a rest and must never arm it. Only a timer
  // armed by us is ever cleared — an unrelated rest already running in the
  // store is left alone until this screen puts one up itself.
  //
  // Keyed on `armedByUs`, a FLAG, not on `view.rest`'s object identity. Once
  // the countdown ticks, `tickRest` returns a new `RestState` every second —
  // same rest, new reference — so an identity-keyed effect would call
  // `startRest` again every second, restart the store's own timer, and the
  // athlete's rest-complete notification would never land on time. The flag
  // only flips on a genuine transition. Growing `total` while still armed
  // (`extendRest`, the +15) is not a new rest either: it is relayed to the
  // store's own `add` so the background timer stays in step with the dial.
  const armedByUs = useRef(false);
  const armedTotal = useRef(0);
  useEffect(() => {
    const rest = view.rest;
    if (rest && rest.kind === 'set') {
      if (!armedByUs.current) {
        armedByUs.current = true;
        armedTotal.current = rest.total;
        startRest(rest.total);
      } else if (rest.total !== armedTotal.current) {
        addRest(rest.total - armedTotal.current);
        armedTotal.current = rest.total;
      }
    } else if (armedByUs.current) {
      armedByUs.current = false;
      stopRest();
    }
  }, [view.rest, startRest, stopRest, addRest]);

  return { view, dispatch, session };
}

/** A `Block` that is not a `StrengthBlock` has no rounds to log — the same
 *  guard the package applies internally, mirrored here because the view
 *  exposes only the current block's `rounds`, never the block itself. */
function isStrengthBlock(b: Session['blocks'][number]): b is StrengthBlock<LoggedSet> {
  return !isCond(b) && !isText(b);
}

function NoLiveSession({ onLeave }: { onLeave?: () => void }) {
  const st = useLoggerStyles();
  return (
    <View style={[st.screen, st.empty]}>
      <Text style={st.emptyTitle}>No live session</Text>
      <Text style={st.emptyBody}>Start one from Training.</Text>
      {onLeave ? (
        <Tap onPress={onLeave} style={[st.cta, st.ctaOn, { paddingHorizontal: 16 }]}>
          <Text style={st.ctaInkOn}>Go to Training</Text>
        </Tap>
      ) : null}
    </View>
  );
}

function RunningSession({ session: initialSession }: { session: Session }) {
  const st = useLoggerStyles();
  /*
   * This screen runs with the navigator's header off, so nothing above it is
   * clearing the status bar or the gesture bar — the same reason the logger
   * this replaced took the insets itself. The first port dropped them, which
   * put the session's name under the notch on any phone that has one.
   *
   * The parity harness reports zero insets (a browser viewport has no notch),
   * so this costs the visual gate nothing while fixing the phone.
   */
  const insets = useSafeAreaInsets();
  const { updateSession, startRest, stopRest, addRest } = useLoggerHost();
  const { view, dispatch, session } = useLoggerBridge(
    initialSession,
    updateSession,
    startRest,
    stopRest,
    addRest,
  );
  useWakeLock();

  // `view.blockIndex` is the hook's own `run.blockIndex`, surfaced — the
  // single source `goToBlock` moves. Nothing here mirrors it into local state,
  // so there is no second copy of "which block is on screen" to drift.
  const goToBlock = useCallback((index: number) => dispatch({ type: 'goToBlock', index }), [dispatch]);
  const rotate = useCallback((blockId: string) => dispatch({ type: 'rotate', blockId }), [dispatch]);

  const currentBlock = session.blocks[view.blockIndex];
  const strengthBlock = currentBlock && isStrengthBlock(currentBlock) ? currentBlock : null;
  const currentTitle = view.blocks[view.blockIndex]?.title ?? '';

  // Every block's working sets logged — the package's own tally, summed rather
  // than recomputed. Shown only on the last block's screen, mirroring the
  // prototype's own placement for the same receipt.
  const allDone = view.blocks.length > 0 && view.blocks.every((b) => b.progress.done >= b.progress.total);
  const onLastBlock = view.blockIndex === view.blocks.length - 1;
  const setsLogged = view.blocks.reduce((n, b) => n + b.progress.done, 0);

  return (
    <View style={st.screen}>
      {/* The session's own name, at the top of its own screen. The navigator
          runs with `headerShown: false`, so every screen in this app carries
          its own bar — and the parity harness has no navigator at all. */}
      <View testID="logger-appbar" style={[st.appbar, { paddingTop: insets.top + 14 }]}>
        <Text numberOfLines={1} style={st.appbarTitle}>
          {session.name || 'Session'}
        </Text>
      </View>
      <ScrollView contentContainerStyle={[st.scroll, { paddingBottom: insets.bottom + 40 }]}>
        <BlockStrip blocks={view.blocks} currentIndex={view.blockIndex} onSelect={goToBlock} />
        {strengthBlock ? (
          <BlockScreen
            block={strengthBlock}
            blockIndex={view.blockIndex}
            title={currentTitle}
            receipt={
              allDone && onLastBlock ? (
                <FinishCard blocks={view.blocks.length} setsLogged={setsLogged} bestE1rm={view.bestE1rm} />
              ) : null
            }
            rounds={view.rounds}
            onRotate={rotate}
            hot={view.hot}
            draft={view.draft}
            dispatch={dispatch}
          />
        ) : null}
      </ScrollView>
      {view.rest ? (
        <RestTakeover
          rest={view.rest}
          hot={view.hot}
          draftKg={view.draft?.kg ?? null}
          blocks={view.blocks}
          blockIndex={view.blockIndex}
          dispatch={dispatch}
        />
      ) : null}
    </View>
  );
}

export function SessionLogger({ onLeave }: { onLeave?: () => void }) {
  const { activeSession } = useLoggerHost();

  if (!activeSession) return <NoLiveSession onLeave={onLeave} />;

  // Remounted whenever a DIFFERENT session becomes active — a fresh run, not a
  // mutation of the one already on screen — so the hook's state always starts
  // from the session actually meant to be running.
  return <RunningSession key={activeSession.id} session={activeSession} />;
}
