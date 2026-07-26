import { useMemo } from 'react';
import { Text, View } from 'react-native';
import {
  bestE1rmByLift,
  conZones,
  fmtClock,
  isCond,
  sessionVolume,
  ymd,
  type CondResult,
  type Session,
  type ZoneKey,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, Row, Screen, SectionHead, Title, zoneInk } from '../ui';

/*
 * Charts are drawn with plain Views rather than SVG.
 *
 * react-native-svg is not a dependency, and a bar chart of eight points does
 * not justify adding one — a flexed View with a height percentage is the same
 * picture. If a line chart is ever genuinely needed, that is the moment to add
 * the dependency, not before.
 */
export function ProgressScreen() {
  const { db, hr } = useDb();
  const zones = useMemo(() => conZones(hr), [hr]);

  const weeks = useMemo(() => weekly(db.sessions, 8), [db.sessions]);
  const zoneWeek = useMemo(() => thisWeek(db.sessions, db.settings), [db.sessions, db.settings]);
  const lifts = useMemo(() => {
    const now = Date.now();
    const recent = bestE1rmByLift(db.sessions, now - 8 * 7 * 864e5, now);
    const prior = bestE1rmByLift(db.sessions, now - 16 * 7 * 864e5, now - 8 * 7 * 864e5);
    return Array.from(recent.values())
      .map((r) => {
        const p = prior.get(r.name.toLowerCase());
        return { name: r.name, e1: r.e1, delta: p ? r.e1 - p.e1 : null };
      })
      .sort((a, b) => b.e1 - a.e1)
      .slice(0, 5);
  }, [db.sessions]);

  const anything = weeks.some((w) => w.value > 0) || lifts.length || zoneWeek.total > 0;
  const peak = Math.max(...weeks.map((w) => w.value), 1);

  return (
    <Screen>
      <Kicker>Progress</Kicker>
      <Title>Is it working?</Title>

      {!anything ? (
        <Empty
          title="Not enough logged yet"
          body="Trends need a few sessions before they mean anything. Train, and this fills in on its own."
        />
      ) : null}

      {weeks.some((w) => w.value > 0) ? (
        <>
          <SectionHead title="Weekly volume · 8 weeks" />
          <Card>
            {/* `h-full` on the column is load-bearing. `items-end` on the row
                makes each column hug its content, and Yoga resolves a
                percentage height against the parent's DEFINITE height — which
                an auto-sized column does not have. The bars came out zero-high
                and the chart rendered as an empty strip. */}
            <View className="h-16 flex-row items-end gap-0.5">
              {weeks.map((w, i) => (
                <View key={i} className="h-full flex-1 justify-end">
                  <View
                    className="rounded-sm bg-gold2"
                    style={{ height: `${Math.max(2, (100 * w.value) / peak)}%`, opacity: w.value ? 1 : 0.25 }}
                  />
                </View>
              ))}
            </View>
            <View className="mt-0.5 flex-row gap-0.5">
              {weeks.map((w, i) => (
                <Text key={i} className="flex-1 text-center text-1 text-dim">
                  {w.label}
                </Text>
              ))}
            </View>
            <Text className="mt-1 text-3 text-muted">peak {Math.round(peak).toLocaleString()}kg</Text>
          </Card>
        </>
      ) : null}

      {lifts.length ? (
        <>
          <SectionHead title="Top lifts · 8-week change" />
          <Card>
            {lifts.map((d) => (
              <View key={d.name} className="mt-0.5 flex-row items-baseline">
                <Text className="flex-1 text-4 font-bold text-text" numberOfLines={1}>
                  {d.name}
                </Text>
                <Text className="mr-2 text-4 text-muted">{Math.round(d.e1)}kg</Text>
                <Text
                  className="w-8 text-right text-4 font-bold"
                  style={{ color: d.delta == null ? '#847d73' : d.delta > 0 ? '#9fc59b' : d.delta < 0 ? '#cf7f7c' : '#aaa49a' }}
                >
                  {d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + Math.round(d.delta)}
                </Text>
              </View>
            ))}
            <Text className="mt-1 border-t border-line pt-1 text-2 text-dim">
              Against the same lift&apos;s best 8–16 weeks ago. A dash means it wasn&apos;t trained in that window —
              not that it went nowhere.
            </Text>
          </Card>
        </>
      ) : null}

      {zoneWeek.total > 0 ? (
        <>
          <SectionHead title="Zone time · this week" />
          <Card>
            <View className="h-2 flex-row overflow-hidden rounded-pill">
              {(['low', 'mod', 'high'] as ZoneKey[]).map((k) =>
                zoneWeek[k] > 0 ? (
                  <View key={k} style={{ flex: zoneWeek[k], backgroundColor: zoneInk(k) }} />
                ) : null,
              )}
            </View>
            {(['low', 'mod', 'high'] as ZoneKey[]).map((k) => (
              <Row
                key={k}
                dot={zoneInk(k)}
                label={zones.list.find((b) => b.key === k)?.name || k}
                value={fmtClock(zoneWeek[k])}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function weekly(sessions: Session[], n: number) {
  const out: { label: string; value: number }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const a = ymd(start);
    const b = ymd(end);
    out.push({
      label: b.slice(5),
      value: sessions.filter((s) => s.status !== 'active' && s.date >= a && s.date <= b).reduce((t, s) => t + sessionVolume(s), 0),
    });
  }
  return out;
}

function thisWeek(sessions: Session[], settings: { conditioning?: CondResult[] }) {
  const since = Date.now() - 7 * 864e5;
  const inline = sessions.flatMap((s) => s.blocks.filter(isCond).map((b) => b.condResult).filter(Boolean) as CondResult[]);
  // `|| []` is not enough: a non-array `conditioning` from an older or corrupt
  // payload is truthy and spreading it throws, taking the whole screen down
  // rather than degrading to empty. The web app checks the same way.
  const all = [...(Array.isArray(settings.conditioning) ? settings.conditioning : []), ...inline];
  const acc = { low: 0, mod: 0, high: 0, total: 0 };
  all
    .filter((r) => (r.startedAt || 0) >= since)
    .forEach((r) => {
      (['low', 'mod', 'high'] as ZoneKey[]).forEach((k) => {
        const v = r.zsec?.[k] || 0;
        acc[k] += v;
        acc.total += v;
      });
    });
  return acc;
}
