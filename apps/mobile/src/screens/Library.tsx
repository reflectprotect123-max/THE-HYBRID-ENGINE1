import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  agoLabel,
  blockExercises,
  isCond,
  newBlock,
  rxLine,
  sessionOpeners,
  uid,
  workoutStats,
  type LoggedSet,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Chip, Empty, Kicker, Screen, SectionHead, T, Title } from '../ui';
import type { RootStackParams } from '../App';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/*
 * Everything you can train. Coach-assigned work is listed separately and is
 * read-only — editing it here would silently diverge from what the coach still
 * believes they gave you.
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, update } = useDb();
  const [open, setOpen] = useState<string | null>(null);

  const mine = db.workouts.filter((w) => w.origin !== 'coach');
  const fromCoach = db.workouts.filter((w) => w.origin === 'coach');

  /** Straight into the full editor. There was briefly a guided wizard in front
   *  of this; it earned nothing the Planner did not already do better. */
  const add = () => {
    const w: Workout = { id: uid(), name: 'New session', blocks: [newBlock()], updatedAt: Date.now() };
    update((d) => {
      d.workouts.push(w);
    });
    nav.navigate('Planner', { id: w.id });
  };

  const toggleDay = (id: string, i: number) =>
    update((d) => {
      const w = d.workouts.find((x) => x.id === id);
      if (!w) return false;
      const days = new Set(w.days || []);
      if (days.has(i)) days.delete(i);
      else days.add(i);
      w.days = Array.from(days).sort((a, b) => a - b);
      w.updatedAt = Date.now();
    });

  const remove = (id: string) =>
    update((d) => {
      d.workouts = d.workouts.filter((x) => x.id !== id);
      // A tombstone, not just a local delete: without one the next sync sees a
      // workout the remote still has and cheerfully restores it.
      d.settings.deletedIds = { ...(d.settings.deletedIds || {}), [id]: Date.now() };
    });

  /* Asks first. The tombstone above is exactly why: this is not a local
     tidy-up that a re-sync quietly undoes, it removes the session from every
     device you own and there is no way back to it. */
  const confirmRemove = (w: Workout) =>
    Alert.alert(`Delete "${w.name || 'Session'}"?`, 'This removes it from every device. It cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(w.id) },
    ]);

  return (
    <Screen>
      <Kicker>Library</Kicker>
      <Title>Your sessions</Title>

      <Btn variant="brass" className="mt-2" onPress={add}>
        ＋ New session
      </Btn>

      <SectionHead title="Yours" />
      {mine.length ? (
        mine.map((w) => (
          <Card key={w.id} className="mb-1">
            {/* Delete sits on the ROW, not behind the expand. It used to only
                appear once you had tapped the card open, which is not
                somewhere anyone looks for it. */}
            <View className="flex-row items-center">
              <Pressable
                className="min-w-0 flex-1 flex-row items-center"
                onPress={() => setOpen(open === w.id ? null : w.id)}
                accessibilityLabel={`${open === w.id ? 'collapse' : 'expand'} ${w.name || 'session'}`}
              >
                <T w="semi" className="min-w-0 flex-1 text-5 text-text" numberOfLines={1}>
                  {w.name || 'Session'}
                </T>
                <T num className="ml-1 text-3 text-dim">
                  {w.blocks.length} {w.blocks.length === 1 ? 'block' : 'blocks'}
                </T>
              </Pressable>
              <Pressable
                onPress={() => confirmRemove(w)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`delete ${w.name || 'session'}`}
                className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
              >
                <T w="med" className="text-4 text-muted">
                  ✕
                </T>
              </Pressable>
            </View>

            <Signal w={w} />

            <View className="mt-1 flex-row flex-wrap gap-0.5">
              {DAYS.map((d, i) => (
                <Chip key={d} on={(w.days || []).includes(i)} onPress={() => toggleDay(w.id, i)}>
                  {d}
                </Chip>
              ))}
            </View>

            {open === w.id ? (
              <>
                <Detail w={w} />
                <Btn variant="brass" className="mt-1.5" onPress={() => nav.navigate('Planner', { id: w.id })}>
                  Edit
                </Btn>
              </>
            ) : null}
          </Card>
        ))
      ) : (
        <Empty title="Nothing here yet" body="Tap “＋ New session” to build your first one." />
      )}

      {fromCoach.length ? (
        <>
          <SectionHead title="From your coach" />
          {fromCoach.map((w) => (
            <Card key={w.id} className="mb-1 border-gold-line">
              <View className="flex-row items-center">
                <T w="semi" className="flex-1 text-5 text-text" numberOfLines={1}>
                  {w.name || 'Session'}
                </T>
                <T w="semi" className="text-2 uppercase tracking-widest text-gold2">assigned</T>
              </View>
              {(w.dates || []).length ? <T num className="mt-0.5 text-3 text-dim">for {(w.dates || []).join(', ')}</T> : null}
              <Detail w={w} />
              <Btn className="mt-1.5" onPress={() => nav.navigate('Planner', { id: w.id })}>
                View
              </Btn>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

/*
 * What this session actually means to you, on the card.
 *
 * The Library is the screen you open to DECIDE what to train, and until now it
 * answered with a name and a block count. These two lines are the two things
 * that bear on the decision: when you last did it, and what you would be
 * lifting if you started it now.
 *
 * Both are suppressed when empty rather than rendered blank — a session you
 * have never trained should say nothing, not "last trained never · opens at".
 */
function Signal({ w }: { w: Workout }) {
  const { db, whoop } = useDb();
  const stats = useMemo(() => workoutStats(w, db.sessions), [w, db.sessions]);
  // Through sessionOpeners, so this figure and the one the logger prefills come
  // from the same function — including the red-morning easing.
  const opens = useMemo(() => sessionOpeners(w, db.settings, whoop), [w, db.settings, whoop]);

  if (!stats.count && !opens.length) return null;

  return (
    <View className="mt-0.5">
      {stats.count ? (
        <T num className="text-3 text-dim">
          {agoLabel(stats.lastDate)} · {stats.count} {stats.count === 1 ? 'time' : 'times'}
        </T>
      ) : null}
      {opens.length ? (
        <T num className="text-3 text-muted" numberOfLines={1}>
          opens at {opens.map((o) => `${o.name} ${o.kg}`).join(' · ')}
          {opens.some((o) => o.eased) ? ' (eased today)' : ''}
        </T>
      ) : null}
    </View>
  );
}

function Detail({ w }: { w: Workout }) {
  return (
    <View className="mt-1.5 border-t border-line pt-1.5">
      {w.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mb-1">
          <T w="semi" className="text-3 uppercase tracking-widest text-dim">{b.heading || 'Block'}</T>
          {isCond(b) ? (
            <T className="text-4 text-muted">
              {b.condFmt} · {b.effort || b.targetZone}
            </T>
          ) : (
            blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => (
              <T key={ex.id ?? ei} num className="text-4 text-muted">
                <T w="semi" className="text-text">{ex.name || 'Exercise'}</T> {rxLine(ex)}
              </T>
            ))
          )}
        </View>
      ))}
    </View>
  );
}
