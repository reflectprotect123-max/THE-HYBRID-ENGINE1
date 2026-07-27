import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  blockExercises,
  detectPRs,
  exFinished,
  freshSessionBlocks,
  isCond,
  rxLine,
  sessionLetters,
  sessionProgress,
  sessionVolume,
  uid,
  ymd,
  type LoggedSet,
  type Session,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Kicker, Ltr, T, Title } from '../ui';
import type { RootStackParams } from '../App';

/*
 * The session list. Like the web app, it does NOT create a session on render —
 * that minted a phantom active session just for looking at the screen, which
 * then had to be expired and competed in the sync merge.
 */
export function TrainingScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const { db, activeSession, update } = useDb();
  const today = ymd(new Date());
  const dow = new Date().getDay();

  const candidates = db.workouts.filter(
    (w) => (w.dates || []).includes(today) || (w.days || []).includes(dow),
  );

  const start = (w: Workout) => {
    const s: Session = {
      id: uid(),
      date: today,
      name: w.name || 'Session',
      status: 'active',
      blocks: freshSessionBlocks(w.blocks),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      workoutId: w.id,
    };
    update((draft) => {
      draft.sessions.push(s);
    });
  };

  const pad = { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 };

  /*
   * Derived ABOVE the no-session early return, and null-guarded, because these
   * are hooks: computing them after the return meant this component rendered
   * three hooks with no session and seven with one, so the very act of
   * starting a session threw "rendered more hooks than during the previous
   * render". Hook count has to be identical on every path.
   *
   * Memoised because this screen sits UNDER the Logger in the stack and stays
   * mounted, so every keystroke in a set field re-rendered it — and detectPRs
   * re-scans the entire training history for records.
   */
  const s = activeSession;
  const letters = useMemo(() => (s ? sessionLetters(s) : {}), [s]);
  const prog = useMemo(() => (s ? sessionProgress(s) : { done: 0, total: 0, pct: 0 }), [s]);
  // Against every OTHER session — comparing a session with itself would call
  // its own first working set a record.
  const prs = useMemo(() => (s ? detectPRs(s, db.sessions.filter((x) => x.id !== s.id)) : []), [s, db.sessions]);
  const volume = useMemo(() => (s ? sessionVolume(s) : 0), [s]);

  // Narrowed on `s`, not activeSession, so it stays non-null below.
  if (!s) {
    return (
      <ScrollView className="flex-1 bg-bg" contentContainerStyle={pad}>
        <Kicker>Training</Kicker>
        <Title>Start a session</Title>
        {(candidates.length ? candidates : db.workouts).map((w) => (
          <View key={w.id} className="mt-1 flex-row items-center rounded-lg border border-line bg-panel p-2">
            <View className="flex-1">
              <T w="semi" className="text-5 text-text" numberOfLines={1}>
                {w.name || 'Session'}
              </T>
              <T num className="text-3 text-dim">
                {w.blocks.length} {w.blocks.length === 1 ? 'block' : 'blocks'}
                {w.origin === 'coach' ? ' · from your coach' : ''}
              </T>
            </View>
            <Btn variant="brass" onPress={() => start(w)}>
              Start
            </Btn>
          </View>
        ))}
        {!db.workouts.length ? (
          <T className="mt-2 text-4 text-muted">
            Nothing in your library yet. Sessions your coach assigns will appear here automatically.
          </T>
        ) : null}
      </ScrollView>
    );
  }

  const finish = () => {
    if (!s) return;
    const left = prog.total - prog.done;
    const end = () => {
      update((draft) => {
        const ds = draft.sessions.find((x) => x.id === s.id);
        if (!ds) return false;
        ds.status = 'completed';
        ds.completedAt = Date.now();
        ds.updatedAt = Date.now();
      });
      // Straight to the recap: just after finishing is the only time anyone
      // actually reads what they did.
      nav.navigate('Recap', { id: s.id });
    };
    // Finishing cannot be undone — nothing reopens a completed session — and
    // this is a full-width button at the bottom of a list you thumb through
    // mid-workout. Only ask when there is actually work left to lose.
    if (left > 0) {
      Alert.alert(
        'Finish with work left?',
        `${left} set${left === 1 ? '' : 's'} still unlogged. Finishing cannot be undone.`,
        [
          { text: 'Keep training', style: 'cancel' },
          { text: 'Finish anyway', style: 'destructive', onPress: end },
        ],
      );
      return;
    }
    end();
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={pad}>
      <Kicker>In progress</Kicker>
      <Title>{s.name || 'Session'}</Title>

      <View className="mt-2 h-0.5 overflow-hidden rounded-pill bg-track">
        <View className="h-full rounded-pill bg-gold2" style={{ width: `${prog.pct}%` }} />
      </View>
      <View className="mt-0.5 flex-row justify-between">
        <T num className="text-2 text-dim">
          {prog.done} of {prog.total} done
        </T>
        <T num className="text-2 text-dim">{volume.toLocaleString()} kg</T>
      </View>

      {s.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mt-2">
          <T w="semi" className="mb-1 text-5 text-text">{b.heading || 'Block'}</T>
          {isCond(b) ? (
            <Pressable
              /* Carries WHICH block this is, so the result lands back on it.
                 Without it the run banked into standalone history and the
                 block stayed forever unlogged. A logged block reopens the
                 recap rather than being inert. */
              onPress={() =>
                b.condResult ? nav.navigate('Recap', { id: s.id }) : nav.navigate('Conditioning', { bi, bid: b.id })
              }
              className={`rounded-lg border p-2 ${b.condResult ? 'border-done-line bg-done-bg' : 'border-line bg-panel'}`}
            >
              <T w="semi" className="text-5 text-text">{b.condFmt}</T>
              <T className="text-3 text-dim">
                {b.condResult ? 'logged · tap to review' : 'runs by heart rate · tap to start'}
              </T>
            </Pressable>
          ) : (
            blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
              const done = exFinished(ex);
              return (
                <Pressable
                  key={ex.id ?? ei}
                  onPress={() => nav.navigate('Logger', { bi, ei })}
                  className={`mb-1 rounded-lg border p-2 ${done ? 'border-done-line bg-done-bg' : 'border-line bg-panel'}`}
                >
                  <View className="flex-row items-center gap-1">
                    <Ltr>{letters[bi]?.[ei] ?? '?'}</Ltr>
                    <T w="semi" className="flex-1 text-5 text-text" numberOfLines={1}>
                      {ex.name || 'Exercise'}
                    </T>
                    <T num className="text-3 text-dim">
                      {ex.sets.filter((x) => x.done).length}/{ex.sets.length}
                    </T>
                  </View>
                  <T num className="mt-0.5 text-3 text-muted">{rxLine(ex)}</T>
                  {ex.cue ? <T className="mt-0.5 text-3 text-gold2">{ex.cue}</T> : null}
                </Pressable>
              );
            })
          )}
        </View>
      ))}

      {prs.length ? (
        <View className="mt-2 rounded-lg border border-gold-line bg-gold-wash p-2">
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">Personal records</T>
          {prs.map((p) => (
            <T key={p.name} num className="mt-0.5 text-4 text-gold2">
              {p.name} — {p.kg}kg × {p.reps} (e1RM {Math.round(p.e1)}kg)
            </T>
          ))}
        </View>
      ) : null}

      <Btn variant="brass" size="lg" className="mt-3" onPress={finish}>
        Finish session
      </Btn>
    </ScrollView>
  );
}
