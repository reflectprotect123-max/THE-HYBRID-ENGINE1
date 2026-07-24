/*
 * Browser smoke test — drives the real app in headless Chromium.
 *
 * Needs the `playwright` package (not a repo dependency, to keep Netlify
 * builds lean): `npm i -D playwright` locally, or point NODE_PATH at an
 * install. Skips cleanly when playwright is unavailable.
 *
 * Serves the repo root on an ephemeral port with a built-in static server,
 * so no other tooling is required. Run: node checks/browser-smoke.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP — browser smoke: playwright is not installed (npm i -D playwright, or set NODE_PATH).');
  process.exit(0);
}

const root = resolve(process.cwd(), process.argv[2] || '.');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(500); res.end(String(error));
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch();
} catch {
  const bundled = '/opt/pw-browsers/chromium';
  if (existsSync(bundled)) browser = await chromium.launch({ executablePath: bundled });
  else { console.log('SKIP — browser smoke: no Chromium available for playwright.'); server.close(); process.exit(0); }
}

const errors = [];
let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/netlify|Failed to load resource|supabase/i.test(m.text())) errors.push('console: ' + m.text());
});
page.on('dialog', (d) => d.accept());

const t = async (name, fn) => {
  try { await fn(); console.log('PASS — ' + name); }
  catch (e) { console.log('FAIL — ' + name + ': ' + e.message); failures += 1; }
};

await page.goto(base + '/', { waitUntil: 'networkidle' });

await t('home renders the mock greeting', async () => {
  const h1 = await page.textContent('#s-home h1');
  if (h1.trim() !== 'Train today') throw new Error('h1=' + h1);
});
await t('week strip: 7 days, Sunday-first, today marked', async () => {
  const days = await page.$$eval('#s-home .wd span', (els) => els.map((e) => e.textContent));
  if (days.length !== 7 || days[0] !== 'S' || days[1] !== 'M') throw new Error(days.join(','));
  if (!(await page.$('#s-home .wd.today'))) throw new Error('no today');
});
await t('a session scheduled for today shows a card on Home', async () => {
  // The app no longer auto-seeds a template — schedule one for today so the
  // logger/builder tests below have a session to drive.
  await page.evaluate(() => {
    const today = ymd(new Date());
    const w = { id: uid(), name: '', days: [], dates: [today], blocks: [
      { id: uid(), heading: 'Warm-up', minutes: '8', format: '', superset: false, exercises: [{ id: uid(), name: '', mode: 'seconds', tempo: '', rest: 0, sets: [{ t: '120', rpe: '' }] }] },
      { id: uid(), heading: 'Warm-up prep', minutes: '', format: 'Superset · 3 rounds', superset: true, exercises: [
        { id: uid(), name: '', mode: 'reps', tempo: '', rest: 0, sets: [{ t: '15', rpe: '' }] },
        { id: uid(), name: '', mode: 'reps', tempo: '', rest: 0, sets: [{ t: '10', rpe: '' }] }] },
      { id: uid(), heading: 'Strength 1', minutes: '15', format: '4 working sets · straight sets', superset: false, exercises: [{ id: uid(), name: '', mode: 'reps_kg', tempo: '', rest: 180, sets: [{ t: '12', rpe: '7' }, { t: '10', rpe: '8' }, { t: '8', rpe: '9' }, { t: '8', rpe: '10' }] }] },
      { id: uid(), heading: 'Strength 2', minutes: '12', format: 'Every 2:30 × 4 sets', superset: false, exercises: [{ id: uid(), name: '', mode: 'reps_kg', tempo: '', rest: 150, sets: [{ t: '10', rpe: '7' }, { t: '10', rpe: '8' }, { t: '10', rpe: '8' }, { t: '10', rpe: '8' }] }] },
      { id: uid(), heading: 'Carry finisher', minutes: '8', format: '3 rounds', superset: false, exercises: [{ id: uid(), name: '', mode: 'seconds', tempo: '', rest: 90, sets: [{ t: '40', rpe: '8' }, { t: '40', rpe: '8' }, { t: '40', rpe: '9' }] }] },
      { id: uid(), heading: 'Cooldown', minutes: '5', format: '', superset: false, exercises: [{ id: uid(), name: '', mode: 'completion', tempo: '', rest: 0, sets: [{ t: '', rpe: '' }] }] }
    ] };
    DB.workouts = [w]; save(); go('home');
  });
  const meta = await page.textContent('#s-home .sessioncard .sc-meta');
  if (!/Warm-up · Warm-up prep · Strength 1 · Strength 2 · Carry finisher · Cooldown/.test(meta)) throw new Error(meta);
});
await t('no readiness card without any data', async () => {
  if (await page.$('#readinessCard')) throw new Error('readiness card rendered with no data');
});
await t('tapping a week day opens History (empty state)', async () => {
  await page.click('#s-home .wd.today');
  await page.waitForSelector('#s-history.on', { timeout: 2000 });
  const body = await page.textContent('#s-history');
  if (!/No training logged this day/.test(body)) throw new Error('unexpected: ' + body.slice(0, 80));
  await page.click('#s-history .backbtn');
});
await t('session card opens the Training day view', async () => {
  await page.click('#s-home .sessioncard');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  const secs = await page.$$eval('#s-training .lgsec', (els) => els.map((e) => e.textContent));
  if (!/^Warm-up/.test(secs[0] || '') || !secs.some((x) => /Strength 1/.test(x))) throw new Error(secs.join(','));
});
await t('superset block is labeled "flows on" (auto-advance chain)', async () => {
  const label = await page.textContent('#s-training .lgsec .lgss');
  if (!/flows on/.test(label)) throw new Error(label);
});
await t('logger accordion opens on a strength row with prescribed rest', async () => {
  const rows = await page.$$('#s-training .lgcrow');
  let clicked = false;
  for (const row of rows) {
    const txt = await row.textContent();
    if (/rest/.test(txt) && /RPE|reps/.test(txt)) { await row.click(); clicked = true; break; }
  }
  if (!clicked) throw new Error('no row with prescribed rest');
  await page.waitForSelector('#s-training .lgx.open', { timeout: 2000 });
  const head = await page.$$eval('#s-training .lgx.open .lgth', (els) => els.map((e) => e.textContent));
  if (!head.includes('KG') || !head.includes('Target')) throw new Error(head.join(','));
});
await t('logging a set autosaves and starts the rest chip', async () => {
  const inputs = await page.$$('#s-training .lgx.open .lgrow input');
  await inputs[0].fill('60'); await inputs[1].fill('12'); await inputs[2].fill('8');
  await page.click('#s-training .lgx.open .lgrow .lgtick');
  await page.waitForSelector('#restchip.show', { timeout: 2000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')));
  const ok = saved.sessions.some((s) => s.blocks.some((b) => b.exercises.some((e) => e.sets.some((st) => st.done && st.aVal === '60' && st.felt === '8'))));
  if (!ok) throw new Error('set not persisted');
});
await t('no add/remove-set steppers in the logger (mock-exact)', async () => {
  if (await page.$('#s-training .bsteprow')) throw new Error('stepper present');
});
await t('rest timer survives a full page reload', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#restchip.show', { timeout: 3000 });
});
await t('rest chip tap-to-stop clears persistence', async () => {
  await page.click('#restchip');
  const shown = await page.$eval('#restchip', (el) => el.classList.contains('show'));
  if (shown) throw new Error('chip still shown');
  const stored = await page.evaluate(() => localStorage.getItem('hybrid-engine-v1-rest-ends'));
  if (stored) throw new Error('rest key not cleared');
});
await t('finish session → recap shows, Done → home, history recorded', async () => {
  await page.click('#s-home .sessioncard, .navlink[data-s="training"]');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  await page.click('#s-training .completebar .bigbtn');
  await page.waitForSelector('#s-recap.on', { timeout: 4000 });
  const recap = await page.textContent('#s-recap');
  if (!/Session complete/.test(recap)) throw new Error('recap missing header');
  if (!/kg volume/.test(recap) || !/sets done/.test(recap)) throw new Error('recap missing stats');
  await page.click('#s-recap .completebar .bigbtn');
  await page.waitForSelector('#s-home.on', { timeout: 2000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')));
  if (!saved.sessions.some((s) => s.status === 'completed')) throw new Error('no completed session');
  if (!(await page.$('#s-home .wd.has'))) throw new Error('week strip lacks .has');
  if (await page.$('#readinessCard')) throw new Error('readiness visible without tapping the WHOOP card');
});
await t('PR engine: epley math, detection on finish, exercise history + top lifts', async () => {
  const r = await page.evaluate(() => {
    const out = {};
    // seed one past session with a 100x5 best (e1 ~116.7)
    const past = { id: uid(), workoutId: 'x', name: 'Seed', date: ymd(new Date(Date.now() - 3 * 864e5)), status: 'completed',
      completedAt: Date.now() - 3 * 864e5, startedAt: Date.now() - 3 * 864e5 - 3600e3,
      blocks: [{ id: uid(), heading: 'Main', exercises: [{ id: uid(), name: 'Test squat', mode: 'reps_kg', rest: 90,
        sets: [{ t: '5', rpe: '8', aVal: '100', aVal2: '5', felt: '8', done: true }] }] }] };
    DB.sessions.push(past); save();
    out.epley = Math.round(epley(100, 5) * 10) / 10;
    out.best = exBest('Test squat') ? Math.round(exBest('Test squat').e1 * 10) / 10 : null;
    // a finishing session that beats it: 105x5 (e1 ~122.5)
    const s = { id: uid(), workoutId: 'x', name: 'Now', date: ymd(new Date()), status: 'active', startedAt: Date.now(),
      blocks: [{ id: uid(), heading: 'Main', exercises: [{ id: uid(), name: 'Test squat', mode: 'reps_kg', rest: 90,
        sets: [{ t: '5', rpe: '8', aVal: '105', aVal2: '5', felt: '9', done: true }] }] }] };
    const prs = detectPRs(s);
    out.prCount = prs.length; out.prName = prs[0] && prs[0].name;
    out.hist = exLogFor('Test squat').length;
    out.topLifts = progTopLifts().includes('Test squat');
    DB.sessions = DB.sessions.filter(x => x.name !== 'Seed'); save();
    return out;
  });
  if (r.epley !== 116.7) throw new Error('epley wrong: ' + r.epley);
  if (r.best !== 116.7) throw new Error('exBest wrong: ' + r.best);
  if (r.prCount !== 1 || r.prName !== 'Test squat') throw new Error('PR not detected: ' + JSON.stringify(r));
  if (r.hist < 1) throw new Error('exLogFor empty');
  if (!r.topLifts) throw new Error('top lifts card missing the movement');
});
await t('tapping the WHOOP card reveals readiness; tapping again hides it', async () => {
  await page.click('#whoopCard');
  await page.waitForSelector('#readinessCard', { timeout: 2000 });
  const txt = await page.textContent('#readinessCard');
  if (!/RPE/.test(txt)) throw new Error('readiness has no RPE info: ' + txt);
  await page.click('#whoopCard');
  if (await page.$('#readinessCard')) throw new Error('readiness still visible after collapse');
});
await t('WHOOP card renders the dual ring (strain outer, recovery inner)', async () => {
  const rings = await page.$('#whoopCard .ringx .ringx-in');
  if (!rings) throw new Error('dual ring structure missing');
});
await t('History shows the logged set', async () => {
  await page.click('#s-home .wd.today');
  await page.waitForSelector('#s-history.on', { timeout: 2000 });
  const body = await page.textContent('#s-history');
  if (!/60kg × 12/.test(body)) throw new Error('logged set missing: ' + body.slice(0, 200));
  await page.click('#s-history .backbtn');
});
await t('logger prefills last kg as placeholder next time', async () => {
  await page.click('#s-home .sessioncard');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  const rows = await page.$$('#s-training .lgcrow');
  for (const row of rows) {
    if (/rest 3:00/.test(await row.textContent())) { await row.click(); break; }
  }
  await page.waitForSelector('#s-training .lgx.open', { timeout: 2000 });
  const ph = await page.$eval('#s-training .lgx.open .lgrow input', (el) => el.placeholder);
  if (ph !== '60') throw new Error('placeholder=' + ph);
});
await t('builder: uniform sets collapse to one "All sets" row', async () => {
  await page.evaluate(() => { BUILDER_WID = null; go('builder'); });
  await page.waitForSelector('#s-builder.on', { timeout: 2000 });
  await page.click('#s-builder .bblock:nth-of-type(4) .bexp');
  await page.waitForSelector('#s-builder .bblock:nth-of-type(4) .bex', { timeout: 2000 });
  await page.click('#s-builder .bblock:nth-of-type(4) .addbtn.small');
  const block = await page.$('#s-builder .bblock:nth-of-type(4)');
  const txt = await block.textContent();
  if (!/All sets/.test(txt)) throw new Error('no All sets row on fresh exercise');
});
await t('builder: "vary per set" expands to per-set rows', async () => {
  const block = await page.$('#s-builder .bblock:nth-of-type(4)');
  const vary = (await block.$$('.markall')).at(-1);
  const label = await vary.textContent();
  if (!/vary per set/.test(label)) throw new Error('toggle label=' + label);
  await vary.click();
  const rows = await page.$$eval('#s-builder .bblock:nth-of-type(4) .bex:last-of-type .bsetrow', (els) => els.length);
  if (rows < 3) throw new Error('rows=' + rows);
});
await t('builder: Max reps mode targets every set at max', async () => {
  await page.selectOption('#s-builder .bblock:nth-of-type(4) .bex:last-of-type select', 'amrap');
  const txt = await page.textContent('#s-builder .bblock:nth-of-type(4) .bex:last-of-type');
  if (!/max reps/.test(txt)) throw new Error('no max-reps target cells');
  const rx = await page.textContent('#s-builder .bblock:nth-of-type(4) .bex:last-of-type .rxline');
  if (!/× max/.test(rx)) throw new Error('rx=' + rx);
});
await t('builder: typing "max" as a single set target works', async () => {
  await page.selectOption('#s-builder .bblock:nth-of-type(4) .bex:last-of-type select', 'reps_kg');
  const input = await page.$('#s-builder .bblock:nth-of-type(4) .bex:last-of-type .bsetrow input');
  await input.fill('max');
  const rx = await page.textContent('#s-builder .bblock:nth-of-type(4) .bex:last-of-type .rxline');
  if (!/max/.test(rx)) throw new Error('rx=' + rx);
});
await t('builder: tempo/rest hidden behind disclosure when unused', async () => {
  await page.click('#s-builder .bblock:nth-of-type(1) .bexp');
  await page.waitForSelector('#s-builder .bblock:nth-of-type(1) .bex', { timeout: 2000 });
  const txt = await page.textContent('#s-builder .bblock:nth-of-type(1) .bex');
  if (!/\+ tempo · rest/.test(txt)) throw new Error('disclosure link missing (warm-up has rest 0)');
});
await t('builder: day chips schedule the workout', async () => {
  const todayIdx = await page.evaluate(() => new Date().getDay());
  await page.click(`#s-builder .daychip:nth-of-type(${todayIdx + 1})`);
  const on = await page.$eval(`#s-builder .daychip:nth-of-type(${todayIdx + 1})`, (el) => el.classList.contains('on'));
  if (!on) throw new Error('chip did not toggle');
  await page.click('#s-builder .completebar .bigbtn');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  await page.click('.navlink[data-s="home"]');
  const sub = await page.textContent('#s-home .sub');
  if (!/session in progress|session planned/i.test(sub)) throw new Error('sub=' + sub);
});
await t('nav is three tabs: Home · Training · Library', async () => {
  const navs = await page.$$eval('.navlink', (els) => els.map((e) => e.dataset.s));
  if (navs.length !== 3 || navs.includes('logger')) throw new Error(navs.join(','));
  if (navs.join(',') !== 'home,training,library') throw new Error('unexpected tabs: ' + navs.join(','));
});
await t('Calendar: month grid, schedule a future day, planned dot shows', async () => {
  await page.evaluate(() => { CAL_VIEW = null; go('calendar'); });
  await page.waitForSelector('#s-calendar.on', { timeout: 2000 });
  const cells = await page.$$eval('#s-calendar .calcell:not(.blank)', (els) => els.length);
  if (cells < 28) throw new Error('month grid too small: ' + cells);
  if (!(await page.$('#s-calendar .calcell.today'))) throw new Error('today not marked');
  // schedule the seeded session on a future day (7 days out) and confirm a planned dot appears
  const result = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); const key = ymd(d);
    const w = DB.workouts[0];
    scheduleWorkoutOn(w.id, key);
    renderCalendar();
    return { key, planned: (w.dates || []).includes(key) };
  });
  if (!result.planned) throw new Error('future date not stored on workout');
  const plannedDots = await page.$$eval('#s-calendar .cd.plan', (els) => els.length);
  if (plannedDots < 1) throw new Error('no planned dot rendered');
  // unschedule via the day sheet, back to clean
  await page.evaluate((key) => { calDay(key); }, result.key);
  await page.waitForSelector('#sheet .sheet', { timeout: 2000 });
  await page.evaluate((key) => { calUnschedule(DB.workouts[0].id, key); }, result.key);
  const stillPlanned = await page.evaluate((key) => (DB.workouts[0].dates || []).includes(key), result.key);
  if (stillPlanned) throw new Error('unschedule did not remove the date');
  await page.evaluate(() => go('home'));
});
await t('scheduling: one-off-today CTA starts the session (not the builder)', async () => {
  await page.evaluate(() => {
    const today = ymd(new Date());
    DB.sessions = DB.sessions.filter((s) => s.status !== 'active');
    DB.workouts = [{ id: uid(), name: 'One-off today', days: [], dates: [today],
      blocks: [{ id: uid(), heading: 'Main', superset: false, exercises: [{ id: uid(), name: 'Row', mode: 'reps_kg', rest: 60, sets: [{ t: '5', rpe: '8' }] }] }] }];
    CUR_SESSION = null; save(); go('home');
  });
  await page.click('#s-home .homecta');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  const started = await page.evaluate(() => { const s = curSession(); return !!(s && s.status === 'active' && s.name === 'One-off today'); });
  if (!started) throw new Error('one-off-today CTA did not start the session');
});
await t('scheduling: a future-dated Create Session does NOT start a today session', async () => {
  const res = await page.evaluate(() => {
    DB.sessions = DB.sessions.filter((s) => s.status !== 'active'); CUR_SESSION = null; save();
    const fut = new Date(); fut.setDate(fut.getDate() + 6); const key = ymd(fut);
    SCHED_DATE = key; createKind('strength');           // builds a blank workout dated in the future, opens builder
    WK.name = 'Next week lower'; WK.blocks[0].exercises[0].name = 'Squat';
    previewWorkout();                                    // "See how it looks"
    const active = DB.sessions.filter((s) => s.status === 'active').length;
    const saved = DB.workouts.find((w) => w.name === 'Next week lower');
    return { screen: CURRENT, active, scheduled: !!(saved && (saved.dates || []).includes(key)) };
  });
  if (res.active !== 0) throw new Error('future Create Session wrongly started a today session');
  if (!res.scheduled) throw new Error('future session not saved with its date');
  if (res.screen !== 'calendar') throw new Error('did not land on the calendar; screen=' + res.screen);
});
await t('scheduling: cancelling the add sheet clears the pending date', async () => {
  const leaked = await page.evaluate(() => {
    const fut = new Date(); fut.setDate(fut.getDate() + 4);
    SCHED_DATE = ymd(fut); openAddSheet(); closeSheet();
    return SCHED_DATE;
  });
  if (leaked !== null) throw new Error('SCHED_DATE leaked after cancel: ' + leaked);
  // restore the standard seeded session so the Library/logger tests below have data
  await page.evaluate(() => {
    const today = ymd(new Date());
    DB.sessions = []; CUR_SESSION = null;
    DB.workouts = [{ id: uid(), name: '', days: [], dates: [today], blocks: [
      { id: uid(), heading: 'Warm-up', minutes: '8', format: '', superset: false, exercises: [{ id: uid(), name: '', mode: 'seconds', tempo: '', rest: 0, sets: [{ t: '120', rpe: '' }] }] },
      { id: uid(), heading: 'Warm-up prep', minutes: '', format: 'Superset · 3 rounds', superset: true, exercises: [
        { id: uid(), name: '', mode: 'reps', tempo: '', rest: 0, sets: [{ t: '15', rpe: '' }] },
        { id: uid(), name: '', mode: 'reps', tempo: '', rest: 0, sets: [{ t: '10', rpe: '' }] }] },
      { id: uid(), heading: 'Strength 1', minutes: '15', format: '4 working sets · straight sets', superset: false, exercises: [{ id: uid(), name: '', mode: 'reps_kg', tempo: '', rest: 180, sets: [{ t: '12', rpe: '7' }, { t: '10', rpe: '8' }, { t: '8', rpe: '9' }, { t: '8', rpe: '10' }] }] },
      { id: uid(), heading: 'Strength 2', minutes: '12', format: 'Every 2:30 × 4 sets', superset: false, exercises: [{ id: uid(), name: '', mode: 'reps_kg', tempo: '', rest: 150, sets: [{ t: '10', rpe: '7' }, { t: '10', rpe: '8' }, { t: '10', rpe: '8' }, { t: '10', rpe: '8' }] }] },
      { id: uid(), heading: 'Carry finisher', minutes: '8', format: '3 rounds', superset: false, exercises: [{ id: uid(), name: '', mode: 'seconds', tempo: '', rest: 90, sets: [{ t: '40', rpe: '8' }, { t: '40', rpe: '8' }, { t: '40', rpe: '9' }] }] },
      { id: uid(), heading: 'Cooldown', minutes: '5', format: '', superset: false, exercises: [{ id: uid(), name: '', mode: 'completion', tempo: '', rest: 0, sets: [{ t: '', rpe: '' }] }] }
    ] }];
    save(); go('home');
  });
});
await t('Library: LIBRARY screen with Sessions/Conditioning/Progress tabs + Create card', async () => {
  await page.click('.navlink[data-s="library"]');
  await page.waitForSelector('#s-library.on', { timeout: 2000 });
  const html = await page.$eval('#s-library', (el) => el.innerHTML);
  if (!/LIBRARY/.test(html)) throw new Error('LIBRARY title missing');
  const tabs = await page.$$eval('#s-library .libtab', (els) => els.map((e) => e.textContent));
  if (tabs.join(',') !== 'Sessions,Conditioning,Progress') throw new Error('lib tabs: ' + tabs.join(','));
  if (!/Create Session Template/.test(html)) throw new Error('create card missing');
  if (!(await page.$('#s-library .tplrow'))) throw new Error('no template row for the seeded session');
  const active = await page.$eval('.navlink[data-s="library"]', (el) => el.classList.contains('active'));
  if (!active) throw new Error('Library tab not highlighted');
});
await t('Conditioning: setup shows zones; demo session records live HR and saves results', async () => {
  await page.evaluate(() => libGo('conditioning'));
  await page.waitForSelector('#s-conditioning.on', { timeout: 2000 });
  let html = await page.$eval('#s-conditioning', (el) => el.innerHTML);
  if (!/Zone session/.test(html) || !/Conditioning/.test(html)) throw new Error('setup missing zones');
  // HR-zone engine: Tanaka max, blue/green/red bands, HRR when resting known
  const zn = await page.evaluate(() => {
    DB.settings.profile = { age: 30 }; save();
    const a = conZones();
    DB.settings.profile = { age: 30, restingHr: 50 }; save();
    const b = conZones();
    DB.settings.profile = {}; save();
    return { a, b };
  });
  if (zn.a.max !== Math.round(208 - 0.7 * 30)) throw new Error('max HR not Tanaka: ' + zn.a.max);
  if (zn.a.method !== 'pctmax') throw new Error('expected %max fallback with no resting HR');
  if (zn.b.method !== 'hrr') throw new Error('expected HRR method when resting HR set');
  const keys = zn.a.list.map((z) => z.name).join(',');
  if (keys !== 'Recovery,Conditioning,Overload') throw new Error('zone names wrong: ' + keys);
  if (zn.a.list[1].color !== '#33c07a') throw new Error('conditioning zone not green');
  // start the simulated-HR demo (no Bluetooth in CI), let it tick a few seconds
  await page.evaluate(() => conStartDemo());
  await page.waitForFunction(() => CON.live && CON.samples.length >= 2, null, { timeout: 8000 });
  const bpm = await page.textContent('#conBpm');
  if (!/^\d+$/.test(bpm.trim())) throw new Error('live BPM not painting: ' + bpm);
  const seg = await page.$eval('#conLiveSeg', (g) => g.innerHTML.length);
  if (!seg) throw new Error('live HR line not drawing');
  // finish → results persisted with donut + zone times
  await page.evaluate(() => conFinish());
  await page.waitForFunction(() => CON.view === 'results', null, { timeout: 2000 });
  html = await page.$eval('#s-conditioning', (el) => el.innerHTML);
  if (!/Session complete/.test(html) || !/hr recovery/i.test(html)) throw new Error('results missing');
  const saved = await page.evaluate(() => (DB.settings.conditioning || []).length);
  if (!saved) throw new Error('session not persisted');
  // clean up so later steps see pristine state
  await page.evaluate(() => { DB.settings.conditioning = []; save(); conDone(); go('home'); });
});
await t('hybrid session: strength + conditioning blocks run and persist in one workout', async () => {
  await page.evaluate(() => {
    WK = templateWorkout(); WK.name = 'Hybrid Day';
    WK.blocks = [
      { id: uid(), heading: 'Strength', minutes: '', format: '', superset: false,
        exercises: [{ id: uid(), name: 'Back squat', mode: 'reps_kg', tempo: '', rest: 60, sets: [{ t: '5', rpe: '8' }] }] },
      newCondBlock()
    ];
    WK.blocks[1].condFmt = 'intervals';
    BUILDER_WID = WK.id; EDIT_EXISTING = false; openBlock = -1;
    previewWorkout();
  });
  let html = await page.$eval('#s-training', (el) => el.innerHTML);
  if (!/condrow/.test(html)) throw new Error('conditioning row missing in the session');
  // open the conditioning block from the session and run the demo
  await page.evaluate(() => {
    const s = curSession();
    const bi = s.blocks.findIndex((b) => b.kind === 'conditioning');
    conRunBlock(bi);
    conStartDemo();
  });
  await page.waitForFunction(() => CON.live && CON.samples.length >= 2, null, { timeout: 8000 });
  if (await page.evaluate(() => CON.sink.scope) !== 'session') throw new Error('sink not session-scoped during run');
  await page.evaluate(() => conFinish());
  const state = await page.evaluate(() => {
    const s = curSession();
    const b = s.blocks.find((x) => x.kind === 'conditioning');
    return { hasResult: !!(b && b.condResult), standalone: (DB.settings.conditioning || []).length };
  });
  if (!state.hasResult) throw new Error('condResult not stored on the block');
  if (state.standalone !== 0) throw new Error('session run leaked into standalone history');
  // finish the whole session; the union read must surface the conditioning result
  await page.evaluate(() => { const s = curSession(); s.status = 'completed'; s.completedAt = Date.now(); CUR_SESSION = null; CON.sink = { scope: 'standalone' }; save(); });
  const union = await page.evaluate(() => allCondRecords().length);
  if (union < 1) throw new Error('completed hybrid conditioning missing from union read');
  // clean up
  await page.evaluate(() => {
    DB.sessions = DB.sessions.filter((s) => s.name !== 'Hybrid Day');
    DB.workouts = DB.workouts.filter((w) => w.name !== 'Hybrid Day');
    CUR_SESSION = null; WK = templateWorkout(); BUILDER_WID = null; save(); go('home');
  });
});
await t('interval progression: level-0 base unchanged; adaptation steps up; red recovery deloads today only', async () => {
  const r = await page.evaluate(() => {
    const out = {};
    DB.settings.conProgress = {}; WHOOP.sample = null; save();
    // level 0 must equal the base session exactly
    const p0 = conPrescription('intervals');
    out.base = [p0.rounds, p0.work, p0.rest, conPrescDesc('intervals', p0)];
    // a level-3 profile rotates the levers: +round, +work, -rest
    DB.settings.conProgress = { intervals: { level: 3 } }; save();
    const p3 = conPrescription('intervals');
    out.lvl3 = [p3.rounds, p3.work, p3.rest];
    // adaptation: strong on-target session on a green day steps the level up
    DB.settings.conProgress = {}; WHOOP.sample = { recoveryScore: 85 }; save();
    const delta = conAdapt({ id: 'a1', fmt: 'intervals', dur: 600, zsec: { low: 100, mod: 300, high: 50 }, hrr: 20 });
    out.delta = delta; out.levelAfter = conProgLevel('intervals');
    // red-recovery day deloads TODAY without touching the earned baseline
    DB.settings.conProgress = { intervals: { level: 2 } }; WHOOP.sample = { recoveryScore: 30 }; save();
    const earned = conPrescription('intervals', true), served = conPrescription('intervals');
    out.earnedRounds = earned.rounds; out.servedRounds = served.rounds;
    out.servedAdj = served.dailyAdj; out.levelStill = conProgLevel('intervals');
    DB.settings.conProgress = {}; WHOOP.sample = null; save();
    return out;
  });
  if (r.base[0] !== 8 || r.base[1] !== 30 || r.base[2] !== 90) throw new Error('level-0 not base 8/30/90: ' + r.base);
  if (r.base[3] !== '8×30s / 90s') throw new Error('base desc wrong: ' + r.base[3]);
  if (r.lvl3[0] !== 9 || r.lvl3[1] !== 35 || r.lvl3[2] !== 85) throw new Error('level-3 levers wrong: ' + r.lvl3);
  if (r.delta !== 1 || r.levelAfter !== 1) throw new Error('adaptation did not step up: ' + JSON.stringify(r));
  if (!(r.servedRounds < r.earnedRounds) || r.servedAdj !== -1) throw new Error('red day did not deload today: ' + JSON.stringify(r));
  if (r.levelStill !== 2) throw new Error('red day changed the earned baseline: ' + r.levelStill);
});
await t('sanitizeDB keeps conditioning blocks exercise-less (no phantom exercise)', async () => {
  const r = await page.evaluate(() => {
    const raw = { workouts: [{ id: 'w', name: 'x', blocks: [{ id: 's', heading: 'S', exercises: [{ name: 'Squat', mode: 'reps_kg', sets: [{ t: '5' }] }] }, { id: 'c', kind: 'conditioning', condFmt: 'intervals', targetZone: 'mod' }] }], sessions: [], settings: {} };
    const clean = sanitizeDB(raw);
    const b = clean.workouts[0].blocks;
    return { strengthHasEx: Array.isArray(b[0].exercises) && b[0].exercises.length === 1, condHasNoEx: !b[1].exercises, condKind: b[1].kind };
  });
  if (!r.strengthHasEx) throw new Error('strength block lost its exercise');
  if (!r.condHasNoEx) throw new Error('phantom exercise injected into conditioning block');
  if (r.condKind !== 'conditioning') throw new Error('conditioning kind not preserved');
});
await t('cloud: settings changes are in the sync fingerprint; mergeSettings never loses additive data', async () => {
  const r = await page.evaluate(() => {
    const A = { workouts: [], sessions: [] };
    const base = cloudFp(Object.assign({}, A, { settings: { conProgress: { intervals: { level: 1 } } } }));
    const bumped = cloudFp(Object.assign({}, A, { settings: { conProgress: { intervals: { level: 2 } } } }));
    const whoopOnly = cloudFp(Object.assign({}, A, { settings: { conProgress: { intervals: { level: 1 } }, whoopDaily: [{ x: Math.random() }] } }));
    const baseNoWhoop = cloudFp(Object.assign({}, A, { settings: { conProgress: { intervals: { level: 1 } } } }));
    const merged = mergeSettings(
      { conProgress: { intervals: { level: 5 } }, conditioning: [{ id: 'a', startedAt: 1 }], lexicon: { kw: { emom: 'x' }, ex: {} } },
      { conProgress: { intervals: { level: 2 } }, conditioning: [{ id: 'b', startedAt: 2 }], lexicon: { kw: { amrap: 'y' }, ex: {} } }
    );
    return {
      settingsInFp: base !== bumped,
      whoopExcluded: whoopOnly === baseNoWhoop,
      levelMax: merged.conProgress.intervals.level,
      condIds: merged.conditioning.map((c) => c.id).sort().join(','),
      lexKeys: Object.keys(merged.lexicon.kw).sort().join(','),
    };
  });
  if (!r.settingsInFp) throw new Error('settings change not reflected in cloud fingerprint (would not sync)');
  if (!r.whoopExcluded) throw new Error('whoopDaily should be excluded from the fingerprint');
  if (r.levelMax !== 5) throw new Error('mergeSettings regressed progression level: ' + r.levelMax);
  if (r.condIds !== 'a,b') throw new Error('mergeSettings lost conditioning history: ' + r.condIds);
  if (r.lexKeys !== 'amrap,emom') throw new Error('mergeSettings lost learned lexicon: ' + r.lexKeys);
});
await t('cloud: record-level merge unions two-device scheduling, honours tombstones, device excluded from fp', async () => {
  const r = await page.evaluate(() => {
    // two devices scheduled the SAME workout on different days between syncs
    const local = { workouts: [{ id: 'w1', name: 'Lower', days: [1], dates: ['2026-08-03'], updatedAt: 100 }], sessions: [{ id: 's1', workoutId: 'w1', status: 'completed', completedAt: 10, blocks: [] }], settings: {} };
    const remote = { workouts: [{ id: 'w1', name: 'Lower', days: [4], dates: ['2026-08-05'], updatedAt: 90 }, { id: 'w2', name: 'Upper', days: [], dates: ['2026-08-06'], updatedAt: 50 }], sessions: [{ id: 's2', workoutId: 'w2', status: 'completed', completedAt: 20, blocks: [] }], settings: {} };
    const m = mergeEngines(local, remote);
    const w1 = m.workouts.find((w) => w.id === 'w1');
    const out = {
      keptBothWorkouts: m.workouts.map((w) => w.id).sort().join(','),
      unionedDates: (w1.dates || []).slice().sort().join(','),
      unionedDays: (w1.days || []).slice().sort().join(','),
      keptBothSessions: m.sessions.map((s) => s.id).sort().join(','),
    };
    // tombstone must win over a remote copy that still has the record
    const t = mergeEngines(
      { workouts: [], sessions: [], settings: { deletedIds: { w2: 999 } } },
      remote
    );
    out.tombstonedGone = !t.workouts.some((w) => w.id === 'w2');
    // devices registry must NOT be in the fingerprint (else hourly stamps churn sync)
    const A = { workouts: [], sessions: [] };
    out.devExcluded = cloudFp(Object.assign({}, A, { settings: { devices: { d1: { seen: 1 } } } })) === cloudFp(Object.assign({}, A, { settings: {} }));
    // ...but a deletion SHOULD change the fingerprint so it propagates
    out.tombInFp = cloudFp(Object.assign({}, A, { settings: { deletedIds: { x: 1 } } })) !== cloudFp(Object.assign({}, A, { settings: {} }));
    return out;
  });
  if (r.keptBothWorkouts !== 'w1,w2') throw new Error('merge dropped a workout: ' + r.keptBothWorkouts);
  if (r.unionedDates !== '2026-08-03,2026-08-05') throw new Error('two-device scheduling lost a date: ' + r.unionedDates);
  if (r.unionedDays !== '1,4') throw new Error('recurring days not unioned: ' + r.unionedDays);
  if (r.keptBothSessions !== 's1,s2') throw new Error('merge dropped a logged session: ' + r.keptBothSessions);
  if (!r.tombstonedGone) throw new Error('tombstone did not suppress a deleted workout (would resurrect)');
  if (!r.devExcluded) throw new Error('devices registry leaked into the sync fingerprint (would churn)');
  if (!r.tombInFp) throw new Error('a deletion is not in the fingerprint (would not propagate)');
});
await t('weekly zone targets: defaults + this-week banked minutes', async () => {
  const r = await page.evaluate(() => {
    DB.settings.zoneTargets = undefined; DB.settings.conditioning = [];
    const t = zoneTargets();
    const now = Date.now();
    DB.settings.conditioning = [{ id: 'z1', sim: false, startedAt: now, date: ymd(new Date()), zsec: { low: 600, mod: 900, high: 120 } }];
    save();
    const w = thisWeekZoneMin();
    DB.settings.conditioning = []; save();
    return { t, w };
  });
  if (r.t.low !== 60 || r.t.mod !== 45 || r.t.high !== 12) throw new Error('zone target defaults wrong: ' + JSON.stringify(r.t));
  if (r.w.low !== 10 || r.w.mod !== 15 || r.w.high !== 2) throw new Error('this-week zone minutes wrong: ' + JSON.stringify(r.w));
});
await t('conditioning: custom format builds from settings; free run is open-ended', async () => {
  const r = await page.evaluate(() => {
    DB.settings.customFmt = { rounds: 5, work: 45, rest: 75 }; save();
    const p = conPrescription('custom');
    const phases = CON_FORMATS.custom.build(p);
    const work = phases.filter((x) => x.kind === 'work');
    const free = CON_FORMATS.free.build();
    const fp = conPrescription('free');
    DB.settings.customFmt = undefined; save();
    return { rounds: p.rounds, work: p.work, rest: p.rest, phaseWork: work.length, firstWork: work[0] && work[0].dur,
      desc: conPrescDesc('custom', p), freeLen: free.length, freeKind: free[0].kind, freeNote: fp.note,
      adaptIgnored: conAdapt({ id: 'c1', fmt: 'custom', dur: 600, zsec: { low: 0, mod: 600, high: 0 }, hrr: 20 }) };
  });
  if (r.rounds !== 5 || r.work !== 45 || r.rest !== 75) throw new Error('custom presc wrong: ' + JSON.stringify(r));
  if (r.phaseWork !== 5 || r.firstWork !== 45) throw new Error('custom build wrong: ' + JSON.stringify(r));
  if (r.desc !== '5×45s / 75s') throw new Error('custom desc: ' + r.desc);
  if (r.freeLen !== 1 || r.freeKind !== 'work2') throw new Error('free build wrong');
  if (r.freeNote !== 'open-ended') throw new Error('free presc note: ' + r.freeNote);
  if (r.adaptIgnored !== 0) throw new Error('custom format must not move progression');
});
await t('Progress (under Library) renders trends (empty state or charts, never blank)', async () => {
  await page.evaluate(() => libGo('progress'));
  await page.waitForSelector('#s-progress.on', { timeout: 2000 });
  const active = await page.$eval('.navlink[data-s="library"]', (el) => el.classList.contains('active'));
  if (!active) throw new Error('Library tab not highlighted on Progress');
  if (!(await page.$('#s-progress .libtab'))) throw new Error('Progress missing the Library tab strip');
  const html = await page.$eval('#s-progress', (el) => el.innerHTML);
  if (!/Your trends/.test(html)) throw new Error('progress header missing');
  // either the empty state or at least one chart must be present
  if (!/class="[^"]*empty|class="chart"/.test(html)) throw new Error('neither empty state nor chart rendered');
  await page.click('.navlink[data-s="home"]');
  await page.waitForSelector('#s-home.on', { timeout: 2000 });
});
await t('importer: paste → meaning-questions inline → learn → save lands in Builder', async () => {
  await page.evaluate(() => { BUILDER_WID = null; go('builder'); });
  await page.waitForSelector('#s-builder.on', { timeout: 2000 });
  await page.click('#s-builder [data-click="openImport"]');
  await page.waitForSelector('#s-import.on', { timeout: 2000 });
  await page.fill('#impSrc', 'power primer 3x3\n-test 45s between sets');
  await page.click('[data-click="impRead"]');
  let out = await page.textContent('#impOut');
  if (!/2 things need you/.test(out)) throw new Error('expected 2 inline questions: ' + out.slice(0, 120));
  // clean input must NOT ask about blank weights (meaning-only rule)
  const cleanQ = await page.evaluate(() => { const w = impParse('Bench press 4x8\nOHP 3x10'); return w.issues.length; });
  if (cleanQ !== 0) throw new Error('clean paste asked ' + cleanQ + ' questions');
  // prose paragraphs become notes, not fake exercises
  const prose = await page.evaluate(() => impParse('Bench 4x8\nEffort Note:\nSelect a pace that matches the rest you need before your next set.'));
  if (prose.blocks.flatMap((b) => b.exercises).length !== 1) throw new Error('prose leaked into exercises');
  if (!prose.notes.length) throw new Error('note paragraph not captured');
  // spoken dictation is tidied into parseable text (number words → digits)
  const spoken = await page.evaluate(() => impSplitSpoken('bench four by eight at rpe eight rest three minutes'));
  if (!/bench 4 ?x ?8/.test(spoken) || !/@RPE 8/.test(spoken) || !/3min/.test(spoken)) throw new Error('voice tidy failed: ' + spoken);
  // resolve: section → name the movement; typo → learn test=rest
  const pend = await page.evaluate(() => impPending().map((i) => ({ id: i.id, kind: i.kind })));
  for (const q of pend) {
    if (q.kind === 'nameOrSection') {
      await page.fill('#impIn' + q.id, 'sandbag over shoulder');
      await page.evaluate((id) => impResolve(id, 'setmove'), q.id);
    } else await page.evaluate((id) => impResolve(id, 'yes'), q.id);
  }
  out = await page.textContent('#impOut');
  if (!/All sorted/.test(out)) throw new Error('not all sorted: ' + out.slice(0, 120));
  const lex = await page.evaluate(() => DB.settings.lexicon);
  if (!lex || lex.kw.test !== 'rest' || !lex.ex['sandbag over shoulder']) throw new Error('lexicon not learned: ' + JSON.stringify(lex));
  if (lex.ex['power primer']) throw new Error('section name wrongly learned as movement');
  const before = await page.evaluate(() => DB.workouts.length);
  await page.click('[data-click="impSave"]');
  await page.waitForSelector('#s-builder.on', { timeout: 2000 });
  const okSaved = await page.evaluate((b) => DB.workouts.length === b + 1 && WK.blocks.length >= 1, before);
  if (!okSaved) throw new Error('imported workout did not land in Builder');
  // cleanup: remove imported workout + learned lexicon so later steps are pristine
  await page.evaluate(() => { deleteCurrentWorkout(); DB.settings.lexicon = { kw: {}, ex: {} }; save(); go('home'); });
});
await t('logger accordion: open, collapse, one-at-a-time', async () => {
  await page.click('.navlink[data-s="training"]');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  const rows = await page.$$('#s-training .lgcrow');
  if (rows.length < 2) throw new Error('need at least 2 exercise rows, got ' + rows.length);
  await rows[0].click();
  await page.waitForSelector('#s-training .lgx.open', { timeout: 2000 });
  // collapse via the letter chip
  await page.click('#s-training .lgx.open .lgltr');
  if (await page.$('#s-training .lgx.open')) throw new Error('card did not collapse');
  // open a different row — only ONE open card ever
  const rows2 = await page.$$('#s-training .lgcrow');
  await rows2[1].click();
  await page.waitForSelector('#s-training .lgx.open', { timeout: 2000 });
  const openCount = await page.$$eval('#s-training .lgx.open', (els) => els.length);
  if (openCount !== 1) throw new Error('open cards=' + openCount);
  const training = await page.$eval('.navlink[data-s="training"]', (el) => el.classList.contains('active'));
  if (!training) throw new Error('Training tab not highlighted while logging');
});
await t('hostile exercise/target text is escaped, never executed (XSS)', async () => {
  const executed = await page.evaluate(async () => {
    window.__xss = 0;
    const evil = '<img src=x onerror="window.__xss=1">';
    WK = templateWorkout(); WK.name = 'XSS'; BUILDER_WID = WK.id; EDIT_EXISTING = false; openBlock = 0;
    WK.blocks[0].exercises[0].name = evil;
    WK.blocks[0].exercises[0].tempo = evil;
    WK.blocks[0].exercises[0].sets[0].t = evil;
    renderBuilder();
    startWorkout((DB.workouts.push(JSON.parse(JSON.stringify(WK))), DB.workouts[DB.workouts.length - 1]).id);
    openLogger(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    const fired = window.__xss;
    BUILDER_WID = DB.workouts[DB.workouts.length - 1].id; deleteCurrentWorkout();
    return fired;
  });
  if (executed) throw new Error('XSS executed');
});
await t('corrupted localStorage (bad JSON and wrong types) boots clean', async () => {
  for (const bad of ['{{{not json', JSON.stringify({ workouts: { a: 1 }, sessions: 'nope', settings: 7 }), JSON.stringify({ workouts: [{ name: 'no blocks' }], sessions: [null] })]) {
    await page.evaluate((v) => localStorage.setItem('hybrid-engine-v1', v), bad);
    await page.reload({ waitUntil: 'networkidle' });
    const h1 = await page.textContent('#s-home h1').catch(() => '');
    if (h1.trim() !== 'Train today') throw new Error('did not boot on: ' + bad.slice(0, 30));
  }
  await page.evaluate(() => { localStorage.removeItem('hybrid-engine-v1'); });
  await page.reload({ waitUntil: 'networkidle' });
});
await t('empty workout cannot be previewed into a finishable session', async () => {
  const stayed = await page.evaluate(() => {
    WK = { id: uid(), name: 'Empty', blocks: [] }; BUILDER_WID = WK.id; EDIT_EXISTING = false; go('builder');
    previewWorkout();
    return CURRENT === 'builder' && !DB.sessions.some((s) => s.name === 'Empty');
  });
  if (!stayed) throw new Error('empty workout produced a session');
  await page.evaluate(() => go('home'));
});
await t('mobile viewport: nav becomes the bottom bar', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pos = await page.$eval('.side', (el) => getComputedStyle(el).position);
  if (pos !== 'fixed') throw new Error('side position=' + pos);
});

if (errors.length) {
  console.log('RUNTIME ERRORS:');
  errors.forEach((e) => console.log('  ' + e));
  failures += errors.length;
} else {
  console.log('No runtime errors.');
}

await browser.close();
server.close();
if (failures) {
  console.error(`FAIL — browser smoke failed (${failures}).`);
  process.exitCode = 1;
} else {
  console.log('PASS — browser smoke passed.');
}
