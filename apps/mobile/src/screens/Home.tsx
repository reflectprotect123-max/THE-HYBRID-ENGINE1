import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  conZones,
  isCondWorkout,
  recoveryBand,
  rpeGapInfo,
  sessionVolume,
  todayHrv,
  todayRecovery,
  todayStrain,
  ymd,
  type Session,
  type Workout,
  type Zones,
} from '@hybrid/engine';
import { color } from '@hybrid/design';
import { useDb } from '../store/db';
import { Btn, Card, Empty, Kicker, Link, Ring, Row, Screen, SectionHead, T, Title, zoneNeon } from '../ui';
import type { RootStackParams } from '../App';

/*
 * Home answers one question: what should I do today, given how I've recovered?
 *
 * Same layout as apps/web/src/screens/Home — the two apps are one product. The
 * one dominant tap first (resume, or start today's session), the week at a
 * glance, then readiness — because it changes the answer — then the zone model
 * conditioning will hold you to, and the week's honest totals last.
 *
 * The routes that have no tab of their own are reached from here by meaningful
 * doors rather than a pill row: the week strip and its header open Calendar,
 * the zones card offers Conditioning, and the 7-day totals link to History.
 */
export function HomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, hr, whoop, activeSession } = useDb();
  const sessions = db.sessions;

  const today = ymd(new Date());
  const rec = todayRecovery(whoop);
  const band = recoveryBand(rec);
  const strain = todayStrain(whoop);
  const hrv = todayHrv(whoop);
  const rhr = Number.isFinite(Number(whoop?.restingHr)) && whoop?.restingHr != null ? Math.round(Number(whoop.restingHr)) : null;
  const zones = useMemo(() => conZones(hr), [hr]);
  const gap = useMemo(() => rpeGapInfo(sessions), [sessions]);

  const dow = new Date().getDay();
  const planned = useMemo(
    () => db.workouts.filter((w) => (w.dates || []).includes(today) || (w.days || []).includes(dow)),
    [db.workouts, today, dow],
  );
  // The live session already has its own card — repeating its workout under
  // "Today's plan" would offer Start for work that is mid-flight.
  const plannedToShow = useMemo(
    () => planned.filter((w) => !(activeSession && activeSession.workoutId === w.id)),
    [planned, activeSession],
  );

  const week7 = useMemo(
    () =>
      sessions.filter(
        (s) => s.status !== 'active' && s.completedAt && Date.now() - s.completedAt < 7 * 864e5,
      ),
    [sessions],
  );
  const recentVolume = useMemo(() => week7.reduce((n, s) => n + sessionVolume(s), 0), [week7]);

  const bandColor = band === 'good' ? color.neonOk : band === 'watch' ? color.neonWarn : color.neonBad;

  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const subLine = activeSession
    ? 'One session in progress.'
    : planned.length === 1
      ? 'One session planned.'
      : planned.length > 1
        ? `${planned.length} sessions planned.`
        : 'Rest day — nothing scheduled.';

  /* Both the resume card and a plan row land on the Train tab. Starting is
     Training's job and only Training's — Home minting a second session while
     one is already active is how you end up with two "active" sessions and a
     merge that has to pick one. */
  const toTraining = () => nav.navigate('Tabs', { screen: 'Train' });

  return (
    <Screen>
      <Kicker>Welcome back</Kicker>
      <Title>Train today</Title>
      <T className="mt-0.5 text-4 text-muted">
        {dateLine} · {subLine}
      </T>

      <View className="mt-2 mb-1 flex-row items-end justify-between gap-1">
        <T w="semi" className="text-1 uppercase text-dim" style={{ letterSpacing: 1.4 }}>
          This week
        </T>
        <Link onPress={() => nav.navigate('Calendar')}>Calendar ›</Link>
      </View>
      <WeekStrip workouts={db.workouts} sessions={sessions} today={today} onOpen={() => nav.navigate('Calendar')} />

      {activeSession ? (
        <SessionCard className="mt-2 border-gold-line">
          <Kicker className="text-1">In progress</Kicker>
          <T w="bold" className="mt-0.5 text-7 text-text" numberOfLines={1}>
            {activeSession.name || 'Live session'}
          </T>
          <Btn variant="brass" size="lg" className="mt-1.5" onPress={toTraining}>
            Resume session →
          </Btn>
        </SessionCard>
      ) : null}

      <SectionHead title="Today's plan" />
      {plannedToShow.length ? (
        plannedToShow.map((w, i) => (
          <PlanRow key={w.id} w={w} primary={i === 0 && !activeSession} onStart={toTraining} />
        ))
      ) : activeSession ? (
        <T className="text-4 text-muted">Nothing else on today. Finish what you started.</T>
      ) : (
        <Empty
          title="Nothing planned today"
          body="Pick something from your Library, or let a rest day be a rest day."
          action={
            <Btn variant="brass" onPress={() => nav.navigate('Tabs', { screen: 'Library' })}>
              Open Library
            </Btn>
          }
        />
      )}

      <SectionHead title="Readiness" />
      <Card>
        <View className="flex-row items-center gap-2">
          <Ring
            frac={rec == null ? 0 : rec / 100}
            size={104}
            color={rec == null ? color.ringIdle : bandColor}
            glow={rec != null}
          >
            {rec == null ? (
              <T className="text-3 text-dim">no score</T>
            ) : (
              <>
                <T w="black" num className="text-8" style={{ color: bandColor }}>
                  {rec}
                </T>
                <T w="semi" className="text-1 uppercase text-dim" style={{ letterSpacing: 1 }}>
                  recovery
                </T>
              </>
            )}
          </Ring>
          <View className="min-w-0 flex-1">
            <T w="semi" className="text-6 text-text">
              {band === 'good' ? 'Strong' : band === 'watch' ? 'Steady' : band === 'low' ? 'Low' : 'No score yet'}
            </T>
            <T className="mt-0.5 text-4 text-muted">
              {band === 'low'
                ? 'Zones are eased today and conditioning is dialled back a notch.'
                : band === 'good'
                  ? 'Zones widened slightly at the top. Good day to push.'
                  : band === 'watch'
                    ? 'Nothing adjusted. Train as prescribed.'
                    : 'Connect WHOOP in Settings, or set a resting HR to sharpen your zones.'}
            </T>
            {gap ? (
              <T className="mt-1 text-3 text-dim">
                Last session felt {gap.gap > 0.25 ? 'harder' : gap.gap < -0.25 ? 'easier' : 'about as'}{' '}
                {Math.abs(gap.gap) <= 0.25 ? 'hard as asked' : 'than asked'} ({gap.gap > 0 ? '+' : ''}
                {gap.gap.toFixed(1)} RPE over {gap.n} rated {gap.n === 1 ? 'set' : 'sets'}).
              </T>
            ) : null}
          </View>
        </View>
        {strain != null || hrv != null || rhr != null ? (
          <View className="mt-1.5 border-t border-line pt-1.5">
            {strain != null ? <Row dot={color.neonStrain} glow label="Strain" value={strain.toFixed(1)} /> : null}
            {hrv != null ? <Row label="HRV" value={hrv + ' ms'} /> : null}
            {rhr != null ? <Row label="Resting HR" value={rhr + ' bpm'} /> : null}
          </View>
        ) : null}
      </Card>

      <SectionHead
        title="Your zones today"
        right={<Link onPress={() => nav.navigate('Conditioning')}>Start a run ›</Link>}
      />
      <ZonesCard zones={zones} />

      <SectionHead title="Last 7 days" right={<Link onPress={() => nav.navigate('History')}>History ›</Link>} />
      <View className="flex-row gap-1">
        <Stat value={recentVolume.toLocaleString()} label="kg lifted" tint />
        <Stat value={String(week7.length)} label={week7.length === 1 ? 'session' : 'sessions'} />
      </View>
    </Screen>
  );
}

/** Seven days, today lit, a brass dot on any day with planned or logged work.
 * Every cell is a door into the calendar (04-athlete-01). */
function WeekStrip({
  workouts,
  sessions,
  today,
  onOpen,
}: {
  workouts: Workout[];
  sessions: Session[];
  today: string;
  onOpen: () => void;
}) {
  const days = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - start.getDay());
    const trained = new Set(sessions.filter((s) => s.status !== 'active').map((s) => s.date));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      const has =
        trained.has(key) ||
        workouts.some((w) => (w.dates || []).includes(key) || (w.days || []).includes(d.getDay()));
      return {
        key,
        dw: 'SMTWTFS'[i],
        n: d.getDate(),
        has,
        label: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      };
    });
  }, [workouts, sessions]);

  return (
    <View className="flex-row gap-0.5">
      {days.map((d) => {
        const isToday = d.key === today;
        return (
          <Pressable
            key={d.key}
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`${d.label} — open calendar`}
            className={`flex-1 items-center rounded-sm border py-1 ${
              isToday ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel3'
            }`}
          >
            <T w="semi" className={`text-1 uppercase ${isToday ? 'text-gold2' : 'text-dim'}`} style={{ letterSpacing: 1 }}>
              {d.dw}
            </T>
            <T w="med" num className={`text-5 ${isToday ? 'text-gold2' : 'text-text'}`}>
              {d.n}
            </T>
            <View
              className={`mt-0.5 h-0.5 w-0.5 rounded-pill ${d.has ? 'bg-gold' : 'bg-transparent'}`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** The session card surface from 04-athlete-02: a brass wash falling in from
 * the top-right corner. RN has no radial gradients, so the wash is two stacked
 * translucent gold discs bleeding off the corner — decoration only, content
 * stacks above it and the card's overflow clips the rest. */
function SessionCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Card className={`overflow-hidden ${className || ''}`}>
      <View
        pointerEvents="none"
        className="absolute rounded-pill"
        style={{ top: -110, right: -110, width: 260, height: 260, backgroundColor: color.goldWash }}
      />
      <View
        pointerEvents="none"
        className="absolute rounded-pill"
        style={{ top: -70, right: -70, width: 150, height: 150, backgroundColor: color.goldWash }}
      />
      {children}
    </Card>
  );
}

function PlanRow({ w, onStart, primary }: { w: Workout; onStart: () => void; primary?: boolean }) {
  const n = w.blocks.length;
  const cond = n === 0 || isCondWorkout(w);
  // The kicker already names a conditioning day; repeating it below the title
  // said nothing. Strength days get the honest block count instead.
  const meta = [!cond && `${n} ${n === 1 ? 'block' : 'blocks'}`, w.origin === 'coach' && 'from your coach']
    .filter(Boolean)
    .join(' · ');
  return (
    <SessionCard className="mb-1">
      <Kicker className="text-1">Today · {cond ? 'Conditioning' : 'Strength'}</Kicker>
      <View className="mt-0.5 flex-row items-center gap-1">
        <View className="min-w-0 flex-1">
          <T w="bold" className="text-7 text-text" numberOfLines={1}>
            {w.name || 'Session'}
          </T>
          {meta ? <T className="mt-0.5 text-3 text-muted">{meta}</T> : null}
        </View>
        {!primary ? (
          <Btn variant="brass" onPress={onStart}>
            Start
          </Btn>
        ) : null}
      </View>
      {primary ? (
        <Btn variant="brass" size="lg" className="mt-1.5" onPress={onStart}>
          Start today&rsquo;s session →
        </Btn>
      ) : null}
    </SessionCard>
  );
}

/** HR zone rows per 04-athlete-06, lit with the neon set: glowing dot, a bar
 * whose length is each band's share of the working range, tabular bpm. */
function ZonesCard({ zones }: { zones: Zones }) {
  const span = Math.max(1, zones.max - zones.floor);
  return (
    <Card>
      <View className="flex-row items-baseline justify-between gap-1">
        <T num className="text-3 text-dim">
          max {zones.max} bpm · {zones.method === 'hrr' ? 'Karvonen · resting ' + zones.rest : 'percent of max'}
        </T>
        {zones.adj !== 0 ? <T className="text-3 text-gold2">re-zoned today</T> : null}
      </View>
      <View className="mt-1">
        {zones.list.map((b) => {
          const neon = zoneNeon(b.key);
          return (
            <View key={b.key} className="flex-row items-center gap-1 py-0.5">
              <View
                className="h-1 w-1 rounded-pill"
                style={{ backgroundColor: neon, boxShadow: `0 0 6px ${neon}` }}
              />
              <T w="med" className="text-4 text-text" style={{ width: 88 }}>
                {b.name}
              </T>
              <View className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-track">
                <View
                  className="h-full rounded-pill"
                  style={{
                    width: `${Math.round((100 * (b.hi - b.lo)) / span)}%`,
                    backgroundColor: neon,
                    boxShadow: `0 0 8px ${neon}`,
                  }}
                />
              </View>
              <T num className="text-right text-3 text-muted" style={{ width: 52 }}>
                {b.lo}–{b.hi}
              </T>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function Stat({ value, label, tint }: { value: string; label: string; tint?: boolean }) {
  return (
    <Card className="flex-1 items-center py-1.5">
      <T w="black" num className={`text-7 ${tint ? 'text-gold2' : 'text-text'}`}>
        {value}
      </T>
      <T className="mt-0.5 text-2 text-dim">{label}</T>
    </Card>
  );
}
