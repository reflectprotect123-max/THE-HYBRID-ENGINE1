/*
 * Drives a target (the prototype today, the rebuilt app later) through the
 * abstract step list from `script.mjs`, using only `[data-parity="…"]`
 * selectors — with the two documented, explicitly-labelled exceptions
 * `script.mjs` routes through `clickRaw` (see the comment at the top of
 * that file for why).
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
 */

async function execAction(page, action, label) {
  if (action.type === 'click') {
    const loc = page.locator(`[data-parity="${action.hook}"]`);
    if ((await loc.count()) === 0) {
      throw new Error(`missing hook \`${action.hook}\` at step \`${label}\``);
    }
    await loc.first().click();
    return;
  }
  if (action.type === 'fill') {
    const loc = page.locator(`[data-parity="${action.hook}"]`);
    if ((await loc.count()) === 0) {
      throw new Error(`missing hook \`${action.hook}\` at step \`${label}\``);
    }
    await loc.first().fill(action.value);
    return;
  }
  if (action.type === 'clickRaw') {
    const loc = page.locator(action.selector);
    if ((await loc.count()) === 0) {
      throw new Error(
        `missing element \`${action.selector}\` at step \`${label}\` (${action.why})`,
      );
    }
    await loc.first().click();
    return;
  }
  throw new Error(`unknown action type \`${action.type}\` at step \`${label}\``);
}

/** Reads a single hot-card field. Absence is not a failure here — a
 *  warm/cool card genuinely has no `hot-why`/`hot-kg`, and a bodyweight
 *  strength card genuinely has no `hot-kg` either. `null` records that
 *  honestly rather than papering over it. */
async function readOptionalText(page, hook) {
  const loc = page.locator(`[data-parity="${hook}"]`);
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

async function readReceipts(page, blockIndex) {
  if (blockIndex == null) return [];
  const scope = page.locator(`#track > .blockscreen:nth-of-type(${blockIndex + 1})`);
  if ((await scope.count()) === 0) return [];
  const items = scope.locator('[data-parity^="receipt-"]');
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
 */
export async function runScript(page, steps) {
  const trace = [];
  for (const st of steps) {
    for (const action of st.actions) {
      await execAction(page, action, st.label);
    }
    if (st.record) {
      const hot = await readHot(page);
      const receipts = await readReceipts(page, st.block);
      trace.push({ step: st.label, hot, receipts });
    }
  }
  return trace;
}
