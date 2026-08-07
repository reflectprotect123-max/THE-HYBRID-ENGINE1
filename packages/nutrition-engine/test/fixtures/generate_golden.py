#!/usr/bin/env python3
"""Generate the golden fixtures the TypeScript port is graded against.

Run against the Python reference, whose repository path is the only argument:

    python3 generate_golden.py /path/to/thehybridsystem > adaptive-engine-golden.json

The scenarios below are the parity gate: every one carries its inputs as plain
JSON so `parity.test.ts` can feed the identical case to the TypeScript engine
and compare, rather than trusting a hand-copied expectation. The reference
repository is READ-ONLY; this script imports it and writes nothing to it.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from datetime import date, timedelta


def load_reference(repo_path: str):
    sys.path.insert(0, repo_path)
    import adaptive_engine  # noqa: PLC0415

    return adaptive_engine


def iso(day: date) -> str:
    return day.isoformat()


def record(day, calories=None, weight_kg=None, nutrition_status="complete"):
    return {
        "date": day,
        "calories": calories,
        "weight_kg": weight_kg,
        "nutrition_status": nutrition_status,
    }


START = date(2026, 7, 1)


def linear_days(count, calories=2800, start_weight=90.0, per_day=-0.04, status="complete"):
    return [
        record(
            iso(START + timedelta(days=index)),
            calories=calories,
            weight_kg=None if start_weight is None else start_weight + index * per_day,
            nutrition_status=status,
        )
        for index in range(count)
    ]


def build_scenarios():
    # 1. The reference test's own 14-day baseline.
    baseline = linear_days(14)

    # 2. Two days downgraded to `partial` with null calories: the invariant that
    #    a partial day is unknown intake, never zero.
    partial = linear_days(14)
    partial[2] = record(partial[2]["date"], None, 89.92, "partial")
    partial[3] = record(partial[3]["date"], None, 89.88, "partial")

    # 3. `unlogged` with a stored calorie value is still not countable.
    unlogged = linear_days(14)
    for index in (5, 6):
        unlogged[index] = record(unlogged[index]["date"], 2750, unlogged[index]["weight_kg"], "unlogged")

    # 4. A declared fast: countable at explicit zero, not countable at null.
    fasted_zero = linear_days(14)
    fasted_zero[9] = record(fasted_zero[9]["date"], 0, fasted_zero[9]["weight_kg"], "fasted")
    fasted_null = linear_days(14)
    fasted_null[9] = record(fasted_null[9]["date"], None, fasted_null[9]["weight_kg"], "fasted")

    # 5. Weight gaps: the scale is noisy, so missing weigh-ins are tolerated as
    #    long as each seven-day period holds at least one.
    sparse_weight = [
        record(row["date"], row["calories"], row["weight_kg"] if index % 5 == 0 else None)
        for index, row in enumerate(linear_days(14))
    ]
    # 6. A whole period without a weigh-in fails the weight gate.
    no_recent_weight = [
        record(row["date"], row["calories"], row["weight_kg"] if index < 7 else None)
        for index, row in enumerate(linear_days(14))
    ]
    # 7. Exactly one weigh-in overall: EWMA yields a single trend point, so the
    #    slope is undefined even though the weight gate passes on one period.
    single_weight = [
        record(row["date"], row["calories"], row["weight_kg"] if index == 13 else None)
        for index, row in enumerate(linear_days(14))
    ]

    # 8. A weight spike the EWMA has to absorb.
    spiky = linear_days(21)
    spiky[15] = record(spiky[15]["date"], 2800, 95.0)

    # 9. Long history -> high confidence; and a gaining athlete.
    long_history = linear_days(35)
    gaining = linear_days(21, calories=3400, start_weight=82.0, per_day=0.06)

    # 10. Implausible rates of change that drive the raw estimate onto the
    #     configured sanity bounds before damping.
    crashing = linear_days(14, calories=1500, start_weight=95.0, per_day=-0.9)
    ballooning = linear_days(14, calories=1200, start_weight=80.0, per_day=0.9)

    # 11. Flat weight: slope zero, expenditure equals mean intake.
    flat = linear_days(14, per_day=0.0)

    # 12. Unsorted input must sort identically in both engines.
    shuffled = list(reversed(linear_days(14)))

    # 13. Non-uniform calories so the mean exercises compensated summation.
    jagged = [
        record(row["date"], 2450 + (index * 137) % 900, row["weight_kg"])
        for index, row in enumerate(linear_days(18))
    ]

    # 14. Short history: holds regardless of perfect coverage.
    short = linear_days(7)
    # 15. Sparse calendar: 14 days apart but only four records in between.
    sparse_calendar = [linear_days(14)[index] for index in (0, 4, 9, 13)]

    estimate_cases = [
        ("empty", [], None),
        ("empty_with_previous", [], 2800),
        ("baseline_with_previous", baseline, 2800),
        ("baseline_no_previous", baseline, None),
        ("baseline_previous_far_below", baseline, 1500),
        ("baseline_previous_far_above", baseline, 4200),
        ("partial_days_hold", partial, 2800),
        ("partial_days_hold_no_previous", partial, None),
        ("unlogged_days_hold", unlogged, 2800),
        ("fasted_zero_counts", fasted_zero, 2800),
        ("fasted_null_holds", fasted_null, 2800),
        ("sparse_weight_updates", sparse_weight, 2800),
        ("no_recent_weight_holds", no_recent_weight, 2800),
        ("single_weight_holds", single_weight, 2800),
        ("spike_absorbed", spiky, 2900),
        ("long_history_high_confidence", long_history, 2800),
        ("gaining_athlete", gaining, 3200),
        ("clamped_to_maximum", crashing, None),
        ("clamped_to_minimum", ballooning, None),
        ("flat_weight", flat, None),
        ("shuffled_input", shuffled, 2800),
        ("jagged_calories", jagged, 2800),
        ("short_history_holds", short, 2800),
        ("sparse_calendar", sparse_calendar, 2800),
    ]

    check_in_cases = [
        ("ready_cut", baseline, 2800, 90, -0.3, 1.8, 0.8),
        ("ready_bulk", gaining, 3200, 82, 0.25, 2.2, 1.0),
        ("ready_maintain", flat, None, 88, 0.0, 1.8, 0.8),
        ("held_short_history", short, 2800, 90, -0.3, 1.8, 0.8),
        ("held_partial", partial, 2800, 90, -0.3, 1.8, 0.8),
        ("held_no_previous", partial, None, 90, -0.3, 1.8, 0.8),
        ("held_no_weight", no_recent_weight, 2600, 90, -0.5, 2.0, 0.9),
        ("held_empty", [], None, 90, -0.3, 1.8, 0.8),
    ]

    # Non-default configs: every product parameter has to be genuinely wired to
    # behaviour, not merely present on the dataclass.
    config_cases = [
        ("faster_ewma_wider_step", baseline, 1500, {"trend_alpha": 0.5, "maximum_expenditure_step_kcal": 300}),
        ("short_window_gate", short, 2800, {"minimum_history_days": 7, "coverage_window_days": 3, "minimum_nutrition_days_per_week": 3}),
        ("narrow_sanity_range", baseline, None, {"minimum_expenditure_kcal": 2000, "maximum_expenditure_kcal": 2500}),
        ("perfect_logging_required", fasted_null, 2800, {"minimum_nutrition_days_per_week": 7}),
        ("alternative_kcal_per_kg", baseline, None, {"kcal_per_kg": 3500}),
        ("two_weigh_ins_required", sparse_weight, 2800, {"minimum_weight_days_per_week": 2}),
    ]

    return estimate_cases, check_in_cases, config_cases


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    engine = load_reference(sys.argv[1])
    estimate_cases, check_in_cases, config_cases = build_scenarios()

    payload = {
        "source": "adaptive_engine.py (reflectprotect123-max/thehybridsystem)",
        "python": sys.version.split()[0],
        "engineConfig": asdict(engine.EngineConfig()),
        "weightTrend": [],
        "linearSlope": [],
        "nutritionIsCountable": [],
        "periodCoverage": [],
        "coverageExplanation": [],
        "estimateExpenditure": [],
        "estimateExpenditureWithConfig": [],
        "initialExpenditure": [],
        "calorieTarget": [],
        "macroTargets": [],
        "weeklyCheckIn": [],
    }

    trend_inputs = [
        ("smooths_a_spike", [90.0, 90.2, 90.1, 95.0, 90.2], 0.2),
        ("leading_gap", [None, None, 88.4, 88.1, None, 87.9], 0.2),
        ("all_missing", [None, None, None], 0.2),
        ("alpha_one", [90.0, 91.0, 89.0], 1.0),
        ("alpha_small", [90.0, 91.0, 89.0, 92.5, 88.25], 0.05),
        ("empty", [], 0.2),
        ("single", [77.7], 0.2),
        ("long_drift", [90 - index * 0.037 for index in range(30)], 0.2),
    ]
    for name, values, alpha in trend_inputs:
        payload["weightTrend"].append(
            {"name": name, "values": values, "alpha": alpha, "expected": engine.weight_trend(values, alpha)}
        )

    slope_inputs = [
        ("empty", []),
        ("single", [["2026-07-01", 90.0]]),
        ("same_day_twice", [["2026-07-01", 90.0], ["2026-07-01", 90.4]]),
        ("linear", [[iso(START + timedelta(days=index)), 90 - index * 0.04] for index in range(14)]),
        ("irregular", [["2026-07-01", 90.0], ["2026-07-04", 89.55], ["2026-07-11", 89.1], ["2026-07-12", 89.34]]),
        ("noisy", [[iso(START + timedelta(days=index)), 90 + ((index * 37) % 11) / 10] for index in range(21)]),
    ]
    for name, points in slope_inputs:
        typed = [(date.fromisoformat(day), value) for day, value in points]
        payload["linearSlope"].append(
            {"name": name, "points": points, "expected": engine._linear_slope(typed)}
        )

    countable_inputs = [
        record("2026-07-01", 2400, 90.0, "complete"),
        record("2026-07-01", 0, 90.0, "complete"),
        record("2026-07-01", -5, 90.0, "complete"),
        record("2026-07-01", None, 90.0, "complete"),
        record("2026-07-01", 2400, 90.0, "partial"),
        record("2026-07-01", None, 90.0, "partial"),
        record("2026-07-01", 2400, 90.0, "unlogged"),
        record("2026-07-01", 0, 90.0, "fasted"),
        record("2026-07-01", None, 90.0, "fasted"),
        record("2026-07-01", 120, 90.0, "fasted"),
    ]
    for row in countable_inputs:
        payload["nutritionIsCountable"].append(
            {"record": row, "expected": engine.nutrition_is_countable(engine.DailyRecord.from_dict(row))}
        )

    estimate_case_records = {name: rows for name, rows, _ in estimate_cases}
    coverage_inputs = [
        ("baseline", "baseline_with_previous", "2026-07-01", "2026-07-14"),
        ("partial", "partial_days_hold", "2026-07-01", "2026-07-07"),
        ("sparse_weight", "sparse_weight_updates", "2026-07-08", "2026-07-14"),
        ("short", "short_history_holds", "2026-07-01", "2026-07-07"),
    ]
    for name, case, start, end in coverage_inputs:
        rows = [engine.DailyRecord.from_dict(row) for row in estimate_case_records[case]]
        nutrition_days, weight_days = engine._period_coverage(
            sorted(rows, key=lambda item: item.day), date.fromisoformat(start), date.fromisoformat(end)
        )
        payload["periodCoverage"].append(
            {
                "name": name,
                "records": estimate_case_records[case],
                "start": start,
                "end": end,
                "expected": {"nutritionDays": nutrition_days, "weightDays": weight_days},
            }
        )

    for name, rows, _ in estimate_cases:
        typed = sorted(
            (engine.DailyRecord.from_dict(row) for row in rows), key=lambda item: item.day
        )
        enough, reasons, nutrition_days, weight_days = engine._coverage_explanation(
            typed, engine.EngineConfig()
        )
        payload["coverageExplanation"].append(
            {
                "name": name,
                "records": rows,
                "expected": {
                    "enough": enough,
                    "reasons": reasons,
                    "nutritionDays": nutrition_days,
                    "weightDays": weight_days,
                },
            }
        )

    for name, rows, previous in estimate_cases:
        typed = [engine.DailyRecord.from_dict(row) for row in rows]
        payload["estimateExpenditure"].append(
            {
                "name": name,
                "records": rows,
                "previousEstimateKcal": previous,
                "expected": asdict(engine.estimate_expenditure(typed, previous)),
            }
        )

    for name, rows, previous, overrides in config_cases:
        typed = [engine.DailyRecord.from_dict(row) for row in rows]
        config = engine.EngineConfig(**overrides)
        payload["estimateExpenditureWithConfig"].append(
            {
                "name": name,
                "records": rows,
                "previousEstimateKcal": previous,
                "config": overrides,
                "expected": asdict(engine.estimate_expenditure(typed, previous, config)),
            }
        )

    initial_inputs = [
        ("male_moderate", dict(weight_kg=90, height_cm=177, age_years=32, sex="male", activity_level="moderate")),
        ("female_light", dict(weight_kg=62, height_cm=165, age_years=28, sex="female", activity_level="light")),
        ("unspecified_sedentary", dict(weight_kg=75, height_cm=170, age_years=45, sex="unspecified", activity_level="sedentary")),
        ("male_very_high", dict(weight_kg=104.4, height_cm=188.5, age_years=21.5, sex="male", activity_level="very_high")),
        ("body_fat_known", dict(weight_kg=90, height_cm=177, age_years=32, sex="male", activity_level="high", body_fat_pct=14.5)),
        ("body_fat_out_of_range_low", dict(weight_kg=90, height_cm=177, age_years=32, sex="male", body_fat_pct=1.5)),
        ("body_fat_out_of_range_high", dict(weight_kg=90, height_cm=177, age_years=32, sex="female", body_fat_pct=80)),
        ("body_fat_boundary_low", dict(weight_kg=90, height_cm=177, age_years=32, sex="male", body_fat_pct=2)),
        ("body_fat_boundary_high", dict(weight_kg=90, height_cm=177, age_years=32, sex="male", body_fat_pct=70)),
        ("unknown_activity_falls_back", dict(weight_kg=90, height_cm=177, age_years=32, sex="male", activity_level="ultra")),
        ("tiny_athlete_floor", dict(weight_kg=30, height_cm=120, age_years=80, sex="female", activity_level="sedentary")),
    ]
    for name, kwargs in initial_inputs:
        payload["initialExpenditure"].append(
            {"name": name, "input": kwargs, "expected": engine.initial_expenditure_kcal(**kwargs)}
        )

    target_inputs = [
        (2800, -0.5),
        (2800, 0.5),
        (2800, 0.0),
        (2734.6, -0.25),
        (3111.1, 0.35),
        (2500, -1.0),
        (2000.05, -0.125),
        (2200, 0.0714285714285714),
    ]
    for expenditure, rate in target_inputs:
        payload["calorieTarget"].append(
            {
                "expenditureKcal": expenditure,
                "targetRateKgPerWeek": rate,
                "expected": engine.calorie_target(expenditure, rate),
            }
        )

    macro_inputs = [
        (2500, 90, 2.0, 0.8),
        (2500, 90, None, None),
        (2225.0, 88.5, 1.9, 0.75),
        (1441.0, 90, 2.0, 0.8),
        (1200, 110, 2.2, 1.1),  # protein+fat overshoot: carbs clamp at zero
        (0, 80, 1.8, 0.8),
        (3333.33, 77.77, 1.85, 0.85),
        (2000.5, 90, 2.0, 0.8),
    ]
    for calories, weight, protein, fat in macro_inputs:
        kwargs = {}
        if protein is not None:
            kwargs["protein_g_per_kg"] = protein
        if fat is not None:
            kwargs["fat_g_per_kg"] = fat
        payload["macroTargets"].append(
            {
                "calories": calories,
                "bodyWeightKg": weight,
                "proteinGPerKg": protein,
                "fatGPerKg": fat,
                "expected": engine.macro_targets(calories, weight, **kwargs),
            }
        )

    for name, rows, previous, weight, rate, protein, fat in check_in_cases:
        typed = [engine.DailyRecord.from_dict(row) for row in rows]
        payload["weeklyCheckIn"].append(
            {
                "name": name,
                "records": rows,
                "previousExpenditureKcal": previous,
                "bodyWeightKg": weight,
                "targetRateKgPerWeek": rate,
                "proteinGPerKg": protein,
                "fatGPerKg": fat,
                "expected": engine.weekly_check_in(
                    typed,
                    previous_expenditure_kcal=previous,
                    body_weight_kg=weight,
                    target_rate_kg_per_week=rate,
                    protein_g_per_kg=protein,
                    fat_g_per_kg=fat,
                ),
            }
        )

    json.dump(payload, sys.stdout, indent=2, sort_keys=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
