/*
 * React app smoke test.
 *
 * Serves the BUILT output of apps/web and apps/coach and drives them in a real
 * browser. A green `vite build` only proves the modules resolved; this proves
 * the app renders, the guided set flow logs a set, autoregulation moves the
 * next weight, and the coach's session survives the emit contract.
 *
 * Run: node checks/react-smoke.mjs   (from the repo root)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv[2] || '.');
let failures = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log('PASS — ' + name);
  } catch (e) {
    console.log('FAIL — ' + name + ': ' + e.message);
    failures += 1;
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

/** One server, both apps: / is the athlete app, /coach/ is the builder. */
function serve(port) {
  const web = resolve(root, 'apps/web/dist');
  const coach = resolve(root, 'apps/coach/dist');
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const isCoach = p === '/coach' || p.startsWith('/coach/');
      const base = isCoach ? coach : web;
      if (isCoach) p = p.replace(/^\/coach\/?/, '/') || '/';
      let file = join(base, p);
      if (p === '/' || !existsSync(file)) file = join(base, 'index.html'); // SPA fallback
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

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP — react-smoke: playwright not installed.');
  process.exit(0);
}

const PORT = 4317;
const server = await serve(PORT);
const base = 'http://127.0.0.1:' + PORT;

let browser;
try {
  browser = await chromium.launch();
} catch {
  const bundled = '/opt/pw-browsers/chromium';
  if (!existsSync(bundled)) {
    console.log('SKIP — react-smoke: no Chromium.');
    server.close();
    process.exit(0);
  }
  browser = await chromium.launch({ executablePath: bundled });
}

const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/service worker|manifest|favicon|icon-/i.test(m.text())) errors.push(m.text());
});

/* ---------- athlete app ---------- */

// Seed a library workout BEFORE the app boots, so the first render already has
// something to start — mirroring an athlete who already uses the app.
//
// addInitScript runs before EVERY document load, not just the first, so this
// must not clobber what the app has since written. Seeding unconditionally
// resets the store on every reload and navigation, which looks exactly like the
// app losing the athlete's live session.
await page.addInitScript(() => {
  if (localStorage.getItem('hybrid-engine-v1')) return;
  localStorage.setItem(
    'hybrid-engine-v1',
    JSON.stringify({
      workouts: [
        {
          id: 'w1',
          name: 'Lower A',
          days: [0, 1, 2, 3, 4, 5, 6],
          updatedAt: 1,
          blocks: [
            {
              id: 'b1',
              heading: 'Main',
              superset: false,
              exercises: [
                {
                  id: 'e1',
                  name: 'Back Squat',
                  mode: 'reps_kg',
                  rest: 120,
                  cue: 'Prescribed load: 100kg',
                  sets: [
                    { t: 'W10', rpe: '' },
                    { t: '5', rpe: '8' },
                    { t: '5', rpe: '8' },
                  ],
                },
              ],
            },
          ],
        },
      ],
      sessions: [],
      settings: { profile: { age: 30, restingHr: 50 } },
    }),
  );
});

await page.goto(base + '/', { waitUntil: 'networkidle' });

await t('athlete app mounts and renders Home', async () => {
  await page.waitForSelector('h1', { timeout: 5000 });
  const txt = await page.textContent('body');
  assert(/Readiness/.test(txt), 'Readiness card missing');
  assert(/Your zones today/.test(txt), 'zone card missing');
});

await t('zones are computed by Karvonen when a resting HR is known', async () => {
  const txt = await page.textContent('body');
  assert(/Karvonen · resting 50/.test(txt), 'expected Karvonen method line, got: ' + txt.slice(0, 400));
});

await t("today's plan surfaces the seeded workout", async () => {
  const txt = await page.textContent('body');
  assert(/Lower A/.test(txt), 'seeded workout not shown on Home');
});

await t('Training starts a session without one existing beforehand', async () => {
  await page.click('a[href="/training"]');
  await page.waitForSelector('text=Start a session');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.length);
  assert(before === 0, 'a session existed before Start was pressed — phantom session regression');
  await page.click('button:has-text("Start")');
  await page.waitForSelector('text=In progress');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).sessions.length);
  assert(after === 1, 'Start did not create exactly one session, got ' + after);
});

await t('the coach cue reaches the athlete card', async () => {
  const txt = await page.textContent('body');
  assert(/Prescribed load: 100kg/.test(txt), 'ex.cue not rendered on the session list');
});

await t('opening an exercise goes full-screen with no bottom nav', async () => {
  await page.click('button:has-text("Back Squat")');
  await page.waitForURL(/\/log\/0\/0/);
  // Wait for the stage to actually commit before asserting what is NOT on
  // screen — the URL changes before React finishes rendering, so checking too
  // early tests the previous screen.
  await page.waitForSelector('button:has-text("Finish Set")');
  const nav = await page.$('nav[aria-label="Main"]');
  assert(!nav, 'bottom nav is visible on the logger — the stage is meant to be full-screen');
  const txt = await page.textContent('body');
  assert(/Set 1 of 3/.test(txt), 'set tracker missing');
  assert(/warm-up/.test(txt), 'W10 was not recognised as a warm-up');
});

await t('a warm-up does NOT move the working weight', async () => {
  await page.fill('input[aria-label="Weight"]', '40');
  await page.fill('input[aria-label="Reps"]', '10');
  await page.click('button:has-text("Finish Set")');
  await page.click('button:has-text("Confirm Set")');
  const next = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return db.sessions[0].blocks[0].exercises[0].sets[1].aVal;
  });
  assert(!next, 'a warm-up wrote a prescription onto the next set: ' + next);
});

await t('a working set is logged and autoregulation moves the next one', async () => {
  // The warm-up had rest 120, so the stage is mid-rest; skip it.
  const skip = await page.$('button:has-text("Skip Rest")');
  if (skip) await skip.click();
  await page.waitForSelector('text=Set 2 of 3');
  await page.fill('input[aria-label="Weight"]', '100');
  await page.fill('input[aria-label="Reps"]', '5');
  await page.click('button:has-text("Finish Set")');
  // Rate it easy (RPE 6.5 against a target of 8) so the weight must go UP.
  await page.fill('input[aria-label="RPE from 1 to 10"]', '6.5');
  await page.click('button:has-text("Confirm Set")');

  const state = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const sets = db.sessions[0].blocks[0].exercises[0].sets;
    return { logged: sets[1], next: sets[2].aVal };
  });
  assert(state.logged.done === true, 'set 2 not marked done');
  assert(state.logged.aVal === '100' && state.logged.aVal2 === '5', 'values not stored: ' + JSON.stringify(state.logged));
  assert(state.logged.felt === '6.5', 'felt RPE not stored: ' + state.logged.felt);
  // 100 × (1 + (8 − 6.5) × 2.5/100) = 103.75, snapped to the 2.5kg increment:
  // 103.75 / 2.5 = 41.5, and Math.round rounds a half up, so 42 × 2.5 = 105.
  // This is the shipped app's arithmetic exactly — the golden vectors pin all
  // 672 combinations of it.
  assert(state.next === '105', 'expected next set prefilled at 105, got ' + state.next);
});

await t('the rest timer survives a reload', async () => {
  const running = await page.evaluate(() => Number(localStorage.getItem('hybrid-engine-v1-rest-ends')) > Date.now());
  assert(running, 'rest end time was not persisted');
  await page.reload({ waitUntil: 'networkidle' });
  const still = await page.evaluate(() => Number(localStorage.getItem('hybrid-engine-v1-rest-ends')) > Date.now());
  assert(still, 'rest did not survive the reload');
});

await t('a weight of 1e309 cannot poison the record', async () => {
  await page.goto(base + '/log/0/0', { waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Skip Rest"), button:has-text("Finish Set")');
  const skip = await page.$('button:has-text("Skip Rest")');
  if (skip) await skip.click();
  await page.waitForSelector('input[aria-label="Weight"]');
  await page.fill('input[aria-label="Weight"]', '1e309');
  await page.fill('input[aria-label="Reps"]', '3');
  await page.click('button:has-text("Finish Set")');
  await page.click('button:has-text("Confirm Set")');
  const stored = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return db.sessions[0].blocks[0].exercises[0].sets[2].aVal;
  });
  assert(Number.isFinite(Number(stored)), 'a non-finite weight reached storage: ' + stored);
});

await t('finishing a session lands on the recap, with the numbers', async () => {
  await page.goto(base + '/training', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Finish session")');
  await page.waitForURL(/\/recap\//);
  await page.waitForSelector('text=Volume', { timeout: 5000 }).catch(() => {});
  const txt = await page.textContent('body');
  assert(
    /Volume/.test(txt) && /Working sets/.test(txt),
    'recap stats missing at ' + page.url() + ' — body: ' + txt.slice(0, 200),
  );
  // The warm-up must not be counted as a working set.
  assert(!/Working sets[\s\S]{0,40}\b3\b/.test(txt), 'warm-up appears to have been counted as working');
});

await t('History shows the finished work', async () => {
  await page.goto(base + '/history', { waitUntil: 'networkidle' });
  const txt = await page.textContent('body');
  assert(/Lower A/.test(txt), 'finished session missing from History');
});

await t('Progress renders trends without a chart library', async () => {
  await page.goto(base + '/progress', { waitUntil: 'networkidle' });
  const txt = await page.textContent('body');
  assert(/Weekly volume|Top lifts|Not enough logged/.test(txt), 'Progress rendered nothing: ' + txt.slice(0, 200));
});

await t('Calendar marks a trained day differently from a planned one', async () => {
  await page.goto(base + '/calendar', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=trained');
  const trained = await page.$$('[title="trained"]');
  assert(trained.length >= 1, 'the session logged above should mark today as trained');
});

await t('Settings offers cloud sign-in and a WHOOP connect', async () => {
  await page.goto(base + '/settings', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Cloud sync');
  const txt = await page.textContent('body');
  assert(/Sign in/.test(txt), 'no sign-in control');
  assert(/Connect WHOOP/.test(txt), 'no WHOOP connect control');
  // The functions are not served here, so the status call fails. That must
  // degrade to "not connected", never to a broken screen.
  assert(/Karvonen|percent of max/.test(txt), 'zone summary missing after a failed WHOOP status call');
});

/* ---------- importer ---------- */

await t('the importer parses pasted whiteboard shorthand', async () => {
  await page.goto(base + '/import', { waitUntil: 'networkidle' });
  await page.fill('textarea[aria-label="workout text"]', 'Lower B\nA1) Back squat 5x5 @8\nA2) RDL 3x10\nrest 120');
  await page.waitForSelector('text=Lower B');
  const txt = await page.textContent('body');
  assert(/Back squat/.test(txt), 'squat not recognised');
  assert(/Romanian deadlift/.test(txt), 'RDL alias not resolved to its canonical name');
  assert(/superset/.test(txt), 'A1/A2 did not become a superset');
});

await t('an unknown movement asks rather than guessing silently', async () => {
  await page.fill('textarea[aria-label="workout text"]', 'Zercher goodmorning 3x8');
  await page.waitForSelector('text=Not in the library');
});

await t('teaching it a movement sticks', async () => {
  await page.click('button:has-text("Yes — remember it")');
  const learned = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return db.settings.lexicon?.ex || {};
  });
  assert(Object.keys(learned).length >= 1, 'nothing was learned: ' + JSON.stringify(learned));
});

await t('an imported workout saves to the Library', async () => {
  await page.fill('textarea[aria-label="workout text"]', 'Lower B\nBack squat 5x5 @8\nRDL 3x10');
  await page.waitForSelector('button:has-text("Save to Library")');
  await page.click('button:has-text("Save to Library")');
  await page.waitForURL(/\/library/);
  const txt = await page.textContent('body');
  assert(/Lower B/.test(txt), 'imported workout not in the Library');
});

/* ---------- planner ---------- */

await t('the plan editor edits a target and it persists', async () => {
  await page.click('button:has-text("Lower B")');
  await page.click('button:has-text("Edit")');
  await page.waitForURL(/\/planner\//);
  await page.waitForSelector('input[aria-label="target for set 1"]');
  await page.fill('input[aria-label="target for set 1"]', 'W10');
  await page.fill('input[aria-label="target for set 2"]', '3');
  const stored = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    const w = db.workouts.find((x) => x.name === 'Lower B');
    return w.blocks[0].exercises[0].sets.slice(0, 2).map((s) => s.t);
  });
  assert(stored[0] === 'W10' && stored[1] === '3', 'targets not saved: ' + JSON.stringify(stored));
});

await t('a coach-assigned session is read-only in the plan editor', async () => {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.workouts.push({
      id: 'coach:zz', origin: 'coach', assignmentId: 'zz', name: 'Coach Session', updatedAt: 1,
      blocks: [{ id: 'b', heading: 'Main', exercises: [{ id: 'e', name: 'Bench', mode: 'reps_kg', rest: 90, sets: [{ t: '5', rpe: '8' }] }] }],
    });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/planner/coach:zz', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=read-only');
  const ro = await page.getAttribute('input[aria-label="session name"]', 'readonly');
  assert(ro !== null, 'a coach session must not be locally editable');
});

/* ---------- coach app ---------- */

await t('coach builder mounts', async () => {
  await page.goto(base + '/coach/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=THE Hybrid System');
  const txt = await page.textContent('body');
  assert(/Week 1/.test(txt), 'week strip missing');
  assert(/Day 1/.test(txt), 'day pills missing');
});

await t('a session can be authored and validates against the emit contract', async () => {
  const add = await page.$('button:has-text("Add a session")');
  if (add) await add.click();
  await page.waitForSelector('input[aria-label="session name"]');
  await page.fill('input[aria-label="session name"]', 'Coach Day 1');
  // The first exercise card opens by default; type a warm-up and a working set.
  await page.fill('input[aria-label="target for set 1"]', 'W10');
  await page.fill('input[aria-label="target for set 2"]', '5');
  await page.fill('input[aria-label="target RPE for set 2"]', '8');
  // Signed out, publish degrades to validate-only — the coach still learns
  // whether the session would cross the boundary cleanly.
  await page.click('button:has-text("Validate & publish")');
  await page.waitForSelector('text=ready to send');
  const txt = await page.textContent('body');
  assert(!/Could not convert/.test(txt), 'emit contract rejected a valid session: ' + txt.slice(0, 300));
  assert(/Sign in to send this to an athlete/.test(txt), 'signed-out state should explain what is missing');
});

await t('a logger-owned field in the coach library cannot reach an athlete', async () => {
  // Corrupt the stored library directly — the UI cannot produce this shape.
  // The conversion copies only `t` and `rpe`, and the loader rebuilds sets
  // through newSet, so the field is stripped twice over before the contract
  // ever sees it. Publishing must therefore still succeed, with the injected
  // value gone rather than carried.
  await page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('hybrid-coach-v1'));
    lib.programs[0].weeks[0].days[0].blocks[0].ex[0].sets[0].aVal = '999';
    localStorage.setItem('hybrid-coach-v1', JSON.stringify(lib));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Validate & publish")');
  await page.click('button:has-text("Validate & publish")');
  await page.waitForSelector('text=ready to send');

  // The loader rebuilds every set through newSet, so the in-memory model is
  // already clean — but the corrupted blob is still on disk until something
  // writes. Any edit heals it, so make one and check the store.
  //
  // It must be a DIFFERENT value: React suppresses onChange when the value is
  // unchanged, so re-filling the existing text writes nothing and this would
  // silently assert against the stale blob.
  await page.fill('input[aria-label="block name"]', 'Main block');
  const stripped = await page.evaluate(() => {
    const lib = JSON.parse(localStorage.getItem('hybrid-coach-v1'));
    return Object.keys(lib.programs[0].weeks[0].days[0].blocks[0].ex[0].sets[0]).sort();
  });
  assert(
    JSON.stringify(stripped) === JSON.stringify(['rpe', 't']),
    'a planned set must be exactly {t,rpe} after load, got: ' + JSON.stringify(stripped),
  );
});

await t('the superset seam chains two cards into one unit', async () => {
  await page.click('button:has-text("＋ Exercise")');
  await page.click('button[aria-label="chain into a superset"]');
  const split = await page.$('button[aria-label="split the superset here"]');
  assert(split, 'chaining did not turn the seam into a split control');
  const txt = await page.textContent('body');
  assert(/A1/.test(txt) && /A2/.test(txt), 'superset letters should be A1 and A2, got: ' + txt.slice(0, 300));
});

await t('no uncaught page errors across either app', async () => {
  assert(errors.length === 0, errors.join(' | '));
});

await browser.close();
server.close();
console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll React smoke checks passed.');
process.exit(failures ? 1 : 0);
