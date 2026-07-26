import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { blockExercises, epley, isCond, sessionRpe, sessionVolume, type LoggedSet, type Session, type StrengthBlock } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, Screen, SectionHead, Title } from '../ui';

export function HistoryScreen() {
  const { db } = useDb();
  const [open, setOpen] = useState<string | null>(null);

  const done = useMemo(
    () => db.sessions.filter((s) => s.status !== 'active').slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    [db.sessions],
  );

  return (
    <Screen>
      <Kicker>History</Kicker>
      <Title>What you&apos;ve done</Title>

      <SectionHead title="Sessions" />
      {done.length ? (
        done.map((s) => (
          <Card key={s.id} className="mb-1">
            <Pressable onPress={() => setOpen(open === s.id ? null : s.id)}>
              <View className="flex-row items-baseline">
                <Text className="flex-1 text-5 font-bold text-text" numberOfLines={1}>
                  {s.name || 'Session'}
                </Text>
                <Text className="text-3 text-dim">{s.date}</Text>
              </View>
              <Summary s={s} />
            </Pressable>
            {open === s.id ? <Detail s={s} /> : null}
          </Card>
        ))
      ) : (
        <Empty title="No finished sessions yet" body="Your first one shows up here the moment you finish it." />
      )}
    </Screen>
  );
}

function Summary({ s }: { s: Session }) {
  const vol = sessionVolume(s);
  const rpe = sessionRpe(s);
  const cond = s.blocks.filter((b) => isCond(b) && b.condResult).length;
  return (
    <Text className="mt-0.5 text-3 text-muted">
      {[
        vol ? `${vol.toLocaleString()} kg` : null,
        rpe.felt != null ? `felt RPE ${rpe.felt.toFixed(1)}` : null,
        cond ? `${cond} conditioning` : null,
        s.status === 'incomplete' ? 'left unfinished' : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </Text>
  );
}

function Detail({ s }: { s: Session }) {
  return (
    <View className="mt-1.5 border-t border-line pt-1.5">
      {s.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mb-1">
          <Text className="text-3 font-bold uppercase tracking-widest text-dim">{b.heading || 'Block'}</Text>
          {isCond(b) ? (
            <Text className="text-4 text-muted">
              {b.condFmt}
              {b.condResult?.dur ? ` · ${Math.round(b.condResult.dur / 60)} min` : ''}
            </Text>
          ) : (
            blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
              const logged = ex.sets.filter((st) => st.done);
              if (!logged.length) return null;
              const best = logged.reduce<number | null>((m, st) => {
                const e1 = epley(st.aVal, st.aVal2);
                return e1 != null && (m == null || e1 > m) ? e1 : m;
              }, null);
              return (
                <View key={ex.id ?? ei}>
                  <Text className="text-4 font-bold text-text">{ex.name || 'Exercise'}</Text>
                  <Text className="text-3 text-muted">
                    {logged.map((st) => `${st.aVal || '—'}${st.aVal2 ? '×' + st.aVal2 : ''}${st.felt ? '@' + st.felt : ''}`).join('  ')}
                    {best != null ? `  ·  e1RM ${Math.round(best)}kg` : ''}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      ))}
    </View>
  );
}
