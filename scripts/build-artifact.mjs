/*
 * Build the athlete app as ONE self-contained HTML document.
 *
 * Why this exists: the deployed site is a multi-file origin with a server, a
 * service worker and Netlify functions behind it. An artifact is a single
 * sandboxed document with a strict CSP — no external host, no origin, no
 * backend. Everything the app reaches for has to already be inside the file,
 * and everything it reaches for that CANNOT be has to be answered locally
 * rather than left to fail.
 *
 * Three classes of problem, each handled below:
 *   1. Assets      — CSS and JS are inlined; fonts/icons are already data URIs
 *                    from vite.artifact.config.ts's assetsInlineLimit.
 *   2. Backend     — the WHOOP/Concept2 status calls go to /.netlify/functions/*,
 *                    which does not exist here. A fetch shim answers them with
 *                    the same fixture checks/screens.mjs uses, so the readiness
 *                    card renders connected instead of erroring.
 *   3. Empty store — an app opened with an empty database shows nothing but
 *                    empty states. The shim seeds the SAME athlete the
 *                    screenshot harness seeds (checks/_seed.mjs), so the file
 *                    opens on a populated week.
 *
 * WHICH product this builds is an argument, because the repo has three real
 * athlete surfaces and they are genuinely different apps:
 *
 *   hybrid       (default, no VITE_HYBRID_PRODUCT) — unfiltered, both halves
 *                present. `/` redirects to the coach bench on this build, so the
 *                shim lands the document on `#/home` instead.
 *   strength     — THE Strength System. FILTERS the surface to what it owns, so
 *                Home's zones card, the door into conditioning, is hidden
 *                (`showZonesCard`, Home.tsx).
 *   conditioning — THE Conditioning System. The second nav tab becomes Cond →
 *                /conditioning.
 *
 * That last line is worth reading twice: `navTabs` (BottomNav.tsx) SWAPS Train
 * for Cond rather than adding it, so the conditioning product is the only build
 * where conditioning has a tab at all — and on the hybrid build it is reachable
 * only through Home's zones card. That is a fact about the nav, not about this
 * script, and it is why the conditioning side needs its own document to be seen
 * as a first-class surface.
 *
 * On the two scoped builds `/` IS the athlete Home, so the shim leaves the hash
 * alone; only the unscoped build needs landing past the coach bench.
 *
 * Output is BODY CONTENT, not a whole document: the artifact host wraps the file
 * in its own <!doctype>/<head>/<body> skeleton, so emitting those tags again
 * would nest a second document inside the first.
 *
 * Run: node scripts/build-artifact.mjs [hybrid|strength|conditioning] [outFile]
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildSeed } from '../checks/_seed.mjs';

const PRODUCTS = {
  hybrid: { env: '', title: 'THE Hybrid Engine — Athlete', file: 'athlete.html' },
  strength: { env: 'strength', title: 'THE Strength System — Athlete', file: 'athlete-strength.html' },
  conditioning: {
    env: 'conditioning',
    title: 'THE Conditioning System — Athlete',
    file: 'athlete-conditioning.html',
  },
};

const which = process.argv[2] || 'hybrid';
const product = PRODUCTS[which];
if (!product) {
  console.error(`unknown product ${JSON.stringify(which)} — expected one of: ${Object.keys(PRODUCTS).join(', ')}`);
  process.exit(1);
}
/* Scoped builds render Home at `/`; only the unscoped one sends `/` to the
   coach bench and therefore needs the shim to land somewhere else. */
const isScoped = product.env !== '';
const landing = isScoped ? '#/' : '#/home';

const root = resolve(process.cwd(), '.');
const DIST = resolve(root, 'apps/web/dist-artifact');
const OUT = resolve(root, process.argv[3] || join('apps/web/dist-artifact', product.file));

const say = (m) => console.log('  ' + m);

/* ---- 1. build ---- */
console.log(`Building the ${which} athlete app as a single document:\n`);
/* VITE_HYBRID_PRODUCT is always set explicitly, to '' for hybrid rather than
   left off: inheriting a stray one from the caller's shell would silently
   produce a differently-filtered surface than the one being asked for. */
execFileSync(
  'pnpm',
  ['--filter', '@hybrid/web', 'exec', 'vite', 'build', '--config', 'vite.artifact.config.ts'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_HYBRID_PRODUCT: product.env } },
);

/* ---- 2. collect what vite emitted ---- */
const assets = await readdir(join(DIST, 'assets'));
const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));

/* Loud, not lenient. cssCodeSplit:false + inlineDynamicImports:true promise
   exactly one of each; more than one means a config change silently split the
   bundle and the inliner would ship a document missing half its code. */
if (js.length !== 1) throw new Error(`expected exactly 1 JS chunk, got ${js.length}: ${js.join(', ')}`);
if (css.length !== 1) throw new Error(`expected exactly 1 CSS file, got ${css.length}: ${css.join(', ')}`);

const jsSrc = await readFile(join(DIST, 'assets', js[0]), 'utf8');
const cssSrc = await readFile(join(DIST, 'assets', css[0]), 'utf8');
say(`inlining ${js[0]} (${Math.round(jsSrc.length / 1024)} KB)`);
say(`inlining ${css[0]} (${Math.round(cssSrc.length / 1024)} KB)`);

/* Any remaining same-origin URL is a live bug: there is no origin to serve it.
   Data URIs are already inlined and are not references, so exclude them. */
const dangling = [...cssSrc.matchAll(/url\((["']?)(?!data:)([^)"']+)\1\)/g)].map((m) => m[2]);
if (dangling.length) {
  throw new Error(
    'CSS still references external assets, which the artifact CSP blocks:\n  ' +
      [...new Set(dangling)].join('\n  '),
  );
}

/* ---- 3. the boot shim ----
   Runs BEFORE the bundle. Everything here exists because the app would
   otherwise reach for something a sandboxed document cannot provide. */
const seed = buildSeed();
const shim = `
/* --- the athlete this document opens as ---
   Seeded only when absent, never on every load: the store is real localStorage
   and re-seeding it on each boot would silently discard anything logged in this
   session, which is exactly what a lost session looks like. */
try {
  var S = ${JSON.stringify(seed)};

  /* --- land on the athlete app ---
     On the unscoped build \`/\` redirects to the coach bench, so an empty hash
     would drop the reader straight into the coach workspace; \`/home\` is Home's
     own address and renders the athlete screen on every build. Scoped builds
     already render Home at \`/\` and just need a hash to exist.
     Only an ABSENT or root hash is set, so a deep link the reader chose — or a
     reload after navigating — is left alone. */
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = ${JSON.stringify(landing)};
  }
  if (!localStorage.getItem('hybrid-engine-v1')) {
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(S.db));
  }
  /* Its own key and its own guard — the training and nutrition slices are
     separate stores, and one guard over both would make a nutrition reset look
     like a training reset. */
  if (!localStorage.getItem('hybrid-nutrition-v1')) {
    localStorage.setItem('hybrid-nutrition-v1', JSON.stringify(S.nutrition));
  }

  /* --- no service worker ---
     UpdateBanner.tsx registers '/sw.js' with no .catch(). There is no origin to
     serve it from, so the register() would reject unhandled on every boot. The
     component already guards on the capability, so switching that guard off is
     the clean fix.

     It has to be DELETED, not shadowed with an undefined getter: the guard is
     \`'serviceWorker' in navigator\`, and \`in\` is true for a property that
     exists and holds undefined. Shadowing therefore passed the guard and then
     threw on .register — which, from inside a render effect, unmounted the whole
     tree and produced a blank document that built perfectly. The accessor lives
     on Navigator.prototype, so that is where the delete has to land. */
  try { delete Navigator.prototype.serviceWorker; } catch (e) {}
  try { delete navigator.serviceWorker; } catch (e) {}

  /* --- no backend ---
     WHOOP state is never persisted; it is fetched on mount. The artifact CSP
     blocks the request outright, so without this the readiness card boots into
     its error state. Answer the two endpoints locally with the same fixture the
     screenshot harness uses, and let every other call fail as it normally would. */
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/.netlify/functions/integrations-status') !== -1) {
      return Promise.resolve(new Response(JSON.stringify(S.whoopStatus), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    }
    if (url.indexOf('/.netlify/functions/whoop-sync') !== -1) {
      return Promise.resolve(new Response(JSON.stringify({
        connected: true, normalized: S.whoopStatus.whoop.normalized,
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (!realFetch) return Promise.reject(new Error('offline artifact'));
    return realFetch(input, init);
  };
} catch (e) {
  /* A shim failure must not take the app down with it — an unseeded app still
     runs, it just opens empty. */
  console.warn('artifact shim: ' + (e && e.message));
}
`;

/* ---- 4. assemble ----
   Body content only: the artifact host supplies <!doctype>, <html>, <head> and
   <body>. The app mounts into #root, which main.tsx looks up by id. */
const html = `<title>${product.title}</title>
<style>
/* The host's reset gives <body> no height, but the app's shell is
   min-h-full — without a height chain to resolve against, every screen
   collapses to the height of its content and the bottom nav floats mid-page. */
html, body { height: 100%; margin: 0; background: #070706; }
#root { min-height: 100%; }
</style>
<style>${cssSrc}</style>
<div id="root"></div>
<script>${shim}</script>
<script type="module">${jsSrc}</script>
`;

await writeFile(OUT, html);
say(`wrote ${OUT} (${Math.round(html.length / 1024)} KB)`);

/* The artifact host caps a rendered page at 16 MB. */
const mb = Buffer.byteLength(html) / 1024 / 1024;
if (mb > 16) throw new Error(`artifact is ${mb.toFixed(1)} MB, over the 16 MB limit`);
console.log(`\nAthlete artifact ready — ${mb.toFixed(2)} MB, self-contained.`);
