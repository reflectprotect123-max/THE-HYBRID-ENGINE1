/*
 * Native PWA smoke test for the mock-exact app.
 *
 * The app is a single index.html (the design mock's screens, made real) plus
 * manifest, icons, service worker and the vendored Supabase client. This
 * check validates the installable-PWA surface and the app's core behavior
 * contracts without needing a browser.
 */
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { join } from 'node:path';

const bundleRoot = resolve(process.cwd(), process.argv[2] || '.');
const failures = [];

function pass(label, detail = '') {
  console.log(`PASS — ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label, detail = '') {
  const message = `${label}${detail ? `: ${detail}` : ''}`;
  failures.push(message);
  console.error(`FAIL — ${message}`);
}

function check(condition, label, detail = '') {
  if (condition) pass(label, detail);
  else fail(label, detail);
}

async function readBundleText(relativePath) {
  try {
    return await readFile(join(bundleRoot, ...relativePath.split('/')), 'utf8');
  } catch (error) {
    fail(`read ${relativePath}`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function bundleFileExists(relativePath) {
  try {
    await access(join(bundleRoot, ...relativePath.split('/')));
    return true;
  } catch {
    return false;
  }
}

function normalizeAssetReference(value) {
  const withoutQuery = String(value).split(/[?#]/, 1)[0];
  return withoutQuery
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/+/, '')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+/g, '/');
}

function isLocalReference(value) {
  const reference = String(value || '').trim();
  return Boolean(
    reference &&
    !reference.startsWith('#') &&
    !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference),
  );
}

function tagAttributeValues(html, tagName, attribute) {
  const values = [];
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const attributePattern = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  for (const tag of html.matchAll(tagPattern)) {
    const match = tag[0].match(attributePattern);
    if (match) values.push(match[2]);
  }
  return values;
}

function localHtmlDependencies(html) {
  const refs = [
    ...tagAttributeValues(html, 'link', 'href'),
    ...tagAttributeValues(html, 'script', 'src'),
    ...tagAttributeValues(html, 'img', 'src'),
    ...tagAttributeValues(html, 'source', 'src'),
  ];
  return [...new Set(refs.filter(isLocalReference).map(normalizeAssetReference))].filter(Boolean);
}

function stringLiterals(source) {
  const literals = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  return [...source.matchAll(literals)].map(([literal]) => literal.slice(1, -1));
}

function arrayAssignments(source) {
  const arrays = new Map();
  const assignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\]/g;
  for (const match of source.matchAll(assignment)) {
    arrays.set(match[1], stringLiterals(match[2]));
  }
  return arrays;
}

function cachedShellEntries(serviceWorker) {
  const arrays = arrayAssignments(serviceWorker);
  const entries = [];
  const addAll = /\.addAll\s*\(\s*(?:([A-Za-z_$][\w$]*)|\[([\s\S]*?)\])\s*\)/g;
  for (const match of serviceWorker.matchAll(addAll)) {
    if (match[1]) entries.push(...(arrays.get(match[1]) || []));
    if (match[2]) entries.push(...stringLiterals(match[2]));
  }
  return [...new Set(entries.map(normalizeAssetReference).filter(Boolean))];
}

function missingPatterns(source, patterns) {
  return patterns.filter((pattern) => !pattern.test(source)).map((pattern) => pattern.toString());
}

async function run() {
  console.log(`Native PWA smoke test — ${bundleRoot}`);

  const index = await readBundleText('index.html');
  const manifestSource = await readBundleText('manifest.json');
  const serviceWorker = await readBundleText('service-worker.js');

  let manifest = null;
  if (manifestSource) {
    try {
      manifest = JSON.parse(manifestSource);
      pass('manifest.json is valid JSON');
    } catch (error) {
      fail('manifest.json is valid JSON', error instanceof Error ? error.message : String(error));
    }
  }

  if (manifest) {
    for (const field of ['name', 'short_name', 'start_url', 'display', 'icons']) {
      const value = manifest[field];
      const present = Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim() !== '' : value != null;
      if (present) pass(`manifest install field ${field}`);
      else fail(`manifest install field ${field}`, 'missing or empty');
    }
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    for (const size of ['192x192', '512x512']) {
      if (icons.some((icon) => icon && icon.sizes === size)) pass(`manifest includes ${size} install icon`);
      else fail(`manifest includes ${size} install icon`, 'required icon size not found');
    }
  }

  if (index) {
    check(/<link\s+rel="manifest"/.test(index), 'index.html links the web app manifest');
    check(/serviceWorker/.test(index) && /register\(\s*['"]\.\/service-worker\.js['"]/.test(index), 'index.html registers the service worker');

    // The mock-exact behavior contracts: local-first persistence, the four
    // mock screens, set logging with automatic rest, and server-side WHOOP.
    const behaviorPatterns = [
      [/const LS_KEY='hybrid-engine-v1'/, 'local-first persistence key'],
      [/s-home/, 'Home screen'],
      [/s-training/, 'Training screen'],
      [/s-logger/, 'Logger screen'],
      [/s-builder/, 'Builder screen'],
      [/s-settings/, 'Settings screen'],
      [/restchip/, 'non-blocking rest chip'],
      [/tickSet\(/, 'set completion ticks'],
      [/startRest\(CUR_REST\)/, 'rest auto-starts on set completion'],
      [/reps_kg/, 'Reps + Kilos tracking mode'],
      [/amrap/, 'Max reps tracking mode'],
      [/reps_seconds/, 'Reps + Seconds tracking mode'],
      [/completion/, 'For completion tracking mode'],
      [/RPE felt/, 'actual-RPE logging'],
      [/lastTimeFor\(/, 'last-time history lookup'],
      [/integrations-status/, 'WHOOP status endpoint'],
      [/whoop-connect/, 'WHOOP connect endpoint'],
      [/whoop-sync/, 'WHOOP sync endpoint'],
      [/integrations-disconnect/, 'WHOOP disconnect endpoint'],
      [/templateWorkout\(/, 'nameless template seed'],
    ];
    for (const [pattern, label] of behaviorPatterns) {
      check(pattern.test(index), `app contract: ${label}`);
    }
    check(!/api\.prod\.whoop\.com|WHOOP_CLIENT_SECRET|APP_SESSION_SECRET/.test(index), 'index.html has no provider API or secret material');
  }

  if (serviceWorker && index) {
    const shellDependencies = new Set(['index.html', ...localHtmlDependencies(index)]);
    for (const icon of manifest?.icons || []) {
      if (isLocalReference(icon?.src)) shellDependencies.add(normalizeAssetReference(icon.src));
    }

    const missingFiles = [];
    for (const dependency of shellDependencies) {
      if (!(await bundleFileExists(dependency))) missingFiles.push(dependency);
    }
    if (missingFiles.length) fail('local app shell files exist', missingFiles.join(', '));
    else pass('local app shell files exist', `${shellDependencies.size} dependencies`);

    const cachedEntries = cachedShellEntries(serviceWorker);
    const missingCacheEntries = [...shellDependencies].filter((dependency) => !cachedEntries.includes(dependency));
    if (missingCacheEntries.length) fail('service worker caches all local app shell dependencies', missingCacheEntries.join(', '));
    else pass('service worker caches all local app shell dependencies', `${shellDependencies.size} dependencies`);

    if (/\.netlify\/functions\//.test(serviceWorker) && /return;/.test(serviceWorker)) {
      pass('service worker bypasses authenticated function requests');
    } else {
      fail('service worker bypasses authenticated function requests', 'function-route bypass not found');
    }
    check(/SKIP_WAITING/.test(serviceWorker), 'service worker supports user-confirmed updates');
  } else {
    fail('service worker caches all local app shell dependencies', 'index.html or service-worker.js could not be read');
  }

  if (failures.length) {
    console.error(`FAIL — Native PWA smoke test failed (${failures.length} checks).`);
    process.exitCode = 1;
  } else {
    console.log('PASS — Native PWA smoke test passed.');
  }
}

try {
  await run();
} catch (error) {
  fail('smoke test execution', error instanceof Error ? error.stack || error.message : String(error));
  console.error(`FAIL — Native PWA smoke test failed (${failures.length} checks).`);
  process.exitCode = 1;
}
