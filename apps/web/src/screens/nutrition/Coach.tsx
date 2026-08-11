import { useMemo, useState } from 'react';
import { uid, ymd } from '@hybrid/engine';
import { targetForDay, type MacroProgram } from '@hybrid/nutrition-core';
import type { ExpenditureConfidence } from '@hybrid/nutrition-engine';
import {
  checkInFor,
  currentEstimate,
  goalLabel,
  goalOf,
  latestWeighIn,
  weekEndOf,
  weekStartOf,
  weighInCoverage,
} from '@hybrid/nutrition-adapter';
import { useNutrition } from '../../store/nutrition';
import { Button, Card, Chip, Empty, Kicker, Ring, ScreenTitle, SectionHead } from '../../ui';
import { round } from './fields';
import { CheckInScreen } from './CheckIn';

/*
 * The macro program, and the engine's account of itself. Ported from mobile's
 * `apps/mobile/src/screens/nutrition/Coach.tsx`, which is itself ported from
 * MacroTrack's CoachScreen.kt — the source of its own rule: "missing-data
 * holding is a valid state and must be visible in the UI". HOLDING IS
 * RENDERED AS INFORMATION HERE — a quiet card, muted ink, the engine's own
 * sentence about what is missing, and the carried-forward number still shown.
 * Never `text-bad`, never a warning glyph. An athlete whose logging has a gap
 * is not being told they broke something.
 *
 * The check-in is a PANE of this tab rather than a route, exactly as mobile
 * renders it (`CheckInScreen` swapped in for `CoachHome` by local state, not
 * a router push) — the nutrition bottom nav is the world's shape, and a back
 * stack over a tab the athlete reached by tapping the bar is a different
 * navigation model from the one this world already has.
 */

/**
 * The goal rates offered.
 *
 * MacroTrack uses a −1…+1 slider in 0.1 steps. Mobile has no slider primitive
 * and offers the same range at 0.25 granularity as chips instead; web follows
 * the already-ported choice rather than adding a slider here.
 */
const RATES = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1] as const;

const rateText = (rate: number): string => (rate > 0 ? `+${rate}` : String(rate));

const rateSpoken = (rate: number): string =>
  rate === 0 ? 'maintain weight' : `${rate < 0 ? 'lose' : 'gain'} ${Math.abs(rate)} kilograms per week`;

/** The engine's four confidence words, said in the athlete's language. `holding`
 *  is one of them and is a state, not a grade — see the file header. */
const CONFIDENCE: Record<ExpenditureConfidence, string> = {
  holding: 'no estimate yet',
  low: 'low confidence',
  medium: 'medium confidence',
  high: 'high confidence',
};

export function Coach() {
  const [pane, setPane] = useState<'coach' | 'checkIn'>('coach');
  if (pane === 'checkIn') return <CheckInScreen onBack={() => setPane('coach')} />;
  return <CoachHome onCheckIn={() => setPane('checkIn')} />;
}

function CoachHome({ onCheckIn }: { onCheckIn: () => void }) {
  const { nutrition, update } = useNutrition();
  const today = ymd(new Date());
  const weekStart = weekStartOf(today);

  const program = nutrition.program;
  const weighIn = latestWeighIn(nutrition);
  const stored = checkInFor(nutrition, weekStart);
  /* The whole point of this screen: the engine, run on the athlete's own
     slice, shown with its own explanation attached. */
  const estimate = useMemo(() => currentEstimate(nutrition, today), [nutrition, today]);
  const coverage = weighInCoverage(estimate);
  const target = targetForDay(program, today);

  /** null = "showing what is saved". A number = the athlete has picked
   *  something they have not saved yet, which is a state the screen has to be
   *  able to say. */
  const [picked, setPicked] = useState<number | null>(null);
  const saved = program?.targetRateKgPerWeek ?? null;
  const rate = picked ?? saved ?? 0;
  const unsaved = picked !== null && picked !== saved;

  const saveGoal = () => {
    const at = new Date().toISOString();
    update((n) => {
      if (n.program) {
        if (n.program.targetRateKgPerWeek === rate) return false;
        // Edited in place, keeping the program id — this slice holds at most
        // one program (`NutritionDB.program`), so minting a new id on a
        // changed goal would orphan every stored check-in's `programId` and
        // discard the day-target calendar the merge keys on. The provenance
        // survives on the check-in rows instead.
        n.program.targetRateKgPerWeek = rate;
        n.program.goal = goalOf(rate);
        n.program.updatedAt = at;
        return;
      }
      const created: MacroProgram = {
        id: uid(),
        // Blank, as everywhere else in this slice — see Weight.tsx.
        userId: '',
        name: 'My macro goal',
        // 'manual' is what the reference writes: the athlete chose the rate.
        // 'coached' would claim a coach set it.
        mode: 'manual',
        goal: goalOf(rate),
        targetRateKgPerWeek: rate,
        startDate: today,
        endDate: null,
        weeklyCalorieBudget: null,
        proteinPreference: null,
        fatPreference: null,
        status: 'active',
        // Empty: a program proposes no day targets until a check-in is
        // accepted. Seeding a week here would be a target nobody agreed to.
        days: [],
        createdAt: at,
        updatedAt: at,
      };
      n.program = created;
    });
    setPicked(null);
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Coach</ScreenTitle>

      <SectionHead title="Your goal" />
      <Card tone={program ? undefined : 'raised'}>
        {program ? (
          <>
            <p className="text-6 font-[650] text-text">
              {goalLabel(program.targetRateKgPerWeek)}
              {program.targetRateKgPerWeek === 0 ? '' : ` ${Math.abs(program.targetRateKgPerWeek)} kg/week`}
            </p>
            <p className="num mt-0.5 text-3 text-muted">
              {target
                ? `Today's target: ${round(target.calories)} kcal · ${round(target.proteinG)}P ${round(target.carbsG)}C ${round(target.fatG)}F`
                : 'No target for today yet — accept a check-in and next week gets one.'}
            </p>
          </>
        ) : (
          <p className="text-4 text-muted">
            Pick how fast you want to change. Everything else — your calories, your macros — is worked out from that
            and from what you actually log.
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {RATES.map((r) => (
            <Chip key={r} on={rate === r} onClick={() => setPicked(r)} aria-label={rateSpoken(r)}>
              {rateText(r)}
            </Chip>
          ))}
        </div>
        <p className="mt-0.5 text-3 text-dim">kg per week — negative loses, positive gains, zero maintains.</p>

        {!program || unsaved ? (
          <div className="mt-2">
            <Button variant="brass" onClick={saveGoal}>
              {program ? 'Save goal change' : 'Save goal'}
            </Button>
            {unsaved ? <p className="mt-1 text-3 text-dim">Not saved yet.</p> : null}
          </div>
        ) : null}
      </Card>

      <SectionHead title="Expenditure" />
      <Card tone="quiet">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {estimate.estimateKcal === null ? (
              <p className="text-6 font-[650] text-muted">No estimate yet</p>
            ) : (
              <p className="num text-8 font-[800] text-text">
                {round(estimate.estimateKcal)}
                <span className="text-5 font-[500] text-muted"> kcal/day</span>
              </p>
            )}
            <p className="mt-0.5 text-3 text-muted">
              {estimate.state === 'holding' ? 'Holding — ' : ''}
              {CONFIDENCE[estimate.confidence]}
            </p>
          </div>
          <CoverageRing coverage={coverage} />
        </div>

        {/* The engine's own words, verbatim. On a holding result this is the
            list of exactly what is missing; on an updating one it is what
            was used. Either way it is not paraphrased here — a paraphrase is
            where the UI starts telling the athlete something the engine did
            not. */}
        <p className="mt-1.5 text-4 text-muted">{estimate.explanation}</p>

        {estimate.trendSlopeKgPerWeek === null ? null : (
          <p className="num mt-1 text-3 text-dim">
            Weight trend {estimate.trendSlopeKgPerWeek > 0 ? '+' : ''}
            {estimate.trendSlopeKgPerWeek.toFixed(2)} kg/week over {estimate.nutritionDays} logged day
            {estimate.nutritionDays === 1 ? '' : 's'}
          </p>
        )}

        {/* The first engine defect, stated where it changes a decision. Only
            shown when it can actually be biting: a thin weight signal INSIDE
            the window the estimate was computed from. */}
        {coverage.sparse ? (
          <p className="mt-1.5 rounded-md border border-line2 bg-panel2 p-1.5 text-3 text-muted">
            This estimate saw {coverage.weightDays} weigh-in{coverage.weightDays === 1 ? '' : 's'} in{' '}
            {coverage.windowDays} days. The smoothed line repeats your last weight on the days between, so it reads
            flatter than your real change — and a flatter trend makes this number, and the target built on it, LOWER
            than it should be. More weigh-ins fix it; nothing else does.
          </p>
        ) : null}

        <p className="mt-1.5 text-3 text-dim">
          Worked out from what you logged and how your weight moved. No wearable calorie estimate is used.
        </p>
      </Card>

      <SectionHead title="This week" />
      {!program ? (
        <Empty title="Set a goal first" body="The weekly check-in proposes the next week of targets for a goal." />
      ) : !weighIn ? (
        <Empty
          title="Log a weigh-in"
          body="Your macros are scaled by your body weight, so the check-in needs one weigh-in before it can propose anything. The Weight tab is next door."
        />
      ) : (
        <Card>
          <p className="text-5 font-[650] text-text">{statusLine(stored?.status)}</p>
          <p className="num mt-0.5 text-3 text-dim">
            {weekStart} – {weekEndOf(weekStart)}
          </p>
          <div className="mt-1.5">
            <Button variant={stored?.status === 'pending' ? 'brass' : 'ghost'} onClick={onCheckIn}>
              {stored?.status === 'pending' ? 'Review the proposal' : 'Open check-in'}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

function statusLine(status: string | undefined): string {
  if (status === 'pending') return 'A proposal is waiting for you';
  if (status === 'accepted') return 'You accepted this week';
  if (status === 'declined') return 'You declined this week';
  // 'held' is a recorded, normal outcome — said as a fact, not as a failure.
  if (status === 'held') return 'Held — recorded, with what was missing';
  return 'Not checked in yet';
}

/**
 * Weigh-in coverage inside the engine's own window, as a fraction.
 *
 * A real ratio of two real counts, which is the only thing on this screen a
 * ring can honestly show — confidence is four words, not a percentage, and
 * drawing it as an arc would invent a number the engine never produced.
 */
function CoverageRing({ coverage }: { coverage: { weightDays: number; windowDays: number; sparse: boolean } }) {
  const has = coverage.windowDays > 0;
  const frac = has ? coverage.weightDays / coverage.windowDays : 0;
  return (
    // The label rides on the wrapper, not on `Ring`: the arc is a stack of
    // decorative SVG, and a screen reader given only "3" and "14" beside a
    // shape reads two orphaned numbers.
    <div
      className="flex flex-col items-center"
      aria-label={`${coverage.weightDays} weigh-ins in ${coverage.windowDays} days`}
    >
      <Ring
        frac={frac}
        size={72}
        stroke={7}
        color={has ? 'var(--color-gold2)' : 'var(--color-ring-idle)'}
        track="var(--color-panel3)"
      >
        <span className="num text-4 font-[800] text-text">
          {coverage.weightDays}/{coverage.windowDays}
        </span>
      </Ring>
      <span className="mt-0.5 text-2 font-[650] uppercase tracking-[.12em] text-dim">Weigh-ins</span>
    </div>
  );
}
