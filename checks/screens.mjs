/*
 * Screenshot every screen of both web apps, against a realistically populated
 * database.
 *
 * This is not a test — nothing here can fail except the harness itself. It
 * exists so a visual change can be judged by looking at it, before and after,
 * instead of by reading a diff and imagining the result.
 *
 * The seed matters as much as the harness. An app screenshotted with an empty
 * store shows nothing but empty states, which is the one thing a design pass must
 * NOT be tuned against — every screen looks calm when there is nothing in it.
 * So this seeds eight weeks of plausible training: logged sessions with real
 * set data, conditioning with HR traces, a WHOOP reading, and PR-worthy lifts.
 *
 * Run: node checks/screens.mjs [outDir]     (after `pnpm run build`)
 */
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.cwd(), '.');
const OUT = resolve(root, process.argv[2] || '.screens');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

function serve(port) {
  const web = resolve(root, 'apps/web/dist');
  const coach = resolve(root, 'apps/coach/dist');
  if (!existsSync(web) || !existsSync(coach)) {
    console.error('Build first: pnpm run build');
    process.exit(1);
  }
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const isCoach = p === '/coach' || p.startsWith('/coach/');
      const base = isCoach ? coach : web;
      if (isCoach) p = p.replace(/^\/coach\/?/, '/') || '/';
      let file = join(base, p);
      if (p === '/' || !existsSync(file)) file = join(base, 'index.html');
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

  return {
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
  ['01-home', '/', null],
  ['02-training', '/training', null],
  ['03-library', '/library', null],
  ['04-conditioning', '/conditioning', null],
  ['05-history', '/history', null],
  ['06-progress', '/progress', null],
  ['07-calendar', '/calendar', null],
  ['08-settings', '/settings', null],
  ['09-planner', '/planner/w1', null],
  ['10-logger', '/log/0/0', null],
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is required for screenshots.');
  process.exit(1);
}

const PORT = 4519;
const server = await serve(PORT);
const base = 'http://127.0.0.1:' + PORT;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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
  if (localStorage.getItem('hybrid-engine-v1')) return;
  localStorage.setItem('hybrid-engine-v1', JSON.stringify(s.db));
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

for (const [label, path] of SHOTS) {
  try {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350); // let entrance transitions settle
    await page.screenshot({ path: join(OUT, label + '.png'), fullPage: true });
    console.log('  ' + label);
  } catch (e) {
    console.log('  ' + label + ' — FAILED: ' + e.message);
    problems.push(label + ': ' + e.message);
  }
}

/* The coach app is desktop by construction — a 420px shot would only prove it
   does not collapse, which is a known and accepted property. */
const wide = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const cpage = await wide.newPage();
cpage.on('pageerror', (e) => problems.push('coach pageerror: ' + e));
cpage.on('console', (m) => {
  if (m.type() === 'error') problems.push('coach console: ' + m.text());
});
try {
  await cpage.goto(base + '/coach/', { waitUntil: 'networkidle' });
  await cpage.waitForTimeout(400);
  await cpage.screenshot({ path: join(OUT, '20-coach.png'), fullPage: true });
  console.log('  20-coach');
} catch (e) {
  problems.push('coach: ' + e.message);
}

await browser.close();
server.close();

console.log('\nWrote ' + SHOTS.length + ' athlete screens + 1 coach screen to ' + OUT);
if (problems.length) {
  console.log('\nProblems observed while capturing (these are real, fix them):');
  for (const p of [...new Set(problems)]) console.log('  ' + p);
}
