import { useMemo } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  barScale,
  bestE1rmByLift,
  conZones,
  fmtClock,
  fmtDistance,
  isCond,
  condEfforts,
  insights,
  loadBalance,
  sessionVolume,
  ymd,
  type CondResult,
  type Insight,
  type Session,
  type ZoneKey,
} from '@hybrid/engine';
import { color } from '@hybrid/design';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, Row, Screen, SectionHead, T, Tap, Title, zoneInk } from '../ui';
import type { RootStackParams } from '../App';

/*
 * Charts are drawn with plain Views rather than SVG.
 *
 * react-native-svg is not a dependency, and a trend of eight to thirty points
 * does not justify adding one — a flexed View with a height percentage carries
 * the same information. The web app's recovery and HRR trends are polylines;
 * here they are columns against the same axis. Deliberate: the shape of the
 * trend is the point, and a column chart states it without a new dependency.
 */
export function ProgressScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, hr } = useDb();
  const zones = useMemo(() => conZones(hr), [hr]);

  const weeks = useMemo(() => weekly(db.sessions, 8), [db.sessions]);
  const zoneWeek = useMemo(() => thisWeek(db.sessions, db.settings), [db.sessions, db.settings]);
  const distWeek = useMemo(() => distanceThisWeek(db.sessions, db.settings), [db.sessions, db.settings]);

  const whoopHist = useMemo(
    () =>
      Array.isArray(db.settings.whoopDaily)
        ? (db.settings.whoopDaily as { date: string; recovery: number | null; strain: number | null }[])
        : [],
    [db.settings.whoopDaily],
  );
  const recovery = useMemo(
    () =>
      whoopHist
        .filter((h) => h && h.recovery != null)
        .slice(-30)
        .map((h) => ({ label: String(h.date).slice(5), value: h.recovery as number })),
    [whoopHist],
  );
  const strain = useMemo(
    () =>
      whoopHist
        .filter((h) => h && h.strain != null)
        .slice(-30)
        .map((h) => ({ label: String(h.date).slice(5), value: h.strain as number })),
    [whoopHist],
  );

  const hrrTrend = useMemo(() => {
    return condEfforts(db.sessions, db.settings)
      .filter((r) => r.hrr != null)
      .slice(-12)
      .map((r, i) => ({ label: String(i + 1), value: r.hrr as number }));
  }, [db.sessions, db.settings]);
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

  const balance = useMemo(() => loadBalance(db.sessions, db.settings), [db.sessions, db.settings]);

  /* Everything else on this screen reports what you already lived through.
     This is the only thing that answers the title's question, and it returns
     nothing at all until there is enough on both sides of the comparison. */
  const found = useMemo(() => insights(db), [db]);

  /*
   * These thresholds must match the ones each card renders at, EXACTLY.
   * They did not: `anything` counted a single recovery reading as content
   * while every trend below refuses to draw from fewer than two points. One
   * WHOOP sync is enough to produce exactly that — so the empty state was
   * suppressed, no card qualified, and the screen was blank apart from its
   * title. "Nothing to show yet" has to mean the same thing in both places.
   */
  const anything =
    weeks.some((w) => w.value > 0) ||
    lifts.length > 0 ||
    zoneWeek.total > 0 ||
    recovery.length > 1 ||
    strain.length > 1 ||
    hrrTrend.length > 1 ||
    found.length > 0 ||
    !!balance;
  /* Zero-baselined, this was seven bars spanning 92-100% of the card: the
     largest element on the screen, distinguishing nothing. See `barScale`. */
  /* Scaled from COMPLETE weeks only — see the web app's note. The current
     bucket ends today, so on a Monday it holds two days against seven full
     weeks and flattens the whole chart. */
  const vol = useMemo(() => {
    const done = weeks.filter((w) => !w.partial);
    return barScale((done.length ? done : weeks).map((w) => w.value));
  }, [weeks]);

  return (
    <Screen>
      <Kicker>Progress</Kicker>
      {/* Not "Is it working?" — on a screen that can legitimately be empty,
          that reads as the APP asking whether IT is broken. It is a question
          about the training. */}
      <Title>Is the training working?</Title>

      {!anything ? (
        <Empty
          title="Not enough logged yet"
          body="Trends need a few sessions before they mean anything. Train, and this fills in on its own."
        />
      ) : null}

      {/* First, because it is the answer and everything below is the working.
          It is also the only thing on this screen that reads the two halves of
          the app together — strength progression and conditioning progression
          have always adapted correctly in isolation and never once been
          compared. `loadBalance` returns null unless both sides have enough
          data, so this card simply is not here rather than guessing. */}
      {balance ? (
        <Card tone="raised" className="mt-2">
          <Kicker className="text-1">Strength vs conditioning</Kicker>
          <T w="semi" className="mt-0.5 text-6 text-text">{balance.title}</T>
          <T className="mt-0.5 text-4 text-muted">{balance.body}</T>
          <View className="mt-1 border-t border-line pt-1">
            <T className="text-2 text-dim">
              Two things moving together is not one causing the other — a hard month at work moves both.
            </T>
          </View>
        </Card>
      ) : null}

      {/* Above the charts because it is the only thing here you could not have
          worked out by looking at them. A volume bar tells you what you did; a
          finding tells you what it did to you. */}
      {found.length ? (
        <>
          <SectionHead title="What has changed" />
          <Card>
            <View className="gap-1">
              {found.map((i, n) => (
                <Finding
                  key={i.id}
                  i={i}
                  last={n === found.length - 1}
                  onMovement={(name) => nav.navigate('Exercise', { name })}
                />
              ))}
            </View>
            <View className="mt-1 border-t border-line pt-1">
              <T className="text-2 text-dim">
                Measured against your own past self at the same felt effort — so more weight only counts if it did
                not cost more. Nothing appears until both windows hold enough to mean something.
              </T>
            </View>
          </Card>
        </>
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
                    className={`rounded-sm ${w.partial ? 'border border-gold2' : 'bg-gold2'}`}
                    style={{
                      // A trained week never renders as literally nothing — 2%
                      // reads as "small", 0 reads as "missing".
                      height: `${w.value > 0 ? Math.max(2, vol.pct(w.value)) : 2}%`,
                      // Outlined, not filled: the current week is short because
                      // it is UNFINISHED, not because it went badly.
                      opacity: w.partial ? 0.55 : w.value ? 1 : 0.25,
                    }}
                  />
                </View>
              ))}
            </View>
            <View className="mt-0.5 flex-row gap-0.5">
              {weeks.map((w, i) => (
                <T key={i} num className="flex-1 text-center text-1 text-dim">
                  {w.label}
                </T>
              ))}
            </View>
            {/* The axis is truncated to make variation visible, so it says so.
                A zoomed chart implying the shortest bar is nothing is the same
                dishonesty as the flat one, pointing the other way. */}
            <T num className="mt-1 text-3 text-muted">
              {vol.floating
                ? `${Math.round(vol.floor).toLocaleString()}–${Math.round(vol.top).toLocaleString()}kg · axis starts at ${Math.round(vol.floor).toLocaleString()}`
                : `peak ${Math.round(vol.top).toLocaleString()}kg`}
              {weeks.some((w) => w.partial) ? ' · outlined bar is this week so far' : ''}
            </T>
          </Card>
        </>
      ) : null}

      {lifts.length ? (
        <>
          <SectionHead title="Top lifts · 8-week change" />
          <Card>
            {/* Each lift is a door into its own history — the per-movement
                trend `exLogFor` has always been able to produce and nothing
                ever asked it for. */}
            {lifts.map((d) => (
              <Tap
                key={d.name}
                onPress={() => nav.navigate('Exercise', { name: d.name })}
                label={`${d.name} history`}
                className="mt-0.5 flex-row items-baseline"
              >
                <T w="semi" className="flex-1 text-4 text-text" numberOfLines={1}>
                  {d.name}
                </T>
                <T num className="mr-2 text-4 text-muted">{Math.round(d.e1)}kg</T>
                <T
                  w="semi"
                  num
                  className={`w-8 text-right text-4 ${
                    d.delta == null ? 'text-dim' : d.delta > 0 ? 'text-ok' : d.delta < 0 ? 'text-bad' : 'text-muted'
                  }`}
                >
                  {d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + Math.round(d.delta)}
                </T>
                <T className="ml-1 text-3 text-dim">›</T>
              </Tap>
            ))}
            <T className="mt-1 border-t border-line pt-1 text-2 text-dim">
              Against the same lift&apos;s best 8–16 weeks ago. A dash means it wasn&apos;t trained in that window —
              not that it went nowhere.
            </T>
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
            {distWeek > 0 ? (
              <T num className="mt-1 border-t border-line pt-1 text-3 text-dim">{fmtDistance(distWeek)} this week</T>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* One point is not a trend: a chart drawn from a single reading implies a
          direction it cannot know, which is worse than showing nothing. */}
      {recovery.length > 1 ? (
        <>
          <SectionHead title="Recovery · 30 days" />
          <Card>
            <Trend data={recovery} color={color.ok} unit="%" min={0} max={100} />
          </Card>
        </>
      ) : null}

      {strain.length > 1 ? (
        <>
          <SectionHead title="Strain · 30 days" />
          <Card>
            <Trend data={strain} color={color.neonStrain} unit="" min={0} max={21} />
          </Card>
        </>
      ) : null}

      {hrrTrend.length > 1 ? (
        <>
          <SectionHead title="Heart-rate recovery" />
          <Card>
            <Trend data={hrrTrend} color={color.zMod} unit="bpm" />
            <T className="mt-1 text-2 text-dim">
              Drop in the minute after your session peak. Recorded and shown — it does not gate progression, because
              its day-to-day noise is larger than the effect.
            </T>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

interface Point {
  label: string;
  value: number;
  /** the current week, still being trained */
  partial?: boolean;
}

/** A trend as columns against a shared axis. See the note at the top of the file. */
function Trend({
  data,
  color,
  unit,
  min,
  max,
}: {
  data: Point[];
  color: string;
  unit: string;
  min?: number;
  max?: number;
}) {
  const lo = min ?? Math.min(...data.map((d) => d.value));
  const hi = max ?? Math.max(...data.map((d) => d.value));
  const span = hi - lo || 1;
  const last = data[data.length - 1];

  return (
    <View>
      {/* `h-full` on each column is load-bearing: Yoga resolves a percentage
          height against the parent's DEFINITE height, which an auto-sized
          column does not have — the bars come out zero-high without it. */}
      <View className="h-8 flex-row items-end">
        {data.map((d, i) => (
          <View key={i} className="h-full flex-1 justify-end">
            <View
              className="rounded-sm"
              style={{
                height: `${Math.max(4, ((d.value - lo) / span) * 100)}%`,
                backgroundColor: color,
                opacity: i === data.length - 1 ? 1 : 0.5,
                marginHorizontal: 0.5,
              }}
            />
          </View>
        ))}
      </View>
      <View className="mt-0.5 flex-row justify-between">
        <T num className="text-2 text-dim">{data[0].label}</T>
        <T w="semi" num className="text-2" style={{ color }}>
          {Math.round(last.value)}
          {unit}
        </T>
        <T num className="text-2 text-dim">{last.label}</T>
      </View>
    </View>
  );
}

/**
 * One finding, with its evidence under it. The web app's `Finding` in the same
 * words — a claim about the athlete's body has to read identically on both
 * surfaces, or one of them is telling a different story about the same data.
 *
 * The sample counts are shown rather than kept internal: four sets against
 * four is a different statement from twenty against twenty, and hiding the
 * difference would make the two look equally certain.
 */
function Finding({
  i,
  last,
  onMovement,
}: {
  i: Insight;
  last: boolean;
  onMovement: (name: string) => void;
}) {
  // A strength finding names a movement, and the sets behind the claim are one
  // screen away. Opening them makes the evidence inspectable rather than
  // something to take on trust. Only this kind opens: `work-rate`'s subject is
  // a session name, which the Exercise route cannot resolve.
  const movement = i.key === 'strength-at-effort' && i.subject ? i.subject : null;
  const heading = (
    <T w="semi" className="min-w-0 flex-1 text-4 text-text">
      {i.title}
      {movement ? ' ›' : ''}
    </T>
  );
  return (
    // `last` is a prop rather than a `last:` variant because NativeWind has no
    // child-position selectors. Without it the final divider stacks against the
    // footnote's own top border and draws a doubled rule — the web app gets
    // this free from `last:border-0`, and the phone would quietly not.
    <View className={last ? '' : 'border-b border-line pb-1'}>
      <View className="flex-row items-baseline gap-1">
        {/* Through <Tap>, not a bare Pressable — that is what makes the target
            reach 48dp and give feedback, and checks/mobile-touch.mjs enforces
            it across every screen. */}
        {movement ? (
          <Tap onPress={() => onMovement(movement)} className="min-w-0 flex-1">
            {heading}
          </Tap>
        ) : (
          heading
        )}
        {/* Whether this is good news is carried by the colour and, for a
            decline, the minus sign — neither of which reaches a screen reader
            as meaning, and green-vs-red is the pairing colour-blind readers are
            least likely to separate. TalkBack gets the direction in words. */}
        <T
          num
          w="bold"
          accessibilityLabel={`${i.pct == null ? 'no percentage' : Math.abs(Math.round(i.pct * 100)) + ' percent'}, ${
            i.improved ? 'improved' : 'declined'
          }`}
          className={`text-4 ${i.improved ? 'text-ok' : 'text-bad'}`}
        >
          {i.pct == null ? '—' : (i.pct > 0 ? '+' : '') + Math.round(i.pct * 100) + '%'}
        </T>
      </View>
      <T className="mt-0.5 text-3 text-muted">{i.detail}</T>
      <T num className="mt-0.5 text-2 text-dim">
        {i.evidence.recentN} recent vs {i.evidence.baselineN} earlier · {i.evidence.windowDays}-day windows
      </T>
    </View>
  );
}

function weekly(sessions: Session[], n: number): Point[] {
  const out: Point[] = [];
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
      // Always the current week, always incomplete — see the web app's note.
      partial: i === 0,
    });
  }
  return out;
}

function thisWeek(sessions: Session[], settings: { conditioning?: CondResult[] }) {
  const since = Date.now() - 7 * 864e5;
  const acc = { low: 0, mod: 0, high: 0, total: 0 };
  condEfforts(sessions, settings)
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

function distanceThisWeek(sessions: Session[], settings: { conditioning?: CondResult[] }): number {
  const since = Date.now() - 7 * 864e5;
  return condEfforts(sessions, settings)
    .filter((r) => (r.startedAt || 0) >= since)
    .reduce((sum, r) => sum + (r.distanceM || 0), 0);
}
