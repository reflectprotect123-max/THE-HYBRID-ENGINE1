/*
 * The seeded athlete world, shared by every harness that needs a populated app.
 *
 * Extracted from checks/screens.mjs so the screenshot run and the single-file
 * artifact build (scripts/build-artifact.mjs) cannot drift into seeding two
 * different athletes. Dates are computed relative to the run so the calendar,
 * the 8-week trend and "today's plan" are all populated no matter when it runs.
 */
export function buildSeed() {
  const DAY = 86400000;
  const now = Date.now();
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const EX = [
    { name: 'Back Squat', top: 140, cue: 'Brace before you unrack.' },
    { name: 'Romanian Deadlift', top: 120, cue: '' },
    { name: 'Bench Press', top: 100, cue: 'Elbows tucked.' },
    { name: 'Weighted Pull-up', top: 30, cue: '' },
  ];

  const workouts = [
    {
      id: 'w1', name: 'Lower A', days: [1, 4], updatedAt: 1,
      blocks: [{
        id: 'b1', heading: 'Main', superset: false,
        exercises: [
          { id: 'e1', name: 'Back Squat', mode: 'reps_kg', rest: 180, cue: 'Prescribed load: 140kg',
            sets: [{ t: 'W10', rpe: '' }, { t: '5', rpe: '7' }, { t: '5', rpe: '8' }, { t: '5', rpe: '9' }] },
          { id: 'e2', name: 'Romanian Deadlift', mode: 'reps_kg', rest: 120, cue: '',
            sets: [{ t: '8', rpe: '7' }, { t: '8', rpe: '8' }, { t: '8', rpe: '8' }] },
        ],
      }],
    },
    {
      id: 'w2', name: 'Upper A', days: [2, 5], updatedAt: 1,
      blocks: [{
        id: 'b2', heading: 'Press + Pull', superset: true,
        exercises: [
          { id: 'e3', name: 'Bench Press', mode: 'reps_kg', rest: 150, cue: 'Elbows tucked.',
            sets: [{ t: 'W10', rpe: '' }, { t: '5', rpe: '8' }, { t: '5', rpe: '8' }, { t: '5', rpe: '9' }] },
          { id: 'e4', name: 'Weighted Pull-up', mode: 'reps_kg', rest: 150, cue: '',
            sets: [{ t: '6', rpe: '8' }, { t: '6', rpe: '8' }, { t: '6', rpe: '9' }] },
        ],
      }],
    },
    { id: 'w3', name: 'Zone 2 Run', days: [0], updatedAt: 1, blocks: [] },
  ];

  // Eight weeks of logged work, trending up ~1.5% a week so Progress has a real
  // slope to draw rather than a flat line.
  const sessions = [];
  for (let w = 8; w >= 1; w--) {
    for (const [i, src] of [workouts[0], workouts[1]].entries()) {
      const when = now - (w * 7 + (i === 0 ? 3 : 0)) * DAY;
      const scale = 1 - w * 0.015;
      const exercises = src.blocks[0].exercises.map((e) => {
        const spec = EX.find((x) => x.name === e.name) || { top: 80 };
        return {
          id: e.id, name: e.name, mode: 'reps_kg', rest: e.rest, cue: e.cue,
          sets: e.sets.map((s, si) => {
            const warm = String(s.t).startsWith('W');
            const kg = Math.round((spec.top * scale * (warm ? 0.5 : 0.9 + si * 0.03)) / 2.5) * 2.5;
            return {
              t: s.t, rpe: s.rpe, done: true,
              aVal: kg, aVal2: warm ? 10 : Number(s.t),
              felt: warm ? '' : String(Math.min(10, Number(s.rpe || 8) + (w % 3 === 0 ? 0.5 : 0))),
              note: '',
            };
          }),
        };
      });
      sessions.push({
        id: 's' + w + '-' + i, workoutId: src.id, name: src.name,
        date: iso(when), startedAt: when, completedAt: when + 3900000,
        // 'completed' — the engine's SessionStatus is 'active' | 'completed' |
        // 'incomplete'. Anything else and History and Progress silently show
        // nothing, which would make this harness flatter the app.
        status: 'completed',
        blocks: [{ id: src.blocks[0].id, heading: src.blocks[0].heading, superset: src.blocks[0].superset, exercises }],
      });
    }
  }

  /*
   * One session left mid-flight, so the Logger — the screen this app lives or
   * dies on, used one-handed between sets — screenshots as it is actually seen:
   * first exercise part-logged, second untouched.
   */
  const live = workouts[0];
  sessions.push({
    id: 'live', workoutId: live.id, name: live.name,
    date: iso(now), startedAt: now - 1500000, status: 'active',
    blocks: [{
      id: live.blocks[0].id, heading: live.blocks[0].heading, superset: false,
      exercises: live.blocks[0].exercises.map((e, ei) => {
        const spec = EX.find((x) => x.name === e.name) || { top: 80 };
        return {
          id: e.id, name: e.name, mode: 'reps_kg', rest: e.rest, cue: e.cue,
          sets: e.sets.map((s, si) => {
            const warm = String(s.t).startsWith('W');
            const done = ei === 0 && si < 2;
            const kg = Math.round((spec.top * (warm ? 0.5 : 0.92)) / 2.5) * 2.5;
            return done
              ? { t: s.t, rpe: s.rpe, done: true, aVal: kg, aVal2: warm ? 10 : Number(s.t), felt: warm ? '' : '7.5', note: '' }
              : { t: s.t, rpe: s.rpe, done: false, aVal: '', aVal2: '', felt: '', note: '' };
          }),
        };
      }),
    }],
  });

  /*
   * Conditioning, with a downsampled HR trace so the zone bars and the trace
   * chart both have something real to render.
   *
   * This block was WRONG for as long as it existed and nothing noticed, because
   * a screenshot harness cannot fail. It wrote `{ minutes, zones: {blue, green,
   * red}, hr }` at the DB root — an older schema — while the engine reads
   * `settings.conditioning` as `CondResult` with `dur` in seconds, `zsec` keyed
   * low/mod/high, and `trace` as `{every, pts}`. Nothing in either app reads
   * `db.conditioning`, so these six runs reached no screen at all: the weekly
   * zone card, the HR-recovery trend and the strength-vs-conditioning readout
   * had all been screenshotted as permanently absent, and the harness was
   * quietly flattering the app by showing only the half that worked.
   *
   * Two runs a week for the last three, one a week before that — someone
   * ramping their running, which is the shape the balance card exists to catch.
   */
  const conditioning = [];
  const EVERY = 20;
  for (let w = 6; w >= 1; w--) {
    const perWeek = w <= 3 ? 2 : 1;
    for (let n = 0; n < perWeek; n++) {
      const when = now - (w * 7 + 1 + n * 3) * DAY;
      const pts = Array.from({ length: 90 }, (_, i) => {
        const base = 118 + Math.round(28 * Math.sin(i / 9));
        return Math.max(96, Math.min(178, base + (i % 7) * 2));
      });
      // 40 minutes, banked the way conFinish banks it: seconds per zone, and
      // the three summing to the duration.
      conditioning.push({
        id: 'c' + w + '-' + n, fmt: 'steady', effort: 'easy', targetZone: 'low',
        startedAt: when, dur: 2400, zsec: { low: 1500, mod: 780, high: 120 },
        rec: 62, hrr: 26 + (6 - w), trace: { every: EVERY, pts },
      });
    }
  }

  /*
   * The nutrition slice, in its OWN key — `hybrid-nutrition-v1`, never a field
   * on the engine blob. Screenshotting the food log against an empty slice
   * would show the one state a design pass must not be tuned against (see this
   * file's header), and the nutrition screens are mostly numbers: a totals card
   * with no totals and a card with no target is two empty states, not a screen.
   *
   * So: an active program with a target for today, a full day of food across
   * three meals, and eight weeks of near-daily weigh-ins on a slow cut, which
   * is what makes the weight-trend line on Home's card real rather than "no
   * trend yet".
   */
  const UID = 'screens-athlete';
  const stamp = (d) => new Date(d).toISOString();
  const MEALS = [
    ['breakfast', 'Oats, milk and whey', 520, 38, 68, 11],
    ['lunch', 'Chicken, rice and greens', 640, 52, 74, 14],
    ['snack', 'Greek yoghurt and berries', 210, 20, 22, 4],
    ['dinner', 'Salmon, potatoes and salad', 700, 45, 58, 30],
  ];
  const logEntries = MEALS.map(([meal, name, kcal, p, c, f], i) => ({
    id: 'n' + i, userId: UID, logDate: iso(now), meal, entryKind: 'quick_add',
    foodId: null, customFoodId: null, recipeId: null, quantity: 1, unit: 'serving',
    calories: kcal, proteinG: p, carbsG: c, fatG: f, displayName: name,
    nutrients: {}, notes: null, sourceSnapshot: {},
    createdAt: stamp(now - (4 - i) * 3600000), updatedAt: stamp(now - (4 - i) * 3600000), deletedAt: null,
  }));

  // Six weigh-ins a week for eight weeks, drifting down ~0.35 kg/week with the
  // day-to-day noise a real scale has — the noise is the reason the card shows
  // a smoothed trend rather than the last reading.
  const weightEntries = [];
  for (let d = 56; d >= 0; d--) {
    if (d % 7 === 3) continue; // one skipped day a week, as happens
    const when = now - d * DAY;
    weightEntries.push({
      id: 'wt' + d, userId: UID, measuredAt: stamp(when),
      weightKg: Math.round((84.6 - (56 - d) * 0.05 + Math.sin(d / 2) * 0.35) * 10) / 10,
      source: 'manual', note: null, createdAt: stamp(when), updatedAt: stamp(when), deletedAt: null,
    });
  }

  const programStart = iso(now - 56 * DAY);
  const nutrition = {
    schemaVersion: 1,
    logEntries,
    weightEntries,
    program: {
      id: 'prog-1', userId: UID, name: 'Slow cut', mode: 'collaborative', goal: 'lose',
      targetRateKgPerWeek: -0.35, startDate: programStart, endDate: null,
      weeklyCalorieBudget: null, proteinPreference: null, fatPreference: null, status: 'active',
      // A target for today, and for the six days behind it, so paging back
      // through the log does not fall off the end of the program.
      days: Array.from({ length: 7 }, (_, i) => ({
        programId: 'prog-1', targetDate: iso(now - (6 - i) * DAY),
        calories: 2180, proteinG: 165, carbsG: 215, fatG: 62,
        source: 'engine', createdAt: stamp(now - 7 * DAY),
      })),
      createdAt: stamp(now - 56 * DAY), updatedAt: stamp(now - 7 * DAY),
    },
    checkIns: [], dayStatus: [],
    customFoods: [], recipes: [], favorites: [], foodCache: [], settings: {},
  };

  return {
    nutrition,
    db: {
      workouts, sessions,
      settings: {
        // Under settings, which is where every read path looks for it.
        conditioning,
        profile: { age: 30, maxHr: '', restingHr: 48 },
        // Twelve weeks of recovery/strain so the WHOOP trend card has a curve.
        whoopDaily: Array.from({ length: 84 }, (_, i) => ({
          date: iso(now - (83 - i) * DAY),
          recovery: 52 + Math.round(22 * Math.sin(i / 6)) + (i % 5),
          strain: 9 + Math.round(5 * Math.sin(i / 4 + 1)),
        })),
        updatedAt: now,
      },
    },
    /*
     * WHOOP state is never persisted — it is fetched from the Netlify functions
     * on mount. So it cannot be seeded through localStorage; the run intercepts
     * the status endpoint instead. Without this the WHOOP card screenshots in
     * its disconnected state, which hides a card the design pass has to judge.
     */
    whoopStatus: {
      whoop: {
        connected: true,
        lastSyncAt: new Date(now - 3600000).toISOString(),
        normalized: { recoveryScore: 68, restingHr: 48, strain: 12.4, date: iso(now), at: now },
      },
    },
  };
}
