import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { agoLabel, barScale, exLogFor, knownMovements, type ExerciseHistoryEntry } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Empty, Input, Kicker, Screen, SectionHead, T, Tap, Title } from '../ui';
import type { RootStackParams } from '../App';

/*
 * One movement, all of it. The web app's Exercise screen, phrased for a phone.
 *
 * `exLogFor` has been in the engine since the exercise-history work with no
 * caller anywhere — this and its web twin are the first things to ask it for
 * anything.
 *
 * The trend is estimated 1RM rather than top set, because a top set means
 * nothing across changing rep ranges: 100×5 and 115×2 are the same lift on
 * different days and only e1RM puts them on one axis. Drawn as columns rather
 * than a line for the same reason every other chart here is — react-native-svg
 * is not a dependency and a flexed View with a height percentage carries the
 * same information.
 */
type Nav = NativeStackNavigationProp<RootStackParams>;

export function ExerciseScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParams, 'Exercise'>>();
  const movement = route.params?.name || '';
  const { db } = useDb();

  const log = useMemo(() => exLogFor(movement, db.sessions), [movement, db.sessions]);
  const movements = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);

  /* Newest first, capped. Thirty-one sessions is a scroll nobody finishes, and
     the recent ones are what anyone opens this for. */
  const shown = useMemo(() => (all ? log.slice().reverse() : log.slice(-8).reverse()), [log, all]);
  const best = useMemo(
    () => log.reduce<ExerciseHistoryEntry | null>((m, h) => (!m || h.best.e1 > m.best.e1 ? h : m), null),
    [log],
  );
  /* Hoisted rather than called inside the JSX: it is a hook, and a hook that
     lives in render position is one conditional away from changing the call
     order. Every hook on this screen sits above the first return. */
  const hits = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (k ? movements.filter((m) => m.toLowerCase().includes(k)) : movements).slice(0, 10);
  }, [movements, q]);
  const heaviest = useMemo(
    () =>
      log
        .flatMap((h) => h.sets)
        .reduce<{ kg: number; reps: number } | null>((m, s) => (!m || s.kg > m.kg ? s : m), null),
    [log],
  );

  return (
    <Screen>
      <Kicker>Exercise</Kicker>
      <Title>{movement || 'Pick a movement'}</Title>

      {movement && !log.length ? (
        <Empty
          title="Nothing logged for this one yet"
          body="Working sets show up here the moment you finish a session with it in."
        />
      ) : null}

      {log.length ? (
        <>
          <SectionHead title={`Estimated 1RM · ${log.length} ${log.length === 1 ? 'session' : 'sessions'}`} />
          <Card>
            <E1rmTrend log={log} />
          </Card>

          <SectionHead title="Bests" />
          <View className="flex-row gap-1">
            <Stat
              label="Best estimated 1RM"
              value={best ? `${Math.round(best.best.e1)}kg` : '—'}
              sub={
                best
                  ? `${best.best.kg}×${best.best.reps}${best.best.reps > 8 ? ' — a long extrapolation' : ''} · ${agoLabel(best.date)}`
                  : ''
              }
              tint
            />
            <Stat
              label="Heaviest set"
              value={heaviest ? `${heaviest.kg}kg` : '—'}
              sub={heaviest ? `for ${heaviest.reps} ${heaviest.reps === 1 ? 'rep' : 'reps'}` : ''}
            />
          </View>

          <SectionHead title={shown.length < log.length ? `Last ${shown.length} sessions` : 'Every session'} />
          {shown.map((h) => (
            <Card key={h.sid} tone="quiet" className="mb-0.5 py-1.5">
              <View className="flex-row items-baseline">
                <T num w="med" className="flex-1 text-4 text-text">
                  {agoLabel(h.date)}
                </T>
                <T num className="text-3 text-dim">{h.date}</T>
              </View>
              <T num className="mt-0.5 text-3 text-muted">
                {h.sets.map((s) => `${s.kg}×${s.reps}${s.felt ? '@' + s.felt : ''}`).join('  ')}
              </T>
              <T num className="mt-0.5 text-2 text-dim">best e1RM {Math.round(h.best.e1)}kg</T>
            </Card>
          ))}
          {shown.length < log.length ? (
            <Btn className="mt-1" onPress={() => setAll(true)}>
              Show the other {log.length - shown.length}
            </Btn>
          ) : null}
        </>
      ) : null}

      <SectionHead title={movement ? 'Another movement' : 'Your movements'} />
      {/* 448 movements is not a list anyone scrolls. */}
      <Card tone="quiet">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${movements.length} movements`}
          accessibilityLabel="Search movements"
          className="h-5 rounded-md border border-line bg-well px-1.5 text-5 text-text"
        />
      </Card>
      {hits.map((m) => (
        <Tap
          key={m}
          onPress={() => {
            setQ('');
            setAll(false);
            nav.push('Exercise', { name: m });
          }}
          label={m}
          className="mt-0.5 rounded-md border border-line bg-panel3 p-1.5"
        >
          <T w="med" className="text-4 text-text">{m}</T>
        </Tap>
      ))}
    </Screen>
  );
}

/**
 * e1RM session by session, as columns.
 *
 * Reuses `barScale` so a lift that moves a few percent over months does not
 * draw as a flat wall — the same problem the weekly volume chart had — and the
 * floor is named underneath, because a truncated axis that does not say so is
 * the dishonest kind.
 */
function E1rmTrend({ log }: { log: ExerciseHistoryEntry[] }) {
  const pts = log.map((h) => h.best.e1);
  const scale = barScale(pts);
  const last = log[log.length - 1];

  if (pts.length < 2) {
    return (
      <T num className="text-4 text-muted">
        {Math.round(pts[0])}kg estimated 1RM from {last.best.kg}×{last.best.reps}. One session is a point, not a trend —
        the line starts at two.
      </T>
    );
  }

  // Only the tail fits on a phone at a legible column width.
  const tail = pts.slice(-24);
  return (
    <View>
      <View className="h-16 flex-row items-end gap-0.5">
        {tail.map((v, i) => (
          <View key={i} className="h-full flex-1 justify-end">
            <View
              className="rounded-sm bg-gold2"
              style={{ height: `${Math.max(2, scale.pct(v))}%`, opacity: i === tail.length - 1 ? 1 : 0.6 }}
            />
          </View>
        ))}
      </View>
      <View className="mt-0.5 flex-row justify-between">
        <T num className="text-2 text-dim">{log[log.length - tail.length].date}</T>
        <T num className="text-2 text-gold2">{Math.round(pts[pts.length - 1])}kg</T>
        <T num className="text-2 text-dim">{last.date}</T>
      </View>
      <T num className="mt-1 text-3 text-muted">
        {scale.floating
          ? `${Math.round(scale.floor)}–${Math.round(scale.top)}kg · axis starts at ${Math.round(scale.floor)}`
          : `peak ${Math.round(scale.top)}kg`}
        {tail.length < pts.length ? ` · last ${tail.length} of ${pts.length}` : ''}
        {' · from your best set each session'}
      </T>
    </View>
  );
}

function Stat({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint?: boolean }) {
  return (
    <Card tone="quiet" className="flex-1 py-1.5">
      <T className="text-2 text-dim">{label}</T>
      <T num w="black" className={`mt-0.5 text-7 ${tint ? 'text-gold2' : 'text-text'}`}>
        {value}
      </T>
      {sub ? <T num className="mt-0.5 text-2 text-dim">{sub}</T> : null}
    </Card>
  );
}
