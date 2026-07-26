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
await t('guided stage opens on a strength row: dots, tracker, weight+reps, Finish Set', async () => {
  const rows = await page.$$('#s-training .lgcrow');
  let clicked = false;
  for (const row of rows) {
    const txt = await row.textContent();
    if (/rest/.test(txt) && /RPE|reps/.test(txt)) { await row.click(); clicked = true; break; }
  }
  if (!clicked) throw new Error('no row with prescribed rest');
  await page.waitForSelector('#s-training .lgx.open.glog', { timeout: 2000 });
  const track = await page.textContent('#s-training .glogtrack');
  if (!/SET 1 OF/.test(track)) throw new Error('tracker=' + track);
  if (!(await page.$('#glogV1')) || !(await page.$('#glogV2'))) throw new Error('weight/reps inputs missing');
  if (!(await page.$('#s-training .glogdot.active'))) throw new Error('no active set dot');
  if (!(await page.$('#s-training .glogfinish'))) throw new Error('no Finish Set button');
});
await t('Finish Set → RPE slider (1–10) → Confirm logs the set and starts the rest chip', async () => {
  await page.fill('#glogV1', '60'); await page.fill('#glogV2', '12');
  await page.click('#s-training .glogfinish');
  await page.waitForSelector('#glogRpeSlider', { timeout: 2000 });
  const range = await page.$eval('#glogRpeSlider', (el) => el.min + '-' + el.max + '/' + el.step);
  if (range !== '1-10/0.5') throw new Error('slider range=' + range);
  await page.fill('#glogRpeSlider', '8');
  if ((await page.textContent('#glogRpeOut')) !== '8') throw new Error('readout did not track slider');
  await page.click('#s-training .glogrpe .bigbtn');
  await page.waitForSelector('#restchip.show', { timeout: 2000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')));
  const ok = saved.sessions.some((s) => s.blocks.some((b) => b.exercises.some((e) => e.sets.some((st) => st.done && st.aVal === '60' && st.felt === '8'))));
  if (!ok) throw new Error('set not persisted');
});
await t('per-set autoregulation moved the next set\'s weight (percentage of current, plate-rounded)', async () => {
  // target RPE 7, felt 8 → (7−8) × 2.5% of 60 = −1.5 → 58.5 → rounds to 57.5 on 2.5 kg plates
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')));
  const ex = saved.sessions.flatMap((s) => s.blocks).flatMap((b) => b.exercises || []).find((e) => e.sets.some((st) => st.done && st.aVal === '60'));
  if (!ex) throw new Error('logged exercise not found');
  const next = ex.sets[1];
  if (next.aVal !== '57.5') throw new Error('next set weight=' + next.aVal);
  const hint = await page.textContent('#s-training .gloghint');
  if (!/57\.5 kg/.test(hint)) throw new Error('hint=' + hint);
  if (!(await page.$('#s-training .glogrest'))) throw new Error('in-stage rest panel missing');
});
await t('rest +15s extends the clock; Skip Rest advances to the next set', async () => {
  const secsOf = (s) => { const m = s.trim().match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : NaN; };
  const before = secsOf(await page.textContent('#glogClock'));
  await page.click('#s-training .glogrestbtns button:first-child');
  const after = secsOf(await page.textContent('#glogClock'));
  if (!(after > before + 10)) throw new Error('+15s did not extend: ' + before + '→' + after);
  await page.click('#s-training .glogrestbtns button:last-child');
  await page.waitForSelector('#s-training .glogfinish', { timeout: 2000 });
  const track = await page.textContent('#s-training .glogtrack');
  if (!/SET 2 OF/.test(track)) throw new Error('did not advance: ' + track);
  // re-arm a rest for the reload-persistence tests below
  await page.evaluate(() => startRest(120));
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
  await page.waitForSelector('#s-training .lgx.open.glog', { timeout: 2000 });
  const v = await page.$eval('#glogV1', (el) => el.value);
  if (v !== '60') throw new Error('prefill=' + v);
  const lastLine = await page.textContent('#s-training .gloglast');
  if (!/60 kg × 12 @ RPE 8/.test(lastLine)) throw new Error('last-time line=' + lastLine);
});
await t('nav is four tabs: Home · Training · Library · Settings', async () => {
  const navs = await page.$$eval('.navlink', (els) => els.map((e) => e.dataset.s));
  if (navs.length !== 4 || navs.includes('logger')) throw new Error(navs.join(','));
  if (navs.join(',') !== 'home,training,library,settings') throw new Error('unexpected tabs: ' + navs.join(','));
  await page.click('.navlink[data-s="settings"]');
  await page.waitForSelector('#s-settings.on', { timeout: 2000 });
  const active = await page.$eval('.navlink[data-s="settings"]', (el) => el.classList.contains('active'));
  if (!active) throw new Error('Settings tab not highlighted on Settings screen');
  await page.evaluate(() => go('home'));
});
await t('plateBreakdown math: exact and nearest cases', async () => {
  const r = await page.evaluate(() => {
    const P = [25,20,15,10,5,2.5,1.25];
    const a = plateBreakdown(100, 20, P);
    const b = plateBreakdown(102.5, 20, P);
    const c = plateBreakdown(101, 20, P);
    return { a, b, c };
  });
  if (r.a.perSide.join(',') !== '25,15' || !r.a.loadable || r.a.delta !== 0) throw new Error('100 → ' + JSON.stringify(r.a));
  if (r.b.perSide.join(',') !== '25,15,1.25' || !r.b.loadable) throw new Error('102.5 → ' + JSON.stringify(r.b));
  if (r.c.loadable || r.c.achievableKg !== 100 || r.c.delta !== -1) throw new Error('101 → ' + JSON.stringify(r.c));
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
await t('scheduling: adding a saved session to a future day does NOT start a today session', async () => {
  const res = await page.evaluate(() => {
    DB.sessions = DB.sessions.filter((s) => s.status !== 'active'); CUR_SESSION = null;
    const w = { id: uid(), name: 'Next week lower', days: [], dates: [], blocks: [
      { id: uid(), heading: 'Main', superset: false, exercises: [{ id: uid(), name: 'Squat', mode: 'reps_kg', tempo: '', rest: 90, sets: [{ t: '5', rpe: '8' }] }] },
    ] };
    DB.workouts.push(w); save();
    const fut = new Date(); fut.setDate(fut.getDate() + 6); const key = ymd(fut);
    scheduleWorkoutOn(w.id, key);                        // "Add" a saved session onto a future day
    const active = DB.sessions.filter((s) => s.status === 'active').length;
    const saved = DB.workouts.find((x) => x.name === 'Next week lower');
    return { active, scheduled: !!(saved && (saved.dates || []).includes(key)) };
  });
  if (res.active !== 0) throw new Error('scheduling a future session wrongly started a today session');
  if (!res.scheduled) throw new Error('future session not saved with its date');
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
await t('Library: LIBRARY screen with Sessions/Conditioning/Progress tabs + Import card', async () => {
  await page.click('.navlink[data-s="library"]');
  await page.waitForSelector('#s-library.on', { timeout: 2000 });
  const html = await page.$eval('#s-library', (el) => el.innerHTML);
  if (!/LIBRARY/.test(html)) throw new Error('LIBRARY title missing');
  const tabs = await page.$$eval('#s-library .libtab', (els) => els.map((e) => e.textContent));
  if (tabs.join(',') !== 'Sessions,Conditioning,Progress') throw new Error('lib tabs: ' + tabs.join(','));
  if (!/Import a session/.test(html)) throw new Error('import card missing');
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
    const w = templateWorkout(); w.name = 'Hybrid Day';
    w.blocks = [
      { id: uid(), heading: 'Strength', minutes: '', format: '', superset: false,
        exercises: [{ id: uid(), name: 'Back squat', mode: 'reps_kg', tempo: '', rest: 60, sets: [{ t: '5', rpe: '8' }] }] },
      newCondBlock()
    ];
    w.blocks[1].condFmt = 'intervals';
    DB.workouts.push(w); save();
    startWorkout(w.id);
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
    CUR_SESSION = null; save(); go('home');
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
await t('Stage 0 fixes: HRR window, downsample coverage, corroborated max, one recovery band', async () => {
  const r = await page.evaluate(() => {
    const out = {};

    // --- HRR must be a real 60s window, or null. It must never silently
    //     shrink and still call itself "60s".
    const every = 2;
    const clean = new Array(60).fill(null).map((_, i) => (i === 5 ? 180 : 120));
    out.cleanHrr = conHrr({ every, pts: clean });          // peak at i=5, +60s = i=35
    // Gap case: peak, then nothing anywhere near the 60s mark.
    const gappy = new Array(60).fill(null); gappy[5] = 180;
    out.gappyHrr = conHrr({ every, pts: gappy });
    // No data at all.
    out.emptyHrr = conHrr({ every, pts: [] });

    // --- Downsampling must span the whole session, not fold the tail into the
    //     final bin. A 3-hour session at 2s would need 5400 points; the cap is
    //     2700, so `every` must widen instead of the index clamping.
    const dur = 3 * 3600;
    const samples = [];
    for (let t2 = 0; t2 <= dur; t2 += 30) samples.push({ t: t2, bpm: 100 + (t2 > dur / 2 ? 40 : 0) });
    const ds = conDownsample(samples, dur);
    out.dsEvery = ds.every;
    out.dsSpans = ds.every * (ds.pts.length - 1) >= dur - ds.every;
    // The late-session 140bpm samples must land in late bins, not all in the last one.
    const lastIdx = ds.pts.length - 1;
    const highIdxs = ds.pts.map((v, i) => (v === 140 ? i : -1)).filter((i) => i >= 0);
    out.highSpread = highIdxs.length > 10 && highIdxs[0] < lastIdx - 10;

    // --- Observed max needs corroboration: a single spike must not count.
    out.spikeIgnored = conObservedMax([{ bpm: 210 }, { bpm: 120 }, { bpm: 118 }]) === 118;
    out.sustainedTaken = conObservedMax([{ bpm: 200 }, { bpm: 199 }, { bpm: 198 }, { bpm: 120 }]) === 198;
    out.tooFewIsNull = conObservedMax([{ bpm: 200 }, { bpm: 190 }]) === null;

    // --- One definition of the recovery bands, everywhere.
    out.bands = [recoveryBand(90), recoveryBand(67), recoveryBand(50), recoveryBand(34), recoveryBand(10), recoveryBand(null)];
    out.toneAgrees = whoopTone(67).cls === 'good' && whoopTone(66).cls === 'watch' && whoopTone(33).cls === 'low';
    return out;
  });

  if (r.cleanHrr.hrr !== 60 || r.cleanHrr.win !== 60) throw new Error('HRR60 on clean data wrong: ' + JSON.stringify(r.cleanHrr));
  if (r.gappyHrr.hrr !== null) throw new Error('HRR returned a number with no sample near 60s: ' + JSON.stringify(r.gappyHrr));
  if (r.emptyHrr.hrr !== null) throw new Error('HRR on empty data should be null');
  if (r.dsEvery <= 2) throw new Error('downsample did not widen the bin for a 3h session: every=' + r.dsEvery);
  if (!r.dsSpans) throw new Error('downsampled trace does not span the session (tail folded into last bin)');
  if (!r.highSpread) throw new Error('late-session samples collapsed into the final bins');
  if (!r.spikeIgnored) throw new Error('a single artefact beat still raises the observed max');
  if (!r.sustainedTaken) throw new Error('a corroborated high max was not accepted');
  if (!r.tooFewIsNull) throw new Error('observed max accepted fewer than 3 corroborating samples');
  if (r.bands.join(',') !== 'good,good,watch,watch,low,') throw new Error('recovery bands wrong: ' + r.bands.join(','));
  if (!r.toneAgrees) throw new Error('whoopTone disagrees with recoveryBand — the bands have drifted apart again');
});
await t('Stage 0 fixes: deload reaches level-0, plan length is recovery-independent, adapt uses stored recovery', async () => {
  const r = await page.evaluate(() => {
    const out = {};
    const savedWhoop = WHOOP.sample;
    DB.settings.conProgress = {}; save();

    // B1: a level-0 athlete on low recovery must still get eased.
    WHOOP.sample = { recoveryScore: 25 };
    const p0 = conPrescription('intervals');
    out.level0Eased = p0.dailyAdj === -1 && p0.rounds < CON_FORMATS.intervals.base.rounds;

    // B2: a high-recovery day must not claim an adjustment it didn't make.
    WHOOP.sample = { recoveryScore: 95 };
    const pHigh = conPrescription('intervals');
    const pNone = conPrescription('intervals', true);
    out.greenHonest = pHigh.dailyAdj === 0 && pHigh.rounds === pNone.rounds && !/strong recovery/i.test(pHigh.note || '');

    // B8: the planned length of a block must not move with today's recovery.
    const blk = { kind: 'conditioning', condFmt: 'intervals' };
    WHOOP.sample = { recoveryScore: 25 };
    const lowMin = condBlockMinutes(blk);
    WHOOP.sample = { recoveryScore: 95 };
    const highMin = condBlockMinutes(blk);
    out.planStable = lowMin === highMin && lowMin > 0;

    // B13: conAdapt must read the recovery stored ON the record.
    DB.settings.conProgress = {}; save();
    WHOOP.sample = { recoveryScore: 95 };   // today says "great"
    const rec = { id: 'x1', fmt: 'intervals', dur: 600, zsec: { low: 60, mod: 300, high: 40 }, rec: 20 };
    const delta = conAdapt(rec);            // ...but the session was run at 20%
    out.usedStoredRecovery = delta !== 1;

    WHOOP.sample = savedWhoop; DB.settings.conProgress = {}; save();
    return out;
  });
  if (!r.level0Eased) throw new Error('B1: a level-0 athlete on 25% recovery got no deload');
  if (!r.greenHonest) throw new Error('B2: a high-recovery day still claims an adjustment it does not make');
  if (!r.planStable) throw new Error('B8: planned block length changes with today\'s recovery');
  if (!r.usedStoredRecovery) throw new Error('B13: conAdapt used today\'s recovery instead of the session\'s');
});
await t('weekly zone time: banked minutes are reported, with no invented target', async () => {
  const r = await page.evaluate(() => {
    DB.settings.conditioning = [];
    const now = Date.now();
    DB.settings.conditioning = [{ id: 'z1', sim: false, startedAt: now, date: ymd(new Date()), zsec: { low: 600, mod: 900, high: 120 } }];
    save();
    const w = thisWeekZoneMin();
    const html = weeklyZoneTargetCard();
    DB.settings.conditioning = []; save();
    return { w, html, hasTargets: typeof window.zoneTargets === 'function' };
  });
  if (r.w.low !== 10 || r.w.mod !== 15 || r.w.high !== 2) throw new Error('this-week zone minutes wrong: ' + JSON.stringify(r.w));
  // The fabricated 60/45/12 weekly targets are gone and must not come back.
  if (r.hasTargets) throw new Error('zoneTargets() is back — the invented 60/45/12 weekly targets must stay deleted');
  if (/\/\d+m/.test(r.html)) throw new Error('zone card is still rendering a "/Nm" target: ' + r.html);
  if (!/27 min total/.test(r.html)) throw new Error('zone card did not report the banked total: ' + r.html);
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
await t('Top Lifts: 8-week delta shown when both windows have data, silent otherwise', async () => {
  const r = await page.evaluate(() => {
    const DAY = 864e5;
    const mkSession = (id, daysAgo, kg, reps) => ({
      id, status: 'completed', date: ymd(new Date(Date.now() - daysAgo * DAY)), completedAt: Date.now() - daysAgo * DAY,
      blocks: [{ id: 'b1', exercises: [{ id: 'e1', name: 'Back Squat', mode: 'reps_kg', tempo: '', rest: 90,
        sets: [{ t: '', rpe: '', done: true, aVal: kg, aVal2: reps }] }] }],
    });
    // A lift tested this window (100kg) and the window before (90kg) -> should show +10kg.
    // A second lift tested only this window (no history) -> should show no delta at all.
    DB.sessions = [
      mkSession('s1', 5, 100, 5),      // this 8-week window
      mkSession('s2', 60, 90, 5),      // the window before (weeks 9-16 ago)
      { ...mkSession('s3', 3, 60, 8), blocks: [{ id: 'b2', exercises: [{ id: 'e2', name: 'Overhead Press', mode: 'reps_kg', tempo: '', rest: 90,
          sets: [{ t: '', rpe: '', done: true, aVal: 60, aVal2: 8 }] }] }] },
    ];
    save();
    const html = progTopLifts();
    DB.sessions = []; save();
    return html;
  });
  if (!/Back Squat/.test(r) || !/tldelta/.test(r)) throw new Error('squat delta card missing: ' + r);
  // e1RM (Epley), not raw kg: 100x5 -> 116.7kg, 90x5 -> 105kg, delta +11.7kg.
  if (!/\+11\.7kg · 8wk/.test(r)) throw new Error('squat delta wrong sign/magnitude: ' + r);
  const opressBlock = r.split('Overhead Press')[1] || '';
  if (/tldelta/.test(opressBlock.split('</div>')[0] || opressBlock.slice(0, 200))) {
    throw new Error('a lift with data in only one window should show no delta: ' + r);
  }
});
await t('WHOOP recovery trend: rolling average appears only with >=14 days of history', async () => {
  const r = await page.evaluate(() => {
    const mkDaily = (n) => Array.from({ length: n }, (_, i) => ({
      date: ymd(new Date(Date.now() - (n - 1 - i) * 864e5)), recovery: 50 + (i % 2 === 0 ? 20 : -20), strain: null,
    }));
    DB.settings.whoopDaily = mkDaily(10); save();
    const shortHtml = document.getElementById('s-progress') ? null : null; // no-op, renderProgress reads DB directly
    // renderProgress isn't isolated per-card, so call the internal pieces the same way it does
    const wd10 = DB.settings.whoopDaily.filter(h => Number.isFinite(h.recovery));
    const has7dAvgFor10 = wd10.length >= 14;
    DB.settings.whoopDaily = mkDaily(20); save();
    const wd20 = DB.settings.whoopDaily.filter(h => Number.isFinite(h.recovery));
    const avg = rollingMean(wd20.map(h => h.recovery), 7);
    const handMean = wd20.slice(13, 20).map(h => h.recovery).reduce((a, b) => a + b, 0) / 7; // trailing 7 ending at index 19... check index 13-19
    DB.settings.whoopDaily = []; save();
    return { has7dAvgFor10, len20: wd20.length, avgLast: avg[avg.length - 1], handMean };
  });
  if (r.has7dAvgFor10) throw new Error('10 days of recovery history should not be enough for a rolling average');
  if (r.len20 !== 20) throw new Error('seeded recovery history was not 20 rows');
  if (Math.abs(r.avgLast - r.handMean) > 1e-9) throw new Error('rollingMean does not match a hand-computed trailing 7-day mean: ' + JSON.stringify(r));
});
await t('importer: paste → meaning-questions inline → learn → save lands in Library', async () => {
  await page.evaluate(() => openImport());
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
  await page.waitForSelector('#s-library.on', { timeout: 2000 });
  const okSaved = await page.evaluate((b) => DB.workouts.length === b + 1, before);
  if (!okSaved) throw new Error('imported workout did not land in Library');
  // cleanup: remove imported workout (impSave always appends, so the last
  // entry is the one just added) + learned lexicon so later steps are pristine
  await page.evaluate((b) => {
    DB.workouts = DB.workouts.slice(0, b);
    DB.settings.lexicon = { kw: {}, ex: {} }; save(); go('home');
  }, before);
});
await t('import without rest text defaults lifts to 90s, and the draft says so', async () => {
  const r = await page.evaluate(() => {
    const wk = impParse('Bench press 4x8\nPlank 3x30s');
    const preview = impTargetStr(wk.blocks[0].exercises[0], wk.blocks[0]);
    IMP.wk = wk; const before = DB.workouts.length;
    impSave();
    const w = DB.workouts[DB.workouts.length - 1];
    const rests = w.blocks.flatMap((b) => b.exercises.map((e) => e.rest));
    DB.workouts = DB.workouts.slice(0, before); save();
    return { rests, preview };
  });
  if (!r.rests.every((x) => x === 90)) throw new Error('rests=' + JSON.stringify(r.rests));
  if (!/rest 1:30 \(default\)/.test(r.preview)) throw new Error('draft preview missing default note: ' + r.preview);
  await page.evaluate(() => go('home'));
});
await t('Home zero-state card opens the importer directly', async () => {
  await page.evaluate(() => { window.__stashW = DB.workouts; DB.workouts = []; go('home'); });
  await page.click('#s-home .sessioncard[data-click="openImport"]');
  await page.waitForSelector('#s-import.on', { timeout: 2000 });
  await page.evaluate(() => { DB.workouts = window.__stashW; delete window.__stashW; save(); go('home'); });
});
await t('Planner: Library ⋮ Edit opens the plan view with logger-identical rows', async () => {
  await page.evaluate(() => {
    window.__stashW = DB.workouts; window.__stashS = DB.sessions;
    DB.workouts = [{ id: 'plw1', name: 'Push Day', days: [], dates: [], blocks: [
      { id: 'plb1', heading: 'Main', minutes: '', format: '', superset: false, exercises: [
        { id: 'ple1', name: 'Bench Press', mode: 'reps_kg', tempo: '', rest: 90, sets: [
          { t: '5', rpe: '' }, { t: '5', rpe: '' }, { t: '5', rpe: '' }] },
        { id: 'ple2', name: 'Incline DB Press', mode: 'reps_kg', tempo: '', rest: 90, sets: [
          { t: '12', rpe: '8' }, { t: '10', rpe: '8' }, { t: '8', rpe: '8' }] }] }] }];
    DB.sessions = []; save(); go('library');
  });
  await page.click('#s-library .tpmenu');
  await page.waitForSelector('#sheet .bigopt', { timeout: 2000 });
  await page.click('#sheet .bigopt:has-text("Edit")');
  await page.waitForSelector('#s-planner.on', { timeout: 2000 });
  const row = await page.textContent('#s-planner .lgcrow .lgcn');
  const expected = await page.evaluate(() => rxLine(DB.workouts[0].blocks[0].exercises[0]));
  if (!row.includes(expected.replace(/RPE /, 'RPE '))) throw new Error('planner row "' + row + '" lacks rxLine "' + expected + '"');
});
await t('Planner: dots stepper, rep chips, RPE slider and ±15s rest all write the template', async () => {
  await page.click('#s-planner .lgcrow');
  await page.waitForSelector('#s-planner .lgx.open.plan', { timeout: 2000 });
  await page.click('#s-planner .plandots button:last-child'); // + one set
  await page.click('#s-planner .daychip:text-is("6-8")');
  await page.fill('#planRpeSlider', '8');
  await page.click('#s-planner .glogfield:has(.planrest) button[data-args="[15]"]');
  await page.click('#s-planner .glogfield:has(.planrest) button[data-args="[15]"]');
  const ex = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts[0].blocks[0].exercises[0]);
  if (ex.sets.length !== 4) throw new Error('sets=' + ex.sets.length);
  if (!ex.sets.every((s) => s.t === '6-8' && s.rpe === '8')) throw new Error('sets=' + JSON.stringify(ex.sets));
  if (ex.rest !== 120) throw new Error('rest=' + ex.rest);
  if (Object.keys(ex.sets[0]).sort().join(',') !== 'rpe,t') throw new Error('set shape grew: ' + Object.keys(ex.sets[0]));
  // an imported per-set ladder reads as "mixed" until deliberately overridden
  await page.click('#s-planner .lgx:not(.open) .lgcrow');
  await page.waitForSelector('#s-planner .lgx.open.plan', { timeout: 2000 });
  const lit = await page.$$eval('#s-planner .planchips .daychip.on', (els) => els.map((e) => e.textContent).join(','));
  if (!/mixed/.test(lit)) throw new Error('ladder not shown as mixed: ' + lit);
});
await t('Planner structure: chain merges/splits supersets, add/move/delete, heading chips', async () => {
  await page.evaluate(() => {
    window.__stashW2 = DB.workouts; window.__stashS2 = DB.sessions;
    DB.workouts = [{ id: 'plw2', name: 'Struct Day', days: [], dates: [], blocks: [
      { id: 'sb1', heading: 'Pair', minutes: '', format: '', superset: false, exercises: [
        { id: 'se1', name: 'Bench', mode: 'reps_kg', tempo: '', rest: 120, sets: [{ t: '10', rpe: '8' }] }] },
      { id: 'sb2', heading: 'Pair2', minutes: '', format: '', superset: false, exercises: [
        { id: 'se2', name: 'Row', mode: 'reps_kg', tempo: '', rest: 120, sets: [{ t: '10', rpe: '8' }] }] }] }];
    DB.sessions = []; save(); openPlanner('plw2');
  });
  await page.waitForSelector('#s-planner.on', { timeout: 2000 });
  // cross-block chain → one superset block
  await page.click('#s-planner .planseam button');
  let blocks = await page.evaluate(() => DB.workouts[0].blocks.map((b) => ({ n: b.exercises.length, ss: !!b.superset })));
  if (blocks.length !== 1 || !blocks[0].ss || blocks[0].n !== 2) throw new Error('merge failed: ' + JSON.stringify(blocks));
  // lit chain → split back apart
  await page.click('#s-planner .planseam button.on');
  blocks = await page.evaluate(() => DB.workouts[0].blocks.map((b) => ({ n: b.exercises.length, ss: !!b.superset })));
  if (blocks.length !== 2 || blocks.some((b) => b.ss)) throw new Error('split failed: ' + JSON.stringify(blocks));
  // + Exercise auto-opens the name sheet; free-text names it
  await page.click('#s-planner .planadd:not(.block)');
  await page.waitForSelector('#sheet .swapsearch', { timeout: 2000 });
  await page.fill('#sheet .swapsearch', 'Pallof Press Iso');
  await page.click('#sheet .swapopt');
  await page.waitForSelector('#s-planner .lgx.open.plan', { timeout: 2000 });
  let names = await page.evaluate(() => DB.workouts[0].blocks[0].exercises.map((e) => e.name));
  if (names[1] !== 'Pallof Press Iso') throw new Error('add+name failed: ' + names);
  // move it up, then delete it
  await page.click('#s-planner .planctl button:first-child');
  names = await page.evaluate(() => DB.workouts[0].blocks[0].exercises.map((e) => e.name));
  if (names[0] !== 'Pallof Press Iso') throw new Error('move failed: ' + names);
  await page.click('#s-planner .planctl .del');
  names = await page.evaluate(() => DB.workouts[0].blocks[0].exercises.map((e) => e.name));
  if (names.length !== 1 || names[0] !== 'Bench') throw new Error('delete failed: ' + names);
  // heading chips
  await page.click('#s-planner .plansec');
  await page.waitForSelector('#s-planner .planhead input', { timeout: 2000 });
  await page.click('#s-planner .planhead .daychip:text-is("Warm-up")');
  const head = await page.evaluate(() => DB.workouts[0].blocks[0].heading);
  if (head !== 'Warm-up') throw new Error('heading chip failed: ' + head);
  await page.evaluate(() => {
    DB.workouts = window.__stashW2; DB.sessions = window.__stashS2;
    delete window.__stashW2; delete window.__stashS2; save(); go('library');
  });
});
await t('Planner conditioning: ♥ adds a block, format+effort persist, live engine picks it up', async () => {
  await page.evaluate(() => {
    window.__stashW3 = DB.workouts; window.__stashS3 = DB.sessions;
    DB.workouts = [{ id: 'plw3', name: 'Hybrid Day', days: [], dates: [], blocks: [
      { id: 'hb1', heading: 'Main', minutes: '', format: '', superset: false, exercises: [
        { id: 'he1', name: 'Squat', mode: 'reps_kg', tempo: '', rest: 180, sets: [{ t: '5', rpe: '8' }] }] }] }];
    DB.sessions = []; save(); openPlanner('plw3');
  });
  await page.waitForSelector('#s-planner.on', { timeout: 2000 });
  await page.click('#s-planner .planaddrow button:last-child'); // ♥ Conditioning
  await page.waitForSelector('#plc1', { timeout: 2000 });
  await page.click('#plc1 .daychip:text-is("Steady-state")');
  await page.click('#plc1 .daychip:has-text("Hard")'); // effort chip: "Hard" + "RPE 8-9.5"
  const blk = await page.evaluate(() => DB.workouts[0].blocks[1]);
  // effort is what you authored; the zone it implies is written alongside it
  if (blk.kind !== 'conditioning' || blk.condFmt !== 'steady' || blk.effort !== 'hard' || blk.targetZone !== 'high') throw new Error(JSON.stringify(blk));
  const body = await page.textContent('#plc1 .lg-body');
  if (!/earned level/.test(body)) throw new Error('no earned-level preview: ' + body);
  if (!/RPE 8-9\.5/.test(body)) throw new Error('effort chip does not show its RPE anchor: ' + body);
  if (!/Overload/.test(body)) throw new Error('effort note does not name the zone it holds: ' + body);
  await page.evaluate(() => { scheduleWorkoutOn('plw3', ymd(new Date())); startWorkout('plw3'); });
  await page.waitForSelector('#s-training .condrow', { timeout: 2000 });
  await page.click('#s-training .condrow');
  await page.waitForSelector('#s-conditioning.on', { timeout: 3000 });
  const con = await page.evaluate(() => ({ fmt: CON.fmt, zone: CON.targetZone, eff: CON.effort, rpe: CON.targetRpe, sink: CON.sink.scope }));
  if (con.fmt !== 'steady' || con.zone !== 'high' || con.eff !== 'hard' || con.rpe !== 8.5 || con.sink !== 'session') throw new Error(JSON.stringify(con));
  await page.evaluate(() => {
    CON.sink = { scope: 'standalone' }; CON.view = 'setup';
    DB.workouts = window.__stashW3; DB.sessions = window.__stashS3;
    delete window.__stashW3; delete window.__stashS3;
    CUR_SESSION = null; LOG_LOC = null; save(); go('library');
  });
});
await t('Conditioning effort ↔ RPE: legacy zones map, felt rating saves and feeds readiness', async () => {
  // blocks authored before effort existed carry only a zone — they must read back
  const map = await page.evaluate(() => ({
    legacyLow: condEffort({ targetZone: 'low' }).key,
    legacyHigh: condEffort({ targetZone: 'high' }).key,
    bare: condEffort({}).key,
    hardCenter: CON_EFFORTS.hard.center
  }));
  if (map.legacyLow !== 'easy' || map.legacyHigh !== 'hard' || map.bare !== 'medium' || map.hardCenter !== 8.5) throw new Error(JSON.stringify(map));

  await page.evaluate(() => {
    window.__stashS4 = DB.sessions;
    const hr = Array.from({ length: 240 }, (_, i) => 130 + (i % 40));
    DB.sessions = [{ id: 'cs1', name: 'Run day', date: ymd(new Date()), status: 'completed', completedAt: Date.now(), blocks: [
      { id: 'cb1', kind: 'conditioning', heading: 'Conditioning', condFmt: 'steady', effort: 'medium', targetZone: 'mod',
        condResult: { id: 'cr1', date: ymd(new Date()), startedAt: Date.now() - 1200000, dur: 1200, fmt: 'steady',
          every: 5, hr, zsec: { low: 200, mod: 900, high: 100 }, max: 170, avg: 148, hrr: 22,
          effort: 'medium', targetRpe: 6 } }] }];
    save();
    CON.sink = { scope: 'session', sid: 'cs1', bi: 0, bid: 'cb1' };
    CON.record = DB.sessions[0].blocks[0].condResult;
    CON.view = 'results'; CON.feltDraft = null; CON.feltEdit = false;
    go('conditioning');
  });
  await page.waitForSelector('#s-conditioning .glogrpe', { timeout: 2000 });
  const ask = await page.textContent('#s-conditioning .glogrpe');
  if (!/you asked for Medium/.test(ask)) throw new Error('rating panel does not recall the authored effort: ' + ask);
  await page.evaluate(() => { conFeltInput('9'); conFeltSave(); });
  const out = await page.evaluate(() => ({ felt: DB.sessions[0].blocks[0].condResult.felt, gap: rpeGapInfo() }));
  if (out.felt !== '9') throw new Error('felt RPE not persisted onto the block: ' + JSON.stringify(out));
  if (!out.gap || Math.abs(out.gap.gap - 3) > 0.001) throw new Error('conditioning gap missing from readiness: ' + JSON.stringify(out.gap));
  const verdict = await page.textContent('#s-conditioning .guidebar');
  if (!/RPE 9/.test(verdict) || !/harder than medium/.test(verdict)) throw new Error('no target-vs-felt verdict: ' + verdict);
  await page.evaluate(() => {
    DB.sessions = window.__stashS4; delete window.__stashS4;
    CON.sink = { scope: 'standalone' }; CON.view = 'setup'; CON.record = null; save(); go('library');
  });
});
await t('Sample session: one tap loads a full demo workout that drives the Logger', async () => {
  await page.evaluate(() => {
    window.__stashW5 = DB.workouts; window.__stashS5 = DB.sessions;
    DB.workouts = []; DB.sessions = []; CUR_SESSION = null; save(); go('library');
  });
  await page.waitForSelector('#s-library.on', { timeout: 2000 });
  await page.click('#s-library .tplcreate:has-text("Load a sample session")');
  await page.waitForSelector('#s-home.on', { timeout: 2000 });
  const one = await page.evaluate(() => ({
    n: DB.workouts.length,
    today: DB.workouts.filter(w => plannedOn(w, ymd(new Date()))).length,
    modes: DB.workouts[0].blocks.filter(b => !isCond(b)).flatMap(b => b.exercises.map(e => e.mode)),
    superset: DB.workouts[0].blocks.some(b => b.superset),
    effort: (DB.workouts[0].blocks.filter(isCond)[0] || {}).effort
  }));
  if (one.n !== 1 || one.today !== 1) throw new Error('sample not saved/scheduled: ' + JSON.stringify(one));
  if (!one.superset || one.effort !== 'medium') throw new Error('sample missing superset/conditioning: ' + JSON.stringify(one));
  for (const m of ['seconds', 'reps', 'reps_kg', 'amrap']) {
    if (!one.modes.includes(m)) throw new Error('sample does not cover the ' + m + ' logger shape: ' + JSON.stringify(one.modes));
  }
  // tapping it again re-uses the saved sample instead of piling up copies
  await page.evaluate(() => go('library'));
  await page.waitForSelector('#s-library.on', { timeout: 2000 });
  await page.click('#s-library .tplcreate:has-text("Load a sample session")');
  const again = await page.evaluate(() => DB.workouts.length);
  if (again !== 1) throw new Error('second tap duplicated the sample: ' + again);
  // and it is an ordinary session all the way into the guided logger
  await page.evaluate(() => startWorkout(DB.workouts[0].id));
  await page.waitForSelector('#s-training .condrow', { timeout: 2000 });
  const body = await page.textContent('#s-training #sessBody');
  if (!/Back Squat/.test(body)) throw new Error('sample rows missing from Training: ' + body.slice(0, 300));
  if (!/RPE 8/.test(body)) throw new Error('sample RPE target not shown: ' + body.slice(0, 300));
  if (!/max/.test(body)) throw new Error('sample max-reps set not shown: ' + body.slice(0, 300));
  await page.evaluate(() => openLogger(1, 0));
  await page.waitForSelector('#s-training .lgx.open.glog', { timeout: 2000 });
  await page.evaluate(() => {
    DB.workouts = window.__stashW5; DB.sessions = window.__stashS5;
    delete window.__stashW5; delete window.__stashS5;
    CUR_SESSION = null; LOG_LOC = null; save(); go('library');
  });
});
await t('Planner → Logger symbiosis: the authored plan drives the guided flow', async () => {
  await page.evaluate(() => { scheduleWorkoutOn('plw1', ymd(new Date())); startWorkout('plw1'); openLogger(0, 0); });
  await page.waitForSelector('#s-training .lgx.open.glog', { timeout: 2000 });
  const track = await page.textContent('#s-training .glogtrack');
  if (!/SET 1 OF 4/.test(track) || !/6-8 @8/.test(track)) throw new Error('logger did not read the plan: ' + track);
  await page.fill('#glogV1', '80'); await page.fill('#glogV2', '8');
  await page.click('#s-training .glogfinish');
  await page.fill('#glogRpeSlider', '8');
  await page.click('#s-training .glogrpe .bigbtn');
  await page.waitForSelector('#s-training .glogrest', { timeout: 2000 });
  const hint = await page.textContent('#s-training .gloghint');
  // felt 8 against an authored target of 8 → on target, hold weight
  if (!/right on target/.test(hint) || !/hold weight/.test(hint)) throw new Error('verdict not centered on authored RPE: ' + hint);
  await page.evaluate(() => {
    stopRest(); DB.workouts = window.__stashW; DB.sessions = window.__stashS;
    delete window.__stashW; delete window.__stashS;
    CUR_SESSION = null; LOG_LOC = null; save(); go('home');
  });
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
await t('per-set note persists and shows in History', async () => {
  await page.evaluate(() => { setNote(0, 'belt on'); });
  const stored = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    return db.sessions.some((s) => s.blocks.some((b) => (b.exercises || []).some((e) => e.sets.some((st) => st.note === 'belt on'))));
  });
  if (!stored) throw new Error('note not persisted');
  const day = await page.evaluate(() => { const s = curSession(); finishSession({ textContent: '', classList: { add() {} } }); return s.date; });
  await page.evaluate((d) => { HIST_DATE = d; go('history'); }, day);
  const body = await page.textContent('#s-history');
  if (!/belt on/.test(body)) throw new Error('note not in History: ' + body.slice(0, 120));
  await page.evaluate(() => go('home'));
});
await t('swap exercise mid-session: name changes, sets kept, swappedFrom set, still finishable', async () => {
  await page.evaluate(() => {
    const today = ymd(new Date());
    DB.sessions = DB.sessions.filter((s) => s.status !== 'active'); CUR_SESSION = null;
    DB.workouts = [{ id: uid(), name: 'Swaptest', days: [], dates: [today],
      blocks: [{ id: uid(), heading: 'Main', superset: false, exercises: [{ id: uid(), name: 'Back squat', mode: 'reps_kg', rest: 60, sets: [{ t: '5', rpe: '8' }, { t: '5', rpe: '8' }] }] }] }];
    save(); startWorkout(DB.workouts[0].id); openLogger(0, 0);
    applySwap('Front squat');
  });
  const r = await page.evaluate(() => { const e = curSession().blocks[0].exercises[0]; return { name: e.name, from: e.swappedFrom, sets: e.sets.length }; });
  if (r.name !== 'Front squat') throw new Error('name=' + r.name);
  if (r.from !== 'Back squat') throw new Error('swappedFrom=' + r.from);
  if (r.sets !== 2) throw new Error('sets lost: ' + r.sets);
  const finished = await page.evaluate(() => {
    curSession().blocks[0].exercises[0].sets.forEach((st) => st.done = true);
    finishSession({ textContent: '', classList: { add() {} } });
    return DB.sessions.some((s) => s.status === 'completed' && s.blocks[0].exercises[0].name === 'Front squat');
  });
  if (!finished) throw new Error('swapped session did not finish');
  await page.evaluate(() => go('home'));
});
await t('superset pair flows A→B with no rest, rests after the pair, then round 2 on A', async () => {
  await page.waitForTimeout(800); // the swap test's finishSession schedules go('recap') at +650ms — let it land first
  await page.evaluate(() => {
    const today = ymd(new Date());
    DB.sessions = DB.sessions.filter((s) => s.status !== 'active'); CUR_SESSION = null;
    DB.workouts = [{ id: uid(), name: 'Pairtest', days: [], dates: [today],
      blocks: [{ id: uid(), heading: 'Superset', superset: true, exercises: [
        { id: uid(), name: 'Bench', mode: 'reps_kg', rest: 120, sets: [{ t: '10', rpe: '8' }, { t: '10', rpe: '8' }] },
        { id: uid(), name: 'Row', mode: 'reps_kg', rest: 120, sets: [{ t: '10', rpe: '8' }, { t: '10', rpe: '8' }] }] }] }];
    save(); startWorkout(DB.workouts[0].id); openLogger(0, 0);
  });
  await page.waitForSelector('#s-training .lgx.open.glog', { timeout: 2000 });
  const logOne = async (kg) => {
    await page.fill('#glogV1', kg); await page.fill('#glogV2', '10');
    await page.click('#s-training .glogfinish');
    await page.fill('#glogRpeSlider', '8.5');
    await page.click('#s-training .glogrpe .bigbtn');
  };
  await logOne('60'); // A1 confirmed → B opens immediately, NO rest inside the pair
  const openA = await page.textContent('#s-training .lgx.open .lgttl');
  if (openA !== 'Row') throw new Error('did not flow to B, open=' + openA);
  if (await page.$('#s-training .glogrest')) throw new Error('rest ran inside the pair');
  await logOne('40'); // B1 confirmed → pair complete → rest
  await page.waitForSelector('#s-training .glogrest', { timeout: 2000 });
  await page.click('#s-training .glogrestbtns button:last-child'); // skip
  await page.waitForSelector('#s-training .glogfinish', { timeout: 2000 });
  const openB = await page.textContent('#s-training .lgx.open .lgttl');
  const track = await page.textContent('#s-training .glogtrack');
  if (openB !== 'Bench' || !/SET 2 OF/.test(track)) throw new Error('round 2 landed on ' + openB + ' / ' + track);
  await page.evaluate(() => {
    DB.workouts = []; DB.sessions = DB.sessions.filter((s) => s.status !== 'active');
    CUR_SESSION = null; LOG_LOC = null; save(); go('home');
  });
});
await t('hostile exercise/target text is escaped, never executed (XSS)', async () => {
  const executed = await page.evaluate(async () => {
    window.__xss = 0;
    const evil = '<img src=x onerror="window.__xss=1">';
    const w = templateWorkout(); w.name = 'XSS';
    w.blocks[0].exercises[0].name = evil;
    w.blocks[0].exercises[0].tempo = evil;
    w.blocks[0].exercises[0].sets[0].t = evil;
    DB.workouts.push(w); save();
    renderLibrary();   // Library renders the saved workout's name/summary
    startWorkout(w.id);
    openLogger(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    const fired = window.__xss;
    DB.workouts = DB.workouts.filter((x) => x.id !== w.id);
    DB.sessions = DB.sessions.filter((s) => s.workoutId !== w.id);
    CUR_SESSION = null; save();
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
await t('a workout with zero blocks can never be a finishable session (vacuous truth guard)', async () => {
  const res = await page.evaluate(() => {
    const w = { id: uid(), name: 'Empty', days: [], dates: [], blocks: [] };
    DB.workouts.push(w); save();
    startWorkout(w.id);
    const s = curSession();
    const done = s ? sessionAllDone(s) : null;
    DB.workouts = DB.workouts.filter((x) => x.id !== w.id);
    DB.sessions = DB.sessions.filter((x) => x.workoutId !== w.id);
    CUR_SESSION = null; save();
    return { hasSession: !!s, done };
  });
  if (res.hasSession && res.done) throw new Error('a zero-block session is instantly finishable (vacuous truth)');
  await page.evaluate(() => go('home'));
});
await t('mobile viewport: nav becomes the bottom bar', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pos = await page.$eval('.side', (el) => getComputedStyle(el).position);
  if (pos !== 'fixed') throw new Error('side position=' + pos);
});
await t('long-press a session card opens Move / Delete / Cancel, and Delete removes it', async () => {
  await page.evaluate(() => { const today = ymd(new Date()); DB.workouts = [{ id: uid(), name: 'Press Test', days: [], dates: [today], blocks: [{ id: uid(), heading: 'Squat', minutes: '', format: '', superset: false, exercises: [{ id: uid(), name: 'Back Squat', mode: 'reps_kg', tempo: '', rest: 120, sets: [{ t: '5', rpe: '8' }] }] }] }]; save(); go('home'); });
  const card = await page.$('#s-home .sessioncard[data-args]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600); // hold past the 450ms long-press threshold
  await page.mouse.up();
  const sheet = await page.textContent('#sheet');
  if (!/Move/.test(sheet) || !/Delete/.test(sheet) || !/Cancel/.test(sheet)) throw new Error('menu missing options: ' + sheet.slice(0, 80));
  await page.click('#sheet [data-click="cardDelete"]'); // dialog auto-accepted by handler
  await page.waitForTimeout(150);
  const gone = await page.evaluate(() => DB.workouts.length === 0);
  if (!gone) throw new Error('delete did not remove the workout');
});
await t('Move on a recurring session reschedules without double-booking the old weekday', async () => {
  await page.evaluate(() => { const dow = new Date().getDay(); DB.workouts = [{ id: 'recur1', name: 'Recur Test', days: [dow], dates: [], blocks: [{ id: uid(), heading: 'Squat', minutes: '', format: '', superset: false, exercises: [{ id: uid(), name: 'Back Squat', mode: 'reps_kg', tempo: '', rest: 120, sets: [{ t: '5', rpe: '8' }] }] }] }]; DB.sessions = []; save(); go('home'); });
  const card = await page.$('#s-home .sessioncard[data-args]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  await page.click('#sheet [data-click="cardMove"]');
  await page.waitForSelector('#moveDate', { timeout: 2000 });
  const future = await page.evaluate(() => { const d = new Date(Date.now() + 9 * 864e5); return ymd(d); });
  await page.$eval('#moveDate', (el, v) => { el.value = v; }, future);
  await page.click('#sheet [data-click="cardMoveTo"]');
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => { const w = DB.workouts[0]; const dow = new Date().getDay(); return { daysHasDow: (w.days || []).includes(dow), datesHasFuture: (w.dates || []).length === 1 }; });
  if (st.daysHasDow) throw new Error('recurring weekday not removed → double-books');
  if (!st.datesHasFuture) throw new Error('new date not added');
});
await t('a quick tap on a session card still starts it (long-press does not hijack taps)', async () => {
  await page.evaluate(() => { const today = ymd(new Date()); DB.workouts = [{ id: uid(), name: 'Tap Test', days: [], dates: [today], blocks: [{ id: uid(), heading: 'Squat', minutes: '', format: '', superset: false, exercises: [{ id: uid(), name: 'Back Squat', mode: 'reps_kg', tempo: '', rest: 120, sets: [{ t: '5', rpe: '8' }] }] }] }]; DB.sessions = []; save(); go('home'); });
  await page.click('#s-home .sessioncard[data-args]'); // fast click
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  await page.evaluate(() => go('home'));
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
