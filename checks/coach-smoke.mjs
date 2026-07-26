/*
 * Coach website smoke test — drives coach/index.html in headless Chromium.
 * Local-first: no Supabase needed (runs fully offline). Skips if playwright
 * is unavailable. Run: node checks/coach-smoke.mjs
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('SKIP — coach smoke: playwright not installed.'); process.exit(0); }

const root = resolve(process.cwd(), process.argv[2] || '.');
let browser;
try { browser = await chromium.launch(); }
catch {
  const bundled = '/opt/pw-browsers/chromium';
  if (existsSync(bundled)) browser = await chromium.launch({ executablePath: bundled });
  else { console.log('SKIP — coach smoke: no Chromium available.'); process.exit(0); }
}

const errors = [];
let failures = 0;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, bypassCSP: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());

const t = async (name, fn) => { try { await fn(); console.log('PASS — ' + name); } catch (e) { console.log('FAIL — ' + name + ': ' + e.message); failures += 1; } };
const url = pathToFileURL(resolve(root, 'coach/index.html')).href;
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

await t('boots into the seeded program (name + 7 day pills + the day-1 session)', async () => {
  if ((await page.textContent('#progname')).trim() !== 'Sample Program') throw new Error('progname');
  if ((await page.$$('#days .day')).length !== 7) throw new Error('day count');
  const cards = await page.$$('.lgx');
  if (cards.length < 4) throw new Error('expected the seeded session cards, got ' + cards.length);
  const heads = await page.$$eval('.sech', (els) => els.map((e) => e.value));
  if (heads[0] !== 'Main') throw new Error('headings: ' + heads.join(','));
});
await t('day pills mark days that have sessions', async () => {
  const has = await page.$$eval('#days .day', (els) => els.map((e) => e.classList.contains('has')));
  // seeded: days 1, 4 and 6 carry sessions (indices 0, 3, 5)
  if (!(has[0] && !has[1] && !has[2] && has[3] && !has[4] && has[5] && !has[6])) throw new Error(has.join(','));
});
await t('switching to a rest day shows the empty-session state', async () => {
  await page.click('#days .day[data-i="2"]');
  const body = await page.textContent('#editor');
  if (!/Add a session to this day/.test(body)) throw new Error('no empty state: ' + body.slice(0, 60));
  await page.click('#days .day[data-i="0"]');
});
await t('letters run across the session, and a chain builds a superset', async () => {
  const before = await page.$$eval('.lgltr', (els) => els.map((e) => e.textContent).join(' '));
  if (before.indexOf('A B') !== 0) throw new Error('letters do not run across the session: ' + before);
  await page.click('.planseam button');           // chain Main's pair
  const after = await page.$$eval('.lgltr', (els) => els.map((e) => e.textContent).join(' '));
  if (after.indexOf('A1 A2') !== 0) throw new Error('chain did not build a superset: ' + after);
  if (!(await page.$('.superwrap'))) throw new Error('no superset rail');
  await page.click('.planseam button.on');        // and split it back
  const back = await page.$$eval('.lgltr', (els) => els.map((e) => e.textContent).join(' '));
  if (back.indexOf('A B') !== 0) throw new Error('split did not restore: ' + back);
});
await t('typing a target persists, and W marks the set a warm-up', async () => {
  await page.click('[data-act="open"][data-b="0"][data-e="0"]');
  await page.waitForSelector('.lgx.open .setrow', { timeout: 1500 });
  const warm = await page.$$eval('.setrow.warm', (els) => els.length);
  if (warm !== 2) throw new Error('seeded warm-ups not flagged: ' + warm);
  const box = await page.$('[data-act="st"][data-b="0"][data-e="0"][data-s="2"]');
  await box.click({ clickCount: 3 });
  await box.type('6');
  await page.waitForTimeout(60);
  const val = await page.evaluate(() => window.__coach.LIB.programs[0].weeks[0].days[0].blocks[0].ex[0].sets[2].t);
  if (val !== '6') throw new Error('target not in the model: ' + val);
  const ls = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-coach-v1')).programs[0].weeks[0].days[0].blocks[0].ex[0].sets[2].t);
  if (ls !== '6') throw new Error('target not in localStorage: ' + ls);
  // and typing a W retags the row live, without a re-render
  const box2 = await page.$('[data-act="st"][data-b="0"][data-e="0"][data-s="3"]');
  await box2.click({ clickCount: 3 });
  await box2.type('W8');
  await page.waitForTimeout(60);
  const warm2 = await page.$$eval('.setrow.warm', (els) => els.length);
  if (warm2 !== 3) throw new Error('W did not retag the row: ' + warm2);
  await box2.click({ clickCount: 3 });
  await box2.type('5');
  await page.waitForTimeout(60);
});
await t('the published snapshot carries rest, cue, RPE, superset and conditioning', async () => {
  await page.fill('[data-act="cue"][data-b="0"][data-e="0"]', 'Work up to 120kg.');
  const snap = await page.evaluate(() => window.__coach.snapshot());
  const b0 = snap.blocks[0], e0 = b0.exercises[0];
  if (e0.rest !== 180) throw new Error('rest not carried: ' + e0.rest);          // was hardcoded 90
  if (e0.cue !== 'Work up to 120kg.') throw new Error('cue not carried: ' + e0.cue);
  if (b0.minutes !== '18 min') throw new Error('block minutes not carried: ' + b0.minutes);
  if (Object.keys(e0.sets[0]).sort().join(',') !== 'rpe,t') throw new Error('set shape grew: ' + Object.keys(e0.sets[0]));
  if (e0.sets[0].t !== 'W10') throw new Error('warm-up target not carried: ' + e0.sets[0].t);
  if (e0.sets[3].rpe !== '8') throw new Error('per-set RPE not carried: ' + e0.sets[3].rpe);
  const ss = snap.blocks.filter((b) => b.superset)[0];
  if (!ss || ss.exercises.length !== 2) throw new Error('superset not carried');
  const cond = snap.blocks.filter((b) => b.kind === 'conditioning')[0];
  if (!cond) throw new Error('conditioning block never emitted');
  if (cond.condFmt !== 'intervals' || cond.effort !== 'medium' || cond.targetZone !== 'mod') throw new Error('conditioning: ' + JSON.stringify(cond));
  if (snap.note !== 'Belt optional. Honest bar speed on all five.') throw new Error('coach note not carried: ' + snap.note);
});
await t('adding an exercise grows the session', async () => {
  const before = (await page.$$('.lgx')).length;
  await page.click('[data-act="addex"]');
  await page.waitForTimeout(80);
  await page.click('[data-act="mclose"]').catch(() => {});   // the movement picker opens with it
  if ((await page.$$('.lgx')).length !== before + 1) throw new Error('exercise not added');
});
await t('week selector switches weeks', async () => {
  await page.click('[data-act="wkmenu"]');
  await page.waitForSelector('.mmenu', { timeout: 1500 });
  await page.click('.mmenu button[data-v="Week 2"]');
  if (!/Week 2/.test(await page.textContent('#wklabel'))) throw new Error('week label');
  const body = await page.textContent('#editor');
  if (!/Add a session to this day/.test(body)) throw new Error('week2 not empty');
});
await t('account modal opens (sign-in gate present)', async () => {
  await page.click('[data-act="account"]');
  await page.waitForSelector('#modal.on', { timeout: 1500 });
  if (!/Coach sign in/.test(await page.textContent('#modal'))) throw new Error('no auth card');
  await page.click('[data-act="mclose"]');
});

await t('no unexpected console errors', async () => {
  const real = errors.filter((e) => !/supabase|Failed to load resource|net::|ERR_/i.test(e));
  if (real.length) throw new Error(real.slice(0, 4).join(' | '));
});

await browser.close();
console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nAll coach-smoke checks passed.');
process.exit(failures ? 1 : 0);
