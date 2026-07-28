/*
 * Finding a Chromium for the checks that need a real browser.
 *
 * `chromium.launch()` with no executablePath is always tried first: it already
 * honours PLAYWRIGHT_BROWSERS_PATH and the per-user browser cache, which is how
 * a browser installed by `playwright install` is found on any OS.
 *
 * The container path is only a fallback, for CI images that bake the browser in
 * outside that cache. It used to be passed to launch() unconditionally, which
 * meant a machine with no Chromium died on an absolute Linux path — a failure
 * that reads like a bug in the check rather than a missing browser, and one
 * that no Windows or macOS checkout could ever satisfy.
 *
 * Returns { browser } or { skip: reason }, never throws, so a caller can decide
 * whether a missing browser is a SKIP (most checks) or fatal (screenshots).
 */
import { existsSync } from 'node:fs';

/** Where CI images bake Chromium, outside Playwright's own cache. */
const BAKED_IN = '/opt/pw-browsers/chromium';

export async function launchChromium(opts = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { skip: 'playwright not installed' };
  }

  try {
    return { browser: await chromium.launch(opts) };
  } catch (err) {
    if (!existsSync(BAKED_IN)) {
      return { skip: 'no Chromium — run `pnpm exec playwright install chromium`' };
    }
    try {
      return { browser: await chromium.launch({ ...opts, executablePath: BAKED_IN }) };
    } catch {
      return { skip: 'Chromium found at ' + BAKED_IN + ' but it would not launch: ' + err.message };
    }
  }
}
