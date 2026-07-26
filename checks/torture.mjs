let chromium; try { ({ chromium } = await import('playwright')); } catch { console.log('SKIP — torture: playwright not installed (npm i -D playwright).'); process.exit(0); }
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv[2] || '.');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

let browser; try { browser = await chromium.launch(); } catch { const b='/opt/pw-browsers/chromium'; browser = await chromium.launch({ executablePath: b }); }
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/netlify|Failed to load resource|supabase/i.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());

let failures = 0;
const t = async (name, fn) => {
  const before = errors.length;
  try { await fn(); if (errors.length > before) throw new Error('runtime errors: ' + errors.slice(before).join(' | ')); console.log('PASS — ' + name); }
  catch (e) { console.log('FAIL — ' + name + ' :: ' + e.message.split('\n')[0]); failures++; }
};
const S = () => page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')));

await page.goto(base + '/', { waitUntil: 'networkidle' });

/* ============ PART 1 — a full, realistic workout ============ */
await t('build a full workout using all six modes + superset + schedule', async () => {
  // Sessions are created via the importer now, not a manual Builder - construct
  // the saved-workout shape directly (same shape the importer produces) and
  // start it, exercising the same logger/runtime path this test is really for.
  await page.evaluate(() => {
    const today = new Date().getDay();
    const w = { id: uid(), name: 'Break Test — Full Day', days: [today], dates: [], blocks: [
      { id: uid(), heading: 'Warm-up', minutes: '8', format: '', superset: false, exercises: [{ id: uid(), name: 'Bike erg', mode: 'seconds', tempo: '', rest: 0, sets: [{ t: '120', rpe: '' }] }] },
      { id: uid(), heading: 'Prep', minutes: '', format: 'Superset', superset: true, exercises: [
        { id: uid(), name: 'Band pull-apart', mode: 'reps', tempo: '', rest: 0, sets: [{ t: '15', rpe: '' }] },
        { id: uid(), name: 'Scap push-up', mode: 'reps', tempo: '', rest: 0, sets: [{ t: '10', rpe: '' }] }] },
      { id: uid(), heading: 'Strength 1', minutes: '15', format: '', superset: false, exercises: [{ id: uid(), name: 'Incline Bench', mode: 'reps_kg', tempo: '30X1', rest: 180, sets: [{ t: '8', rpe: '8' }, { t: '8', rpe: '8' }] }] },
      { id: uid(), heading: 'Strength 2', minutes: '12', format: '', superset: false, exercises: [{ id: uid(), name: 'Chin-up', mode: 'amrap', tempo: '', rest: 120, sets: [{ t: '10', rpe: '7' }] }] },
      { id: uid(), heading: 'Finisher', minutes: '8', format: '', superset: false, exercises: [{ id: uid(), name: 'Farmer carry', mode: 'reps_seconds', tempo: '', rest: 90, sets: [{ t: '40', rpe: '8' }] }] },
      { id: uid(), heading: 'Cooldown', minutes: '5', format: '', superset: false, exercises: [{ id: uid(), name: 'Stretch flow', mode: 'completion', tempo: '', rest: 0, sets: [{ t: '', rpe: '' }] }] }
    ] };
    DB.workouts.push(w); save();
    startWorkout(w.id);
  });
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
});
await t('log EVERY set of EVERY exercise like a real session', async () => {
  const result = await page.evaluate(async () => {
    const s = curSession();
    for (let bi = 0; bi < s.blocks.length; bi++) {
      const b = s.blocks[bi];
      for (let ei = 0; ei < b.exercises.length; ei++) {
        const ex = b.exercises[ei];
        if (b.superset || ex.mode === 'completion') { ex.sets.forEach((st) => (st.done = true)); continue; }
        openLogger(bi, ei);
        // drive the guided flow the way a thumb would: values → Finish → RPE → Confirm.
        // Dispatch real input events so setActual persists values across re-renders.
        const type = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
        for (let si = 0; si < ex.sets.length; si++) {
          type('glogV1', String(40 + si * 5));
          type('glogV2', String(12 - si));
          glogFinishSet();
          glogRpeInput(String(7 + si * 0.5));
          glogConfirmSet();
          stopRest();
        }
      }
    }
    save();
    return curSession().blocks.every((b) => b.exercises.every((e) => e.sets.every((st) => st.done)));
  });
  if (!result) throw new Error('not all sets done');
});
await t('finish offered in the session view; finish lands on recap → home', async () => {
  // logging happens on its own screen now — come back to the session list first
  await page.evaluate(() => closeLogger());
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  await page.waitForSelector('#s-training .completebar .bigbtn', { timeout: 2000 });
  const label = await page.textContent('#s-training .completebar .bigbtn');
  if (!/finish/i.test(label)) throw new Error('finish label=' + label);
  await page.click('#s-training .completebar .bigbtn');
  await page.waitForSelector('#s-recap.on', { timeout: 4000 });
  await page.click('#s-recap .completebar .bigbtn');
  await page.waitForSelector('#s-home.on', { timeout: 2000 });
  const db = await S();
  if (!db.sessions.some((s) => s.status === 'completed' && s.name === 'Break Test — Full Day')) throw new Error('session not completed');
});
await t('history shows the full logged day, readiness behind WHOOP card', async () => {
  await page.click('#s-home .wd.today');
  const body = await page.textContent('#s-history');
  if (!/Incline Bench/.test(body) || !/kg/.test(body)) throw new Error('history incomplete');
  await page.click('#s-history .backbtn');
  if (await page.$('#readinessCard')) throw new Error('readiness leaked');
  await page.click('#whoopCard');
  await page.waitForSelector('#readinessCard', { timeout: 2000 });
  await page.click('#whoopCard');
});

/* ============ PART 2 — try to break it ============ */
await t('XSS: hostile names everywhere never execute', async () => {
  await page.evaluate(() => {
    window.__xss = 0;
    const evil = '<img src=x onerror="window.__xss=1">"\'><svg onload="window.__xss=1">';
    const w = templateWorkout();
    w.name = evil;
    w.blocks[0].heading = evil;
    w.blocks[0].format = evil;
    w.blocks[0].exercises[0].name = evil;
    w.blocks[0].exercises[0].tempo = evil;
    w.blocks[0].exercises[0].sets[0].t = evil;
    DB.workouts.push(w); save();
  });
  await page.click('.navlink[data-s="home"]');
  await page.evaluate((id) => startWorkout(DB.workouts[DB.workouts.length - 1].id), 0);
  await page.waitForSelector('#s-training.on');
  await page.evaluate(() => { openLogger(0, 0); });
  await page.evaluate(() => { const st = curSession().blocks[0].exercises[0].sets[0]; st.aVal = '<img src=x onerror="window.__xss=1">'; st.done = true; save(); renderSession(); stopRest(); });
  await page.evaluate(() => { renderLibrary(); go('library'); });
  await page.waitForSelector('#s-library.on');
  await page.waitForTimeout(400);
  const xss = await page.evaluate(() => window.__xss);
  if (xss) throw new Error('XSS EXECUTED');
  await page.evaluate(() => {
    const id = DB.workouts[DB.workouts.length - 1].id;
    DB.workouts = DB.workouts.filter((x) => x.id !== id);
    DB.sessions = DB.sessions.filter((s) => s.workoutId !== id);
    CUR_SESSION = null; save();
  });
});
await t('empty workout: zero blocks, try to run it', async () => {
  await page.evaluate(() => {
    const w = { id: uid(), name: 'Empty', days: [], dates: [], blocks: [] };
    DB.workouts.push(w); save();
    startWorkout(w.id);
  });
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => ({ sess: DB.sessions.filter((s) => s.name === 'Empty').length }));
  // acceptable outcomes: no session, or a session that exists but can't be "all done"
  if (state.sess) {
    const finishable = await page.evaluate(() => { const s = DB.sessions.find((x) => x.name === 'Empty' && x.status === 'active'); return s ? sessionAllDone(s) : false; });
    if (finishable) throw new Error('empty session is instantly finishable (vacuous truth)');
  }
  await page.evaluate(() => {
    DB.workouts = DB.workouts.filter((w) => w.name !== 'Empty');
    DB.sessions = DB.sessions.filter((s) => s.name !== 'Empty');
    CUR_SESSION = null; save(); go('home');
  });
});
await t('corrupted localStorage: garbage JSON boots clean', async () => {
  await page.evaluate(() => localStorage.setItem('hybrid-engine-v1', '{{{{not json'));
  await page.reload({ waitUntil: 'networkidle' });
  const h1 = await page.textContent('#s-home h1');
  if (h1.trim() !== 'Train today') throw new Error('did not boot');
});
await t('corrupted localStorage: wrong shapes (workouts not an array) boots clean', async () => {
  await page.evaluate(() => localStorage.setItem('hybrid-engine-v1', JSON.stringify({ workouts: { a: 1 }, sessions: 'nope', settings: 7 })));
  await page.reload({ waitUntil: 'networkidle' });
  const h1 = await page.textContent('#s-home h1').catch(() => '');
  if (h1.trim() !== 'Train today') throw new Error('home did not render');
});
await t('corrupted records: workout without blocks, session without blocks', async () => {
  await page.evaluate(() => {
    localStorage.setItem('hybrid-engine-v1', JSON.stringify({
      workouts: [{ id: 'w1', name: 'No blocks' }, { id: 'w2', name: 'Bad ex', blocks: [{ id: 'b', heading: 'B', exercises: [{ id: 'e', name: 'X', mode: 'reps_kg' }] }] }],
      sessions: [{ id: 's1', workoutId: 'w1', name: 'Ghost', date: '2026-07-20', status: 'completed', completedAt: 1 }],
      settings: { seedV: 2 },
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  const h1 = await page.textContent('#s-home h1').catch(() => '');
  if (h1.trim() !== 'Train today') throw new Error('home did not render');
  await page.click('#s-home .sessioncard');
  await page.waitForTimeout(300);
  await page.click('.navlink[data-s="home"]');
});
await t('stale active session from yesterday becomes incomplete history', async () => {
  await page.evaluate(() => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const key = ymd(y);
    localStorage.setItem('hybrid-engine-v1', JSON.stringify({
      workouts: [], sessions: [{ id: 'old1', workoutId: 'gone', name: 'Yesterday', date: key, status: 'active', startedAt: Date.now() - 86400000, blocks: [{ id: 'b', heading: 'B', superset: false, exercises: [{ id: 'e', name: 'Row', mode: 'reps_kg', rest: 0, sets: [{ t: '5', rpe: '', aVal: '60', aVal2: '5', felt: '', done: true }] }] }] }],
      settings: { seedV: 2 },
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  const db = await S();
  const s = db.sessions.find((x) => x.id === 'old1');
  if (!s || s.status !== 'incomplete') throw new Error('status=' + (s && s.status));
});
await t('absurd inputs: negative, huge, emoji, 10k-char name', async () => {
  await page.evaluate(() => {
    const w = templateWorkout();
    w.name = '💀'.repeat(50) + 'x'.repeat(10000);
    w.blocks[0].exercises[0].name = 'Bench';
    w.blocks[0].exercises[0].rest = '999999';
    w.blocks[0].exercises[0].sets = [{ t: '-5', rpe: '99' }, { t: '1e9', rpe: '-3' }, { t: '0.0001', rpe: '🔥' }];
    DB.workouts.push(w); save(); startWorkout(w.id);
  });
  await page.waitForSelector('#s-training.on');
  await page.evaluate(() => openLogger(0, 0));
  await page.evaluate(() => {
    const type = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    type('glogV1', '-100'); type('glogV2', '999999999');
    glogFinishSet(); glogRpeInput('emoji🔥'); glogConfirmSet();
  });
  const chip = await page.$eval('#restchip', (el) => el.classList.contains('show'));
  if (!chip) throw new Error('rest did not start for huge rest value');
  await page.click('#restchip');
  await page.evaluate(() => {
    const id = DB.workouts[DB.workouts.length - 1].id;
    DB.workouts = DB.workouts.filter((x) => x.id !== id);
    DB.sessions = DB.sessions.filter((s) => s.workoutId !== id);
    CUR_SESSION = null; save();
  });
});
await t('spam: 30 blocks, 50 sets, rapid tick/untick, rapid prev/next', async () => {
  await page.evaluate(() => {
    const w = { id: uid(), name: 'Spam', days: [], dates: [], blocks: Array.from({ length: 30 }, () => newBlock()) };
    // pad block[2]'s exercise to 50 sets (matches the old addBlock/bumpSets torture shape)
    const ex = w.blocks[2].exercises[0];
    ex.sets = Array.from({ length: 50 }, (_, i) => ({ t: ex.sets[0]?.t || '', rpe: ex.sets[0]?.rpe || '' }));
    DB.workouts.push(w); save();
    startWorkout(w.id);
  });
  await page.waitForSelector('#s-training.on');
  await page.evaluate(() => openLogger(2, 0));
  await page.evaluate(() => { for (let i = 0; i < 40; i++) { glogFinishSet(); glogRpeInput(String((i % 10) || 5)); glogConfirmSet(); stopRest(); } });
  await page.evaluate(() => { for (let i = 0; i < 60; i++) openLogger(i % 5, 0); });
  const db = await S();
  const spam = db.sessions.find((s) => s.name === 'Spam' && s.status === 'active');
  if (!spam) throw new Error('spam session lost');
  await page.evaluate(() => {
    const id = DB.workouts.find((w) => w.name === 'Spam').id;
    DB.workouts = DB.workouts.filter((x) => x.id !== id);
    DB.sessions = DB.sessions.filter((s) => s.workoutId !== id);
    CUR_SESSION = null; save();
  });
});
await t('planner hammer: rapid set-bumps + chain merge/split keep the shape sane', async () => {
  await page.evaluate(() => {
    DB.workouts.push({ id: 'torplan', name: 'TorPlan', days: [], dates: [], blocks: [
      { id: uid(), heading: 'A', minutes: '', format: '', superset: false, exercises: [{ id: uid(), name: 'X', mode: 'reps_kg', tempo: '', rest: 60, sets: [{ t: '5', rpe: '' }] }] },
      { id: uid(), heading: 'B', minutes: '', format: '', superset: false, exercises: [{ id: uid(), name: 'Y', mode: 'reps_kg', tempo: '', rest: 60, sets: [{ t: '5', rpe: '' }] }] }] });
    save(); openPlanner('torplan', { bi: 0, ei: 0 });
    for (let i = 0; i < 30; i++) planBumpSets(1);
    for (let i = 0; i < 60; i++) planBumpSets(-1); // floor is 1, over-popping must be safe
    for (let i = 0; i < 10; i++) {
      planLink(0, 0, true);  // merge (no-ops once single block)
      const b = DB.workouts.find((w) => w.id === 'torplan').blocks;
      if (b[0] && b[0].superset) planLink(0, 0, false); // split back
    }
  });
  const ok = await page.evaluate(() => {
    const w = DB.workouts.find((x) => x.id === 'torplan');
    const sane = sanitizeDB(JSON.parse(JSON.stringify(DB)));
    const w2 = sane.workouts.find((x) => x.id === 'torplan');
    const shapeOk = w.blocks.every((b) => b.exercises.every((e) => e.sets.length >= 1 && e.sets.every((st) => 't' in st && 'rpe' in st)));
    const r = { shapeOk, survived: !!w2, blocks: w.blocks.length };
    DB.workouts = DB.workouts.filter((x) => x.id !== 'torplan'); save(); go('home');
    return r;
  });
  if (!ok.shapeOk || !ok.survived) throw new Error(JSON.stringify(ok));
});
await t('history navigation 400 days back and forth', async () => {
  await page.evaluate(() => openHistory(ymd(new Date())));
  await page.evaluate(() => { for (let i = 0; i < 400; i++) shiftHistory(-1); for (let i = 0; i < 400; i++) shiftHistory(1); });
  const h1 = await page.textContent('#s-history h1');
  if (!h1) throw new Error('history broke');
  await page.click('#s-history .backbtn');
});
await t('garbage import file is rejected politely', async () => {
  await page.evaluate(() => go('settings'));
  const before = await S();
  await page.evaluate(() => {
    const bad = new File(['{"nope":true}'], 'bad.json', { type: 'application/json' });
    importData({ target: { files: [bad] } });
  });
  await page.waitForTimeout(400);
  const after = await S();
  if (JSON.stringify(before.workouts) !== JSON.stringify(after.workouts)) throw new Error('garbage import mutated data');
});
await t('double-finish and finish-with-nothing are safe', async () => {
  await page.evaluate(() => { CUR_SESSION = null; finishSession({ textContent: '', classList: { add() {} } }); finishSession({ textContent: '', classList: { add() {} } }); });
});
await t('rest timer: 1s rest expires and clears persistence', async () => {
  await page.evaluate(() => startRest(1));
  await page.waitForTimeout(1800);
  const shown = await page.$eval('#restchip', (el) => el.classList.contains('show'));
  const key = await page.evaluate(() => localStorage.getItem('hybrid-engine-v1-rest-ends'));
  if (shown || key) throw new Error('rest chip/persistence not cleared');
});

if (errors.length) { console.log('UNATTRIBUTED RUNTIME ERRORS:'); errors.forEach((e) => console.log('  ' + e)); }
await browser.close(); server.close();
console.log(failures ? `RESULT: ${failures} failure(s)` : 'RESULT: all torture tests passed');
process.exit(failures ? 1 : 0);
