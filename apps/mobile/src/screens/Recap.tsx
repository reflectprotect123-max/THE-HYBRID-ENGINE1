import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  blockDurations,
  CON_FORMATS,
  fmtClock,
  fmtDistance,
  fmtPace,
  isCond,
  sessionRpe,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Kicker, Screen, SectionHead, T, Title } from '../ui';
import { RouteMap } from '../ui/RouteMap';
import type { RootStackParams } from '../App';

/* Strength-only content — PR banners, e1RM/volume stats, per-exercise set
   lines, and the "next session" opener carryover — went with the rest of
   strength on 17 August 2026. This is the conditioning/text recap now:
   felt RPE, duration, and the conditioning result per block. */
export function RecapScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, 'Recap'>>();
  const { db } = useDb();

  // Whole-db by-id lookup, same rule as Planner/GuidedBuilder: a screen
  // holding an id must never lose its subject to view scoping — switching
  // worlds while a Recap sits on the nav stack would otherwise turn a real
  // session into "That session is gone". PR detection still compares against
  // the scoped history: PRs are a within-discipline claim.
  const s = db.sessions.find((x) => x.id === route.params.id);

  if (!s) {
    return (
      <Screen>
        <Title>That session is gone</Title>
        <Btn variant="brass" className="mt-2" onPress={() => nav.goBack()}>
          Back
        </Btn>
      </Screen>
    );
  }

  const rpe = sessionRpe(s);
  const dur = s.completedAt && s.startedAt ? Math.max(0, Math.round((s.completedAt - s.startedAt) / 1000)) : 0;
  /* Live sessions have no `completedAt`, so the last block's segment would be
     open-ended. The recap only ever shows finished sessions, but passing the
     clock costs nothing and keeps this honest if that changes. */
  const times = blockDurations(s, Date.now());

  return (
    <Screen>
      <Kicker>{s.date}</Kicker>
      <Title>{s.name || 'Session'}</Title>

      <View className="mt-2 flex-row flex-wrap gap-1">
        <Stat label="Felt RPE" value={rpe.felt != null ? rpe.felt.toFixed(1) : '—'} unit="" />
        <Stat label="Duration" value={dur ? fmtClock(dur) : '—'} unit="" />
      </View>

      {rpe.target != null && rpe.felt != null ? (
        <Card className="mt-2">
          <T num className="text-4 text-muted">
            You rated it {rpe.felt.toFixed(1)} against a target of {rpe.target.toFixed(1)} —{' '}
            {Math.abs(rpe.felt - rpe.target) <= 0.25
              ? 'right where it was meant to be.'
              : rpe.felt > rpe.target
                ? 'harder than asked. Tomorrow gets adjusted for that.'
                : 'easier than asked. There is room to add load.'}
          </T>
        </Card>
      ) : null}

      <SectionHead title="Everything logged" />
      {s.blocks.map((b, bi) => (
        <Card key={b.id ?? bi} className="mb-1">
          <T w="semi" className="text-3 uppercase tracking-widest text-dim">{b.heading || 'Block'}</T>
          {/*
            * HOW LONG THIS PART TOOK, against what the coach budgeted for it.
            *
            * The actual comes from `blockDurations`, which reads the wall-clock
            * stamps in `Session.blockLog` — see that field for why stamps and
            * not a stopwatch. The planned side is `CondBlock.minutes`, the
            * number the coach types into a section.
            *
            * A block the athlete never opened has NO stamp, so it prints
            * nothing rather than "0:00" — the difference between skipping a
            * section and doing it instantly.
            */}
          <BlockTime seconds={times[b.id]} planned={isCond(b) ? b.minutes : undefined} />
          {isCond(b) ? (
            <T num className="mt-0.5 text-4 text-muted">
              {CON_FORMATS[b.condFmt]?.name ?? b.condFmt}
              {b.condResult?.dur ? ` · ${fmtClock(b.condResult.dur)}` : ''}
              {b.condResult?.distanceM ? ` · ${fmtDistance(b.condResult.distanceM)}` : ''}
              {b.condResult?.avgPaceSecPerKm ? ` · ${fmtPace(b.condResult.avgPaceSecPerKm)}` : ''}
              {b.condResult?.hrr != null ? ` · HRR ${b.condResult.hrr}bpm` : ''}
            </T>
          ) : null}
          {isCond(b) && b.condResult?.route ? (
            <View className="mt-1">
              <RouteMap route={b.condResult.route} />
            </View>
          ) : null}
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
      <T w="semi" className="text-2 uppercase tracking-widest text-dim">{label}</T>
      <T w="black" num className="mt-0.5 text-8 text-text">
        {value}
        {unit ? <T className="text-4 text-dim"> {unit}</T> : null}
      </T>
    </Card>
  );
}


/**
 * "12:04 · planned 15 min" — what a section actually took, beside its budget.
 *
 * Renders NOTHING when the block has no stamp: a section the athlete never
 * opened is not a section that took no time, and "0:00" would say the second.
 * The planned half is dropped on its own when the coach set no minutes, which
 * is every session authored before section budgets existed.
 */
function BlockTime({ seconds, planned }: { seconds: number | undefined; planned?: number | string }) {
  if (seconds == null) return null;
  const budget = Number(planned);
  const hasBudget = Number.isFinite(budget) && budget > 0;
  return (
    <T num className="mt-0.5 text-3 text-dim">
      {fmtClock(seconds)}
      {hasBudget ? ` · planned ${budget} min` : ''}
    </T>
  );
}
