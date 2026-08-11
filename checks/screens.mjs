/*
 * Screenshot every screen of the athlete web app, against a realistically
 * populated database — plus the stage-1 `/coach` routes, added in the
 * coach-workspace redesign (11 August 2026) once a phone layout for the
 * coach bench was approved (see CLAUDE.md's "coach workspace" section).
 *
 * Mostly this is not a test — a screenshot cannot fail except the harness
 * itself, and it exists so a visual change can be judged by looking at it,
 * before and after, instead of by reading a diff and imagining the result.
 * THREE things here fail the run. Horizontal overflow at the 420px phone
 * viewport — a coach screen that needs sideways scrolling on a phone is
 * exactly the regression a phone-support claim must not get to make
 * silently (see `overflowWidth` below). For the coach shots only, a
 * missing piece of that screen's own stable chrome — proof the pillar
 * actually mounted rather than the workspace being stuck on its own
 * "Loading coach workspace…" fallback, which is narrow enough to pass the
 * overflow check clean while showing nothing real (see `assertContent`
 * below).
 *
 * And ANYTHING in `problems` — added 11 August 2026 by the Stage-1
 * whole-branch review, which found the commonest regression of all still
 * exiting 0. There is no error boundary anywhere in this repository
 * (`grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError"
 * apps/web/src` returns nothing), so one uncaught throw in one component
 * unmounts the entire React root and the page goes blank. A blank page has
 * no horizontal overflow, and for a coach shot the per-shot `catch` fired
 * before `assertContent` ever ran — so the run printed the page error under
 * a heading that said "these are real, fix them" and then exited 0. That
 * heading described a list nothing consulted.
 *
 * EVERY producer of `problems` is fatal, not just page errors: an uncaught
 * exception, a console error, and a shot that never completed are all real
 * defects, and a clean tree produces none of them (verified — the list is
 * empty on a green run). Splitting it into a fatal half and an advisory
 * half would rebuild the exact thing being fixed: a bucket that gets
 * printed and ignored. If genuinely benign console noise ever appears, the
 * fix is to silence or stub its source, not to reopen this bucket.
 *
 * The seed matters as much as the harness. An app screenshotted with an empty
 * store shows nothing but empty states, which is the one thing a design pass must
 * NOT be tuned against — every screen looks calm when there is nothing in it.
 * So this seeds eight weeks of plausible training: logged sessions with real
 * set data, conditioning with HR traces, a WHOOP reading, and PR-worthy lifts.
 *
 * The coach routes read the SAME local stores (`useDb()` / `useNutrition()`)
 * as the athlete app — every stage-1 pillar is gated `ClientDetailGate`
 * WITHOUT `layer3Ready`, so it only ever renders the signed-in account's own
 * training (see `ClientDetailGate.tsx`). `CoachAccess` still fails closed in
 * a production build, though, so reaching them needs a second, coach-enabled
 * bundle and a stored Supabase session — the same recipe
 * `checks/react-smoke.mjs` already uses for `/coach/legacy`.
 *
 * Run: node checks/screens.mjs [outDir]     (after `pnpm run build`)
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { launchChromium } from './_chromium.mjs';

const root = resolve(process.cwd(), '.');
const OUT = resolve(root, process.argv[2] || '.screens');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

function serve(port, dir = 'apps/web/dist') {
  const web = resolve(root, dir);
  if (!existsSync(web)) {
    console.error('Build first: pnpm run build');
    process.exit(1);
  }
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = join(web, p);
      if (p === '/' || !existsSync(file)) file = join(web, 'index.html');
      try {
        const buf = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(buf);
      } catch {
        res.writeHead(404).end('nope');
      }
    });
    s.listen(port, () => ok(s));
  });
}

/* ---- the seed ----
   Dates are computed relative to the run so the calendar, the 8-week trend and
   "today's plan" are all populated no matter when this runs. */
function buildSeed() {
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

const SHOTS = [
  // [label, path, waitForText]
  // `/home`, not `/`: the unscoped dashboard build this shoots sends `/` to
  // the coach bench, and Home's own path is the one address that renders the
  // athlete Home screen on every build.
  ['01-home', '/home', null],
  ['02-training', '/training', null],
  ['03-library', '/library', null],
  ['04-conditioning', '/conditioning', null],
  ['05-history', '/history', null],
  ['06-progress', '/progress', null],
  ['07-calendar', '/calendar', null],
  ['08-settings', '/settings', null],
  ['09-planner', '/planner/w1', null],
  ['10-logger', '/log/0/0', null],
  // The third world's web surface. Home (01) carries the nutrition card above
  // it, so the two are judged together.
  ['11-nutrition', '/nutrition', null],
];

/*
 * Stage-1 coach redesign (11 August 2026): the four pillar screens plus the
 * Command Center launcher, at the same 420px phone viewport as every athlete
 * shot above. `/coach/library` and `/coach/settings` are NOT here — they
 * join once their own stage lands and CLAUDE.md's boundary is updated again,
 * per that section's own instruction.
 *
 * The third element is a list of patterns that must ALL match the rendered
 * page's text for the shot to count as real — see `assertContent` below for
 * why this exists and what it deliberately does not check. Every pattern
 * here is STABLE CHROME: a section label, a card heading, a tile name — text
 * that renders unconditionally once the real screen mounts, never a data
 * value. `hrvPoints`/`sleepPoints`/etc. legitimately read "Not enough
 * history yet." against this seed and would on a fresh database too; a
 * pattern that pinned a data value would fail every time the fixture
 * changes, which is how a check like this gets deleted instead of trusted.
 */
/*
 * Case-insensitive throughout (`i` flag): several of these labels sit under
 * CSS `text-transform: uppercase` (e.g. `.rd-section-label`), and Playwright
 * reads `innerText`, which reflects the RENDERED text — the transform, not
 * the source casing. A case-sensitive pattern against "Resting HR" fails
 * the instant the browser paints it as "RESTING HR", which is a false
 * alarm about the check, not a fact about the screen.
 */
const COACH_SHOTS = [
  ['12-coach', '/coach', [/Readiness/i, /Strength/i, /Conditioning/i, /Nutrition/i]],
  ['13-coach-readiness', '/coach/readiness', [/\bHRV\b/i, /Resting HR/i]],
  ['14-coach-strength', '/coach/strength', [/Lift trends/i, /Weekly hard-session budget/i]],
  ['15-coach-conditioning', '/coach/conditioning', [/Time in HR zone/i, /Erg trends/i]],
  ['16-coach-nutrition', '/coach/nutrition', [/Adherence . targets/i, /Weight trend/i]],
  // Stage 3a. The tab labels are chrome the Library always renders; the month
  // heading proves the Calendar tab's grid actually mounted rather than the
  // shell rendering around an empty panel.
  ['17-coach-library', '/coach/library', [/Programs/i, /Calendar/i]],
];

/*
 * The gap this closes: `CoachCommandCenter` renders `aria-busy="true"
 * >Loading coach workspace…</main>` inside `ArcCoachFrame`'s `<Outlet/>`
 * whenever `clientsLoading || !selectedClient` — but the hamburger button
 * this file already waits on (`button[aria-label="Open coach navigation"]`)
 * is `<ArcCoachFrame>`'s own sibling of `<Outlet/>`, rendered
 * unconditionally. So that wait succeeds even when the pillar underneath it
 * never left its loading state — a short, narrow status line that produces
 * no horizontal overflow either. If `listClients()` regressed, or
 * `CoachAccess` failed a different way, this file could report "N/N, 0
 * overflow" against a permanently-loading workspace, on the strength of
 * which CLAUDE.md now asserts phone support as repository policy. This
 * makes that failure visible: every required pattern must match, and the
 * loading fallback's own text must NOT still be on the page.
 */
async function assertContent(page, label, path, patterns) {
  if (!patterns) return [];
  const text = await page.evaluate(() => document.body.innerText || document.body.textContent || '');
  const failures = [];
  const missing = patterns.filter((p) => !p.test(text));
  if (missing.length) {
    failures.push(label + ' (' + path + '): missing ' + missing.map((p) => p.source).join(', '));
  }
  if (/Loading coach workspace/.test(text)) {
    failures.push(label + ' (' + path + '): still showing the Suspense/loading fallback, not the real screen');
  }
  return failures;
}

/*
 * A screen wider than its own viewport is the one thing this file treats as
 * a real failure (see the header comment) — a phone user cannot see content
 * that only reveals itself through a sideways scroll. `scrollWidth` on both
 * `<html>` and `<body>` is checked because either can be the one that grew;
 * `clientWidth` is the viewport's own inner width, unaffected by the
 * overflow itself.
 */
async function overflowWidth(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const w = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
    return w > doc.clientWidth ? w : 0;
  });
}

const PORT = 4519;
const server = await serve(PORT);
const base = 'http://127.0.0.1:' + PORT;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Fatal here, unlike the other checks: a screenshot run with no browser has
// nothing to produce, so skipping would report success and write no images.
const { browser, skip } = await launchChromium();
if (skip) {
  console.error('screenshots need a browser: ' + skip + '.');
  server.close();
  process.exit(1);
}

const seed = buildSeed();

/* Phone-sized, because that is where this app is actually used. deviceScaleFactor
   2 so hairlines and the brass edge survive being looked at. */
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text());
});

/*
 * addInitScript runs before EVERY document load, not just the first. Seeding
 * unconditionally would reset the store on every navigation — which is exactly
 * what a lost session looks like.
 */
await page.addInitScript((s) => {
  if (!localStorage.getItem('hybrid-engine-v1')) {
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(s.db));
  }
  // Its own key, checked independently: the two slices are separate stores and
  // seeding them together under one guard would make a nutrition-only reset
  // look like a training reset.
  if (!localStorage.getItem('hybrid-nutrition-v1')) {
    localStorage.setItem('hybrid-nutrition-v1', JSON.stringify(s.nutrition));
  }
}, seed);

await page.route('**/.netlify/functions/integrations-status*', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seed.whoopStatus) }),
);
// refresh() calls sync() when today's sample looks stale; answer it so the card
// does not screenshot mid-error.
await page.route('**/.netlify/functions/whoop-sync*', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ connected: true, normalized: seed.whoopStatus.whoop.normalized }),
  }),
);

const overflows = [];
/* Counted, not inferred from the arrays' lengths: a shot that threw before
   `screenshot()` leaves no file behind, and the old summary line reported it
   as written anyway ("Wrote 16 screens" while writing 15). */
let written = 0;

for (const [label, path] of SHOTS) {
  try {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350); // let entrance transitions settle
    await page.screenshot({ path: join(OUT, label + '.png'), fullPage: true });
    written += 1;
    const w = await overflowWidth(page);
    if (w) overflows.push(label + ': ' + w + 'px of content in a 420px viewport');
    console.log('  ' + label);
  } catch (e) {
    console.log('  ' + label + ' — FAILED: ' + e.message);
    problems.push(label + ': ' + e.message);
  }
}

server.close();

/*
 * ---- the coach bench ----
 *
 * `CoachAccess` fails closed in a production build (`checks/react-smoke.mjs`
 * explains why, in full, above its own copy of this recipe): with no
 * `VITE_COACH_USER_IDS` and `import.meta.env.DEV` false, `coachAllowed`
 * denies everyone. So the athlete `dist` built above cannot show `/coach` at
 * all — this builds a SECOND bundle, `apps/web/dist-coach`, whose allowlist
 * names one throwaway id, and hands the browser a matching stored Supabase
 * session before the first navigation. `dist-coach` is gitignored, never
 * deployed, and the id is a made-up UUID no real Supabase account can hold.
 *
 * The pillar routes are gated `ClientDetailGate` WITHOUT `layer3Ready`
 * (`ClientDetailGate.tsx`), so they only ever read the SIGNED-IN account's
 * own local stores — the same `hybrid-engine-v1` / `hybrid-nutrition-v1`
 * seed already built above is reused here, seeded into this second page's
 * own origin, so the pillars have real numbers to draw rather than empty
 * states.
 */
const COACH_UID = '00000000-0000-4000-8000-000000000002';
const COACH_DIR = 'apps/web/dist-coach';
const COACH_PORT = 4520;

console.log('\nBuilding a coach-enabled bundle for the phone shots (VITE_COACH_USER_IDS set)…');
execFileSync(
  'pnpm',
  ['--filter', '@hybrid/web', 'exec', 'vite', 'build', '--outDir', 'dist-coach', '--emptyOutDir'],
  { cwd: root, env: { ...process.env, VITE_COACH_USER_IDS: COACH_UID }, stdio: 'inherit' },
);

const coachServer = await serve(COACH_PORT, COACH_DIR);
const coachBase = 'http://127.0.0.1:' + COACH_PORT;
const coachCtx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
const coachPage = await coachCtx.newPage();
coachPage.on('pageerror', (e) => problems.push('coach pageerror: ' + e));
coachPage.on('console', (m) => {
  if (m.type() === 'error') problems.push('coach console: ' + m.text());
});

/*
 * The bench must render from local state alone — every Supabase request is
 * intercepted, exactly as `checks/react-smoke.mjs` does for the same reason.
 * Unlike that check's `/coach/legacy` (which never calls
 * `CoachWorkspaceRepository.listClients()`), the Command Center at `/coach`
 * — and so every pillar reached through it — does, on mount
 * (`CoachWorkspaceContext.tsx`). A blanket `{}` for every request breaks it:
 * `listClients()` awaits `auth.getUser()` then queries
 * `coach_athlete_assignments` expecting a JSON ARRAY back, and a plain `{}`
 * makes `rows.map` throw, which rejects the whole call and leaves
 * `selectedClient` null forever — `CoachCommandCenter` then never leaves its
 * "Loading coach workspace…" state. Two shapes fixes it: the auth check gets
 * a user object, and every REST query gets `[]`, which is a true answer
 * anyway — this throwaway id really does have zero roster assignments — and
 * resolves to just `ENGINE_LOCAL`, the signed-in coach's own entry
 * (`cloud/coach-repository.ts`), exactly like a fresh account with no roster
 * yet would.
 */
await coachPage.route('**/*.supabase.co/**', (r) => {
  const url = r.request().url();
  if (url.includes('/auth/v1/user')) {
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: COACH_UID, aud: 'authenticated', role: 'authenticated', email: 'coach@example.com',
        app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
      }),
    });
  }
  if (url.includes('/rest/v1/')) {
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await coachPage.addInitScript(
  (s) => {
    const expires = Math.floor(Date.now() / 1000) + 86400;
    localStorage.setItem(
      'sb-orysjncrksmdfabpuftd-auth-token',
      JSON.stringify({
        access_token: 'fake.' + btoa(JSON.stringify({ sub: s.uid, exp: expires })) + '.sig',
        token_type: 'bearer',
        expires_in: 86400,
        expires_at: expires,
        refresh_token: 'fake-refresh',
        user: {
          id: s.uid, aud: 'authenticated', role: 'authenticated', email: 'coach@example.com',
          app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
        },
      }),
    );
    if (!localStorage.getItem('hybrid-engine-v1')) {
      localStorage.setItem('hybrid-engine-v1', JSON.stringify(s.db));
    }
    if (!localStorage.getItem('hybrid-nutrition-v1')) {
      localStorage.setItem('hybrid-nutrition-v1', JSON.stringify(s.nutrition));
    }
  },
  { uid: COACH_UID, db: seed.db, nutrition: seed.nutrition },
);

const contentFailures = [];

for (const [label, path, patterns] of COACH_SHOTS) {
  try {
    await coachPage.goto(coachBase + path, { waitUntil: 'networkidle' });
    // The bench is `React.lazy`-loaded as its own chunk (index.tsx's own
    // comment explains why: athlete navigation never fetches it). The FIRST
    // coach navigation shows "Loading coach workspace…" — a real Suspense
    // fallback, not a slow network — for longer than `networkidle` waits, so
    // wait for a piece of the frame that owns every coach route instead of a
    // fixed delay. The hamburger trigger, not the nav list it opens: below
    // ArcCoachFrame's `sm` breakpoint the drawer nav is `invisible` until
    // opened (ArcCoachFrame.tsx), by design — waiting on it would wait
    // forever at 420px. NOTE: this element is `<ArcCoachFrame>`'s own,
    // rendered unconditionally as a sibling of `<Outlet/>` — it existing
    // proves the FRAME mounted, not that the pillar inside it did. That is
    // what `assertContent` below is for.
    await coachPage.waitForSelector('button[aria-label="Open coach navigation"]', { timeout: 15000 });
    await coachPage.waitForTimeout(350); // let entrance transitions settle
    await coachPage.screenshot({ path: join(OUT, label + '.png'), fullPage: true });
    written += 1;
    const w = await overflowWidth(coachPage);
    if (w) overflows.push(label + ': ' + w + 'px of content in a 420px viewport');
    contentFailures.push(...(await assertContent(coachPage, label, path, patterns)));
    console.log('  ' + label);
  } catch (e) {
    console.log('  ' + label + ' — FAILED: ' + e.message);
    problems.push(label + ': ' + e.message);
  }
}

await browser.close();
coachServer.close();

const expected = SHOTS.length + COACH_SHOTS.length;
console.log(
  '\nWrote ' + written + ' of ' + expected + ' screens (' + SHOTS.length + ' athlete, ' +
  COACH_SHOTS.length + ' coach) to ' + OUT,
);
const uniqueProblems = [...new Set(problems)];
if (uniqueProblems.length) {
  console.log('\nFAIL — page errors, console errors or shots that never completed:');
  for (const p of uniqueProblems) console.log('  ' + p);
}
if (overflows.length) {
  console.log('\nFAIL — horizontal overflow at 420px:');
  for (const o of overflows) console.log('  ' + o);
}
if (contentFailures.length) {
  console.log('\nFAIL — coach screen did not render its real content:');
  for (const c of contentFailures) console.log('  ' + c);
}
if (uniqueProblems.length || overflows.length || contentFailures.length || written !== expected) {
  if (written !== expected) console.log('\nFAIL — ' + (expected - written) + ' screen(s) were never captured.');
  process.exit(1);
}
