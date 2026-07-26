import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  blockExercises,
  detectPRs,
  epley,
  fmtClock,
  isCond,
  isWarmup,
  sessionRpe,
  sessionVolume,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Kicker, Screen, SectionHead, Title } from '../ui';
import type { RootStackParams } from '../App';

/* PRs first, because that is the thing worth knowing; then the honest totals.
   Warm-ups are excluded here for the same reason they are excluded from the
   maths — counting them would flatter the numbers. */
export function RecapScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'Recap'>>();
  const { db } = useDb();

  const s = db.sessions.find((x) => x.id === route.params.id);
  const prs = useMemo(() => (s ? detectPRs(s, db.sessions.filter((x) => x.id !== s.id)) : []), [s, db.sessions]);

  if (!s) {
    return (
      <Screen>
        <Title>Session not found</Title>
        <Btn variant="brass" className="mt-2" onPress={() => nav.goBack()}>
          Back
        </Btn>
      </Screen>
    );
  }

  const vol = sessionVolume(s);
  const rpe = sessionRpe(s);
  const dur = s.completedAt && s.startedAt ? Math.max(0, Math.round((s.completedAt - s.startedAt) / 1000)) : 0;
  const working = s.blocks.reduce(
    (n, b) =>
      n + blockExercises(b as StrengthBlock<LoggedSet>).reduce((m, e) => m + e.sets.filter((st) => st.done && !isWarmup(st)).length, 0),
    0,
  );

  return (
    <Screen>
      <Kicker>{s.date}</Kicker>
      <Title>{s.name || 'Session'}</Title>

      {prs.length ? (
        <Card className="mt-2 border-gold-line bg-gold-wash">
          <Kicker>{prs.length === 1 ? 'Personal record' : 'Personal records'}</Kicker>
          {prs.map((p) => (
            <Text key={p.name} className="mt-0.5 text-5 font-bold text-gold2">
              {p.name} — {p.kg}kg × {p.reps}
              <Text className="text-3 text-muted">
                {'  '}e1RM {Math.round(p.e1)}kg{p.prevE1 != null ? ` (was ${Math.round(p.prevE1)})` : ' — first on record'}
              </Text>
            </Text>
          ))}
        </Card>
      ) : null}

      <View className="mt-2 flex-row flex-wrap gap-1">
        <Stat label="Volume" value={vol ? vol.toLocaleString() : '—'} unit="kg" />
        <Stat label="Working sets" value={String(working)} unit="" />
        <Stat label="Felt RPE" value={rpe.felt != null ? rpe.felt.toFixed(1) : '—'} unit="" />
        <Stat label="Duration" value={dur ? fmtClock(dur) : '—'} unit="" />
      </View>

      {rpe.target != null && rpe.felt != null ? (
        <Card className="mt-2">
          <Text className="text-4 text-muted">
            You rated it {rpe.felt.toFixed(1)} against a target of {rpe.target.toFixed(1)} —{' '}
            {Math.abs(rpe.felt - rpe.target) <= 0.25
              ? 'right where it was meant to be.'
              : rpe.felt > rpe.target
                ? 'harder than asked. Tomorrow gets adjusted for that.'
                : 'easier than asked. There is room to add load.'}
          </Text>
        </Card>
      ) : null}

      <SectionHead title="Everything logged" />
      {s.blocks.map((b, bi) => (
        <Card key={b.id ?? bi} className="mb-1">
          <Text className="text-3 font-bold uppercase tracking-widest text-dim">{b.heading || 'Block'}</Text>
          {isCond(b) ? (
            <Text className="mt-0.5 text-4 text-muted">
              {b.condFmt}
              {b.condResult?.dur ? ` · ${fmtClock(b.condResult.dur)}` : ''}
              {b.condResult?.hrr != null ? ` · HRR ${b.condResult.hrr}bpm` : ''}
            </Text>
          ) : (
            blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
              const done = ex.sets.filter((st) => st.done);
              if (!done.length) return null;
              const best = done.reduce<number | null>((m, st) => {
                if (isWarmup(st)) return m;
                const e1 = epley(st.aVal, st.aVal2);
                return e1 != null && (m == null || e1 > m) ? e1 : m;
              }, null);
              return (
                <View key={ex.id ?? ei} className="mt-1">
                  <Text className="text-4 font-bold text-text">{ex.name || 'Exercise'}</Text>
                  <Text className="text-3 text-muted">
                    {done
                      .map((st) => `${isWarmup(st) ? 'W ' : ''}${st.aVal || '—'}${st.aVal2 ? '×' + st.aVal2 : ''}${st.felt ? '@' + st.felt : ''}`)
                      .join('  ')}
                    {best != null ? `  ·  best e1RM ${Math.round(best)}kg` : ''}
                  </Text>
                </View>
              );
            })
          )}
        </Card>
      ))}

      <Btn variant="brass" className="mt-3" onPress={() => nav.navigate('Tabs')}>
        Done
      </Btn>
    </Screen>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Card className="min-w-[45%] flex-1">
      <Text className="text-2 font-bold uppercase tracking-widest text-dim">{label}</Text>
      <Text className="mt-0.5 text-8 font-black text-text">
        {value}
        {unit ? <Text className="text-4 text-dim"> {unit}</Text> : null}
      </Text>
    </Card>
  );
}
