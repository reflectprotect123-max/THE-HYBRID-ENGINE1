import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  conZones,
  recoveryBand,
  rpeGapInfo,
  sessionVolume,
  todayRecovery,
  ymd,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Empty, Kicker, Row, Screen, SectionHead, Title, zoneInk } from '../ui';
import type { RootStackParams } from '../App';

/*
 * Home answers one question: what should I do today, given how I've recovered?
 *
 * Readiness first because it changes the answer; then anything already in
 * progress; then today's plan, with the button that starts it. Same order as
 * the web app — this screen is the one an athlete opens standing in a doorway
 * deciding whether to train, and the answer has to be above the fold.
 */
export function HomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, hr, whoop, activeSession } = useDb();
  const sessions = db.sessions;

  const rec = todayRecovery(whoop);
  const band = recoveryBand(rec);
  const zones = useMemo(() => conZones(hr), [hr]);
  const gap = useMemo(() => rpeGapInfo(sessions), [sessions]);

  const today = ymd(new Date());
  const dow = new Date().getDay();
  const planned = useMemo(
    () => db.workouts.filter((w) => (w.dates || []).includes(today) || (w.days || []).includes(dow)),
    [db.workouts, today, dow],
  );

  const recent = useMemo(
    () => sessions.filter((s) => s.status !== 'active' && s.completedAt && Date.now() - s.completedAt < 7 * 864e5),
    [sessions],
  );
  const recentVolume = useMemo(() => recent.reduce((n, s) => n + sessionVolume(s), 0), [recent]);

  /* Both the resume card and a plan row land on the Train tab. Starting is
     Training's job and only Training's — Home minting a second session while
     one is already active is how you end up with two "active" sessions and a
     merge that has to pick one. */
  const toTraining = () => nav.navigate('Tabs', { screen: 'Train' });

  return (
    <Screen>
      <Kicker>Today</Kicker>
      <Title>
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </Title>

      <Card className="mt-2">
        <Kicker>Readiness</Kicker>
        <Text className="mt-0.5 text-9 font-black text-gold2">{rec == null ? '—' : rec}</Text>
        <Text className="text-5 font-bold text-text">
          {band === 'good' ? 'Strong' : band === 'watch' ? 'Steady' : band === 'low' ? 'Low' : 'No score yet'}
        </Text>
        <Text className="mt-0.5 text-4 text-muted">
          {band === 'low'
            ? 'Zones are eased today and conditioning is dialled back a notch.'
            : band === 'good'
              ? 'Zones widened slightly at the top. Good day to push.'
              : band === 'watch'
                ? 'Nothing adjusted. Train as prescribed.'
                : 'Connect WHOOP in Settings, or set a resting HR to sharpen your zones.'}
        </Text>
        {gap ? (
          <Text className="mt-1 text-3 text-dim">
            Last session felt {gap.gap > 0.25 ? 'harder' : gap.gap < -0.25 ? 'easier' : 'about as'}{' '}
            {Math.abs(gap.gap) <= 0.25 ? 'hard as asked' : 'than asked'} ({gap.gap > 0 ? '+' : ''}
            {gap.gap.toFixed(1)} RPE over {gap.n} rated {gap.n === 1 ? 'set' : 'sets'}).
          </Text>
        ) : null}
      </Card>

      {/* The way back into a session you walked away from. Without it the only
          route is remembering which tab it was on. */}
      {activeSession ? (
        <Card className="mt-2 border-gold-line bg-gold-wash">
          <Kicker>In progress</Kicker>
          <Text className="mt-0.5 text-6 font-bold text-text">{activeSession.name || 'Live session'}</Text>
          <Btn variant="brass" className="mt-1.5" onPress={toTraining}>
            Resume session
          </Btn>
        </Card>
      ) : null}

      <SectionHead title="Today's plan" />
      {planned.length ? (
        planned.map((w) => <PlanRow key={w.id} w={w} onStart={toTraining} />)
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

      <SectionHead title="Your zones today" />
      <Card>
        <Text className="text-3 text-dim">
          {zones.method === 'hrr' ? `Karvonen · resting ${zones.rest}` : 'percent of max'} · max {zones.max}
        </Text>
        {zones.adj !== 0 ? <Text className="text-3 text-gold2">re-zoned for recovery</Text> : null}
        {zones.list.map((b) => (
          <Row key={b.key} dot={zoneInk(b.key)} label={b.name} value={`${b.lo}–${b.hi}`} />
        ))}
      </Card>

      <SectionHead title="Elsewhere" />
      <View className="flex-row flex-wrap gap-1">
        <Btn onPress={() => nav.navigate('Conditioning')}>Conditioning</Btn>
        <Btn onPress={() => nav.navigate('History')}>History</Btn>
        <Btn onPress={() => nav.navigate('Calendar')}>Calendar</Btn>
      </View>

      <SectionHead title="Last 7 days" />
      <Card className="flex-row gap-3">
        <View>
          <Text className="text-8 font-black text-gold2">{recentVolume.toLocaleString()}</Text>
          <Text className="text-2 text-dim">kg volume</Text>
        </View>
        <View>
          <Text className="text-8 font-black text-text">{recent.length}</Text>
          <Text className="text-2 text-dim">sessions</Text>
        </View>
      </Card>
    </Screen>
  );
}

function PlanRow({ w, onStart }: { w: Workout; onStart: () => void }) {
  const n = w.blocks.length;
  return (
    <Card className="mb-1 flex-row items-center gap-1">
      <View className="flex-1">
        <Text className="text-5 font-bold text-text" numberOfLines={1}>
          {w.name || 'Session'}
        </Text>
        <Text className="text-3 text-dim">
          {n} {n === 1 ? 'block' : 'blocks'}
          {w.origin === 'coach' ? ' · from your coach' : ''}
        </Text>
      </View>
      <Btn variant="brass" onPress={onStart}>
        Start
      </Btn>
    </Card>
  );
}
