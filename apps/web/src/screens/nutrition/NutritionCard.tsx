import { useMemo } from 'react';
import { ymd } from '@hybrid/engine';
import { goalLabel, nutritionSummary, round } from '@hybrid/nutrition-adapter';
import { useNutrition } from '../../store/nutrition';
import { Card, Meter, Stat } from '../../ui';

/*
 * Today's nutrition, on the athlete's dashboard.
 *
 * READ-ONLY, and that is a design decision rather than an omission: Home
 * answers "what should I do today", and a form on it would make the screen a
 * place work happens instead of a place work is chosen. Logging lives one tap
 * away on /nutrition, which is where the same numbers are editable.
 *
 * Every figure comes from `nutritionSummary` in `@hybrid/nutrition-adapter`, so
 * this card, the coach bench panel and the phone app cannot disagree about the
 * same day — see that module's header for why the projection is shared rather
 * than recomputed per surface.
 */

const DIRECTION: Record<string, string> = {
  rising: 'rising',
  falling: 'falling',
  steady: 'holding steady',
  unknown: 'no trend yet',
};

export function NutritionCard() {
  const { nutrition } = useNutrition();
  const today = ymd(new Date());
  const summary = useMemo(() => nutritionSummary(nutrition, today), [nutrition, today]);
  const { today: day, adherence, trend } = summary;

  if (day.entryCount === 0 && adherence.loggedDays === 0 && !summary.hasProgram) {
    return (
      <Card tone="quiet">
        <p className="text-3 text-dim">
          Nothing logged yet. The food log is on this device and on your phone — whichever is closer.
        </p>
      </Card>
    );
  }

  return (
    <Card tone="quiet">
      <b className="num block text-8 font-[900] text-text">
        {round(day.totals.calories)}
        <span className="text-5 font-[500] text-muted"> kcal</span>
        {day.target ? <span className="num text-5 font-[500] text-muted"> of {round(day.target.calories)}</span> : null}
      </b>
      {day.target ? (
        <div className="mt-1">
          <Meter pct={day.caloriePct ?? 0} />
        </div>
      ) : (
        /* Absent, not zeroed: "0 of 0" reads as a target the athlete was given
           and missed. A target only exists once a check-in is accepted. */
        <p className="mt-0.5 text-3 text-dim">No target for today — this is just what you have logged.</p>
      )}

      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <Stat size="sm" value={`${round(day.totals.proteinG)}g`} label="Protein" tint />
        <Stat size="sm" value={`${round(day.totals.carbsG)}g`} label="Carbs" />
        <Stat size="sm" value={`${round(day.totals.fatG)}g`} label="Fat" />
      </div>

      <p className="num mt-1.5 text-3 text-dim">
        Logged {adherence.loggedDays} of the last {adherence.windowDays} days
        {' · '}
        Weight {DIRECTION[trend.direction]}
        {trend.slopeKgPerWeek == null
          ? ''
          : ` (${trend.slopeKgPerWeek > 0 ? '+' : ''}${trend.slopeKgPerWeek.toFixed(2)} kg/week)`}
        {summary.goalRateKgPerWeek == null ? '' : ` · ${goalLabel(summary.goalRateKgPerWeek)}`}
      </p>
    </Card>
  );
}
