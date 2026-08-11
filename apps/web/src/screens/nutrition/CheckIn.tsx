import { useMemo } from 'react';
import { ymd } from '@hybrid/engine';
import { targetForDay, type CheckIn, type MacroTotals } from '@hybrid/nutrition-core';
import { weeklyCheckIn, type WeeklyCheckIn } from '@hybrid/nutrition-engine';
import {
  checkInFor,
  dailyRecords,
  dampingAnchor,
  latestWeighIn,
  macroOvershoot,
  nextWeekStart,
  weekEndOf,
  weekStartOf,
} from '@hybrid/nutrition-adapter';
import { useNutrition } from '../../store/nutrition';
import { Button, Card, Empty, Kicker, ScreenTitle, SectionHead } from '../../ui';
import { round } from './fields';
import { acceptedDays, checkInRow, completeTarget } from './checkIn';

/*
 * The weekly review — ported from mobile's `apps/mobile/src/screens/nutrition/
 * CheckIn.tsx`, same rules and same state machine
 * (`docs/ADAPTIVE_ENGINE_CONTRACT.md`):
 *
 *   insufficient history/coverage -> HOLDING
 *   adequate intake + weight data -> UPDATING
 *   UPDATING + accepted check-in  -> next macro-program week
 *   UPDATING + declined check-in  -> preserve current program
 *
 * Every number and every sentence of explanation on this pane is
 * `weeklyCheckIn`'s own output (from `@hybrid/nutrition-engine`, via
 * `dailyRecords`/`dampingAnchor` in `@hybrid/nutrition-adapter`). This pane
 * decides nothing; `./checkIn.ts` holds the pure record-shaping the write
 * calls into.
 *
 * BOTH OUTCOMES ARE RECORDED — a decline is stored exactly like an accept,
 * with the proposal and the decision kept on the row, so the engine never
 * re-offers a week the athlete already turned down.
 *
 * A RESOLVED WEEK IS NOT RECOMPUTED: once a week is accepted or declined the
 * `run` control is gone for it and the next week gets its own row.
 *
 * Rendered as a PANE of `Coach.tsx`, not a route — see that file's header.
 */

export function CheckInScreen({ onBack }: { onBack: () => void }) {
  const { nutrition, update } = useNutrition();
  const today = ymd(new Date());
  const weekStart = weekStartOf(today);
  const weekEnd = weekEndOf(weekStart);

  const program = nutrition.program;
  const weighIn = latestWeighIn(nutrition);
  const stored = checkInFor(nutrition, weekStart);

  /* Recomputed from the slice on every render, deliberately: this is the LIVE
     engine answer, reacting the moment the athlete fixes the logging gap it
     is complaining about. It is not what gets stored — the button is. */
  const live = useMemo<WeeklyCheckIn | null>(() => {
    if (!program || !weighIn) return null;
    return weeklyCheckIn(dailyRecords(nutrition, today), {
      previousExpenditureKcal: dampingAnchor(nutrition, weekStart),
      bodyWeightKg: weighIn.weightKg,
      targetRateKgPerWeek: program.targetRateKgPerWeek,
    });
  }, [nutrition, today, weekStart, program, weighIn]);

  const run = () => {
    if (!program || !live) return;
    const at = new Date().toISOString();
    update((n) => {
      const existing = n.checkIns.find((c) => c.weekStart === weekStart);
      // Compare-and-set: a settled week is never overwritten, so two taps (or
      // two devices) cannot turn a recorded decision back into a proposal.
      if (existing && (existing.status === 'accepted' || existing.status === 'declined')) return false;
      const row = checkInRow({ existing, programId: program.id, weekStart, weekEnd, live, at });
      const i = n.checkIns.findIndex((c) => c.weekStart === weekStart);
      if (i >= 0) n.checkIns[i] = row;
      else n.checkIns.push(row);
    });
  };

  const resolve = (accepted: boolean) => {
    const at = new Date().toISOString();
    update((n) => {
      const row = n.checkIns.find((c) => c.weekStart === weekStart);
      if (!row || row.status !== 'pending') return false;
      const target = accepted ? completeTarget(row) : null;
      // An accept with an incomplete proposal writes nothing at all rather
      // than a partial week of targets — a day carrying calories but no
      // protein would read on the Daily Log as a real coached target.
      if (accepted && !target) return false;
      const liveProgram = n.program;
      if (accepted && !liveProgram) return false;

      row.status = accepted ? 'accepted' : 'declined';
      row.resolvedAt = at;
      row.updatedAt = at;
      // DECLINE ENDS HERE: "preserve current program" is the whole of the
      // declined branch of the state machine.
      if (!accepted || !target || !liveProgram) return;

      const start = nextWeekStart(weekStart);
      for (const day of acceptedDays(liveProgram.id, start, target, at)) {
        const existing = liveProgram.days.findIndex((d) => d.targetDate === day.targetDate);
        if (existing >= 0) liveProgram.days[existing] = day;
        else liveProgram.days.push(day);
      }
      liveProgram.updatedAt = at;
    });
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Check-in</ScreenTitle>
      <p className="mt-0.5 num text-4 text-muted">
        {weekLabel(weekStart)} – {weekLabel(weekEnd)}
      </p>

      {!program ? (
        <div className="mt-2">
          <Empty
            title="No goal yet"
            body="A check-in proposes the next week of targets for a goal. Set one above first."
            action={<Button onClick={onBack}>Back to Coach</Button>}
          />
        </div>
      ) : !weighIn ? (
        <div className="mt-2">
          <Empty
            title="No weigh-in yet"
            body="Your macros are scaled by your body weight, so the check-in needs one weigh-in before it can propose anything. Log one on the Weight tab."
            action={<Button onClick={onBack}>Back to Coach</Button>}
          />
        </div>
      ) : (
        <>
          {stored && (stored.status === 'accepted' || stored.status === 'declined') ? (
            <Settled row={stored} nextWeek={nextWeekStart(weekStart)} />
          ) : stored && stored.status === 'pending' ? (
            <Proposal row={stored} current={targetForDay(program, today)} onResolve={resolve} />
          ) : (
            <Pending stored={stored} live={live} onRun={run} />
          )}

          <SectionHead title="How this works" />
          <Card tone="quiet">
            <p className="text-3 text-muted">
              The next target uses the expenditure the engine observed and the goal rate you set. It never averages in
              a day you did not log, and it is never a make-up target for a day you went over.
            </p>
          </Card>
        </>
      )}

      <div className="mt-2">
        <Button onClick={onBack}>Back to Coach</Button>
      </div>
    </>
  );
}

const weekLabel = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
};

/** Nothing recorded for this week yet, or a recorded HELD week. */
function Pending({ stored, live, onRun }: { stored: CheckIn | null; live: WeeklyCheckIn | null; onRun: () => void }) {
  const held = stored?.status === 'held';
  const explanation = held ? stored.explanation : (live?.explanation ?? '');
  const modules = held ? stored.modules : (live?.modules ?? []);
  const ready = !held && live?.status === 'ready';

  return (
    <>
      <SectionHead title={held ? 'Recorded: holding' : 'This week'} />
      {/* HOLDING IS INFORMATION. Quiet card, muted ink, no bad tint — the
          athlete is not being told off for a gap in their data. */}
      <Card tone={ready ? 'raised' : 'quiet'}>
        <p className="text-6 font-[650] text-text">
          {ready ? 'Ready to propose new targets' : 'Holding your current targets'}
        </p>
        {explanation ? <p className="mt-1 text-4 text-muted">{explanation}</p> : null}
        {modules.length > 0 ? (
          <div className="mt-1.5">
            {modules.map((m) => (
              <p key={m.key} className="mt-0.5 text-3 text-muted">
                · {m.action}
              </p>
            ))}
          </div>
        ) : null}
        <div className="mt-2">
          <Button variant={ready ? 'brass' : 'ghost'} onClick={onRun}>
            {held ? 'Run check-in again' : 'Run check-in'}
          </Button>
        </div>
        {held ? null : (
          <p className="mt-1 text-3 text-dim">
            Running it records this week — including a held week, so a gap in your data is on the record rather than
            invisible.
          </p>
        )}
      </Card>
    </>
  );
}

/** A recorded, unresolved proposal: accept or decline. */
function Proposal({
  row,
  current,
  onResolve,
}: {
  row: CheckIn;
  current: MacroTotals | null;
  onResolve: (accepted: boolean) => void;
}) {
  const target = completeTarget(row);
  return (
    <>
      <SectionHead title="Proposed" />
      <Card tone="raised">
        <p className="text-4 text-muted">{row.explanation}</p>
        {target ? (
          <>
            <div className="mt-1.5 flex gap-1">
              <Cell label="kcal" now={current?.calories} next={target.calories} />
              <Cell label="Protein" now={current?.proteinG} next={target.proteinG} unit="g" />
              <Cell label="Carbs" now={current?.carbsG} next={target.carbsG} unit="g" />
              <Cell label="Fat" now={current?.fatG} next={target.fatG} unit="g" />
            </div>
            <Contradiction target={target} />
          </>
        ) : (
          <p className="mt-1.5 text-4 text-bad">
            This check-in carries no complete target, so there is nothing to accept. Run it again.
          </p>
        )}
        {/* `proposedExpenditureKcal` is the DAMPED figure, and on a held week
            it is the anchor carried forward from an earlier one. Calling it
            "observed" would claim this week measured something it did not;
            `observedExpenditureKcal` is the raw reading, null on exactly the
            paths where there is none. */}
        {row.proposedExpenditureKcal == null ? null : (
          <p className="num mt-1.5 text-3 text-dim">
            {row.observedExpenditureKcal == null
              ? `Expenditure carried forward: ${round(row.proposedExpenditureKcal)} kcal/day — this week had too little data to read one`
              : `From an observed expenditure of ${round(row.observedExpenditureKcal)} kcal/day, damped to ${round(row.proposedExpenditureKcal)}`}
          </p>
        )}
        <div className="mt-2 flex gap-1">
          <div className="min-w-0 flex-1">
            <Button variant="brass" onClick={() => onResolve(true)} disabled={!target} className="w-full">
              Accept
            </Button>
          </div>
          <div className="min-w-0 flex-1">
            <Button onClick={() => onResolve(false)} className="w-full">
              Decline
            </Button>
          </div>
        </div>
        <p className="mt-1 text-3 text-dim">
          Accepting writes next week&apos;s targets. Declining keeps the targets you have — both are recorded.
        </p>
      </Card>
    </>
  );
}

/**
 * The second engine defect this pane is forbidden to paper over: `macroTargets`
 * floors carbohydrate at zero, so when protein and fat alone already exceed
 * the calorie target the macros beside it add up to MORE than it, with no
 * flag from the engine. Both numbers are shown, and the contradiction is
 * named, rather than hiding either.
 */
function Contradiction({ target }: { target: MacroTotals }) {
  const { macroCalories, overKcal } = macroOvershoot(target);
  if (overKcal === 0) return null;
  return (
    <p className="mt-1.5 rounded-md border border-bad bg-panel p-1.5 text-3 text-bad">
      These macros add up to {round(macroCalories)} kcal — {round(overKcal)} more than the {round(target.calories)}{' '}
      kcal target above. Your protein and fat preferences alone already exceed the target, so there is no
      carbohydrate left to allocate and the two numbers cannot both be met. Lower your protein or fat per kilogram,
      or choose a slower rate.
    </p>
  );
}

function Cell({ label, now, next, unit = '' }: { label: string; now?: number; next: number; unit?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="block text-2 font-[750] uppercase tracking-widest text-dim">{label}</span>
      <p className="num mt-0.5 text-6 font-[650] text-text">
        {round(next)}
        {unit}
      </p>
      {/* Absent, not zeroed: "from 0" would read as a target the athlete had
          been given, where "no target yet" is a real and common state. */}
      <p className="num text-3 text-dim">{now == null ? 'no target yet' : `from ${round(now)}${unit}`}</p>
    </div>
  );
}

/** Accepted or declined — the record of a decision, not a dead end. */
function Settled({ row, nextWeek }: { row: CheckIn; nextWeek: string }) {
  const accepted = row.status === 'accepted';
  const target = completeTarget(row);
  return (
    <>
      <SectionHead title="Recorded" />
      <Card>
        <p className="text-6 font-[650] text-text">{accepted ? 'You accepted this week' : 'You declined this week'}</p>
        <p className="mt-1 text-4 text-muted">
          {accepted
            ? `The proposed targets are written against the week starting ${weekLabel(nextWeek)}.`
            : 'Your current targets are unchanged. Nothing was written.'}
        </p>
        {target ? (
          <p className="num mt-1.5 text-4 text-text">
            {round(target.calories)} kcal · {round(target.proteinG)}P {round(target.carbsG)}C {round(target.fatG)}F
            <span className="text-3 text-dim">{accepted ? '' : ' — the proposal you turned down'}</span>
          </p>
        ) : null}
        {row.resolvedAt ? (
          <p className="mt-1 text-3 text-dim">Decided {new Date(row.resolvedAt).toLocaleString()}</p>
        ) : null}
      </Card>
    </>
  );
}
