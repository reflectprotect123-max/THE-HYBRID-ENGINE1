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
await t('seeded template session card present', async () => {
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
  const secs = await page.$$eval('#s-training .sec-head h2', (els) => els.map((e) => e.textContent));
  if (secs[0] !== 'Warm-up' || !secs.includes('Strength 1')) throw new Error(secs.join(','));
});
await t('superset block has "Mark round complete"', async () => {
  const label = await page.textContent('#s-training .superlabel .markall');
  if (!/Mark round complete/.test(label)) throw new Error(label);
});
await t('logger opens on a strength row with prescribed rest', async () => {
  const rows = await page.$$('#s-training .exrow.nav');
  let clicked = false;
  for (const row of rows) {
    if (/rest/.test(await row.textContent())) { await row.click(); clicked = true; break; }
  }
  if (!clicked) throw new Error('no row with prescribed rest');
  await page.waitForSelector('#s-logger.on', { timeout: 2000 });
  const head = await page.$$eval('#s-logger .sethead span', (els) => els.map((e) => e.textContent));
  if (!head.includes('KG')) throw new Error(head.join(','));
});
await t('logging a set autosaves and starts the rest chip', async () => {
  const inputs = await page.$$('#s-logger .setrow input');
  await inputs[0].fill('60'); await inputs[1].fill('12'); await inputs[2].fill('8');
  await page.click('#s-logger .setrow .tick');
  await page.waitForSelector('#restchip.show', { timeout: 2000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')));
  const ok = saved.sessions.some((s) => s.blocks.some((b) => b.exercises.some((e) => e.sets.some((st) => st.done && st.aVal === '60' && st.felt === '8'))));
  if (!ok) throw new Error('set not persisted');
});
await t('no add/remove-set steppers in the logger (mock-exact)', async () => {
  if (await page.$('#s-logger .bsteprow')) throw new Error('stepper present');
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
await t('finish session → history recorded, readiness stays hidden', async () => {
  await page.click('#s-home .sessioncard, .navlink[data-s="training"]');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  await page.click('#s-training .completebar .bigbtn');
  await page.waitForSelector('#s-home.on', { timeout: 4000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')));
  if (!saved.sessions.some((s) => s.status === 'completed')) throw new Error('no completed session');
  if (!(await page.$('#s-home .wd.has'))) throw new Error('week strip lacks .has');
  if (await page.$('#readinessCard')) throw new Error('readiness visible without tapping the WHOOP card');
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
  const rows = await page.$$('#s-training .exrow.nav');
  for (const row of rows) {
    if (/rest 3:00/.test(await row.textContent())) { await row.click(); break; }
  }
  await page.waitForSelector('#s-logger.on', { timeout: 2000 });
  const ph = await page.$eval('#s-logger .setrow input', (el) => el.placeholder);
  if (!/60 last/.test(ph)) throw new Error('placeholder=' + ph);
});
await t('builder: uniform sets collapse to one "All sets" row', async () => {
  await page.click('.navlink[data-s="builder"]');
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
await t('no Logger tab: nav is Home · Training · Builder · Conditioning · Progress', async () => {
  const navs = await page.$$eval('.navlink', (els) => els.map((e) => e.dataset.s));
  if (navs.length !== 5 || navs.includes('logger')) throw new Error(navs.join(','));
  if (!navs.includes('progress') || !navs.includes('conditioning')) throw new Error('missing tab: ' + navs.join(','));
});
await t('Conditioning: setup shows zones; demo session records live HR and saves results', async () => {
  await page.click('.navlink[data-s="conditioning"]');
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
await t('Progress tab renders trends (empty state or charts, never blank)', async () => {
  await page.click('.navlink[data-s="progress"]');
  await page.waitForSelector('#s-progress.on', { timeout: 2000 });
  const active = await page.$eval('.navlink[data-s="progress"]', (el) => el.classList.contains('active'));
  if (!active) throw new Error('Progress tab not highlighted');
  const html = await page.$eval('#s-progress', (el) => el.innerHTML);
  if (!/Your trends/.test(html)) throw new Error('progress header missing');
  // either the empty state or at least one chart must be present
  if (!/class="[^"]*empty|class="chart"/.test(html)) throw new Error('neither empty state nor chart rendered');
  await page.click('.navlink[data-s="home"]');
  await page.waitForSelector('#s-home.on', { timeout: 2000 });
});
await t('importer: paste → meaning-questions inline → learn → save lands in Builder', async () => {
  await page.click('.navlink[data-s="builder"]');
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
await t('logger detail view steps forward and back through the session', async () => {
  await page.click('.navlink[data-s="training"]');
  await page.waitForSelector('#s-training.on', { timeout: 2000 });
  await page.click('#s-training .exrow.nav');
  await page.waitForSelector('#s-logger.on', { timeout: 2000 });
  let kicker = await page.textContent('#s-logger .kicker');
  if (!/exercise 1 of \d+/.test(kicker)) throw new Error('kicker=' + kicker);
  await page.click('#s-logger .histnav .markall');
  kicker = await page.textContent('#s-logger .kicker');
  if (!/exercise 2 of \d+/.test(kicker)) throw new Error('after next: ' + kicker);
  await page.click('#s-logger .histnav .markall');
  kicker = await page.textContent('#s-logger .kicker');
  if (!/exercise 1 of \d+/.test(kicker)) throw new Error('after prev: ' + kicker);
  const training = await page.$eval('.navlink[data-s="training"]', (el) => el.classList.contains('active'));
  if (!training) throw new Error('Training tab not highlighted while logging');
});
await t('hostile exercise/target text is escaped, never executed (XSS)', async () => {
  const executed = await page.evaluate(async () => {
    window.__xss = 0;
    const evil = '<img src=x onerror="window.__xss=1">';
    WK = templateWorkout(); WK.name = 'XSS'; BUILDER_WID = WK.id; EDIT_EXISTING = false; openBlock = 2;
    WK.blocks[2].exercises[0].name = evil;
    WK.blocks[2].exercises[0].tempo = evil;
    WK.blocks[2].exercises[0].sets[0].t = evil;
    renderBuilder();
    startWorkout((DB.workouts.push(JSON.parse(JSON.stringify(WK))), DB.workouts[DB.workouts.length - 1]).id);
    openLogger(2, 0);
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
