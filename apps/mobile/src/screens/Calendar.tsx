import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { hasLoggedWork, ymd, type Session, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Kicker, Screen, Title } from '../ui';

/*
 * Planned and trained are drawn differently on purpose. A dot you intended is
 * not a dot you earned, and conflating them lets you believe you trained more
 * than you did.
 */
export function CalendarScreen() {
  const { db } = useDb();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const cells = useMemo(() => build(cursor, db.workouts, db.sessions), [cursor, db]);
  const today = ymd(new Date());

  return (
    <Screen>
      <Kicker>Calendar</Kicker>
      <Title>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Title>

      <View className="mt-2 flex-row gap-1">
        <Btn className="flex-1" onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
          ‹
        </Btn>
        <Btn className="flex-[2]" onPress={() => setCursor(new Date())}>
          Today
        </Btn>
        <Btn className="flex-1" onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
          ›
        </Btn>
      </View>

      <Card className="mt-2">
        <View className="flex-row flex-wrap">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <View key={i} style={{ width: `${100 / 7}%` }} className="pb-0.5">
              <Text className="text-center text-1 font-bold uppercase tracking-widest text-dim">{d}</Text>
            </View>
          ))}
          {cells.map((c, i) => (
            <View key={i} style={{ width: `${100 / 7}%` }} className="p-0.5">
              {c ? (
                <View
                  className={`aspect-square items-center rounded-sm border py-0.5 ${
                    c.key === today ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel2'
                  }`}
                >
                  <Text className="text-2 text-muted">{c.n}</Text>
                  <View className="mt-0.5 flex-row gap-0.5">
                    {c.trained ? <View className="h-1 w-1 rounded-pill bg-gold2" /> : null}
                    {c.planned && !c.trained ? <View className="h-1 w-1 rounded-pill border border-gold2" /> : null}
                  </View>
                </View>
              ) : (
                <View className="aspect-square" />
              )}
            </View>
          ))}
        </View>
        <View className="mt-1.5 flex-row gap-2 border-t border-line pt-1">
          <View className="flex-row items-center gap-0.5">
            <View className="h-1 w-1 rounded-pill bg-gold2" />
            <Text className="text-2 text-dim">trained</Text>
          </View>
          <View className="flex-row items-center gap-0.5">
            <View className="h-1 w-1 rounded-pill border border-gold2" />
            <Text className="text-2 text-dim">planned</Text>
          </View>
        </View>
      </Card>
    </Screen>
  );
}

interface Cell {
  key: string;
  n: number;
  planned: boolean;
  trained: boolean;
}

function build(cursor: Date, workouts: Workout[], sessions: Session[]): (Cell | null)[] {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const total = new Date(y, m + 1, 0).getDate();
  const trained = new Set(sessions.filter((s) => s.status !== 'active' && hasLoggedWork(s)).map((s) => s.date));

  const out: (Cell | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) out.push(null);
  for (let n = 1; n <= total; n++) {
    const date = new Date(y, m, n);
    const key = ymd(date);
    out.push({
      key,
      n,
      planned: workouts.some((w) => (w.dates || []).includes(key) || (w.days || []).includes(date.getDay())),
      trained: trained.has(key),
    });
  }
  return out;
}
