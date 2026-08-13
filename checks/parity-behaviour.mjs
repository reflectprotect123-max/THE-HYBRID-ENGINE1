/*
 * The behaviour gate: drives a target through the fixed session in
 * `checks/parity/script.mjs` and either records what happened as the
 * baseline, or diffs a fresh run against the recorded baseline.
 *
 * The prototype at `checks/fixtures/prototype/rolling-logger.html` is the
 * specification for a session logger being rebuilt inside this app. This
 * gate is built before the rebuild exists, on purpose, so it cannot be
 * quietly shaped to fit whatever got built — it records what the SPEC did,
 * once, and everything after that is measured against it.
 *
 * Usage:
 *   node checks/parity-behaviour.mjs [--target=prototype|<url>] [--record] [--phase=build|run|all]
 *
 *   --target=prototype (default)  load the committed HTML from file://
 *   --target=harness              export apps/mobile's parity harness, serve it,
 *                                 and drive that — the mobile side, in one command
 *   --target=<url>                load a running app at that URL
 *   --record                      write the trace to the baseline and exit 0
 *   (no --record)                 diff a fresh run against the baseline
 *   --phase=build|run|all         which half of the session to drive (default all)
 *
 * Against `--target=prototype`, every phase still walks the FULL step list —
 * the run half needs the DOM the build half left behind — and `--phase` only
 * narrows which steps get recorded and compared. Against `--target=<url>`,
 * `--phase=run` seeds `checks/fixtures/session.json` into the app's storage
 * and starts at the logger route instead of replaying the build steps, and
 * `--phase=build` walks only the build steps. See `checks/parity/drive.mjs`.
 *
 * Run: node checks/parity-behaviour.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_chromium.mjs';
import { runScript, seedAndGoToLogger, filterTraceByPhase } from './parity/drive.mjs';
import { steps } from './parity/script.mjs';
import { serveHarness } from './parity/serve-harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACE_PATH = resolve(ROOT, 'checks/fixtures/prototype/trace.json');
const PROTOTYPE_PATH = resolve(ROOT, 'checks/fixtures/prototype/rolling-logger.html');
const SESSION_PATH = resolve(ROOT, 'checks/fixtures/session.json');

function parseArgs(argv) {
  let target = 'prototype';
  let record = false;
  let phase = 'all';
  for (const arg of argv) {
    if (arg === '--record') record = true;
    else if (arg.startsWith('--target=')) target = arg.slice('--target='.length);
    else if (arg.startsWith('--phase=')) phase = arg.slice('--phase='.length);
    else {
      console.error(`parity-behaviour: unrecognised argument \`${arg}\``);
      process.exit(1);
    }
  }
  if (!['build', 'run', 'all'].includes(phase)) {
    console.error(`parity-behaviour: --phase must be build, run or all — got \`${phase}\``);
    process.exit(1);
  }
  return { target, record, phase };
}

function fieldsOf(field, expected, actual) {
  const diffs = [];
  const ev = expected ? expected[field] : null;
  const av = actual ? actual[field] : null;
  if (ev !== av) diffs.push(`hot.${field}: expected ${JSON.stringify(ev)}, got ${JSON.stringify(av)}`);
  return diffs;
}

/** Prints every difference as `step → field: expected X, got Y` and returns
 *  how many were found. Steps are compared positionally: a baseline and a
 *  fresh run are the same fixed session, so they should have the same
 *  number of recorded steps in the same order. */
function diffTraces(expected, actual) {
  const diffs = [];
  const len = Math.max(expected.length, actual.length);
  for (let i = 0; i < len; i++) {
    const e = expected[i];
    const a = actual[i];
    if (!e) {
      diffs.push(`(step ${i}) → extra step not in baseline: \`${a.step}\``);
      continue;
    }
    if (!a) {
      diffs.push(`${e.step} → missing step: expected in baseline, run stopped before it`);
      continue;
    }
    const label = e.step === a.step ? e.step : `${e.step} / ${a.step}`;
    if (e.step !== a.step) {
      diffs.push(`(step ${i}) → step label: expected ${JSON.stringify(e.step)}, got ${JSON.stringify(a.step)}`);
    }
    for (const field of ['name', 'presc', 'why', 'kg']) {
      for (const d of fieldsOf(field, e.hot, a.hot)) diffs.push(`${label} → ${d}`);
    }
    const er = e.receipts || [];
    const ar = a.receipts || [];
    const rlen = Math.max(er.length, ar.length);
    for (let r = 0; r < rlen; r++) {
      if (er[r] !== ar[r]) {
        diffs.push(`${label} → receipts[${r}]: expected ${JSON.stringify(er[r] ?? null)}, got ${JSON.stringify(ar[r] ?? null)}`);
      }
    }
  }
  return diffs;
}

async function main() {
  let { target, phase } = parseArgs(process.argv.slice(2));
  const { record } = parseArgs(process.argv.slice(2));

  const { browser, skip } = await launchChromium();
  if (skip) {
    console.log(`SKIP — parity-behaviour: ${skip}`);
    process.exit(0);
  }

  /* `harness` is not a URL, it is an instruction: build the mobile harness and
     serve it. Resolved here so everything downstream sees an ordinary target. */
  let harness = null;
  if (target === 'harness') {
    harness = await serveHarness();
    target = harness.url;
    if (phase === 'all') phase = 'run';
  }

  try {
    const page = await browser.newPage();

    let trace;
    if (target === 'prototype') {
      // One page builds and runs the session, so every phase walks the
      // full step list — `phase` only narrows what gets recorded.
      await page.goto('file://' + PROTOTYPE_PATH);
      trace = await runScript(page, steps, phase);
    } else if (phase === 'run') {
      // No build UI to replay against a real app: seed the fixed session
      // straight into storage and start at the logger route.
      const session = JSON.parse(await readFile(SESSION_PATH, 'utf8'));
      await seedAndGoToLogger(page, target, session);
      trace = await runScript(page, steps.filter((s) => s.phase === 'run'), 'run');
    } else if (phase === 'build') {
      await page.goto(target);
      trace = await runScript(page, steps.filter((s) => s.phase === 'build'), 'build');
    } else {
      await page.goto(target);
      trace = await runScript(page, steps, 'all');
    }

    if (record) {
      await writeFile(TRACE_PATH, JSON.stringify(trace, null, 1) + '\n');
      console.log(`Recorded ${trace.length} steps to ${TRACE_PATH}`);
      return;
    }

    let baseline;
    try {
      baseline = JSON.parse(await readFile(TRACE_PATH, 'utf8'));
    } catch (err) {
      console.error(`parity-behaviour: could not read baseline at ${TRACE_PATH}: ${err.message}`);
      console.error('Run `node checks/parity-behaviour.mjs --record` first.');
      process.exitCode = 1;
      return;
    }
    baseline = filterTraceByPhase(baseline, steps, phase);

    const diffs = diffTraces(baseline, trace);
    if (diffs.length) {
      console.error(`FAIL — parity-behaviour: ${diffs.length} difference(s) against the recorded baseline`);
      for (const d of diffs) console.error(`  ${d}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `PASS — parity-behaviour: ${trace.length} recorded steps match the baseline (target: ${target}, phase: ${phase})`,
    );
  } finally {
    await browser.close();
    if (harness) harness.close();
  }
}

main().catch((err) => {
  console.error('parity-behaviour: fatal error');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
