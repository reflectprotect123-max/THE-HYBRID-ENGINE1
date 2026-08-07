/**
 * The six defects this engine INHERITED and deliberately did not fix.
 *
 * `adaptive_engine.py` is a parity contract, not a suggestion: every function
 * here is proven equal to it, float for float, by generated fixtures. So a
 * defect found during the port could not be quietly corrected — a silent
 * divergence is worse than a known bug, because the next person to compare the
 * two implementations would find them disagreeing and have no way to tell
 * which side was deliberate.
 *
 * They are listed here rather than only in a commit message or a handoff,
 * because a commit message is not where anyone looks when a number seems
 * wrong. Two of them are visible to the athlete and ARE surfaced in the UI
 * (see `apps/mobile/src/screens/nutrition/Coach.tsx` and `CheckIn.tsx`) — the
 * app tells them the estimate is weakened rather than smoothing it over.
 *
 * Fixing any of these is a deliberate decision that breaks parity, and it
 * should update this file, the fixtures, and the Python reference together.
 */

export interface EngineDefect {
  readonly id: string;
  /** What is wrong. */
  readonly problem: string;
  /** What it does to the athlete, in their terms. */
  readonly consequence: string;
  /** Where a reader can see it, or see it surfaced. */
  readonly surfacesAt: string;
  /** Whether the athlete is told. */
  readonly shownToAthlete: boolean;
}

export const ENGINE_DEFECTS: readonly EngineDefect[] = [
  {
    id: 'ewma-gap-carry-flattens-slope',
    problem:
      'weightTrend repeats the last weight across days with no weigh-in, and the least-squares fit reads those flat runs as real measurements.',
    consequence:
      'The reported drift understates the real one — roughly fourfold in the sparse_weight_updates fixture (-0.072 kg/wk reported against -0.28 actual). Expenditure is mean intake minus slope times 7700, so a flattened slope understates expenditure and hands the athlete a LOWER calorie target than the maths intends. The error is worst exactly when weigh-ins are sparsest.',
    surfacesAt: 'Coach screen — coverage ring plus a sentence naming the direction of the harm.',
    shownToAthlete: true,
  },
  {
    id: 'macro-targets-can-overshoot-calories',
    problem:
      'macroTargets floors carbohydrate at zero when protein and fat already exceed the calorie target, and returns the overshoot with no flag.',
    consequence:
      'The athlete can be shown a target whose macros add up to more energy than its own calorie figure — the two numbers cannot both be met, and nothing in the return value says so.',
    surfacesAt: 'Check-in screen — the contradiction is printed with its cause and the two real remedies; accept stays enabled.',
    shownToAthlete: true,
  },
  {
    id: 'holding-claims-high-confidence-it-never-tracked',
    problem:
      'The holding path carries forward `previousEstimateKcal` whatever its confidence was, while the contract text promises the last HIGH-CONFIDENCE estimate. No confidence is recorded alongside the carried value.',
    consequence:
      'A low-confidence estimate can be carried indefinitely while the explanation implies it was a good one.',
    surfacesAt: 'engine.ts estimateExpenditure, holding branch.',
    shownToAthlete: false,
  },
  {
    id: 'coverage-counts-computed-then-discarded',
    problem:
      'estimateExpenditure binds the coverage gates from coverageExplanation and never reads them; the reported day counts come from the wider window instead. Worse, coverageExplanation returns 0/0 counts on its two early-return paths even when records exist.',
    consequence:
      'Dead values today, and a trap tomorrow: the first caller to actually use that return value gets a false "no coverage" for an athlete who has been logging.',
    surfacesAt: 'engine.ts estimateExpenditure and coverageExplanation.',
    shownToAthlete: false,
  },
  {
    id: 'check-in-thresholds-assume-a-seven-day-window',
    problem:
      'weeklyCheckIn compares window-derived counts against the minimum-per-week values doubled, which only lines up because the analysis window happens to be twice coverageWindowDays.',
    consequence:
      'Change coverageWindowDays and the partial-logging and weigh-in modules fire incorrectly — visible in the short_window_gate config fixture.',
    surfacesAt: 'engine.ts weeklyCheckIn.',
    shownToAthlete: false,
  },
  {
    id: 'carried-estimate-is-unrounded',
    problem:
      'The holding branch returns estimateKcal unrounded while the updating branch rounds to one decimal place.',
    consequence:
      'A carried-forward number can display more precision than a freshly computed one, implying more certainty rather than less.',
    surfacesAt: 'engine.ts estimateExpenditure.',
    shownToAthlete: false,
  },
] as const;
