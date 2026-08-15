/*
 * Fold the conditioning lab into the conditioning site, at /lab.
 *
 * The owner asked for one address rather than two, so the branded conditioning
 * build and the engine bench ship from the same origin. They stay two separate
 * Vite apps — the lab has no athlete, no store and no sync, and merging its
 * routes into apps/web would give it all three by accident.
 *
 * THREE THINGS HAVE TO AGREE OR THE PAGE BREAKS QUIETLY, and each is done here
 * rather than left to a Netlify rule:
 *
 *  1. The lab is built with `HYBRID_LAB_BASE=/lab/`. Vite writes ABSOLUTE asset
 *     URLs into index.html, so a root-based build copied into /lab/ would
 *     request `/assets/...` — a real directory on this site belonging to the
 *     athlete app. It would serve a bundle rather than 404, so the failure
 *     would be a blank page with a 200.
 *  2. `_redirects` ends with the athlete SPA fallback `/* /index.html 200`,
 *     and Netlify evaluates top-down, so a rule appended after it can never
 *     fire. The lab's rules are INSERTED ABOVE it.
 *  3. `_headers` caches `/assets/*` as immutable, which does not match
 *     `/lab/assets/*`. Without the added block the lab's hashed bundles would
 *     inherit the `/*` rule's `no-store` and re-download on every launch.
 *
 * Run: node scripts/build-lab.mjs   (after the conditioning site is assembled)
 */
import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv[2] || '.');
const PUBLISH = process.env.HYBRID_PUBLISH || 'apps/web/dist-conditioning';
const OUT = resolve(root, PUBLISH);
const LAB = resolve(root, 'apps/lab/dist');

const exists = async (f) => {
  try {
    await access(f);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(OUT))) {
  console.error(`${PUBLISH} is missing — assemble the conditioning site first.`);
  process.exit(1);
}
if (!(await exists(resolve(LAB, 'index.html')))) {
  console.error('apps/lab/dist/index.html is missing — run the lab build first.');
  process.exit(1);
}

console.log(`Folding the lab into ${PUBLISH}/lab:\n`);

await cp(LAB, resolve(OUT, 'lab'), { recursive: true });
console.log('  lab/');

/* ---- the base check, done on the OUTPUT rather than trusted from the env ----
   Reading HYBRID_LAB_BASE back would only prove what we set. This proves what
   Vite actually wrote, which is the thing that has to be right. */
const labHtml = await readFile(resolve(OUT, 'lab/index.html'), 'utf8');
const wrong = [...labHtml.matchAll(/(?:href|src)="(\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((r) => !r.startsWith('/lab/'));
if (wrong.length) {
  console.error('\nThe lab build was not made for /lab/. These absolute references escape it:');
  wrong.forEach((w) => console.error('  ' + w));
  console.error('\nBuild it with HYBRID_LAB_BASE=/lab/ — on this site those paths belong to the athlete app,');
  console.error('so they would serve the wrong bundle with a 200 rather than fail.');
  process.exit(1);
}
console.log('  every asset reference stays under /lab/');

/* ---- redirects: above the SPA fallback, never after it ---- */
const redirectsPath = resolve(OUT, '_redirects');
const redirects = await readFile(redirectsPath, 'utf8');
const FALLBACK = '/* /index.html 200';
if (!redirects.includes(FALLBACK)) {
  console.error(`\n_redirects has no '${FALLBACK}' line to insert above.`);
  console.error('That line is the athlete SPA fallback; without it the insertion point is a guess.');
  process.exit(1);
}
const labRules = [
  '# The conditioning lab, folded in by scripts/build-lab.mjs.',
  '#',
  '# ABOVE the athlete SPA fallback, because Netlify evaluates this file',
  '# top-down and the fallback below would otherwise answer every /lab address',
  '# with the athlete shell. Real files under /lab/ are served ahead of both.',
  '/lab      /lab/index.html  200',
  '/lab/*    /lab/index.html  200',
  '',
].join('\n');
await writeFile(redirectsPath, redirects.replace(FALLBACK, labRules + FALLBACK));
console.log('  _redirects — /lab rules inserted above the SPA fallback');

/* ---- headers: the lab's hashed bundles are as immutable as the app's ---- */
const headersPath = resolve(OUT, '_headers');
const headers = await readFile(headersPath, 'utf8');
await writeFile(
  headersPath,
  headers +
    '\n# The conditioning lab, folded in by scripts/build-lab.mjs. Vite hashes these\n' +
    '# filenames exactly as it does the athlete app’s, so a URL’s bytes can never\n' +
    '# change. Without this block they inherit the /* rule’s no-store.\n' +
    '/lab/assets/*\n' +
    '  Cache-Control: public, max-age=31536000, immutable\n' +
    '\n/lab/index.html\n' +
    '  Cache-Control: no-cache, no-store, must-revalidate\n',
);
console.log('  _headers — /lab/assets/* is cacheable, /lab/index.html is not');

/* ---- the CSP is script-src 'self' with no unsafe-inline, and it applies to
   /lab as much as to the app. An inline <script> here would be blocked and the
   bench would render blank in production while working in dev. ---- */
const inline = (labHtml.match(/<script\b[^>]*>/gi) || []).filter((m) => !/\ssrc=/i.test(m));
if (inline.length) {
  console.error('\nINLINE <script> in the lab build:');
  inline.forEach((m) => console.error('  ' + m));
  console.error('\nThe deployed CSP is script-src self with no unsafe-inline, so the lab would render blank.');
  process.exit(1);
}
console.log('  no inline <script> — the deployed CSP would allow this page');

console.log('\nOK — the lab is served at /lab on this site.');
