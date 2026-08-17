import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  CON_FORMATS, byMonth, dayLabel, fmtDistance, isCond, sessionRpe, type Session } from '@hybrid/engine';
import { useDb } from '../store/db';
import { Card, Empty, Kicker, Screen, SectionHead, T, Tap, Title } from '../ui';
import { RouteMap } from '../ui/RouteMap';

export function HistoryScreen() {
  const nav = useNavigation();
  const { sessions } = useDb();
  const [open, setOpen] = useState<string | null>(null);

  const done = useMemo(
    () => sessions.filter((s) => s.status !== 'active').slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    [sessions],
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
  const rpe = sessionRpe(s);
  const cond = s.blocks.filter((b) => isCond(b) && b.condResult).length;
  return (
    <T num className="mt-0.5 text-3 text-muted">
      {[
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
          <T w="semi" className="text-3 uppercase tracking-widest text-dim">{(b as { heading?: string }).heading || 'Block'}</T>
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
        </View>
      ))}
    </View>
  );
}
