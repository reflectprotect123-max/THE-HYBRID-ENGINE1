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
 *   node checks/parity-behaviour.mjs [--target=prototype|<url>] [--record]
 *
 *   --target=prototype (default)  load the committed HTML from file://
 *   --target=<url>                load a running app at that URL
 *   --record                      write the trace to the baseline and exit 0
 *   (no --record)                 diff a fresh run against the baseline
 *
 * Run: node checks/parity-behaviour.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_chromium.mjs';
import { runScript } from './parity/drive.mjs';
import { steps } from './parity/script.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACE_PATH = resolve(ROOT, 'checks/fixtures/prototype/trace.json');
const PROTOTYPE_PATH = resolve(ROOT, 'checks/fixtures/prototype/rolling-logger.html');

function parseArgs(argv) {
  let target = 'prototype';
  let record = false;
  for (const arg of argv) {
    if (arg === '--record') record = true;
    else if (arg.startsWith('--target=')) target = arg.slice('--target='.length);
    else {
      console.error(`parity-behaviour: unrecognised argument \`${arg}\``);
      process.exit(1);
    }
  }
  return { target, record };
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
  const { target, record } = parseArgs(process.argv.slice(2));

  const { browser, skip } = await launchChromium();
  if (skip) {
    console.log(`SKIP — parity-behaviour: ${skip}`);
    process.exit(0);
  }

  try {
    const page = await browser.newPage();
    const url = target === 'prototype' ? 'file://' + PROTOTYPE_PATH : target;
    await page.goto(url);

    const trace = await runScript(page, steps);

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

    const diffs = diffTraces(baseline, trace);
    if (diffs.length) {
      console.error(`FAIL — parity-behaviour: ${diffs.length} difference(s) against the recorded baseline`);
      for (const d of diffs) console.error(`  ${d}`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS — parity-behaviour: ${trace.length} recorded steps match the baseline (target: ${target})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('parity-behaviour: fatal error');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
