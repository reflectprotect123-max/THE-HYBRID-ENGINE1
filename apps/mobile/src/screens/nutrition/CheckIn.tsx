import { useMemo } from 'react';
import { View } from 'react-native';
import { uid, ymd } from '@hybrid/engine';
import { targetForDay, type CheckIn, type MacroProgramDay, type MacroTotals } from '@hybrid/nutrition-core';
import { addDays, weeklyCheckIn, type WeeklyCheckIn } from '@hybrid/nutrition-engine';
import { useNutrition } from '../../store/nutrition';
import { Btn, Card, Empty, Kicker, Screen, SectionHead, T, Title } from '../../ui';
import { round } from './fields';
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

/*
 * The weekly review — MacroTrack's check-in flow, and the state machine
 * `docs/ADAPTIVE_ENGINE_CONTRACT.md` writes down:
 *
 *   insufficient history/coverage -> HOLDING
 *   adequate intake + weight data -> UPDATING
 *   UPDATING + accepted check-in  -> next macro-program week
 *   UPDATING + declined check-in  -> preserve current program
 *
 * Every number, every module and every sentence of explanation on this screen
 * is `weeklyCheckIn`'s own output. This screen decides nothing.
 *
 * BOTH OUTCOMES ARE RECORDED. A decline is not "nothing happened": it is the
 * athlete saying no to a specific proposal, and the row keeps the proposal, the
 * decision and the time it was made. An app that only stores the accepts cannot
 * tell a week that was declined from a week that was never reviewed, and would
 * re-offer the same numbers forever.
 *
 * A RESOLVED WEEK IS NOT RECOMPUTED. MacroTrack's `recomputeCheckIn` upserts
 * over any status and clears `resolved_at`, which erases the record of a
 * decision the athlete already made. Here, once a week is accepted or declined
 * it is settled and the re-run control is gone; the next week gets its own row.
 */

/** Recommendations are informational — never punishment, calorie debt, or a
 *  retroactive make-up target (the contract's own words). */
export function CheckInScreen({ onBack }: { onBack: () => void }) {
  const { nutrition, update } = useNutrition();
  const today = ymd(new Date());
  const weekStart = weekStartOf(today);
  const weekEnd = weekEndOf(weekStart);

  const program = nutrition.program;
  const weighIn = latestWeighIn(nutrition);
  const stored = checkInFor(nutrition, weekStart);

  /* Recomputed from the slice on every render, deliberately: this is the LIVE
     engine answer, and it has to react the moment the athlete fixes the logging
     gap it is complaining about. It is not what gets stored — the button is. */
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
      // Compare-and-set, the local form of the reference's `eq("status",
      // "pending")` filter: a settled week is never overwritten, so two taps
      // (or two devices) cannot turn a recorded decision back into a proposal.
      if (existing && (existing.status === 'accepted' || existing.status === 'declined')) return false;
      const row: CheckIn = {
        id: existing?.id ?? uid(),
        // Blank for the same reason every other local write leaves it blank —
        // see Weight.tsx. `checkInKey` tolerates it because both sides of a
        // merge are this device's own writes until sign-in.
        userId: existing?.userId ?? '',
        programId: program.id,
        weekStart,
        weekEnd,
        // `'ready'` is the engine's word and `'pending'` is the schema's; the
        // reference maps them here too, and `CheckInStatus` has no 'ready'.
        status: live.status === 'ready' ? 'pending' : 'held',
        previousExpenditureKcal: live.estimate.previousEstimateKcal,
        /* rawEstimateKcal, not estimateKcal: on a holding result estimateKcal
           is the CARRIED-FORWARD anchor, not anything observed this week, and
           rawEstimateKcal is null on exactly the paths where there is nothing
           real to report. The reference makes the same choice for the same
           reason. */
        observedExpenditureKcal: live.estimate.rawEstimateKcal,
        /* The expenditure, not the calorie target. MacroTrack stores
           `targets.calories` in this field, which makes a column named
           "expenditure" hold an intake number; `dampingAnchor` reads this to
           anchor the next week, so it has to be the expenditure it says it is. */
        proposedExpenditureKcal: live.estimate.estimateKcal,
        proposedCalories: live.targets?.calories ?? null,
        proposedProteinG: live.targets?.proteinG ?? null,
        proposedCarbsG: live.targets?.carbsG ?? null,
        proposedFatG: live.targets?.fatG ?? null,
        modules: live.modules,
        explanation: live.explanation,
        createdAt: existing?.createdAt ?? at,
        // Explicitly null: a week recomputed from resolved back to pending must
        // never keep a stamp saying it was settled. (Unreachable given the
        // guard above, and kept because the field's contract says so.)
        resolvedAt: null,
        updatedAt: at,
      };
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
      // An accept with an incomplete proposal writes nothing at all rather than
      // a partial week of targets — a day carrying calories but no protein
      // would read on the Daily Log as a real coached target.
      if (accepted && !target) return false;
      const live = n.program;
      if (accepted && !live) return false;

      row.status = accepted ? 'accepted' : 'declined';
      row.resolvedAt = at;
      row.updatedAt = at;
      // DECLINE ENDS HERE. Nothing touches the program: "preserve current
      // program" is the whole of the declined branch of the state machine.
      if (!accepted || !target || !live) return;

      const start = nextWeekStart(weekStart);
      for (let i = 0; i < 7; i += 1) {
        const targetDate = addDays(start, i);
        const day: MacroProgramDay = {
          programId: live.id,
          targetDate,
          ...target,
          // Provenance, required by the type: a persisted day that cannot say
          // where its numbers came from is the black box the rules forbid.
          source: 'accepted_check_in',
          createdAt: at,
        };
        const existing = live.days.findIndex((d) => d.targetDate === targetDate);
        if (existing >= 0) live.days[existing] = day;
        else live.days.push(day);
      }
      live.updatedAt = at;
    });
  };

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>Check-in</Title>
      <T num className="mt-0.5 text-4 text-muted">
        {weekLabel(weekStart)} – {weekLabel(weekEnd)}
      </T>

      {!program ? (
        <View className="mt-2">
          <Empty
            title="No goal yet"
            body="A check-in proposes the next week of targets for a goal. Set one on the Coach screen first."
            action={<Btn onPress={onBack}>Back to Coach</Btn>}
          />
        </View>
      ) : !weighIn ? (
        <View className="mt-2">
          <Empty
            title="No weigh-in yet"
            body="Your macros are scaled by your body weight, so the check-in needs one weigh-in before it can propose anything. Log one on the Weight tab."
            action={<Btn onPress={onBack}>Back to Coach</Btn>}
          />
        </View>
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
            <T className="text-3 text-muted">
              The next target uses the expenditure the engine observed and the goal rate you set. It never averages in a
              day you did not log, and it is never a make-up target for a day you went over.
            </T>
          </Card>
        </>
      )}

      <View className="mt-2">
        <Btn onPress={onBack}>Back to Coach</Btn>
      </View>
    </Screen>
  );
}

/** The four numbers, or null if any of them is missing. */
function completeTarget(row: CheckIn): MacroTotals | null {
  const { proposedCalories, proposedProteinG, proposedCarbsG, proposedFatG } = row;
  if (proposedCalories == null || proposedProteinG == null || proposedCarbsG == null || proposedFatG == null) {
    return null;
  }
  return { calories: proposedCalories, proteinG: proposedProteinG, carbsG: proposedCarbsG, fatG: proposedFatG };
}

const weekLabel = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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
      {/* HOLDING IS INFORMATION. Quiet card, muted ink, no bad tint, no warning
          glyph — the athlete is not being told off for a gap in their data. */}
      <Card tone={ready ? 'raised' : 'quiet'}>
        <T w="semi" className="text-6 text-text">
          {ready ? 'Ready to propose new targets' : 'Holding your current targets'}
        </T>
        {explanation ? <T className="mt-1 text-4 text-muted">{explanation}</T> : null}
        {modules.length > 0 ? (
          <View className="mt-1.5">
            {modules.map((m) => (
              <T key={m.key} className="mt-0.5 text-3 text-muted">
                · {m.action}
              </T>
            ))}
          </View>
        ) : null}
        <View className="mt-2">
          <Btn variant={ready ? 'brass' : 'ghost'} onPress={onRun}>
            {held ? 'Run check-in again' : 'Run check-in'}
          </Btn>
        </View>
        {held ? null : (
          <T className="mt-1 text-3 text-dim">
            Running it records this week — including a held week, so a gap in your data is on the record rather than
            invisible.
          </T>
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
        <T className="text-4 text-muted">{row.explanation}</T>
        {target ? (
          <>
            <View className="mt-1.5 flex-row">
              <Cell label="kcal" now={current?.calories} next={target.calories} />
              <Cell label="Protein" now={current?.proteinG} next={target.proteinG} unit="g" />
              <Cell label="Carbs" now={current?.carbsG} next={target.carbsG} unit="g" />
              <Cell label="Fat" now={current?.fatG} next={target.fatG} unit="g" />
            </View>
            <Contradiction target={target} />
          </>
        ) : (
          <T className="mt-1.5 text-4 text-bad">
            This check-in carries no complete target, so there is nothing to accept. Run it again.
          </T>
        )}
        {/* `proposedExpenditureKcal` is the DAMPED figure, and on a held week
            it is the anchor carried forward from an earlier one — see the
            comment on the write above. Calling it "observed" claimed this week
            measured something it did not. `observedExpenditureKcal` is the raw
            reading, and it is null on exactly the paths where there is none. */}
        {row.proposedExpenditureKcal == null ? null : (
          <T num className="mt-1.5 text-3 text-dim">
            {row.observedExpenditureKcal == null
              ? `Expenditure carried forward: ${round(row.proposedExpenditureKcal)} kcal/day — this week had too little data to read one`
              : `From an observed expenditure of ${round(row.observedExpenditureKcal)} kcal/day, damped to ${round(row.proposedExpenditureKcal)}`}
          </T>
        )}
        <View className="mt-2 flex-row gap-1">
          <View className="min-w-0 flex-1">
            <Btn variant="brass" onPress={() => onResolve(true)} disabled={!target} className="w-full">
              Accept
            </Btn>
          </View>
          <View className="min-w-0 flex-1">
            <Btn onPress={() => onResolve(false)} className="w-full">
              Decline
            </Btn>
          </View>
        </View>
        <T className="mt-1 text-3 text-dim">
          Accepting writes next week&apos;s targets. Declining keeps the targets you have — both are recorded.
        </T>
      </Card>
    </>
  );
}

/**
 * The second engine defect this slice is forbidden to paper over.
 *
 * `macroTargets` floors carbohydrate at zero, so when protein and fat alone
 * already exceed the calorie target the macros beside that target add up to
 * MORE than it, and the engine returns no flag. Rather than hide either number,
 * the screen shows both and names the contradiction — an athlete who hits these
 * macros will not hit that calorie figure, and they are entitled to know which
 * of the two the app cannot satisfy.
 */
function Contradiction({ target }: { target: MacroTotals }) {
  const { macroCalories, overKcal } = macroOvershoot(target);
  if (overKcal === 0) return null;
  return (
    <T className="mt-1.5 rounded-md border border-bad bg-panel p-1.5 text-3 text-bad">
      These macros add up to {round(macroCalories)} kcal — {round(overKcal)} more than the {round(target.calories)} kcal
      target above. Your protein and fat preferences alone already exceed the target, so there is no carbohydrate left
      to allocate and the two numbers cannot both be met. Lower your protein or fat per kilogram, or choose a slower
      rate.
    </T>
  );
}

function Cell({ label, now, next, unit = '' }: { label: string; now?: number; next: number; unit?: string }) {
  return (
    <View className="min-w-0 flex-1">
      <T w="semi" className="text-2 uppercase tracking-widest text-dim">
        {label}
      </T>
      <T w="med" num className="mt-0.5 text-6 text-text">
        {round(next)}
        {unit}
      </T>
      {/* Absent, not zeroed: "from 0" would read as a target the athlete had
          been given, where "no target yet" is a real and common state. */}
      <T num className="text-3 text-dim">
        {now == null ? 'no target yet' : `from ${round(now)}${unit}`}
      </T>
    </View>
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
        <T w="semi" className="text-6 text-text">
          {accepted ? 'You accepted this week' : 'You declined this week'}
        </T>
        <T className="mt-1 text-4 text-muted">
          {accepted
            ? `The proposed targets are written against the week starting ${weekLabel(nextWeek)}.`
            : 'Your current targets are unchanged. Nothing was written.'}
        </T>
        {target ? (
          <T num className="mt-1.5 text-4 text-text">
            {round(target.calories)} kcal · {round(target.proteinG)}P {round(target.carbsG)}C {round(target.fatG)}F
            <T className="text-3 text-dim">{accepted ? '' : ' — the proposal you turned down'}</T>
          </T>
        ) : null}
        {row.resolvedAt ? (
          <T className="mt-1 text-3 text-dim">Decided {new Date(row.resolvedAt).toLocaleString()}</T>
        ) : null}
      </Card>
    </>
  );
}
