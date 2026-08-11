import { useMemo, useState } from 'react';
import { uid, ymd } from '@hybrid/engine';
import type { WeightEntry } from '@hybrid/nutrition-core';
import { liveWeighIns, trendSeries, weighInDay, type TrendSeries } from '@hybrid/nutrition-adapter';
import { useNutrition } from '../../store/nutrition';
import { Button, Card, Empty, Kicker, ScreenTitle, SectionHead } from '../../ui';
import { dayLabel } from './entry';

/*
 * The scale, ported from mobile's `WeightScreen.tsx`
 * (`apps/mobile/src/screens/nutrition/Weight.tsx`), same rules:
 *
 *  - EDITING. MacroTrack's `weight_entries` is insert-only against a server
 *    that is the source of truth; this slice is offline-first and merges, so a
 *    fat-fingered 108 for 80.8 has to be correctable in place.
 *  - DELETE IS A STAMP. `mergeNutrition` is additive, so a weigh-in spliced out
 *    of the array is restored by the other device on the next sync — and it
 *    would bring the EWMA and the expenditure estimate back with it.
 *
 * THE TREND IS THE ENGINE'S. Every number on this screen comes from
 * `weightTrend` via `trendSeries`, in `@hybrid/nutrition-adapter`; there is no
 * smoothing, no slope and no averaging written here.
 *
 * NO WRITE HELPER IN `entry.ts`: unlike a food log entry, a custom food or a
 * recipe, `@hybrid/nutrition-core` has no `logEntryFrom*`-style builder for a
 * `WeightEntry` — mobile's own screen builds the record literal directly and
 * pushes it inside `update`, the same shape `CustomFood.tsx` and
 * `RecipeBuilder.tsx` already use here for the record kinds that have no core
 * builder either. This screen follows that same, already-established
 * convention rather than inventing a one-line forward `entry.ts` would gain no
 * behaviour from.
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

export function Weight() {
  const { nutrition, update, saveFailed, dataRecovered } = useNutrition();
  // Read per render, not memoised across one: this screen can sit open past
  // midnight, and a cached "today" would file tomorrow's weigh-in against
  // today.
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
    // Destructive, and it reaches every device — so it asks first, the same
    // way FoodLog's entry delete and mobile's own confirm do.
    if (
      !window.confirm(
        `Delete the ${kg1(entry.weightKg)} kg weigh-in? This removes it from every device and from your trend. It cannot be undone.`,
      )
    ) {
      return;
    }
    const wasEditing = draft.id === entry.id;
    update((n) => {
      const live = n.weightEntries.find((e) => e.id === entry.id);
      if (!live) return false;
      const at = new Date().toISOString();
      // Stamped, not spliced: see this file's header.
      live.deletedAt = at;
      live.updatedAt = at;
    });
    // AFTER the write, not inside it. `update` clones a draft and may abandon
    // it, so a `setDraft` in the mutator is a React state change fired from
    // what is meant to be a pure edit of that clone.
    if (wasEditing) setDraft(blank);
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Weight</ScreenTitle>

      {dataRecovered ? (
        <p className="mt-1 rounded-md border border-bad bg-panel p-1.5 text-4 text-bad">
          Your nutrition data couldn&apos;t be read and had to be reset. Your training data is unaffected — the two are
          stored separately.
        </p>
      ) : saveFailed ? (
        <p className="mt-1 rounded-md border border-bad bg-panel p-1.5 text-4 text-bad">
          The last save failed — usually a full disk. What you just logged may not survive a restart.
        </p>
      ) : null}

      <Card tone="raised" className="mt-2">
        <p className="text-6 font-[650] text-text">{draft.id ? 'Edit weigh-in' : 'Log a weigh-in'}</p>
        <div className="mt-1.5 flex gap-1">
          <NumCell label="Weight kg" value={draft.kg} onChange={(v) => setDraft({ ...draft, kg: v })} />
        </div>
        <TextRow
          label="Note"
          value={draft.note}
          onChange={(v) => setDraft({ ...draft, note: v })}
          placeholder="Optional — morning, post-travel…"
        />
        {rejected ? (
          <p className="mt-1 text-3 text-bad">
            Enter a weight between {MIN_KG} and {MAX_KG} kg. Anything else is refused rather than rounded, so a typo
            never reaches your trend.
          </p>
        ) : null}
        <div className="mt-2 flex gap-1">
          <Button variant="brass" className="flex-1" onClick={commit}>
            {draft.id ? 'Save' : 'Log it'}
          </Button>
          {draft.id ? (
            <Button
              className="flex-1"
              onClick={() => {
                setDraft(blank);
                setRejected(false);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </Card>

      {entries.length === 0 ? (
        <div className="mt-2">
          <Empty title="No weigh-ins yet" body="Log your first one above and the trend starts building from it." />
        </div>
      ) : (
        <>
          <SectionHead title="Trend" />
          <TrendCard series={series} />

          <SectionHead title="History" right={<span className="num text-3 text-muted">{entries.length}</span>} />
          <Card>
            {[...entries].reverse().map((e, i) => (
              <div key={e.id} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDraft(draftOf(e))}
                    aria-label={`edit the ${kg1(e.weightKg)} kg weigh-in`}
                    className="min-w-0 flex-1 rounded-sm text-left"
                  >
                    <span className="num block text-5 font-[650] text-text">{kg1(e.weightKg)} kg</span>
                    <span className="mt-0.5 block text-3 text-muted">
                      {dayLabel(weighInDay(e))}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(e)}
                    aria-label={`delete the ${kg1(e.weightKg)} kg weigh-in`}
                    className="shrink-0 rounded-md border border-line2 bg-panel2 px-1 py-0.5 text-3 font-[650] text-muted"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

function TrendCard({ series }: { series: TrendSeries }) {
  const points = series.trend.filter((v): v is number => v !== null);
  const latest = points.length ? (points[points.length - 1] as number) : null;
  // ~7 days back on a dense daily series; the earliest available if the
  // history is shorter, as in the reference.
  const weekAgo = series.trend[Math.max(0, series.trend.length - 8)] ?? null;
  const delta = latest !== null && weekAgo !== null ? latest - weekAgo : null;
  const weighInDays = series.raw.filter((v) => v !== null).length;

  return (
    <Card tone="quiet">
      {latest === null ? (
        <p className="text-4 text-muted">Nothing to smooth yet.</p>
      ) : (
        <>
          <p className="num text-8 font-[900] text-text">
            {kg1(latest)}
            <span className="text-5 font-[500] text-muted"> kg trend</span>
          </p>
          {delta === null ? null : (
            <p className="num mt-0.5 text-4 text-muted">
              {delta > 0 ? 'Up' : delta < 0 ? 'Down' : 'Flat'} {kg1(Math.abs(delta))} kg vs about a week ago
            </p>
          )}
        </>
      )}

      <Chart series={series} />

      <p className="num mt-1.5 text-3 text-dim">
        {weighInDays} weigh-in{weighInDays === 1 ? '' : 's'} across the last {series.days.length} day
        {series.days.length === 1 ? '' : 's'} of history
      </p>
      {/* The first of the two engine defects this slice is forbidden to paper
          over: the smoothed line repeats your last weight on days you did not
          weigh in, and the slope is fitted THROUGH those repeats. Said here in
          the athlete's terms, on the screen where the gaps are visible. */}
      {series.days.length > 1 && weighInDays * 2 < series.days.length ? (
        <p className="mt-1 text-3 text-muted">
          The line carries your last weight forward on days you didn&apos;t weigh in, so a stretch with few weigh-ins
          reads flatter than your real change. Weighing in more often makes it — and your coaching targets — truer.
        </p>
      ) : null}
    </Card>
  );
}

/*
 * The trend against the raw points, with no chart library and no SVG — same
 * construction as mobile's own `Chart`. Everything is a percentage of a
 * fixed-height box: the trend is a run of connected vertical segments (each
 * spanning the two smoothed values it joins, which is what makes them read as
 * one line rather than as bars) and each weigh-in is a dot at its own value.
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
    <div className="relative mt-1.5 overflow-hidden rounded-md bg-well" style={{ height: CHART_H }}>
      {series.trend.map((value, i) => {
        const previous = i > 0 ? series.trend[i - 1] : null;
        if (value === null || previous == null) return null;
        const top = Math.min(y(previous), y(value));
        const bottom = Math.max(y(previous), y(value));
        return (
          <div
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
          <div
            key={`r${i}`}
            className="absolute rounded-pill border border-gold-line bg-panel"
            /* 6px is off the 8px spacing scale on purpose and so is expressed
               here rather than as a class: this is a data mark sized to the
               chart, not a piece of layout the grid governs. */
            style={{ width: 6, height: 6, left: `${x(i)}%`, top: `${y(value)}%`, marginLeft: -3, marginTop: -3 }}
          />
        ),
      )}
    </div>
  );
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mt-1.5">
      <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none placeholder:text-dim focus:border-gold-line"
      />
    </div>
  );
}

function NumCell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        inputMode="decimal"
        className="num mt-0.5 h-5 w-full rounded-md border border-line bg-well px-1 text-5 text-text outline-none focus:border-gold-line"
      />
    </div>
  );
}
