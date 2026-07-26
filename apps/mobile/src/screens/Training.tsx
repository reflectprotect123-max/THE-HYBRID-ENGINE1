import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  blockExercises,
  exFinished,
  freshSessionBlocks,
  isCond,
  rxLine,
  sessionLetters,
  sessionProgress,
  uid,
  ymd,
  type LoggedSet,
  type Session,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
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

  if (!activeSession) {
    return (
      <ScrollView className="flex-1 bg-bg" contentContainerStyle={pad}>
        <Text className="text-2 font-bold uppercase tracking-widest text-dim">Training</Text>
        <Text className="text-8 font-black text-text">Start a session</Text>
        {(candidates.length ? candidates : db.workouts).map((w) => (
          <View key={w.id} className="mt-1 flex-row items-center rounded-lg border border-line bg-panel p-2">
            <View className="flex-1">
              <Text className="text-5 font-bold text-text" numberOfLines={1}>
                {w.name || 'Session'}
              </Text>
              <Text className="text-3 text-dim">
                {w.blocks.length} {w.blocks.length === 1 ? 'block' : 'blocks'}
                {w.origin === 'coach' ? ' · from your coach' : ''}
              </Text>
            </View>
            <Pressable onPress={() => start(w)} className="rounded-md bg-gold px-2 py-1">
              <Text className="text-4 font-black text-bg">Start</Text>
            </Pressable>
          </View>
        ))}
        {!db.workouts.length ? (
          <Text className="mt-2 text-4 text-muted">
            Nothing in your library yet. Sessions your coach assigns will appear here automatically.
          </Text>
        ) : null}
      </ScrollView>
    );
  }

  const s = activeSession;
  const letters = sessionLetters(s);
  const prog = sessionProgress(s);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={pad}>
      <Text className="text-2 font-bold uppercase tracking-widest text-dim">In progress</Text>
      <Text className="text-8 font-black text-text">{s.name || 'Session'}</Text>

      <View className="mt-2 h-0.5 overflow-hidden rounded-pill bg-track">
        <View className="h-full rounded-pill bg-gold2" style={{ width: `${prog.pct}%` }} />
      </View>
      <Text className="mt-0.5 text-2 text-dim">
        {prog.done} of {prog.total} done
      </Text>

      {s.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mt-2">
          <Text className="mb-1 text-5 font-bold text-text">{b.heading || 'Block'}</Text>
          {isCond(b) ? (
            <View className="rounded-lg border border-line bg-panel p-2">
              <Text className="text-5 font-bold text-text">{b.condFmt}</Text>
              <Text className="text-3 text-dim">{b.condResult ? 'logged' : 'runs by heart rate'}</Text>
            </View>
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
                    <View className="rounded-sm border border-gold-line bg-gold-wash px-0.5">
                      <Text className="text-3 font-black text-gold2">{letters[bi]?.[ei] ?? '?'}</Text>
                    </View>
                    <Text className="flex-1 text-5 font-bold text-text" numberOfLines={1}>
                      {ex.name || 'Exercise'}
                    </Text>
                    <Text className="text-3 text-dim">
                      {ex.sets.filter((x) => x.done).length}/{ex.sets.length}
                    </Text>
                  </View>
                  <Text className="mt-0.5 text-3 text-muted">{rxLine(ex)}</Text>
                  {ex.cue ? <Text className="mt-0.5 text-3 text-gold2">{ex.cue}</Text> : null}
                </Pressable>
              );
            })
          )}
        </View>
      ))}

      <Pressable
        onPress={() =>
          update((draft) => {
            const ds = draft.sessions.find((x) => x.id === s.id);
            if (!ds) return false;
            ds.status = 'completed';
            ds.completedAt = Date.now();
            ds.updatedAt = Date.now();
          })
        }
        className="mt-3 items-center rounded-md bg-gold py-2"
      >
        <Text className="text-6 font-black text-bg">Finish session</Text>
      </Pressable>
    </ScrollView>
  );
}
