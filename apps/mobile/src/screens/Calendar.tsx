import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { hasLoggedWork, ymd, type Session, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { resolveDayTarget } from '../store/session';
import { Btn, Card, Kicker, Screen, T, Tap, Title } from '../ui';
import type { RootStackParams } from '../App';

/*
 * Planned and trained are drawn differently on purpose. A dot you intended is
 * not a dot you earned, and conflating them lets you believe you trained more
 * than you did.
 */
export function CalendarScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { workouts, sessions } = useDb();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const cells = useMemo(() => build(cursor, workouts, sessions), [cursor, workouts, sessions]);
  const today = ymd(new Date());

  /* A tapped cell goes to whatever the day actually holds — a completed
     day's Recap, today's Training tab, or a read-only preview for anything
     else — the same three-way split Home's WeekStrip will use (Task 6). */
  const openDay = (c: Cell) => {
    const target = resolveDayTarget(c.key, today, c.workoutId, c.sessionId);
    if (target.kind === 'recap') nav.navigate('Recap', { id: target.id });
    else if (target.kind === 'today') nav.navigate('Tabs', { screen: 'Train' });
    else nav.navigate('Day', { date: target.date });
  };

  return (
    <Screen>
      <Tap
        onPress={() => nav.goBack()}
        label="back"
        box={40}
        className="mb-1 h-5 w-5 items-center justify-center self-start rounded-md border border-line2 bg-panel2"
      >
        <T className="text-6 text-muted">←</T>
      </Tap>
      <Kicker>Calendar</Kicker>
      <Title>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Title>

      <View className="mt-2 flex-row gap-1">
        <Btn
          className="flex-1"
          label="previous month"
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          ‹
        </Btn>
        <Btn className="flex-[2]" onPress={() => setCursor(new Date())}>
          Today
        </Btn>
        <Btn
          className="flex-1"
          label="next month"
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          ›
        </Btn>
      </View>

      <Card className="mt-2">
        <View className="flex-row flex-wrap">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <View key={i} style={{ width: `${100 / 7}%` }} className="pb-0.5">
              <T w="semi" className="text-center text-1 uppercase tracking-widest text-dim">{d}</T>
            </View>
          ))}
          {cells.map((c, i) => (
            <View key={i} style={{ width: `${100 / 7}%` }} className="p-0.5">
              {c ? (
                <Tap
                  onPress={() => openDay(c)}
                  /* The accessibility label replaces everything inside the Tap,
                     so the trained/planned dot is invisible to VoiceOver unless
                     the state is spoken as part of the name. */
                  label={
                    new Date(c.key + 'T00:00:00').toLocaleDateString(undefined, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    }) + (c.sessionId ? ', trained' : c.workoutId ? ', planned' : '')
                  }
                  className={`aspect-square items-center rounded-sm border py-0.5 ${
                    c.key === today ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel2'
                  }`}
                >
                  <T num className={`text-2 ${c.key === today ? 'text-gold2' : 'text-muted'}`}>{c.n}</T>
                  <View className="mt-0.5 flex-row gap-0.5">
                    {c.sessionId ? <View className="h-1 w-1 rounded-pill bg-gold2" /> : null}
                    {c.workoutId && !c.sessionId ? <View className="h-1 w-1 rounded-pill border border-gold2" /> : null}
                  </View>
                </Tap>
              ) : (
                <View className="aspect-square" />
              )}
            </View>
          ))}
        </View>
        <View className="mt-1.5 flex-row gap-2 border-t border-line pt-1">
          <View className="flex-row items-center gap-0.5">
            <View className="h-1 w-1 rounded-pill bg-gold2" />
            <T className="text-2 text-dim">trained</T>
          </View>
          <View className="flex-row items-center gap-0.5">
            <View className="h-1 w-1 rounded-pill border border-gold2" />
            <T className="text-2 text-dim">planned</T>
          </View>
        </View>
      </Card>

      <Btn className="mt-2" onPress={() => nav.navigate('Tabs', { screen: 'Library' })}>
        Schedule something
      </Btn>
    </Screen>
  );
}

interface Cell {
  key: string;
  n: number;
  workoutId?: string;
  sessionId?: string;
}

function build(cursor: Date, workouts: Workout[], sessions: Session[]): (Cell | null)[] {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const total = new Date(y, m + 1, 0).getDate();
  /* Two completed sessions can share a date. The FIRST one wins — the same
     "take the first" rule `workouts.find(...)` below already applies to a
     multi-match workout, and the one the design doc specifies
     (docs/superpowers/specs/2026-08-02-calendar-day-jump-design.md §1).
     `new Map(entries)` keeps the LAST entry for a repeated key, so the map
     is filled by hand rather than built from the mapped array. */
  const trainedByDate = new Map<string, string>();
  for (const s of sessions) {
    if (s.status === 'active' || !hasLoggedWork(s)) continue;
    if (!trainedByDate.has(s.date)) trainedByDate.set(s.date, s.id);
  }

  const out: (Cell | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) out.push(null);
  for (let n = 1; n <= total; n++) {
    const date = new Date(y, m, n);
    const key = ymd(date);
    const dow = date.getDay();
    const matchedWorkout = workouts.find((w) => (w.dates || []).includes(key) || (w.days || []).includes(dow));
    out.push({
      key,
      n,
      workoutId: matchedWorkout?.id,
      sessionId: trainedByDate.get(key),
    });
  }
  return out;
}
