/*
 * Drives a target (the prototype today, the rebuilt app later) through the
 * abstract step list from `script.mjs`, using only `[data-parity="…"]`
 * selectors.
 *
 * A hook the script asks for and the page does not have is a real defect
 * in the run, not a thing to swallow: it fails with the hook's name and
 * the step label, e.g. "missing hook `hot-why` at step `log set 3`" — never
 * a bare Playwright timeout.
 *
 * `receipt-<i>` is scoped to the block currently on screen: every block
 * screen sits in the DOM at once (a carousel), so a bare
 * `[data-parity="receipt-0"]` would match the first receipt of EVERY
 * block. Each recorded step in `script.mjs` names which block is active,
 * and receipts are read from within that block's screen only.
 *
 * Phase split — the slice that rebuilds only the logger leaves the old
 * builder in place, so the two halves of the script have to be judged
 * independently:
 *
 *  - `runScript(page, steps, phase)` still WALKS every action in `steps`,
 *    in order, exactly as before — the prototype is one page, and the run
 *    half genuinely depends on the DOM the build half left behind (blocks
 *    exist, a session has started). What `phase` changes is only which
 *    steps get RECORDED into the trace: `'all'` records everything marked
 *    `record: true`, same as before the split existed; `'build'` or
 *    `'run'` records only the `record: true` steps whose own `st.phase`
 *    matches, so a baseline recorded once at `'all'` still has an honest
 *    subset comparable against a phase-scoped run (see
 *    `filterTraceByPhase` below, used by the gates for that comparison).
 *
 *  - `seedAndGoToLogger(page, targetUrl, session)` is the run phase's other
 *    way in: against a real app there is no build UI to replay, so this
 *    writes `checks/fixtures/session.json` straight into the target's
 *    storage (under `LS_KEY`, read from `@hybrid/engine` rather than
 *    hardcoded — see the import below) as that app's one active session,
 *    then navigates straight to the logger route. Only a `--target=<url>`
 *    run reaches this path; `--target=prototype` has nothing to seed,
 *    because the prototype builds its own `session` in-page.
 */
import { LS_KEY } from '../../packages/engine/src/constants.ts';
import { toEngineSession } from './session-fixture.mjs';

/*
 * One hook, two attribute names.
 *
 * The prototype is hand-written HTML and spells its hooks `data-parity`. The
 * app is React Native: the only hook a React Native element can carry is
 * `testID`, and react-native-web renders that as `data-testid`. The VALUES are
 * identical by contract — `hot-why` is `hot-why` on both — so matching either
 * attribute is not a loosening of the gate, it is the same vocabulary spoken
 * in the two spellings the two platforms have.
 */
export const hookSel = (hook) => `[data-parity="${hook}"], [data-testid="${hook}"]`;

/** Where the run phase lands once a session is already active — the same
 *  `/log/:bi/:ei` route the existing (soon to be replaced) Logger renders
 *  at, addressing the first block/exercise of the fixed parity session.
 *  Task 7 of the athlete-web-logger plan repoints this route at the new
 *  SessionLogger without changing its shape, so this constant does not need
 *  to change when that lands — only if the route itself does. */
export const LOGGER_ROUTE = '/log/0/0';


/** Writes `session` into `targetUrl`'s storage as the app's one active
 *  session, then navigates to `LOGGER_ROUTE`. `targetUrl` must already be
 *  same-origin-reachable — this does one `goto` to establish an origin to
 *  write `localStorage` against, then a second to the logger route itself. */
export async function seedAndGoToLogger(page, targetUrl, session) {
  await page.goto(targetUrl);
  const db = { workouts: [], sessions: [toEngineSession(session)], settings: {} };
  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: LS_KEY, value: JSON.stringify(db) },
  );
  await page.goto(new URL(LOGGER_ROUTE, targetUrl).toString());
  /* The prototype is a static page and is ready the moment it loads; a real
     app has to boot a JS bundle and mount first. Without this the very first
     action fires against an empty body and the run dies reporting a missing
     hook, which reads like a defect in the screen rather than a race. */
  await page.waitForSelector('[data-parity], [data-testid]', { timeout: 15_000 });
}

/** Keeps only the baseline trace entries recorded by a step whose own
 *  `phase` matches — so a full (`'all'`) baseline can still be diffed
 *  honestly against a phase-scoped run, which only ever records a subset.
 *  `'all'` returns the baseline unchanged. */
export function filterTraceByPhase(baseline, steps, phase) {
  if (phase === 'all') return baseline;
  const phaseOf = new Map(steps.map((s) => [s.label, s.phase]));
  return baseline.filter((entry) => phaseOf.get(entry.step) === phase);
}

async function execAction(page, action, label) {
  if (action.type === 'click') {
    const loc = page.locator(hookSel(action.hook));
    if ((await loc.count()) === 0) {
      throw new Error(`missing hook \`${action.hook}\` at step \`${label}\``);
    }
    await loc.first().click();
    return;
  }
  if (action.type === 'fill') {
    const loc = page.locator(hookSel(action.hook));
    if ((await loc.count()) === 0) {
      throw new Error(`missing hook \`${action.hook}\` at step \`${label}\``);
    }
    await loc.first().fill(action.value);
    return;
  }
  throw new Error(`unknown action type \`${action.type}\` at step \`${label}\``);
}

/** Reads a single hot-card field. Absence is not a failure here — a
 *  warm/cool card genuinely has no `hot-why`/`hot-kg`, and a bodyweight
 *  strength card genuinely has no `hot-kg` either. `null` records that
 *  honestly rather than papering over it. */
async function readOptionalText(page, hook) {
  const loc = page.locator(hookSel(hook));
  if ((await loc.count()) === 0) return null;
  const el = loc.first();
  const tag = await el.evaluate((n) => n.tagName);
  const raw = tag === 'INPUT' ? await el.inputValue() : await el.textContent();
  return raw == null ? null : raw.trim();
}

async function readHot(page) {
  const name = await readOptionalText(page, 'hot-name');
  const presc = await readOptionalText(page, 'hot-presc');
  const why = await readOptionalText(page, 'hot-why');
  const kg = await readOptionalText(page, 'hot-kg');
  if (name == null && presc == null && why == null && kg == null) return null;
  return { name, presc, why, kg };
}

/** Receipts, scoped to ONE block's screen.
 *
 *  Every block screen sits in the prototype's DOM at once (a carousel), so a
 *  bare `[data-parity="receipt-0"]` would match the first receipt of EVERY
 *  block. Each recorded step names which block was active, and the receipts
 *  are read from within that block's screen only.
 *
 *  Scoped by the `blockscreen-<i>` HOOK rather than by `#track >
 *  .blockscreen:nth-of-type(n)`, which was the prototype's own private
 *  markup: a rebuilt app has no `#track` and no `.blockscreen`, so that
 *  selector matched nothing and the driver reported an empty receipt list for
 *  every step — silently agreeing with itself while measuring nothing. An app
 *  that shows one block at a time carries the hook only on the block on
 *  screen, which is the same block every recorded step names. */
async function readReceipts(page, blockIndex) {
  if (blockIndex == null) return [];
  const scope = page.locator(hookSel(`blockscreen-${blockIndex}`));
  if ((await scope.count()) === 0) return [];
  const items = scope.locator('[data-parity^="receipt-"], [data-testid^="receipt-"]');
  const n = await items.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push((await items.nth(i).textContent()).trim());
  }
  return out;
}

/**
 * Executes `steps` (from `script.mjs`) against `page` and returns the
 * ordered Trace: `{ step, hot: { name, presc, why, kg } | null, receipts: string[] }[]`.
 *
 * Every action in `steps` runs, in order, regardless of `phase` — callers
 * that want to skip a whole phase's actions (a real app with no build UI)
 * pass an already-filtered `steps` list rather than relying on this to
 * skip actions. `phase` ('all' | 'build' | 'run', default 'all') only
 * gates which `record: true` steps make it into the returned trace: a step
 * is recorded when it is marked `record: true` AND (`phase === 'all'` or
 * the step's own `phase` matches) — so walking the FULL step list against
 * the prototype with `phase: 'run'` still executes every build action
 * (the run half needs the DOM they produced) without recording any of
 * them, exactly the "replay build unrecorded" behaviour the run phase
 * needs against a target with no separate build/run split.
 */
export async function runScript(page, steps, phase = 'all') {
  const trace = [];
  for (const st of steps) {
    for (const action of st.actions) {
      await execAction(page, action, st.label);
    }
    if (st.record && (phase === 'all' || st.phase === phase)) {
      const hot = await readHot(page);
      const receipts = await readReceipts(page, st.block);
      trace.push({ step: st.label, hot, receipts });
    }
  }
  return trace;
}
