/*
 * Assemble the deployable site.
 *
 * Netlify publishes exactly ONE directory, so everything the origin must serve
 * has to end up inside apps/web/dist. This script is that assembly, kept as a
 * script rather than a shell one-liner in netlify.toml so it can be run and
 * verified locally — a deploy is a bad place to discover a missing cp.
 *
 * Every copy below is a live bug if omitted. That is not a guess: each one was
 * found by building the publish directory and driving it in a browser.
 *
 * Run: node scripts/build-site.mjs   (after `pnpm run build`)
 */
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv[2] || '.');
const OUT = resolve(root, 'apps/web/dist');
const p = (...s) => resolve(root, ...s);

const exists = async (f) => {
  try {
    await access(f);
    return true;
  } catch {
    return false;
  }
};

const say = (m) => console.log('  ' + m);

if (!(await exists(OUT))) {
  console.error('apps/web/dist is missing — run `pnpm run build` first.');
  process.exit(1);
}
if (!(await exists(p('apps/coach/dist')))) {
  console.error('apps/coach/dist is missing — run `pnpm run build` first.');
  process.exit(1);
}

console.log('Assembling the site into apps/web/dist:\n');

/* ---- the coach app, at /coach/ ----
   apps/coach builds with base:'/coach/', so every asset URL it emits is
   already /coach/assets/… — copying its dist here serves it correctly as REAL
   FILES, which Netlify serves ahead of the athlete app's SPA fallback. */
await rm(resolve(OUT, 'coach'), { recursive: true, force: true });
await cp(p('apps/coach/dist'), resolve(OUT, 'coach'), { recursive: true });
say('coach app → /coach/');

/* ---- assets the built HTML already references ----
   apps/web has no public/ directory, but its index.html preloads
   /fonts/inter-var.woff2 and the generated manifest points at
   /icons/icon-*.png. Without these the PWA has no icon and is not
   installable — and nothing fails loudly to tell you. */
for (const dir of ['icons', 'fonts']) {
  await cp(p(dir), resolve(OUT, dir), { recursive: true });
  say(dir + '/');
}

/* ---- assetlinks: lose this and the installed Android app grows an address
   bar, because App Links verification for com.hybridengine.app fails. ---- */
await cp(p('.well-known'), resolve(OUT, '.well-known'), { recursive: true });
say('.well-known/assetlinks.json');

/* ---- /privacy is a real route linked from the Play listing ---- */
await cp(p('privacy.html'), resolve(OUT, 'privacy.html'));
say('privacy.html');

/* ---- Netlify reads these from the PUBLISH directory, not the repo root.
   Once publish stops being ".", an uncopied _headers means the CSP silently
   disappears and the site still works — the worst possible failure mode.
   They stay at the root too: checks/pentest.mjs reads them from there. ---- */
for (const f of ['_headers', '_redirects']) {
  await cp(p(f), resolve(OUT, f));
  say(f);
}

/* ---- service worker handover ----
   Everyone already using the app has `/service-worker.js` registered. The new
   build uses Workbox at `/sw.js`. If the old path simply 404s, browsers keep
   the last worker they successfully fetched — so installed clients would stay
   on the old cache indefinitely.
   Shipping a tombstone at the old path is the clean handover: it takes control,
   deletes every cache it owns, unregisters itself, and reloads. The page then
   registers the new worker normally. */
const tombstone = `/*
 * Tombstone for the pre-React service worker.
 *
 * This file exists ONLY so clients that registered the old worker have
 * something to update to. It unregisters itself and clears the caches the old
 * worker created, handing the origin over to the Workbox worker at /sw.js.
 *
 * Do not add behaviour here. When no client has been offline longer than a
 * cache lifetime, this can be deleted.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('the-hybrid-engine-training-pwa-')).map((k) => caches.delete(k)),
      );
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })(),
  );
});
`;
await writeFile(resolve(OUT, 'service-worker.js'), tombstone);
say('service-worker.js (tombstone — hands old clients over to /sw.js)');

/* ---- sanity: the things the browser will actually ask for ---- */
const html = await readFile(resolve(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
const manifestPath = resolve(OUT, 'manifest.webmanifest');
if (await exists(manifestPath)) {
  const mf = JSON.parse(await readFile(manifestPath, 'utf8'));
  (mf.icons || []).forEach((i) => refs.push(i.src));
}
const missing = [];
for (const r of new Set(refs)) {
  if (r.startsWith('//') || r.includes('://')) continue;
  if (!(await exists(resolve(OUT, r.replace(/^\//, '').split('?')[0])))) missing.push(r);
}
if (missing.length) {
  console.error('\nThese are referenced by the built site but are NOT in the publish directory:');
  missing.forEach((m) => console.error('  ' + m));
  console.error('\nA deploy would 404 them. Fix the copy steps above rather than the reference.');
  process.exit(1);
}

console.log('\nOK — publish directory assembled and every referenced asset is present.');
