/*
 * The visual gate: shoots a target at a real phone viewport (412x915) in a
 * fixed, named subset of states, and diffs each shot pixel-for-pixel
 * against a recorded baseline.
 *
 * It reuses the SAME step list as checks/parity-behaviour.mjs
 * (checks/parity/script.mjs) rather than hand-writing a second tap
 * sequence — two scripts that are supposed to describe the same session
 * would drift, and the two gates would end up judging different sessions.
 * Each named shot below points at a step from that file (and, for a few of
 * them, how many of that step's own actions to run first) — never at a
 * duplicated list of clicks.
 *
 * The prototype at checks/fixtures/prototype/rolling-logger.html is the
 * specification. This gate is built before the rebuild exists, on purpose,
 * so it records what the SPEC looks like, once, and everything after that
 * is measured against it.
 *
 * Usage:
 *   node checks/parity-visual.mjs [--target=prototype|<url>] [--record] [--phase=build|run|all]
 *
 *   --target=prototype (default)  load the committed HTML from file://
 *   --target=harness              export apps/mobile's parity harness, serve it,
 *                                 and drive that — the mobile side, in one command
 *   --target=<url>                load a running app at that URL
 *   --record                      write the baseline shots and exit 0
 *   (no --record)                 diff a fresh run against the baseline
 *   --phase=build|run|all         which half of the session to shoot (default all)
 *
 * `--phase` narrows SHOTS to the ones whose named step falls on that side of
 * the build/run split (see checks/parity/script.mjs). Against
 * `--target=prototype` the full step list still gets walked regardless of
 * phase — the run half's shots depend on the DOM the build half produced —
 * only which shots get CAPTURED is narrowed. Against `--target=<url>`,
 * `--phase=run` seeds `checks/fixtures/session.json` into the app's storage
 * and starts at the logger route instead of replaying the build steps.
 *
 * Run: node checks/parity-visual.mjs
 */
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';
import { launchChromium } from './_chromium.mjs';
import { steps } from './parity/script.mjs';
import { serveHarness } from './parity/serve-harness.mjs';
import { hookSel, seedAndGoToLogger } from './parity/drive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = resolve(ROOT, 'checks/fixtures/prototype/shots');
const PROTOTYPE_PATH = resolve(ROOT, 'checks/fixtures/prototype/rolling-logger.html');
const SESSION_PATH = resolve(ROOT, 'checks/fixtures/session.json');

/* A real Android viewport at 1:1 — the same one the prototype itself was
   built against (see the CSS comment "device: 412 x 915" in
   rolling-logger.html). */
const VIEWPORT = { width: 412, height: 915 };

/* ------------------------------ comparison ------------------------------
 *
 * PIXEL_TOLERANCE — per-channel (0-255) slack before a pixel counts as
 * "different". Anti-aliased text edges and rounded corners blend a few
 * levels toward the neighbouring colour on every render even when nothing
 * else changed. 18 was set empirically: with the clock frozen and
 * animations disabled (see below), two screenshots of the identical state
 * came back byte-for-byte equal in this harness, so 18 is not absorbing an
 * observed wobble — it is headroom for the kind of single-digit-to-low-
 * teens antialiasing jitter font hinting can produce on a different
 * machine, while staying far below the 40+ jump a real colour swap or a
 * missing/extra element produces.
 *
 * DIFF_RATIO_THRESHOLD — proportion of the 412x915 = 376,980 pixels allowed
 * to differ before a shot fails. Because two runs of a fully neutralised
 * state are byte-identical here, the honest threshold is small: 0.001
 * (0.1%, ~377 px) leaves room for a handful of stray antialiasing pixels
 * without absorbing anything real — every state pinned below is a full
 * screen of UI, so a genuine visual regression (a moved card, a wrong
 * colour, a missing takeover) touches thousands of pixels, not hundreds.
 * Raising this to chase flakiness instead of neutralising its source would
 * make the gate blind to a real difference of the same size, so it stays
 * fixed and every known source of flapping is neutralised instead (see
 * `--record` step in the task brief / task-4-report.md).
 */
const PIXEL_TOLERANCE = 18;
const DIFF_RATIO_THRESHOLD = 0.001;

/* --------------------------------- shots ---------------------------------
 * Each entry names a step from checks/parity/script.mjs. `actions`, when
 * given, is how many of that step's own actions to run before capturing —
 * used for the two states that sit *inside* a step rather than at its end
 * (the kind picker is open after `add-block` but before a kind is chosen;
 * the rest takeover is open after `log` but before `rest-go` dismisses
 * it). Every other shot captures the state after the step's last action.
 */
const SHOTS = [
  { name: 'empty-builder', before: true }, // page load, before any step runs
  { name: 'block-kind-picker', step: 'warm-up: choose kind', actions: 1 }, // after add-block, before kind-warm
  { name: 'review-list', step: 'cool-down: commit block' }, // every block built, about to press Start
  { name: 'running-warm-up', step: 'start session' }, // piece 1 (Row, timed) auto-starts on session start
  { name: 'live-superset-card', step: 'warm-up: advance past rest' }, // fresh hot card, superset block just became active
  { name: 'rest-takeover', step: 'superset: round 1 — Barbell Back Squat set 1', actions: 2 }, // after rpe+log, before rest-go
  { name: 'block-done-takeover', step: 'warm-up: finish piece 2 (Air Squats)' }, // last warm-up piece done -> "block done" takeover
  { name: 'finish-card', step: 'finish session' }, // session complete
];

function parseArgs(argv) {
  let target = 'prototype';
  let record = false;
  let phase = 'all';
  for (const arg of argv) {
    if (arg === '--record') record = true;
    else if (arg.startsWith('--target=')) target = arg.slice('--target='.length);
    else if (arg.startsWith('--phase=')) phase = arg.slice('--phase='.length);
    else {
      console.error(`parity-visual: unrecognised argument \`${arg}\``);
      process.exit(1);
    }
  }
  if (!['build', 'run', 'all'].includes(phase)) {
    console.error(`parity-visual: --phase must be build, run or all — got \`${phase}\``);
    process.exit(1);
  }
  return { target, record, phase };
}

/** `empty-builder` has no `step` to look phase up from (it fires before any
 *  step runs) — it is unambiguously a build-phase shot, the page load
 *  before the first build action. Every other shot's phase is the phase of
 *  the step it names. */
function shotPhase(shot, steps) {
  if (!shot.step) return 'build';
  const st = steps.find((s) => s.label === shot.step);
  return st ? st.phase : undefined;
}

/* ------------------------------ the driver -------------------------------
 * A small, local re-implementation of parity/drive.mjs's click/fill
 * handling — drive.mjs only exports the all-in-one `runScript`, which has
 * no way to pause mid-step for the two shots that sit inside a step. The
 * STEP LIST itself still comes only from parity/script.mjs; this is just
 * the mechanics of walking it one action at a time.
 */
async function execAction(page, action, label) {
  /* `hookSel`, not a bare `[data-parity]`: the prototype spells its hooks
     `data-parity` and react-native-web spells the same vocabulary
     `data-testid`. Shared with drive.mjs so the two drivers cannot drift on
     which attributes count. */
  const loc = page.locator(hookSel(action.hook));
  if ((await loc.count()) === 0) {
    throw new Error(`missing hook \`${action.hook}\` at step \`${label}\``);
  }
  if (action.type === 'click') {
    await loc.first().click();
  } else if (action.type === 'fill') {
    await loc.first().fill(action.value);
  } else {
    throw new Error(`unknown action type \`${action.type}\` at step \`${label}\``);
  }
}

/** Walks `walkSteps` once, taking a screenshot (a PNG Buffer) at each named
 *  point in `activeShots`, keyed by shot name. `walkSteps` is every action
 *  to execute, in order — the full `steps` list against the prototype
 *  (the run half's DOM depends on the build half having run), or a
 *  phase-filtered subset against a real target. `activeShots` is the
 *  phase-filtered subset of SHOTS actually expected out of this walk.
 *  Fails loudly if a shot names a step that no longer exists in
 *  script.mjs — a sign the two files have drifted apart. */
async function captureShots(page, walkSteps, activeShots) {
  const stepLabels = new Set(steps.map((s) => s.label));
  for (const shot of activeShots) {
    if (shot.step && !stepLabels.has(shot.step)) {
      throw new Error(
        `parity-visual: shot \`${shot.name}\` names step \`${shot.step}\`, which is not in checks/parity/script.mjs`,
      );
    }
  }

  const shotsByStep = new Map(activeShots.filter((s) => s.step).map((s) => [s.step, s]));
  const captured = new Map();

  const initial = activeShots.find((s) => s.before);
  if (initial) captured.set(initial.name, await page.screenshot());

  for (const st of walkSteps) {
    const shot = shotsByStep.get(st.label);
    const cutoff = shot && shot.actions != null ? shot.actions : st.actions.length;
    for (let i = 0; i < st.actions.length; i++) {
      await execAction(page, st.actions[i], st.label);
      if (shot && i + 1 === cutoff) {
        captured.set(shot.name, await page.screenshot());
      }
    }
  }

  const missing = activeShots.filter((s) => !captured.has(s.name)).map((s) => s.name);
  if (missing.length) {
    throw new Error(`parity-visual: never captured shot(s): ${missing.join(', ')}`);
  }
  return captured;
}

/* -------------------------------- PNG I/O --------------------------------
 * No image-diff or PNG library is reachable from this repo's root
 * (playwright, typescript and vitest are the only devDependencies; pngjs /
 * sharp / jimp / pixelmatch appear only as transitive deps of unrelated
 * tooling three levels down and are not resolvable from here). Playwright's
 * own screenshots are always 8-bit, non-interlaced RGB or RGBA — decoding
 * and diffing that directly, with node:zlib doing the actual inflate, is a
 * genuinely small amount of code, so that is what this does instead of
 * adding a dependency.
 */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('parity-visual: not a PNG file');
  }
  let offset = 8;
  let width, height, bitDepth, colorType, interlace;
  const idatParts = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len; // length(4) + type(4) + data + crc(4)
  }
  if (bitDepth !== 8) {
    throw new Error(`parity-visual: unsupported PNG bit depth ${bitDepth} (expected 8)`);
  }
  if (interlace !== 0) {
    throw new Error('parity-visual: unsupported interlaced PNG');
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`parity-visual: unsupported PNG color type ${colorType} (expected RGB or RGBA)`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const data = Buffer.alloc(width * height * 4, 255); // internal format: RGBA
  let pos = 0;
  let prevLine = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filterType = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = prevLine[x];
      const upLeft = x >= channels ? prevLine[x - channels] : 0;
      let v = line[x];
      if (filterType === 1) v = (v + left) & 0xff;
      else if (filterType === 2) v = (v + up) & 0xff;
      else if (filterType === 3) v = (v + ((left + up) >> 1)) & 0xff;
      else if (filterType === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        v = (v + pred) & 0xff;
      } else if (filterType !== 0) {
        throw new Error(`parity-visual: unsupported PNG filter type ${filterType}`);
      }
      out[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      data[di] = out[si];
      data[di + 1] = out[si + 1];
      data[di + 2] = out[si + 2];
      if (channels === 4) data[di + 3] = out[si + 3];
    }
    prevLine = out;
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encodes an 8-bit RGB PNG, unfiltered — this only ever writes the human-
 *  readable diff image, so a bigger file in exchange for the simplest
 *  possible encoder is the right trade. */
function encodePNG({ width, height, data }) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = rowStart + 1 + x * 3;
      raw[di] = data[si];
      raw[di + 1] = data[si + 1];
      raw[di + 2] = data[si + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Pixel-wise compare of two decoded images. Returns a verdict plus a diff
 *  image: differing pixels in solid red, everything else dimmed to a third
 *  of its grey value so a human can still see what was on screen around
 *  the difference. */
function comparePixels(baseline, actual) {
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      pass: false,
      dimensionMismatch: true,
      baselineDims: `${baseline.width}x${baseline.height}`,
      actualDims: `${actual.width}x${actual.height}`,
    };
  }
  const total = baseline.width * baseline.height;
  const diffData = Buffer.alloc(total * 4, 255);
  let diffCount = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const dr = Math.abs(baseline.data[o] - actual.data[o]);
    const dg = Math.abs(baseline.data[o + 1] - actual.data[o + 1]);
    const db = Math.abs(baseline.data[o + 2] - actual.data[o + 2]);
    const differs = dr > PIXEL_TOLERANCE || dg > PIXEL_TOLERANCE || db > PIXEL_TOLERANCE;
    if (differs) {
      diffCount++;
      diffData[o] = 255;
      diffData[o + 1] = 0;
      diffData[o + 2] = 0;
    } else {
      const grey = Math.round((baseline.data[o] + baseline.data[o + 1] + baseline.data[o + 2]) / 9);
      diffData[o] = grey;
      diffData[o + 1] = grey;
      diffData[o + 2] = grey;
    }
  }
  const diffRatio = diffCount / total;
  return {
    pass: diffRatio <= DIFF_RATIO_THRESHOLD,
    diffCount,
    total,
    diffRatio,
    diffImage: { width: baseline.width, height: baseline.height, data: diffData },
  };
}

async function unlinkIfExists(path) {
  try {
    await unlink(path);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function main() {
  let { target, phase } = parseArgs(process.argv.slice(2));
  const { record } = parseArgs(process.argv.slice(2));

  const { browser, skip } = await launchChromium();
  if (skip) {
    console.log(`SKIP — parity-visual: ${skip}`);
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
    // reducedMotion disables the prototype's own @media(prefers-reduced-motion)
    // rule, which turns off the .restover and .hot entrance animations — see
    // task-4-report.md for why that matters for a pixel-exact gate.
    const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
    const page = await context.newPage();
    // Freeze Date/setTimeout/setInterval at a fixed instant, paused, so the
    // app-bar session clock, the rest dial and a running warm-up piece's
    // countdown never advance between the click that renders them and the
    // screenshot taken right after.
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(0);

    const activeShots = SHOTS.filter((s) => phase === 'all' || shotPhase(s, steps) === phase);

    let walkSteps;
    if (target === 'prototype') {
      // One page builds and runs the session — the run half's shots need
      // the DOM the build half produced, so the full step list is always
      // walked; `phase` only narrows which shots get captured.
      await page.goto('file://' + PROTOTYPE_PATH);
      walkSteps = steps;
    } else if (phase === 'run') {
      // No build UI to replay against a real app: seed the fixed session
      // straight into storage and start at the logger route.
      const session = JSON.parse(await readFile(SESSION_PATH, 'utf8'));
      await seedAndGoToLogger(page, target, session);
      walkSteps = steps.filter((s) => s.phase === 'run');
    } else if (phase === 'build') {
      await page.goto(target);
      walkSteps = steps.filter((s) => s.phase === 'build');
    } else {
      await page.goto(target);
      walkSteps = steps;
    }

    const shots = await captureShots(page, walkSteps, activeShots);

    if (record) {
      await mkdir(SHOTS_DIR, { recursive: true });
      for (const [name, buf] of shots) {
        await writeFile(resolve(SHOTS_DIR, `${name}.png`), buf);
      }
      console.log(`Recorded ${shots.size} shots to ${SHOTS_DIR}`);
      return;
    }

    let failures = 0;
    for (const [name, buf] of shots) {
      const baselinePath = resolve(SHOTS_DIR, `${name}.png`);
      const actualPath = resolve(SHOTS_DIR, `${name}.actual.png`);
      const diffPath = resolve(SHOTS_DIR, `${name}.diff.png`);

      let baselineBuf;
      try {
        baselineBuf = await readFile(baselinePath);
      } catch (err) {
        console.error(`parity-visual: could not read baseline \`${baselinePath}\`: ${err.message}`);
        console.error('Run `node checks/parity-visual.mjs --record` first.');
        process.exitCode = 1;
        return;
      }

      const baseline = decodePNG(baselineBuf);
      const actual = decodePNG(buf);
      const result = comparePixels(baseline, actual);

      if (result.pass) {
        await unlinkIfExists(actualPath);
        await unlinkIfExists(diffPath);
        continue;
      }

      failures++;
      if (result.dimensionMismatch) {
        console.error(
          `FAIL — parity-visual: \`${name}\` viewport size differs: ` +
            `baseline ${result.baselineDims}, actual ${result.actualDims}`,
        );
        await writeFile(actualPath, buf);
        console.error(`  baseline: ${baselinePath}`);
        console.error(`  actual:   ${actualPath}`);
        continue;
      }

      await writeFile(actualPath, buf);
      await writeFile(diffPath, encodePNG(result.diffImage));
      console.error(
        `FAIL — parity-visual: \`${name}\` differs by ${(result.diffRatio * 100).toFixed(3)}% ` +
          `(${result.diffCount}/${result.total} px, threshold ${(DIFF_RATIO_THRESHOLD * 100).toFixed(3)}%)`,
      );
      console.error(`  baseline: ${baselinePath}`);
      console.error(`  actual:   ${actualPath}`);
      console.error(`  diff:     ${diffPath}`);
    }

    if (failures) {
      console.error(
        `FAIL — parity-visual: ${failures}/${shots.size} shot(s) differ from baseline (target: ${target}, phase: ${phase})`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`PASS — parity-visual: ${shots.size} shots match the baseline (target: ${target}, phase: ${phase})`);
  } finally {
    await browser.close();
    if (harness) harness.close();
  }
}

main().catch((err) => {
  console.error('parity-visual: fatal error');
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
