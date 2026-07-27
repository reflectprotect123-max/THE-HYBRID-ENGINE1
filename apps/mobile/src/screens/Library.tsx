import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  agoLabel,
  blockExercises,
  isCond,
  knownMovements,
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
import { Btn, Card, Chip, Empty, Input, Kicker, Screen, SectionHead, T, Tabs, Tap, Title } from '../ui';
import type { RootStackParams } from '../App';

/*
 * Two letters, in seven equal columns — the same change as the web app's.
 *
 * Three-letter chips in a wrapping row do not fit a phone: SAT dropped to a
 * line of its own, so a week rendered as 6 + 1 and every session card carried
 * an extra row of height to say nothing. `flex-1` per cell cannot wrap.
 *
 * Two letters rather than one because Sunday and Saturday are both S, and
 * unlike Home's week strip there is no date underneath to tell them apart.
 */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/*
 * Everything you can train. Coach-assigned work is listed separately and is
 * read-only — editing it here would silently diverge from what the coach still
 * believes they gave you.
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, update } = useDb();
  const [open, setOpen] = useState<string | null>(null);

  /* Three slices of one library, not three destinations. Sessions are things
     you START; exercises and mobility are things you LOOK UP. In one list the
     448 movements buried the sessions you actually run. */
  const [tab, setTab] = useState<'sessions' | 'exercises' | 'mobility'>('sessions');
  const [q, setQ] = useState('');

  const mine = db.workouts.filter((w) => w.origin !== 'coach');
  const fromCoach = db.workouts.filter((w) => w.origin === 'coach');
  const movements = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);
  const mobility = useMemo(
    () => (Array.isArray(db.settings.mobility) ? db.settings.mobility : []),
    [db.settings.mobility],
  );
  const shown = useMemo(() => {
    const list = tab === 'exercises' ? movements : tab === 'mobility' ? mobility : [];
    const k = q.trim().toLowerCase();
    return (k ? list.filter((m) => m.toLowerCase().includes(k)) : list).slice(0, 40);
  }, [tab, q, movements, mobility]);

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
      <Title>Your library</Title>

      <Tabs
        value={tab}
        onChange={(k) => {
          setTab(k);
          setQ('');
        }}
        tabs={[
          { key: 'sessions', label: 'Sessions', count: db.workouts.length },
          { key: 'exercises', label: 'Exercises', count: movements.length },
          { key: 'mobility', label: 'Mobility', count: mobility.length },
        ]}
      />

      {tab !== 'sessions' ? (
        <NameList
          shown={shown}
          total={tab === 'exercises' ? movements.length : mobility.length}
          q={q}
          setQ={setQ}
          noun={tab === 'exercises' ? 'movements' : 'mobility & prep'}
          onPick={tab === 'exercises' ? (m) => nav.navigate('Exercise', { name: m }) : undefined}
          empty={
            tab === 'exercises'
              ? 'Nothing logged yet. Movements appear here as you train them.'
              : 'No mobility work saved. These are the stretches, breathing and prep you do around training — they carry no load to track, so this is a reference list.'
          }
        />
      ) : null}

      {tab !== 'sessions' ? null : (
      <>
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
              <Tap
                className="min-w-0 flex-1 flex-row items-center"
                onPress={() => setOpen(open === w.id ? null : w.id)}
                label={`${open === w.id ? 'collapse' : 'expand'} ${w.name || 'session'}`}
              >
                <T w="semi" className="min-w-0 flex-1 text-5 text-text" numberOfLines={1}>
                  {w.name || 'Session'}
                </T>
                <T num className="ml-1 text-3 text-dim">
                  {w.blocks.length} {w.blocks.length === 1 ? 'block' : 'blocks'}
                </T>
              </Tap>
              <Tap
                onPress={() => confirmRemove(w)}
                box={32}
                label={`delete ${w.name || 'session'}`}
                className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
              >
                <T w="med" className="text-4 text-muted">
                  ✕
                </T>
              </Tap>
            </View>

            <Signal w={w} />

            <View className="mt-1 flex-row gap-0.5">
              {DAYS.map((d, i) => (
                // The cell owns the width; the chip stretches to fill it, so
                // seven always land on one row whatever the label does.
                <View key={d} className="flex-1">
                  <Chip
                    on={(w.days || []).includes(i)}
                    onPress={() => toggleDay(w.id, i)}
                    label={`${DAY_NAMES[i]} — ${(w.days || []).includes(i) ? 'scheduled' : 'not scheduled'}`}
                  >
                    {d}
                  </Chip>
                </View>
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
      </>
      )}
    </Screen>
  );
}

/**
 * A searchable list of names — the web app's `NameList`.
 *
 * Shared by Exercises and Mobility because they are the same object at
 * different weights: one opens a history the app can draw, the other does not,
 * because mobility work carries no numbers and a tappable row would promise a
 * screen that has nothing on it.
 */
function NameList({
  shown,
  total,
  q,
  setQ,
  onPick,
  noun,
  empty,
}: {
  shown: string[];
  total: number;
  q: string;
  setQ: (s: string) => void;
  onPick?: (m: string) => void;
  noun: string;
  empty: string;
}) {
  if (!total) {
    return (
      <View className="mt-2">
        <Empty title="Nothing here yet" body={empty} />
      </View>
    );
  }
  return (
    <>
      <Input
        value={q}
        onChangeText={setQ}
        placeholder={`Search ${total} ${noun}`}
        accessibilityLabel={`Search ${noun}`}
        className="mt-2 h-5 rounded-md border border-line bg-well px-1.5 text-4 text-text"
      />
      {shown.map((m) =>
        onPick ? (
          <Tap
            key={m}
            onPress={() => onPick(m)}
            label={`${m} history`}
            className="mt-0.5 flex-row items-center rounded-md border border-line bg-panel3 p-1.5"
          >
            <T w="med" className="min-w-0 flex-1 text-4 text-text" numberOfLines={1}>
              {m}
            </T>
            <T className="text-3 text-dim">›</T>
          </Tap>
        ) : (
          <View key={m} className="mt-0.5 rounded-md border border-line bg-panel3 p-1.5">
            <T className="text-4 text-muted">{m}</T>
          </View>
        ),
      )}
      {!shown.length ? <T className="mt-1 p-1.5 text-4 text-dim">Nothing matches “{q}”.</T> : null}
    </>
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
