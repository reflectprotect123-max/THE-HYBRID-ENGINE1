/*
 * Phase 0 of the React migration — capture a behavioural baseline.
 *
 * Loads the CURRENT vanilla app.js in a headless page, drives the engine
 * functions over a fixed matrix of inputs, and writes the outputs to
 * packages/engine/test/golden/*.json.
 *
 * These fixtures are the contract the rewritten TypeScript engine has to
 * satisfy. They are generated from the shipped code, so they encode what the
 * app actually does today — including the bugs it has already had fixed.
 * Regenerating them is a deliberate act: if a number here changes, someone
 * changed behaviour, and that has to be justified rather than absorbed.
 *
 * Run: node checks/golden-vectors.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd(), process.argv[2] || '.');
const outDir = resolve(root, 'packages/engine/test/golden');

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('golden-vectors needs playwright.'); process.exit(1); }

let browser;
try { browser = await chromium.launch(); }
catch {
  const bundled = '/opt/pw-browsers/chromium';
  if (!existsSync(bundled)) { console.error('No Chromium available.'); process.exit(1); }
  browser = await chromium.launch({ executablePath: bundled });
}

const ctx = await browser.newContext({ bypassCSP: true });
const page = await ctx.newPage();
page.on('pageerror', () => {}); // file:// load complains about SW/network; irrelevant here
await page.goto(pathToFileURL(resolve(root, 'index.html')).href, { waitUntil: 'domcontentloaded' });

const vectors = await page.evaluate(() => {
  const out = {};

  /* ---------- pure numeric helpers ---------- */
  const kgs = [0, 1, 2.5, 20, 42.5, 60, 100, 137.5, 200, 1999, 2000, 2001, -5, NaN];
  const reps = [0, 1, 2, 3, 5, 8, 10, 12, 15, 20, 30];

  out.epley = [];
  for (const kg of kgs) for (const r of reps) out.epley.push({ kg, reps: r, out: epley(kg, r) });

  out.roundToIncrement = [];
  for (const v of [-10, 0, 0.4, 1.2, 2.4, 2.6, 61.3, 99.9, 1999.9, 2500, Infinity, NaN])
    for (const inc of [0, 0.5, 1, 2.5, 5]) out.roundToIncrement.push({ v, inc, out: roundToIncrement(v, inc) });

  out.saneKg = ['', '0', '-1', '2.5', '100', '2000', '5000', 'abc', 'Infinity', '1e9', null, undefined]
    .map((v) => ({ in: v === undefined ? '__undefined__' : v, out: saneKg(v) }));

  out.sanNumStr = ['', ' ', '0', '-4', '12', '12.75', 'abc', '1e12', 'Infinity', '  9 ', null]
    .map((v) => ({ in: v, out: sanNumStr(v) }));

  /* ---------- autoregulation ---------- */
  out.verdictForRpe = [];
  for (const rpe of [1, 3, 5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10])
    for (const center of [null, 6, 7, 8, 8.5, 9])
      out.verdictForRpe.push({ rpe, center, out: verdictForRpe(rpe, center) });

  out.computeSetAdjustment = [];
  for (const weight of [20, 60, 100, 142.5])
    for (const rpe of [5, 6.5, 7.5, 8, 8.5, 9, 10])
      for (const low of [0, 5, 8])
        for (const repsDone of [3, 5, 8, 12])
          for (const center of [7, 8.5])
            out.computeSetAdjustment.push({
              reps: repsDone, rpe, low, weight, center,
              out: computeSetAdjustment(repsDone, rpe, low, weight, center)
            });

  out.rpeCenterOf = [
    { rpe: '' }, { rpe: '8' }, { rpe: '7-9' }, { rpe: '7.5' }, { rpe: '6/8/10' }, { rpe: 'hard' }, { rpe: 8 }
  ].map((st) => ({ in: st, out: rpeCenterOf(st) }));

  out.isWarmup = ['', 'W', 'w', ' W10', 'W5', '10', 'max', 'warm', 'AMRAP', null, undefined]
    .map((t) => ({ t: t === undefined ? '__undefined__' : t, out: isWarmup({ t }) }));

  out.plateBreakdown = [];
  for (const total of [0, 20, 22.5, 60, 61, 100, 142.5, 200])
    for (const bar of [0, 15, 20])
      for (const plates of [[25, 20, 15, 10, 5, 2.5, 1.25], [20, 10, 5, 2.5], []])
        out.plateBreakdown.push({ total, bar, plates, out: plateBreakdown(total, bar, plates) });

  /* ---------- conditioning effort ---------- */
  out.condEffort = [
    {}, { effort: 'easy' }, { effort: 'medium' }, { effort: 'hard' }, { effort: 'bogus' },
    { targetZone: 'low' }, { targetZone: 'mod' }, { targetZone: 'high' }, { targetZone: 'nope' },
    { effort: 'hard', targetZone: 'low' }
  ].map((b) => ({ in: b, out: condEffort(b) }));

  out.condEffortGap = [];
  for (const key of ['easy', 'medium', 'hard'])
    for (const felt of [1, 3, 3.5, 4, 5, 6, 7, 8, 9, 9.5, 10, NaN, null])
      out.condEffortGap.push({ effort: key, felt, out: condEffortGap(CON_EFFORTS[key], felt) });

  out.condEffortRpe = ['easy', 'medium', 'hard'].map((k) => ({ effort: k, out: condEffortRpe(CON_EFFORTS[k]) }));

  /* ---------- HR zones ----------
     conZones reads its inputs off DB.settings.profile and the live WHOOP
     sample, not off arguments, so the matrix is driven by seeding those two
     globals: profile.maxHr (manual override), profile.restingHr, and
     WHOOP.sample.recoveryScore (which selects the re-zoning band). */
  const seedHr = (maxHr, rest, rec) => {
    DB = { workouts: [], sessions: [], settings: { profile: { age: 30, maxHr, restingHr: rest } } };
    WHOOP.sample = rec == null ? null : { recoveryScore: rec, restingHr: rest || null };
  };

  out.conMaxHr = [];
  for (const p of [{}, { age: 20 }, { age: 30 }, { age: 45 }, { age: 60 }, { maxHr: 195 },
    { age: 30, obsMaxHr: 200 }, { age: 30, obsMaxHr: 150 }, { maxHr: 180, obsMaxHr: 205 }]) {
    DB = { workouts: [], sessions: [], settings: { profile: p } };
    out.conMaxHr.push({ profile: p, out: conMaxHr() });
  }

  out.conZones = [];
  for (const maxHr of [180, 190, 200])
    for (const rest of [0, 45, 60, 175])
      for (const rec of [null, 25, 40, 55, 70, 90]) {
        seedHr(maxHr, rest, rec);
        const z = conZones();
        out.conZones.push({
          maxHr, rest, rec,
          out: { floor: z.floor, max: z.max, rest: z.rest, rec: z.rec, adj: z.adj, method: z.method,
            bands: z.list.map((b) => ({ key: b.key, lo: b.lo, hi: b.hi })) }
        });
      }

  out.conZoneOf = [];
  seedHr(190, 50, null);
  const z190 = conZones();
  for (const bpm of [40, 80, 110, 130, 150, 165, 175, 190, 220])
    out.conZoneOf.push({ bpm, out: conZoneOf(bpm, z190).key });

  out.recoveryBand = [null, '', undefined, 0, 1, 33, 34, 50, 66, 67, 100, 120, -5, 'abc', '55']
    .map((v) => ({ in: v === undefined ? '__undefined__' : v, out: recoveryBand(v) }));

  out.conHrr = [
    { every: 2, pts: [] },
    { every: 2, pts: [120, 140, 170, 160, 150, 140, 130, 125, 120, 118, 116, 115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98, 97, 96, 95, 94] },
    { every: 1, pts: [100, 150, 180, 175, 170, 165, 160, 155, 150, 145, 140] },
    { every: 5, pts: [90, 160, 155, 150, 140, 130, 120, 110, 100, 95, 92, 90, 88, 86, 84] },
    { every: 2, pts: [null, null, 170, null, null, 140] }
  ].map((ds) => ({ in: ds, out: conHrr(ds) }));

  /* ---------- session maths ---------- */
  const mkSet = (t, rpe, aVal, aVal2, done, felt) => ({ t, rpe, aVal, aVal2, done, felt });
  const sessions = [
    { id: 's1', date: '2026-01-10', status: 'completed', completedAt: 1000, startedAt: 900, blocks: [
      { exercises: [{ name: 'Back Squat', mode: 'reps_kg', sets: [
        mkSet('W10', '', '40', '10', true, '4'),
        mkSet('5', '8', '100', '5', true, '8'),
        mkSet('5', '8', '100', '5', true, '9')
      ] }] }
    ] },
    { id: 's2', date: '2026-01-12', status: 'completed', completedAt: 2000, startedAt: 1900, blocks: [
      { exercises: [{ name: 'Bench', mode: 'reps_kg', sets: [
        mkSet('8', '7', '60', '8', true, '7'),
        mkSet('8', '7', '60', '6', false, '')
      ] }] },
      { kind: 'conditioning', condFmt: 'intervals', effort: 'hard',
        condResult: { effort: 'hard', felt: '7', targetRpe: 8.5 } }
    ] },
    { id: 's3', date: '2026-01-14', status: 'active', startedAt: 3000, blocks: [] }
  ];
  out.sessionVolume = sessions.map((s) => ({ id: s.id, out: sessionVolume(s) }));
  out.sessionRpe = sessions.map((s) => ({ id: s.id, out: sessionRpe(s) }));
  out.sessionScore = sessions.map((s) => ({ id: s.id, out: sessionScore(s) }));

  DB = { workouts: [], sessions: [], settings: {} };
  out.detectPRs = sessions.map((s) => ({ id: s.id, out: detectPRs(s) }));

  /* ---------- prescription line ---------- */
  out.rxLine = [
    { name: 'A', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }, { t: '5', rpe: '8' }] },
    { name: 'B', mode: 'reps_kg', sets: [{ t: '8', rpe: '7' }, { t: '6', rpe: '8' }, { t: '4', rpe: '9' }] },
    { name: 'C', mode: 'amrap', sets: [{ t: 'max', rpe: '9' }] },
    { name: 'D', mode: 'completion', sets: [{ t: '', rpe: '' }, { t: '', rpe: '' }] },
    { name: 'E', mode: 'seconds', sets: [{ t: '60', rpe: '' }], rest: 90 },
    { name: 'F', mode: 'reps_kg', sets: [{ t: '5', rpe: '8' }], tempo: '30X1', rest: 180 },
    { name: 'G', mode: 'reps', sets: [{ t: '', rpe: '' }] }
  ].map((ex) => ({ in: ex, out: rxLine(ex) }));

  /* ---------- sanitize + merge (the data-loss surface) ---------- */
  out.sanitizeDB = [
    {},
    { workouts: null, sessions: 'nope', settings: 5 },
    { workouts: [{ id: 'w1', name: 'X', blocks: [{ exercises: [{ id: 'e', name: 'Sq', mode: 'reps_kg', sets: [{ t: '5', rpe: '8', aVal: '99', felt: '9' }] }] }] }], sessions: [], settings: {} },
    { workouts: [{ id: 'w2', name: '<img src=x onerror=alert(1)>', blocks: [] }], sessions: [], settings: {} },
    { workouts: [{ id: 'w3', name: 'Inf', blocks: [{ exercises: [{ id: 'e', name: 'Sq', mode: 'reps_kg', sets: [{ t: 'Infinity', rpe: '1e99' }] }] }] }], sessions: [], settings: {} }
  ].map((db) => ({ in: db, out: sanitizeDB(JSON.parse(JSON.stringify(db))) }));

  const dbA = { workouts: [{ id: 'w1', name: 'A', updatedAt: 100, blocks: [] }], sessions: [{ id: 's1', date: '2026-01-01', status: 'completed', completedAt: 100, blocks: [] }], settings: { maxHr: 190, updatedAt: 100 } };
  const dbB = { workouts: [{ id: 'w1', name: 'B', updatedAt: 200, blocks: [] }], sessions: [{ id: 's1', date: '2026-01-01', status: 'completed', completedAt: 200, blocks: [] }], settings: { maxHr: 185, updatedAt: 200 } };
  const dbC = { workouts: [{ id: 'w1', name: 'C', updatedAt: 200, blocks: [] }], sessions: [], settings: {} };
  out.mergeEngines = [
    { label: 'a<b', out: mergeEngines(JSON.parse(JSON.stringify(dbA)), JSON.parse(JSON.stringify(dbB))) },
    { label: 'b<a', out: mergeEngines(JSON.parse(JSON.stringify(dbB)), JSON.parse(JSON.stringify(dbA))) },
    { label: 'tie', out: mergeEngines(JSON.parse(JSON.stringify(dbB)), JSON.parse(JSON.stringify(dbC))) },
    { label: 'empty', out: mergeEngines({ workouts: [], sessions: [], settings: {} }, JSON.parse(JSON.stringify(dbA))) }
  ];

  /* ---------- importer ----------
     Real-shaped workout text: whiteboard shorthand, ladders, supersets,
     coaching prose, typos, and a photo-OCR-style run-together block. The
     parser's job is to be forgiving, so the vectors have to be messy. */
  DB = { workouts: [], sessions: [], settings: {} };
  const IMP_CASES = [
    'Back squat 5x5 @rpe8',
    'Squat 5x5\nRDL 3x8 rpe7\nrest 120',
    'Lower A\nA1) Back squat 5x5 @8\nA2) RDL 3x10\nB) Walking lunge 3x12 each side',
    'Warm-up\nBike 5 min\nMain\nDeadlift 3x3 @9\nAccessories\nPlank 3x45s',
    '18-16-14-12-10\nWall ball\nCal row',
    'EMOM 12\nBurpee 8\nKb swing 12',
    'AMRAP 20\n5 pull ups\n10 push ups\n15 air squats',
    'Then 3 rounds\nFarmer carry 40m\nSled push 20m',
    'Bench press 8,8,6,6 @ 80kg',
    'Squat 5x5\ntest 90',
    'Notes: keep the bar close and brace before you descend',
    'Front squats 4x6 rpe 7\nStimulus: this should feel fast\nDo not go to failure',
    'Deadlift 5x3\ninto Circuit\nRow 500m\nBurpees 15',
    'Sqaut 5x5',
    'Strength 5x5\nRomanian deadlifts 3x8',
    'Rest day',
    '',
    'Cardio of choice 30 min',
    'Weighted pull up 4x6 each side @rpe 8 rest 180',
  ];
  out.impParse = IMP_CASES.map((text) => {
    const r = impParse(text);
    return {
      in: text,
      out: {
        name: r.name,
        notes: r.notes,
        issues: r.issues.map((i) => ({ kind: i.kind, word: i.word, raw: i.raw, name: i.name, fuzzy: !!i.fuzzy, text: i.text })),
        blocks: r.blocks.map((b) => ({
          heading: b.heading, format: b.format, rounds: b.rounds, rest: b.rest, superset: b.superset,
          exercises: b.exercises.map((e) => ({
            name: e.name, mode: e.mode, rpe: e.rpe, rest: e.rest, eachSide: e.eachSide,
            sets: e.sets, reps: e.reps, secs: e.secs, kg: e.kg, range: e.range, varied: e.varied
          }))
        }))
      }
    };
  });

  out.impLookup = [
    'squat', 'squats', 'back squat', 'rdl', 'sqaut', 'bnech press', 'deadlift', 'deads',
    'wall ball', 'cardio of choice', 'assault bike', 'nonsense movement here', '', 'plank', 'planks'
  ].map((p) => ({ in: p, out: impLookup(p) }));

  /* ---------- constants that carry meaning ---------- */
  out.constants = {
    AUTOREG: AUTOREG,
    MAX_KG: MAX_KG,
    REZONE_PROVISIONAL: REZONE_PROVISIONAL,
    CON_EFFORTS: CON_EFFORTS,
    ZONE_TO_EFFORT: ZONE_TO_EFFORT,
    MODES: Object.keys(MODES),
    CON_FORMATS: Object.keys(CON_FORMATS),
    HRR_WINDOW_SEC: HRR_WINDOW_SEC,
    HRR_TOLERANCE_SEC: HRR_TOLERANCE_SEC
  };

  return out;
});

await browser.close();

await mkdir(outDir, { recursive: true });
let n = 0;
for (const [name, data] of Object.entries(vectors)) {
  await writeFile(resolve(outDir, name + '.json'), JSON.stringify(data, null, 1) + '\n');
  n += Array.isArray(data) ? data.length : 1;
  console.log('  ' + name + ' — ' + (Array.isArray(data) ? data.length + ' vectors' : 'snapshot'));
}
console.log('\nWrote ' + Object.keys(vectors).length + ' fixture files (' + n + ' vectors) to packages/engine/test/golden/');
