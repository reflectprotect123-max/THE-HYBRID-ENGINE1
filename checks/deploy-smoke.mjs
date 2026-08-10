/*
 * Deploy smoke: does the PUBLISH DIRECTORY actually work?
 *
 * Everything else tests the source or a single app's dist. This serves
 * apps/web/dist exactly as Netlify will — one directory, `_headers` applied as
 * real response headers, netlify.toml redirects evaluated BEFORE `_redirects`,
 * real files served ahead of any rewrite — and drives it in a browser.
 *
 * This exists because the cutover's failure modes are all silent. A missing
 * icon still renders. A missing `_headers` still serves the site, just with no
 * CSP.
 *
 * Run: node checks/deploy-smoke.mjs   (after `pnpm run build:site`)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { launchChromium } from './_chromium.mjs';

const root = resolve(process.cwd(), process.argv[2] || '.');
const PUB = resolve(root, 'apps/web/dist');

let failures = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log('PASS — ' + name);
  } catch (e) {
    console.log('FAIL — ' + name + ': ' + e.message);
    failures += 1;
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

if (!existsSync(PUB)) {
  console.error('apps/web/dist missing — run `pnpm run build:site` first.');
  process.exit(1);
}

/* ---- parse the two files Netlify actually obeys, from the PUBLISH dir ---- */
const headersFile = join(PUB, '_headers');
const redirectsFile = join(PUB, '_redirects');
assert(existsSync(headersFile), '_headers is not in the publish directory');
assert(existsSync(redirectsFile), '_redirects is not in the publish directory');

/** `_headers`: an unindented path line, then indented `Key: value` lines. */
function parseHeaders(src) {
  const out = [];
  let cur = null;
  for (const raw of src.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      cur = { path: raw.trim(), headers: {} };
      out.push(cur);
    } else if (cur) {
      const i = raw.indexOf(':');
      if (i > 0) cur.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return out;
}
const HEADER_RULES = parseHeaders(readFileSync(headersFile, 'utf8'));
const REDIRECTS = readFileSync(redirectsFile, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(/\s+/))
  .filter((p) => p.length >= 2)
  .map(([from, to, status]) => ({ from, to, status: parseInt(status || '301', 10) }));

/* netlify.toml rules are evaluated BEFORE _redirects. Replicate it or the
   test proves nothing about the real precedence. */
const toml = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
const TOML_REDIRECTS = [...toml.matchAll(/\[\[redirects\]\]\s+from\s*=\s*"([^"]+)"\s+to\s*=\s*"([^"]+)"\s+status\s*=\s*(\d+)/g)].map(
  (m) => ({ from: m[1], to: m[2], status: Number(m[3]) }),
);

const matchGlob = (pattern, path) => {
  if (pattern.endsWith('/*')) return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
  if (pattern.includes('*')) return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(path);
  return pattern === path;
};

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  const applyHeaders = (p) => {
    const h = {};
    for (const r of HEADER_RULES) if (matchGlob(r.path, p)) Object.assign(h, r.headers);
    return h;
  };

  const serveFile = async (file, forPath, status = 200) => {
    const buf = await readFile(file);
    res.writeHead(status, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...applyHeaders(forPath) });
    res.end(buf);
  };

  // 1. Real files win, before any rewrite is considered.
  const direct = join(PUB, path);
  if (extname(direct) && existsSync(direct)) return serveFile(direct, path);

  // 2. netlify.toml redirects, then _redirects.
  for (const r of [...TOML_REDIRECTS, ...REDIRECTS]) {
    if (!matchGlob(r.from, path)) continue;
    const target = join(PUB, r.to.replace(/^\//, ''));
    if (r.status === 200 && existsSync(target)) return serveFile(target, path, 200);
    if (r.status === 404) {
      res.writeHead(404, applyHeaders(path));
      return res.end('blocked');
    }
  }

  res.writeHead(404, applyHeaders(path));
  res.end('not found');
});

const PORT = 4411;
await new Promise((ok) => server.listen(PORT, ok));
const base = 'http://127.0.0.1:' + PORT;

/* ---- static assertions about the assembled directory ---- */

await t('the CSP survived the move into the publish directory', async () => {
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy');
  assert(csp, 'no CSP header — _headers is not being applied from the publish dir');
  assert(/script-src[^;]*'self'/.test(csp), 'script-src lost self');
  assert(!/script-src[^;]*unsafe-inline/.test(csp), 'script-src gained unsafe-inline');
});

await t('the athlete app is served at /', async () => {
  const html = await (await fetch(base + '/')).text();
  assert(/id="root"/.test(html), 'no React root');
  assert(/THE Hybrid System/.test(html), 'wrong document');
});

await t('an athlete deep link falls back to the athlete shell', async () => {
  const r = await fetch(base + '/log/0/0');
  assert(r.status === 200, 'status ' + r.status);
  assert(/id="root"/.test(await r.text()), 'no React root on a deep link');
});

await t('every asset the built HTML references actually resolves', async () => {
  const html = await (await fetch(base + '/')).text();
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
  assert(refs.length > 0, 'the document referenced nothing at all');
  for (const ref of new Set(refs)) {
    const r = await fetch(base + ref);
    assert(r.status === 200, ref + ' → ' + r.status);
  }
});

await t('the PWA manifest and its icons are present', async () => {
  const r = await fetch(base + '/manifest.webmanifest');
  assert(r.status === 200, 'manifest ' + r.status);
  const mf = await r.json();
  assert((mf.icons || []).length > 0, 'manifest declares no icons');
  for (const i of mf.icons) {
    const ir = await fetch(base + i.src);
    assert(ir.status === 200, 'icon ' + i.src + ' → ' + ir.status);
  }
});

await t('assetlinks.json survives — the Android app depends on it', async () => {
  const r = await fetch(base + '/.well-known/assetlinks.json');
  assert(r.status === 200, 'status ' + r.status);
  const j = await r.json();
  assert(JSON.stringify(j).includes('com.hybridengine.app'), 'wrong package name in assetlinks');
});

await t('/privacy still resolves — the Play listing links to it', async () => {
  const r = await fetch(base + '/privacy');
  assert(r.status === 200, 'status ' + r.status);
  assert(/privacy/i.test(await r.text()), 'not the privacy document');
});

await t('the old service-worker path serves a tombstone, not a 404', async () => {
  // Everyone already using the app has /service-worker.js registered. A 404
  // leaves them on the old worker forever; the tombstone hands them over.
  const r = await fetch(base + '/service-worker.js');
  assert(r.status === 200, 'status ' + r.status);
  const src = await r.text();
  assert(/unregister\(\)/.test(src), 'the old worker path is not self-unregistering');
});

await t('the new Workbox worker is present', async () => {
  assert((await fetch(base + '/sw.js')).status === 200, '/sw.js missing');
});

await t('hashed bundles are cacheable and the workers are not', async () => {
  /*
   * The `/*` rule in _headers is `no-store`, which was correct when the site
   * was a handful of hand-named files and is wrong now that it serves ~6 MB of
   * content-hashed build output — a phone would re-download all of it on every
   * launch. The override only works because Netlify lets a more specific path
   * win, so this asserts the override actually took, in both directions.
   */
  const html = await (await fetch(base + '/')).text();
  const bundle = (html.match(/(?:href|src)="(\/assets\/[^"]+)"/) || [])[1];
  assert(bundle, 'the built HTML referenced no /assets/ file at all');

  const cc = (await fetch(base + bundle)).headers.get('cache-control') || '';
  assert(/immutable/.test(cc) && /max-age=\d{5,}/.test(cc), bundle + ' is not cacheable: ' + (cc || '(none)'));

  // The other direction matters just as much: a cached service worker is
  // unrecoverable from the server, because it decides what every later request
  // does. Same for the shell that names the current bundles.
  for (const p of ['/sw.js', '/service-worker.js', '/index.html', '/']) {
    const h = (await fetch(base + p)).headers.get('cache-control') || '';
    assert(/no-store/.test(h), p + ' is cacheable and must not be: ' + (h || '(none)'));
  }
});

/* ---- and it has to actually run ---- */
const { browser, skip } = await launchChromium();
if (skip) {
  console.log('SKIP — browser run: ' + skip + '.');
  server.close();
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll deploy checks passed (browser run skipped).');
  process.exit(failures ? 1 : 0);
}
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
const violations = [];
page.on('console', (m) => {
  if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await t('the athlete app boots under the real CSP', async () => {
  await page.goto(base + '/home', { waitUntil: 'networkidle' });
  await page.waitForSelector('h1', { timeout: 8000 });
  assert(violations.length === 0, 'CSP violations: ' + violations.join(' | '));
  assert(errors.length === 0, 'page errors: ' + errors.join(' | '));
});

await browser.close();
server.close();
console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll deploy checks passed.');
process.exit(failures ? 1 : 0);
