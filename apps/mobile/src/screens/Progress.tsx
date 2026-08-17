import { useMemo } from 'react';
import { View } from 'react-native';
import {
  conZones,
  fmtClock,
  fmtDistance,
  condEfforts,
  insights,
  type CondResult,
  type Insight,
  type Session,
  type ZoneKey,
} from '@hybrid/engine';
import { color } from '@hybrid/design';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, Row, Screen, SectionHead, T, Title, zoneInk } from '../ui';

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
  const { db, hr, sessions } = useDb();
  const zones = useMemo(() => conZones(hr), [hr]);

  const zoneWeek = useMemo(() => thisWeek(sessions, db.settings), [sessions, db.settings]);
  const distWeek = useMemo(() => distanceThisWeek(sessions, db.settings), [sessions, db.settings]);

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
    return condEfforts(sessions, db.settings)
      .filter((r) => r.hrr != null)
      .slice(-12)
      .map((r, i) => ({ label: String(i + 1), value: r.hrr as number }));
  }, [sessions, db.settings]);

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
    zoneWeek.total > 0 ||
    recovery.length > 1 ||
    strain.length > 1 ||
    hrrTrend.length > 1 ||
    found.length > 0;

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

      {/* Above the charts because it is the only thing here you could not have
          worked out by looking at them. A volume bar tells you what you did; a
          finding tells you what it did to you.

          The "Strength vs conditioning" balance card that used to sit above
          this — `loadBalance`, comparing the two disciplines' progression —
          went with the rest of strength on 17 August 2026. */}
      {found.length ? (
        <>
          <SectionHead title="What has changed" />
          <Card>
            <View className="gap-1">
              {found.map((i, n) => (
                <Finding key={i.id} i={i} last={n === found.length - 1} />
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

      {/* "Weekly volume · 8 weeks" (a strength tonnage bar chart, `weekly()`
          summing `sessionVolume`) and "Top lifts · 8-week change" (per-lift
          e1RM deltas from `bestE1rmByLift`, each a door into the deleted
          Exercise history screen) both went with the rest of strength on
          17 August 2026 — there is no more lifting data to chart. */}

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
function Finding({ i, last }: { i: Insight; last: boolean }) {
  // A strength finding used to name a movement, tappable into the deleted
  // Exercise history screen (`onMovement`) — the 'strength-at-effort' key
  // this checked for is unreachable now: `insights()` no longer emits it,
  // since it derived from logged strength sets and there are none to derive
  // from. Every finding renders as a plain heading.
  const heading = (
    <T w="semi" className="min-w-0 flex-1 text-4 text-text">
      {i.title}
    </T>
  );
  return (
    // `last` is a prop rather than a `last:` variant because NativeWind has no
    // child-position selectors. Without it the final divider stacks against the
    // footnote's own top border and draws a doubled rule — the web app gets
    // this free from `last:border-0`, and the phone would quietly not.
    <View className={last ? '' : 'border-b border-line pb-1'}>
      <View className="flex-row items-baseline gap-1">
        {heading}
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
