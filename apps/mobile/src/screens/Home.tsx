import { useMemo } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  conZones,
  hasLoggedWork,
  isCondWorkout,
  recoveryBand,
  rpeGapInfo,
  sessionVolume,
  todayHrv,
  todayRecovery,
  todaySleepPerformance,
  todayStrain,
  ymd,
  type Session,
  type Workout,
  type Zones,
} from '@hybrid/engine';
import { useTheme } from '@hybrid/design';
import { useDb } from '../store/db';
import { ForeignSessionNotice } from './ForeignSession';
import { resolveDayTarget, sessionFrom } from '../store/session';
import { SessionReceipt } from '../autocoach/SessionReceipt';
import { useLedger, type LedgerEntry } from '../autocoach/ledger';
import { Btn, Card, Empty, Kicker, Link, Ring, Screen, SectionHead, T, Tap, Title, zoneNeon } from '../ui';
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
 * doors rather than a pill row: the week strip's "Calendar ›" header opens
 * Calendar, each day IN the strip opens that day itself — Recap for a day
 * already trained, the Train tab for today, the read-only Day screen
 * otherwise, resolved by `resolveDayTarget` — the zones card offers
 * Conditioning, and the 7-day totals link to History.
 */
/**
 * The reason foreignActiveSession exists, made visible: a session left live
 * in the OTHER world would otherwise run silently until expireStaleSessions
 * ends it at the next day boundary — logged work lost to a tab the athlete
 * forgot they were in. One tap moves to that world, where the normal
 * "In progress" card takes over.
 */
/**
 * What is planned for today, with an Auto-Coached fork REPLACING the session
 * it was forked from rather than sitting next to it. Same helper, same
 * reasoning as apps/web/src/screens/Home.tsx's plannedForToday.
 *
 * A recurring template matches today through `days`; approving a receipt for
 * it writes a one-off copy dated today (applyResolution.ts's ForkPlan) rather
 * than mutating the template, so a plain date-or-weekday filter matched both
 * and showed two cards for one session — with "Start today's session"
 * attached to whichever came first, usually the UN-adjusted original. That
 * silently undoes the approval the athlete just gave.
 *
 * A fork carries no back-pointer to its source (a forked Workout is an
 * ordinary dated workout), so the link is the ledger entry that created it:
 * `workoutId` is the source, `forkedWorkoutId` the copy. The ledger is
 * newest-first, so the first entry naming a source is that source's current
 * state — an `undone` entry means the fork was reversed and the original is
 * today's session again.
 */
export function plannedForToday(
  workouts: Workout[],
  ledger: Pick<LedgerEntry, 'date' | 'action' | 'workoutId' | 'wasForked' | 'forkedWorkoutId'>[],
  today: string,
  dow: number,
): Workout[] {
  const superseded = new Set<string>();
  const seen = new Set<string>();
  for (const e of ledger) {
    if (e.date !== today || seen.has(e.workoutId)) continue;
    seen.add(e.workoutId);
    if (
      e.action === 'applied' &&
      e.wasForked &&
      e.forkedWorkoutId &&
      workouts.some((w) => w.id === e.forkedWorkoutId)
    ) {
      superseded.add(e.workoutId);
    }
  }
  return workouts.filter(
    (w) =>
      ((w.dates || []).includes(today) || (w.days || []).includes(dow)) && !superseded.has(w.id),
  );
}

export function HomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { hr, whoop, activeSession, update, athleteState, weeklyPlan, workouts, sessions } = useDb();
  const { color } = useTheme();

  const today = ymd(new Date());
  const rec = todayRecovery(whoop);
  const band = recoveryBand(rec);
  const strain = todayStrain(whoop);
  const sleep = todaySleepPerformance(whoop);
  const hrv = todayHrv(whoop);
  const rhr = Number.isFinite(Number(whoop?.restingHr)) && whoop?.restingHr != null ? Math.round(Number(whoop.restingHr)) : null;
  const zones = useMemo(() => conZones(hr), [hr]);
  const gap = useMemo(() => rpeGapInfo(sessions), [sessions]);

  const dow = new Date().getDay();
  const ledger = useLedger();
  const planned = useMemo(
    () => plannedForToday(workouts, ledger, today, dow),
    [workouts, ledger, today, dow],
  );
  // The live session already has its own card — repeating its workout under
  // "Today's plan" would offer Start for work that is mid-flight.
  const plannedToShow = useMemo(
    () => planned.filter((w) => !(activeSession && activeSession.workoutId === w.id)),
    [planned, activeSession],
  );

  // Same tombstone as Library's remove — this deletes it everywhere, not just
  // off today's card, so it asks first, same wording as Library's confirm.
  const deleteWorkout = (w: Workout) =>
    Alert.alert(`Delete "${w.name || 'Session'}"?`, 'This removes it from every device. It cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          update((draft) => {
            draft.workouts = draft.workouts.filter((x) => x.id !== w.id);
            draft.settings.deletedIds = { ...(draft.settings.deletedIds || {}), [w.id]: Date.now() };
          }),
      },
    ]);

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

  /* A tapped day in the week strip goes to whatever that day actually holds —
     a completed day's Recap, today's Training tab, or a read-only preview for
     anything else — the same three-way split Calendar's grid uses (Task 6).
     This was the original bug report: tapping a trained day here used to
     always open the generic Calendar month view instead of that day. */
  const openDay = (d: { key: string; workoutId?: string; sessionId?: string }) => {
    const target = resolveDayTarget(d.key, today, d.workoutId, d.sessionId);
    if (target.kind === 'recap') nav.navigate('Recap', { id: target.id });
    else if (target.kind === 'today') toTraining();
    else nav.navigate('Day', { date: target.date });
  };

  return (
    <Screen>
      <Kicker>Welcome back</Kicker>
      <Title>Train today</Title>
      <T className="mt-0.5 text-4 text-muted">
        {dateLine} · {subLine}
      </T>

      <ForeignSessionNotice />

      <View className="mt-2 mb-1 flex-row items-end justify-between gap-1">
        <T w="semi" className="text-1 uppercase text-dim" style={{ letterSpacing: 1.4 }}>
          This week
        </T>
        <Link onPress={() => nav.navigate('Calendar')}>Calendar ›</Link>
      </View>
      <WeekStrip workouts={workouts} sessions={sessions} today={today} onOpenDay={openDay} />

      <SectionHead title="Coordinated week" />
      <Card>
        <T className="text-3 text-dim">
          Coordinator plan · {weeklyPlan.entries.length} scheduled
          {weeklyPlan.decisions.filter((d) => d.action === 'dropped').length
            ? ` · ${weeklyPlan.decisions.filter((d) => d.action === 'dropped').length} held back`
            : ''}
        </T>
        {weeklyPlan.entries.slice(0, 4).map((entry) => (
          <View key={entry.id} className="mt-0.5 flex-row justify-between gap-1">
            <T className="flex-1 text-3 text-muted" numberOfLines={1}>{entry.title}</T>
            <T num className="text-3 text-dim">{entry.date}</T>
          </View>
        ))}
        {!weeklyPlan.entries.length ? <T className="mt-1 text-3 text-muted">No automatic session was placed for this week.</T> : null}
      </Card>

      {activeSession ? (
        <SessionCard tone="raised" className="mt-2">
          <Kicker className="text-1">In progress</Kicker>
          <T w="bold" className="mt-0.5 text-7 text-text" numberOfLines={1}>
            {activeSession.name || 'Live session'}
          </T>
          {/* Was its own section — a header, a gap and a full-width line to say
              one sentence about the card directly above it. It belongs on the
              card it is about. */}
          {!plannedToShow.length ? (
            <T className="mt-0.5 text-3 text-muted">Nothing else on today. Finish what you started.</T>
          ) : null}
          <Btn variant="brass" size="lg" className="mt-1.5" onPress={toTraining}>
            Resume session →
          </Btn>
        </SessionCard>
      ) : null}

      {/* The header renders only when the section has something in it. An empty
          "Today's plan" under a live session was pure vertical cost. */}
      {plannedToShow.length ? (
        <>
          <SectionHead title="Today's plan" />
          {plannedToShow.map((w, i) => (
            <PlanRow
              key={w.id}
              w={w}
              primary={i === 0 && !activeSession}
              onDelete={() => deleteWorkout(w)}
              onStart={() => {
                // Same promise as web's Home: Start MINTS the session unless
                // one is already live, then lands on Training mid-flight.
                // Guard INSIDE the write — same rule as web: a second tap
                // in the same frame sees a stale activeSession.
                update((draft) => {
                  if (draft.sessions.some((x) => x.status === 'active')) return false;
                  draft.sessions.push(sessionFrom(w, today));
                });
                toTraining();
              }}
            />
          ))}
        </>
      ) : activeSession ? null : (
        <>
          <SectionHead title="Today's plan" />
          <Empty
            title="Nothing planned today"
            body="Pick something from your Library, or let a rest day be a rest day."
            action={
              <Btn variant="brass" onPress={() => nav.navigate('Tabs', { screen: 'Library' })}>
                Open Library
              </Btn>
            }
          />
        </>
      )}

      <SessionReceipt />

      <SectionHead title="Readiness" />
      <Card>
        <T className="mb-1 text-3 text-dim">
          Whole-athlete state: <T w="semi" className="text-text">{athleteState.readiness.band}</T>
          {' · '}{athleteState.readiness.confidence} confidence
        </T>
        {/* Sleep · Recovery · Strain, in that order and side by side, because
            that is the shape WHOOP itself shows and the one already read every
            morning. Recovery keeps the band colour the zone model uses, so the
            ring and the prescription below it agree. */}
        <View className="flex-row justify-between">
          <RingStat label="Sleep" value={sleep} frac={sleep == null ? 0 : sleep / 100} suffix="%" ink={color.zLow} />
          <RingStat label="Recovery" value={rec} frac={rec == null ? 0 : rec / 100} suffix="%" ink={bandColor} />
          <RingStat
            label="Strain"
            value={strain}
            frac={strain == null ? 0 : Math.min(1, strain / 21)}
            decimals={1}
            ink={color.neonStrain}
          />
        </View>

        <View className="mt-2 border-t border-line pt-1.5">
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
          {hrv != null || rhr != null ? (
            <T num className="mt-1 text-3 text-dim">
              {[hrv != null ? `HRV ${hrv} ms` : '', rhr != null ? `resting ${rhr} bpm` : ''].filter(Boolean).join(' · ')}
            </T>
          ) : null}
        </View>
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
 * Every cell is a door into THAT day (04-athlete-01): its Recap once trained,
 * the Train tab if it is today, the read-only Day screen otherwise — see
 * `resolveDayTarget`. Only the strip's "Calendar ›" header opens the month. */
/** One of the three readiness dials: the figure inside, its name beneath. A
 *  missing reading shows an idle ring and a dash rather than a zero, because
 *  "no strap on last night" is not the same claim as "you scored nothing". */
function RingStat({
  label,
  value,
  frac,
  ink,
  suffix = '',
  decimals = 0,
}: {
  label: string;
  value: number | null;
  frac: number;
  ink: string;
  suffix?: string;
  decimals?: number;
}) {
  const { color } = useTheme();
  const has = value != null;
  return (
    <View className="items-center">
      <Ring frac={has ? frac : 0} size={92} stroke={8} color={has ? ink : color.ringIdle} glow={has}>
        {has ? (
          <T w="black" num className="text-7" style={{ color: ink }}>
            {value.toFixed(decimals)}
            <T w="bold" num className="text-4" style={{ color: ink }}>
              {suffix}
            </T>
          </T>
        ) : (
          <T w="semi" className="text-6 text-dim">
            —
          </T>
        )}
      </Ring>
      <T w="semi" className="mt-0.5 text-2 uppercase text-dim" style={{ letterSpacing: 1.2 }}>
        {label}
      </T>
    </View>
  );
}

function WeekStrip({
  workouts,
  sessions,
  today,
  onOpenDay,
}: {
  workouts: Workout[];
  sessions: Session[];
  today: string;
  onOpenDay: (day: { key: string; workoutId?: string; sessionId?: string }) => void;
}) {
  const days = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - start.getDay());
    // Same match logic as Calendar's build: a date only counts as "trained"
    // if the session actually has logged work, and the session id that flows
    // to resolveDayTarget is that same trained session — so a day that looks
    // trained here looks trained in Calendar too, and taps land on the same
    // Recap either place. That includes the tie-break: when a date carries
    // more than one completed session the FIRST one wins, matching
    // `workouts.find(...)` below and the design doc's "take the first" rule.
    // `new Map(entries)` would keep the LAST entry for a repeated key, so the
    // map is filled by hand.
    const trainedByDate = new Map<string, string>();
    for (const s of sessions) {
      if (s.status === 'active' || !hasLoggedWork(s)) continue;
      if (!trainedByDate.has(s.date)) trainedByDate.set(s.date, s.id);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      const dow = d.getDay();
      const matchedWorkout = workouts.find((w) => (w.dates || []).includes(key) || (w.days || []).includes(dow));
      const sessionId = trainedByDate.get(key);
      const workoutId = matchedWorkout?.id;
      return {
        key,
        dw: 'SMTWTFS'[i],
        n: d.getDate(),
        has: Boolean(sessionId || workoutId),
        workoutId,
        sessionId,
        label: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      };
    });
    // `today` is not read inside, but `start` and every key come from
    // `new Date()` — without it the strip keeps last week's seven days when
    // the app is left open across a week boundary, until some unrelated
    // store write happens to invalidate the memo. Same dependency the
    // `planned` memo above already carries.
  }, [workouts, sessions, today]);

  return (
    <View className="flex-row gap-0.5">
      {days.map((d) => {
        const isToday = d.key === today;
        return (
          <Tap
            key={d.key}
            onPress={() => onOpenDay(d)}
            /* The accessibility label replaces everything inside the Tap, so
               the trained/planned dot's state has to be part of the name
               itself, same as Calendar's cells. */
            label={`${d.label}${d.sessionId ? ', trained' : d.workoutId ? ', planned' : ''}`}
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
          </Tap>
        );
      })}
    </View>
  );
}

/** The session card surface from 04-athlete-02: a brass wash falling in from
 * the top-right corner. RN has no radial gradients, so the wash is two stacked
 * translucent gold discs bleeding off the corner — decoration only, content
 * stacks above it and the card's overflow clips the rest. */
function SessionCard({
  className,
  tone,
  children,
}: {
  className?: string;
  tone?: 'raised';
  children: React.ReactNode;
}) {
  const { color } = useTheme();
  return (
    <Card tone={tone} className={`overflow-hidden ${className || ''}`}>
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

function PlanRow({
  w,
  onStart,
  onDelete,
  primary,
}: {
  w: Workout;
  onStart: () => void;
  onDelete: () => void;
  primary?: boolean;
}) {
  const n = w.blocks.length;
  const cond = n === 0 || isCondWorkout(w);
  // The kicker already names a conditioning day; repeating it below the title
  // said nothing. Strength days get the honest block count instead.
  const meta = [!cond && `${n} ${n === 1 ? 'block' : 'blocks'}`].filter(Boolean).join(' · ');
  return (
    <SessionCard tone={primary ? 'raised' : undefined} className="mb-1">
      <View className="flex-row items-start justify-between gap-1">
        <Kicker className="text-1">Today · {cond ? 'Conditioning' : 'Strength'}</Kicker>
        <Tap
          onPress={onDelete}
          box={{ h: 32, w: 32 }}
          label={`delete ${w.name || 'session'}`}
          className="-mt-0.5 -mr-0.5 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
        >
          <T w="med" className="text-4 text-muted">
            ✕
          </T>
        </Tap>
      </View>
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
    <Card tone="quiet">
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
    <Card tone="quiet" className="flex-1 items-center py-1.5">
      <T w="black" num className={`text-7 ${tint ? 'text-gold2' : 'text-text'}`}>
        {value}
      </T>
      <T className="mt-0.5 text-2 text-dim">{label}</T>
    </Card>
  );
}
