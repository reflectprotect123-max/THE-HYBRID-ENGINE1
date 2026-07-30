import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  CON_FORMATS, blockExercises, byMonth, dayLabel, epley, fmtDistance, isCond, sessionRpe, sessionVolume, type LoggedSet, type Session, type StrengthBlock } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, Screen, SectionHead, T, Tap, Title } from '../ui';
import { RouteMap } from '../ui/RouteMap';

export function HistoryScreen() {
  const nav = useNavigation();
  const { db } = useDb();
  const [open, setOpen] = useState<string | null>(null);

  const done = useMemo(
    () => db.sessions.filter((s) => s.status !== 'active').slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    [db.sessions],
  );

  const months = useMemo(() => byMonth(done, (s) => s.date), [done]);

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
      <Kicker>History</Kicker>
      <Title>What you&apos;ve done</Title>

      {/* Grouped by month rather than run as one ribbon — see the web app's
          note. The heading names the month once; each row carries only the day
          that tells it apart. */}
      {done.length ? (
        months.map((m) => (
          <View key={m.key}>
            <SectionHead title={m.label} />
            {m.items.map((s) => (
              <Card key={s.id} tone="quiet" className="mb-0.5 py-1.5">
                <Tap onPress={() => setOpen(open === s.id ? null : s.id)}>
                  <View className="flex-row items-baseline">
                    <T w="semi" className="flex-1 text-5 text-text" numberOfLines={1}>
                      {s.name || 'Session'}
                    </T>
                    <T num className="text-3 text-dim">{dayLabel(s.date) || s.date}</T>
                  </View>
                  <Summary s={s} />
                </Tap>
                {open === s.id ? <Detail s={s} /> : null}
              </Card>
            ))}
          </View>
        ))
      ) : (
        <>
          <SectionHead title="Sessions" />
          <Empty title="No finished sessions yet" body="Your first one will show up here the moment you finish it." />
        </>
      )}
    </Screen>
  );
}

function Summary({ s }: { s: Session }) {
  const vol = sessionVolume(s);
  const rpe = sessionRpe(s);
  const cond = s.blocks.filter((b) => isCond(b) && b.condResult).length;
  return (
    <T num className="mt-0.5 text-3 text-muted">
      {[
        vol ? `${vol.toLocaleString()} kg` : null,
        rpe.felt != null ? `felt RPE ${rpe.felt.toFixed(1)}` : null,
        cond ? `${cond} conditioning` : null,
        s.status === 'incomplete' ? 'left unfinished' : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </T>
  );
}

function Detail({ s }: { s: Session }) {
  return (
    <View className="mt-1.5 border-t border-line pt-1.5">
      {s.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mb-1">
          <T w="semi" className="text-3 uppercase tracking-widest text-dim">{b.heading || 'Block'}</T>
          {isCond(b) ? (
            <T num className="text-4 text-muted">
              {CON_FORMATS[b.condFmt]?.name ?? b.condFmt}
              {b.condResult?.dur ? ` · ${Math.round(b.condResult.dur / 60)} min` : ''}
              {b.condResult?.distanceM ? ` · ${fmtDistance(b.condResult.distanceM)}` : ''}
              {b.condResult?.felt ? ` · felt RPE ${b.condResult.felt}` : ''}
            </T>
          ) : null}
          {isCond(b) && b.condResult?.route ? (
            <View className="mt-1">
              <RouteMap route={b.condResult.route} />
            </View>
          ) : null}
          {!isCond(b) ? (
            blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => {
              const logged = ex.sets.filter((st) => st.done);
              if (!logged.length) return null;
              const best = logged.reduce<number | null>((m, st) => {
                const e1 = epley(st.aVal, st.aVal2);
                return e1 != null && (m == null || e1 > m) ? e1 : m;
              }, null);
              return (
                <View key={ex.id ?? ei}>
                  <T w="semi" className="text-4 text-text">{ex.name || 'Exercise'}</T>
                  <T num className="text-3 text-muted">
                    {logged.map((st) => `${st.aVal || '—'}${st.aVal2 ? '×' + st.aVal2 : ''}${st.felt ? '@' + st.felt : ''}`).join('  ')}
                    {best != null ? `  ·  e1RM ${Math.round(best)}kg` : ''}
                  </T>
                </View>
              );
            })
          ) : null}
        </View>
      ))}
    </View>
  );
}
