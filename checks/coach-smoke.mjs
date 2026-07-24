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

await t('boots into the seeded program (name + 7 days + 2 exercises)', async () => {
  if ((await page.textContent('#progname')).trim() !== 'SANDBOX – test – delete me') throw new Error('progname');
  if ((await page.$$('#days .day')).length !== 7) throw new Error('day count');
  if ((await page.$$('.exc')).length !== 2) throw new Error('exercise count');
});
await t('day pills mark days that have sessions', async () => {
  const has = await page.$$eval('#days .day', (els) => els.map((e) => e.classList.contains('has')));
  // seeded: days 1,2,4,6 have sessions (indices 0,1,3,5)
  if (!(has[0] && has[1] && !has[2] && has[3] && !has[4] && has[5] && !has[6])) throw new Error(has.join(','));
});
await t('switching to a rest day shows the empty-session state', async () => {
  await page.click('#days .day[data-i="2"]');
  const body = await page.textContent('#editor');
  if (!/Add a session to this day/.test(body)) throw new Error('no empty state: ' + body.slice(0, 60));
  await page.click('#days .day[data-i="0"]'); // back to day 1
});
await t('chain-link builds a superset (A/B -> A1/A2)', async () => {
  await page.click('.exlink .chain');
  const mks = await page.$$eval('.exhdr .mk', (els) => els.map((e) => e.textContent));
  if (mks[0] !== 'A1' || mks[1] !== 'A2') throw new Error(mks.join(','));
  await page.click('.exlink .chain'); // unlink
  const mks2 = await page.$$eval('.exhdr .mk', (els) => els.map((e) => e.textContent));
  if (mks2[0] !== 'A' || mks2[1] !== 'B') throw new Error('unlink: ' + mks2.join(','));
});
await t('metric dropdown opens with the full measure list', async () => {
  await page.click('.rxth .c[data-c="1"]'); // Weight (lb) column header
  await page.waitForSelector('.mmenu', { timeout: 1500 });
  const opts = await page.$$eval('.mmenu button', (els) => els.map((e) => e.textContent));
  if (opts.length !== 14 || opts[0] !== 'Reps' || !opts.includes('Calories (cal)')) throw new Error(opts.join(','));
  await page.click('.mmenu button[data-v="Weight (kg)"]');
  const hdr = await page.textContent('.rxth .c[data-c="1"]');
  if (!/Weight \(kg\)/.test(hdr)) throw new Error('header not relabeled: ' + hdr);
});
await t('editing a prescription cell persists to localStorage', async () => {
  const input = await page.$('.rxr input[data-e="0"][data-s="0"][data-c="0"]');
  await input.click({ clickCount: 3 });
  await input.type('7');
  await page.waitForTimeout(50);
  const val = await page.evaluate(() => window.__coach.LIB.programs[0].weeks[0].days[0].exercises[0].sets[0][0]);
  if (val !== '7') throw new Error('not persisted: ' + val);
  const ls = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-coach-v1')).programs[0].weeks[0].days[0].exercises[0].sets[0][0]);
  if (ls !== '7') throw new Error('not in localStorage: ' + ls);
});
await t('adding an exercise grows the session', async () => {
  const before = (await page.$$('.exc')).length;
  await page.click('[data-act="addex"]');
  if ((await page.$$('.exc')).length !== before + 1) throw new Error('exercise not added');
});
await t('week selector switches weeks', async () => {
  await page.click('[data-act="wkmenu"]');
  await page.waitForSelector('.mmenu', { timeout: 1500 });
  await page.click('.mmenu button[data-v="Week 2"]');
  if (!/Week 2/.test(await page.textContent('#wklabel'))) throw new Error('week label');
  const body = await page.textContent('#editor'); // week 2 day 1 is empty
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
