import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { uid, ymd } from '@hybrid/engine';
import type { WeightEntry } from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { Btn, Card, Empty, Kicker, Screen, SectionHead, T, Tap, Title } from '../../ui';
import { NumField, TextField } from './fields';
import { liveWeighIns, trendSeries, weighInDay, type TrendSeries } from '@hybrid/nutrition-adapter';

/*
 * The scale.
 *
 * Behaviour ported from MacroTrack's WeightScreen.kt: log a weigh-in, see the
 * smoothed trend against the raw points, delete a mistake. Two things it adds,
 * both forced by this repository rather than by taste:
 *
 *  - EDITING. MacroTrack's `weight_entries` is insert-only against a server
 *    that is the source of truth; this slice is offline-first and merges, so a
 *    fat-fingered 108 for 80.8 has to be correctable in place.
 *  - DELETE IS A STAMP. `mergeNutrition` is additive, so a weigh-in spliced out
 *    of the array is restored by the other device on the next sync — and it
 *    would bring the EWMA and the expenditure estimate back with it.
 *
 * THE TREND IS THE ENGINE'S. Every number on this screen comes from
 * `weightTrend` via `trendSeries`; there is no smoothing, no slope and no
 * averaging written here. See engine.ts.
 */

/** What the sanitizer will actually keep — `weight_kg between 20 and 500` is a
 *  DB check constraint that REJECTS, so a rejected value would vanish on the
 *  next load and the athlete would think the app lost their weigh-in. */
const MIN_KG = 20;
const MAX_KG = 500;

/** Days of history the screen looks back over, as in the reference. */
const WINDOW_DAYS = 90;

interface Draft {
  /** Empty for a new weigh-in; the entry's own id when editing one. */
  id: string;
  kg: string;
  note: string;
}

const blank: Draft = { id: '', kg: '', note: '' };

const draftOf = (e: WeightEntry): Draft => ({ id: e.id, kg: String(e.weightKg), note: e.note ?? '' });

const kilos = (s: string): number | null => {
  const n = Number(s.trim());
  return Number.isFinite(n) && n >= MIN_KG && n <= MAX_KG ? n : null;
};

/** One decimal, the precision a bathroom scale actually reports. */
const kg1 = (n: number): string => n.toFixed(1);

export function WeightScreen() {
  const { nutrition, update, saveFailed, dataRecovered } = useNutrition();
  // Read per render, not memoised across one: this screen stays mounted as a
  // tab, so a cached "today" would file tomorrow's weigh-in against today.
  const today = ymd(new Date());
  const [draft, setDraft] = useState<Draft>(blank);
  const [rejected, setRejected] = useState(false);

  const entries = useMemo(() => liveWeighIns(nutrition), [nutrition]);
  const series = useMemo(() => trendSeries(nutrition, today, WINDOW_DAYS), [nutrition, today]);

  const commit = () => {
    const weightKg = kilos(draft.kg);
    if (weightKg === null) {
      setRejected(true);
      return;
    }
    const at = new Date().toISOString();
    const note = draft.note.trim() || null;
    update((n) => {
      const existing = draft.id ? n.weightEntries.find((e) => e.id === draft.id) : undefined;
      if (existing) {
        // Edited in place; `measuredAt` is NOT re-stamped, because it is the
        // x-axis of every trend fit — correcting the number the athlete typed
        // must not move the day they stood on the scale.
        existing.weightKg = weightKg;
        existing.note = note;
        existing.updatedAt = at;
        return;
      }
      n.weightEntries.push({
        id: uid(),
        // Blank on purpose, exactly as a log entry's is: ownership of this
        // slice belongs to the sync layer and RLS at the namespace level, and a
        // client-guessed id would be wrong for everything logged before sign-in.
        userId: '',
        measuredAt: at,
        weightKg,
        source: 'manual',
        note,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      });
    });
    setDraft(blank);
    setRejected(false);
  };

  const remove = (entry: WeightEntry) => {
    Alert.alert(`Delete the ${kg1(entry.weightKg)} kg weigh-in?`, 'This removes it from every device and from your trend. It cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          update((n) => {
            const live = n.weightEntries.find((e) => e.id === entry.id);
            if (!live) return false;
            const at = new Date().toISOString();
            // Stamped, not spliced: see this file's header.
            live.deletedAt = at;
            live.updatedAt = at;
            if (draft.id === entry.id) setDraft(blank);
          }),
      },
    ]);
  };

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Weight</Title>

      {dataRecovered ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Your nutrition data couldn&apos;t be read and had to be reset. Your training data is unaffected — the two are
          stored separately.
        </T>
      ) : saveFailed ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          The last save failed — usually a full disk. What you just logged may not survive a restart.
        </T>
      ) : null}

      <Card tone="raised" className="mt-2">
        <T w="semi" className="text-6 text-text">
          {draft.id ? 'Edit weigh-in' : 'Log a weigh-in'}
        </T>
        <View className="mt-1.5 flex-row gap-1">
          <NumField label="Weight kg" value={draft.kg} onChange={(v) => setDraft({ ...draft, kg: v })} />
        </View>
        <TextField
          label="Note"
          value={draft.note}
          onChange={(v) => setDraft({ ...draft, note: v })}
          placeholder="Optional — morning, post-travel…"
        />
        {rejected ? (
          <T className="mt-1 text-3 text-bad">
            Enter a weight between {MIN_KG} and {MAX_KG} kg. Anything else is refused rather than rounded, so a typo
            never reaches your trend.
          </T>
        ) : null}
        <View className="mt-2 flex-row gap-1">
          <View className="min-w-0 flex-1">
            <Btn variant="brass" onPress={commit} className="w-full">
              {draft.id ? 'Save' : 'Log it'}
            </Btn>
          </View>
          {draft.id ? (
            <View className="min-w-0 flex-1">
              <Btn
                onPress={() => {
                  setDraft(blank);
                  setRejected(false);
                }}
                className="w-full"
              >
                Cancel
              </Btn>
            </View>
          ) : null}
        </View>
      </Card>

      {entries.length === 0 ? (
        <View className="mt-2">
          <Empty title="No weigh-ins yet" body="Log your first one above and the trend starts building from it." />
        </View>
      ) : (
        <>
          <SectionHead title="Trend" />
          <TrendCard series={series} />

          <SectionHead title="History" right={<T num className="text-3 text-muted">{entries.length}</T>} />
          <Card>
            {[...entries].reverse().map((e, i) => (
              <View key={e.id} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
                <View className="flex-row items-center gap-1">
                  <Tap
                    box={{ h: 44 }}
                    onPress={() => setDraft(draftOf(e))}
                    label={`edit the ${kg1(e.weightKg)} kg weigh-in`}
                    className="min-w-0 flex-1"
                  >
                    <T w="med" num className="text-5 text-text">
                      {kg1(e.weightKg)} kg
                    </T>
                    <T className="mt-0.5 text-3 text-muted">
                      {dayLabel(weighInDay(e))}
                      {e.note ? ` · ${e.note}` : ''}
                    </T>
                  </Tap>
                  <Tap
                    box={{ h: 44, w: 44 }}
                    onPress={() => remove(e)}
                    label={`delete the ${kg1(e.weightKg)} kg weigh-in`}
                    className="items-center justify-center px-1"
                  >
                    <T className="text-6 text-dim">✕</T>
                  </Tap>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

/** `YYYY-MM-DD` as the athlete's own locale reads it. Parsed field by field —
 *  `new Date('2026-08-07')` is UTC midnight and prints as the 6th west of
 *  Greenwich. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function TrendCard({ series }: { series: TrendSeries }) {
  const points = series.trend.filter((v): v is number => v !== null);
  const latest = points.length ? (points[points.length - 1] as number) : null;
  // ~7 days back on a dense daily series; the earliest available if the history
  // is shorter, as in the reference.
  const weekAgo = series.trend[Math.max(0, series.trend.length - 8)] ?? null;
  const delta = latest !== null && weekAgo !== null ? latest - weekAgo : null;
  const weighInDays = series.raw.filter((v) => v !== null).length;

  return (
    <Card tone="quiet">
      {latest === null ? (
        <T className="text-4 text-muted">Nothing to smooth yet.</T>
      ) : (
        <>
          <T w="bold" num className="text-8 text-text">
            {kg1(latest)}
            <T className="text-5 text-muted"> kg trend</T>
          </T>
          {delta === null ? null : (
            <T num className="mt-0.5 text-4 text-muted">
              {delta > 0 ? 'Up' : delta < 0 ? 'Down' : 'Flat'} {kg1(Math.abs(delta))} kg vs about a week ago
            </T>
          )}
        </>
      )}

      <Chart series={series} />

      <T num className="mt-1.5 text-3 text-dim">
        {weighInDays} weigh-in{weighInDays === 1 ? '' : 's'} across the last {series.days.length} day
        {series.days.length === 1 ? '' : 's'} of history
      </T>
      {/* The first of the two engine defects this slice is forbidden to paper
          over: the smoothed line repeats your last weight on days you did not
          weigh in, and the slope is fitted THROUGH those repeats. Said here in
          the athlete's terms, on the screen where the gaps are visible. */}
      {series.days.length > 1 && weighInDays * 2 < series.days.length ? (
        <T className="mt-1 text-3 text-muted">
          The line carries your last weight forward on days you didn&apos;t weigh in, so a stretch with few weigh-ins
          reads flatter than your real change. Weighing in more often makes it — and your coaching targets — truer.
        </T>
      ) : null}
    </Card>
  );
}

/*
 * The trend against the raw points, with no chart library and no SVG.
 *
 * Everything is a percentage of a fixed-height box, so nothing here has to
 * measure itself: the trend is a run of connected vertical segments (each one
 * spanning the two smoothed values it joins, which is what makes them read as
 * one line rather than as bars) and each weigh-in is a dot at its own value.
 * Static, deterministic, and reduced-motion safe by construction — the same
 * posture as `Ring` in ui.tsx.
 */
const CHART_H = 96;

function Chart({ series }: { series: TrendSeries }) {
  const values = [...series.trend, ...series.raw].filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A flat series has no range to divide by; 1 kg of headroom puts the line in
  // the middle of the box instead of on its floor.
  const range = hi - lo > 0 ? hi - lo : 1;
  const n = series.days.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (v: number) => (1 - (v - lo) / range) * 100;

  return (
    <View className="mt-1.5 overflow-hidden rounded-md bg-well" style={{ height: CHART_H }}>
      {series.trend.map((value, i) => {
        const previous = i > 0 ? series.trend[i - 1] : null;
        if (value === null || previous == null) return null;
        const top = Math.min(y(previous), y(value));
        const bottom = Math.max(y(previous), y(value));
        return (
          <View
            key={`t${i}`}
            className="absolute bg-gold2"
            style={{
              left: `${x(i - 1)}%`,
              width: `${x(i) - x(i - 1)}%`,
              top: `${top}%`,
              height: `${bottom - top}%`,
              // A flat day still has to draw something, or a stable week is a
              // gap in the line rather than a straight bit of it.
              minHeight: 2,
            }}
          />
        );
      })}
      {series.raw.map((value, i) =>
        value === null ? null : (
          <View
            key={`r${i}`}
            className="absolute rounded-pill border border-gold-line bg-panel"
            /* 6px is off the 8px spacing scale on purpose and so is expressed
               here rather than as a class: this is a data mark sized to the
               chart, not a piece of layout the grid governs. */
            style={{ width: 6, height: 6, left: `${x(i)}%`, top: `${y(value)}%`, marginLeft: -3, marginTop: -3 }}
          />
        ),
      )}
    </View>
  );
}
