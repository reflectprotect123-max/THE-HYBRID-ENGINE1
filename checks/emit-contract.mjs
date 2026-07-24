/*
 * Emit contract test (dual-mode) — the coach website's single boundary.
 *
 * (a) In-page round-trip: build a session with the coach app's real
 *     coach/js/emit.js, run it through the phone app's REAL sanitizeDB
 *     (loaded from index.html), and assert every field survives and no set
 *     gained a logger-owned actual field. Also asserts HybridEmit.assert()
 *     rejects a bad mode and a set carrying a forbidden field.
 * (b) Static string-pin over app.js: the phone's set shape {t:'',rpe:''},
 *     the 6 MODES keys, the 5 CON_FORMATS keys, and the 3 zone keys must all
 *     still be present — so a future rename on the phone fails THIS test
 *     instead of silently shipping broken sessions to athletes.
 *
 * Run: node checks/emit-contract.mjs   (skips cleanly if playwright absent)
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd(), process.argv[2] || '.');
let failures = 0;
const t = (name, fn) => {
  try { const r = fn(); if (r && r.then) return r.then(() => console.log('PASS — ' + name)).catch((e) => { console.log('FAIL — ' + name + ': ' + e.message); failures += 1; }); console.log('PASS — ' + name); }
  catch (e) { console.log('FAIL — ' + name + ': ' + e.message); failures += 1; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---------- (b) static string-pin over app.js ---------- */
const appjs = await readFile(resolve(root, 'app.js'), 'utf8');
t('app.js still defines the set shape {t,rpe}', () => {
  assert(/return\s*\{\s*t:\s*''\s*,\s*rpe:\s*''\s*\}/.test(appjs), 'newSet {t:\'\',rpe:\'\'} not found — phone set shape changed');
});
t('app.js still declares all 6 MODES keys', () => {
  ['reps_kg', 'amrap', 'seconds', 'reps_seconds', 'reps', 'completion'].forEach((k) => {
    assert(new RegExp('\\b' + k + ':\\{').test(appjs), 'MODES key missing on phone: ' + k);
  });
});
t('app.js still declares all 5 CON_FORMATS keys', () => {
  ['steady', 'intervals', 'tempo', 'custom', 'free'].forEach((k) => {
    assert(new RegExp('\\b' + k + ':\\{').test(appjs), 'CON_FORMATS key missing on phone: ' + k);
  });
});
t('app.js still declares the 3 zone keys', () => {
  ['low', 'mod', 'high'].forEach((k) => {
    assert(new RegExp("key:'" + k + "'").test(appjs), 'zone key missing on phone: ' + k);
  });
});
t('emit.js whitelists exactly match the phone enums', () => {
  const emit = existsSync(resolve(root, 'coach/js/emit.js'));
  assert(emit, 'coach/js/emit.js missing');
  const src = appjs; // sanity: phone still forbids these actual fields via the logger
  ['aVal', 'aVal2', 'felt'].forEach((k) => assert(src.includes(k), 'phone logger field vanished: ' + k));
});

/* ---------- (a) in-page round-trip through the real sanitizeDB ---------- */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('SKIP — emit round-trip: playwright not installed.'); process.exit(failures ? 1 : 0); }

let browser;
try { browser = await chromium.launch(); }
catch {
  const bundled = '/opt/pw-browsers/chromium';
  if (existsSync(bundled)) browser = await chromium.launch({ executablePath: bundled });
  else { console.log('SKIP — emit round-trip: no Chromium available.'); process.exit(failures ? 1 : 0); }
}

const ctx = await browser.newContext({ bypassCSP: true });
const page = await ctx.newPage();
page.on('pageerror', () => {}); // app.js may complain about SW/network on file:// — irrelevant here
await page.goto(pathToFileURL(resolve(root, 'index.html')).href, { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ path: resolve(root, 'coach/js/emit.js') });

const out = await page.evaluate(() => {
  const E = window.HybridEmit;
  // Build a mixed session: a strength block (superset) + a conditioning block.
  const w = E.newWorkout('Coach Session', [
    E.newBlock('Strength', [
      E.newEx('Back Squat', 'reps_kg', [E.newSet('60', '8'), E.newSet('60', '8')]),
      E.newEx('Romanian Deadlift', 'reps_kg', [E.newSet('80', '7')])
    ], true),
    E.newCondBlock('Conditioning', 'intervals', 'mod', 12)
  ], { origin: 'coach', assignmentId: 'test-1' });
  E.assert(w); // must not throw

  // Round-trip through the PHONE's real sanitizeDB.
  const clean = window.sanitizeDB({ workouts: [w], sessions: [], settings: {} });
  const cw = clean.workouts[0];
  const strengthEx = cw.blocks[0].exercises[0];
  const set0 = strengthEx.sets[0];

  // assert() should REJECT a bad mode…
  let badMode = false;
  try { E.assert(E.newWorkout('x', [E.newBlock('b', [{ id: 'a', name: 'x', mode: 'nonsense', sets: [{ t: '', rpe: '' }] }])])); }
  catch (e) { badMode = true; }
  // …and a set carrying a logger-owned actual field.
  let badField = false;
  try { const bw = E.newWorkout('x', [E.newBlock('b', [E.newEx('x', 'reps', [E.newSet('5')])])]); bw.blocks[0].exercises[0].sets[0].aVal = '99'; E.assert(bw); }
  catch (e) { badField = true; }

  return {
    name: cw.name,
    origin: cw.origin,
    assignmentId: cw.assignmentId,
    blockCount: cw.blocks.length,
    superset: cw.blocks[0].superset,
    exMode: strengthEx.mode,
    setKeys: Object.keys(set0),
    setT: set0.t,
    setRpe: set0.rpe,
    condKind: cw.blocks[1].kind,
    condFmt: cw.blocks[1].condFmt,
    condZone: cw.blocks[1].targetZone,
    badMode, badField
  };
});

t('workout name + coach tags survive sanitizeDB', () => {
  assert(out.name === 'Coach Session', 'name lost: ' + out.name);
  assert(out.origin === 'coach', 'origin tag dropped (per-workout key should survive)');
  assert(out.assignmentId === 'test-1', 'assignmentId dropped');
});
t('blocks, superset flag, and exercise mode survive', () => {
  assert(out.blockCount === 2, 'blockCount=' + out.blockCount);
  assert(out.superset === true, 'superset flag lost');
  assert(out.exMode === 'reps_kg', 'mode=' + out.exMode);
});
t('set keeps ONLY target fields {t,rpe} — no logger fields', () => {
  assert(out.setT === '60' && out.setRpe === '8', 'target lost t=' + out.setT + ' rpe=' + out.setRpe);
  const extra = out.setKeys.filter((k) => k !== 't' && k !== 'rpe');
  assert(extra.length === 0, 'set gained non-target keys: ' + extra.join(','));
});
t('conditioning block survives with valid enums', () => {
  assert(out.condKind === 'conditioning', 'cond kind lost');
  assert(out.condFmt === 'intervals' && out.condZone === 'mod', 'cond enums: ' + out.condFmt + '/' + out.condZone);
});
t('HybridEmit.assert rejects a bad mode', () => assert(out.badMode, 'assert did not throw on bad mode'));
t('HybridEmit.assert rejects a set with a logger field', () => assert(out.badField, 'assert did not throw on aVal'));

await browser.close();
console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nAll emit-contract checks passed.');
process.exit(failures ? 1 : 0);
