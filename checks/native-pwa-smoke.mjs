import { access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDefault = fileURLToPath(new URL('../app/', import.meta.url));
const packageDefault = resolve(process.cwd());
const bundleRoot = resolve(
  process.cwd(),
  process.argv[2] || (existsSync(join(process.cwd(), 'app', 'index.html')) ? sourceDefault : packageDefault),
);
const failures = [];

function pass(label, detail = '') {
  console.log(`PASS — ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label, detail = '') {
  const message = `${label}${detail ? `: ${detail}` : ''}`;
  failures.push(message);
  console.error(`FAIL — ${message}`);
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
  const attributePattern = new RegExp(
    `\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`,
    'i',
  );

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
  return [...new Set(refs.filter(isLocalReference).map(normalizeAssetReference))]
    .filter(Boolean);
}

function hasTagAssetReference(html, tagName, attribute, asset) {
  return tagAttributeValues(html, tagName, attribute)
    .filter(isLocalReference)
    .map(normalizeAssetReference)
    .some((reference) => reference === asset || reference.endsWith(`/${asset}`));
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
  const focusedUi = await readBundleText('focused-ui.js');
  const pwa = await readBundleText('pwa.js');

  if (index) {
    const expectedReferences = [
      ['focused-ui.js', 'script', 'src'],
      ['native-ui.css', 'link', 'href'],
      ['pwa.js', 'script', 'src'],
    ];
    for (const [asset, tagName, attribute] of expectedReferences) {
      if (hasTagAssetReference(index, tagName, attribute, asset)) {
        pass(`index.html references ${asset}`);
      } else {
        fail(`index.html references ${asset}`, 'matching local script or link tag not found');
      }
    }
  } else {
    for (const asset of ['focused-ui.js', 'native-ui.css', 'pwa.js']) {
      fail(`index.html references ${asset}`, 'index.html could not be read');
    }
  }

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

    for (const [index, icon] of icons.entries()) {
      const valid = icon && typeof icon.src === 'string' && icon.src.trim() &&
        typeof icon.sizes === 'string' && icon.sizes.trim() &&
        typeof icon.type === 'string' && icon.type.trim();
      if (valid) pass(`manifest icon ${index + 1} has src, sizes, and type`);
      else fail(`manifest icon ${index + 1} has src, sizes, and type`, 'icon metadata is incomplete');
    }
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
    if (missingFiles.length) {
      fail('local app shell files exist', missingFiles.join(', '));
    } else {
      pass('local app shell files exist', `${shellDependencies.size} dependencies`);
    }

    const cachedEntries = cachedShellEntries(serviceWorker);
    const missingCacheEntries = [...shellDependencies].filter((dependency) => (
      !cachedEntries.includes(dependency)
    ));
    if (missingCacheEntries.length) {
      fail('service worker caches all local app shell dependencies', missingCacheEntries.join(', '));
    } else {
      pass('service worker caches all local app shell dependencies', `${shellDependencies.size} dependencies`);
    }

    if (/\.netlify\/functions\//.test(serviceWorker) && /return;/.test(serviceWorker)) {
      pass('service worker bypasses authenticated function requests');
    } else {
      fail('service worker bypasses authenticated function requests', 'function-route bypass not found');
    }
  } else {
    fail('service worker caches all local app shell dependencies', 'index.html or service-worker.js could not be read');
  }

  if (focusedUi) {
    const builderPatterns = [
      /\bfunction\s+focusedBuilder\s*\(/,
      /window\.focusedBuilder\s*=\s*focusedBuilder/,
      /window\.builder\s*=\s*focusedBuilder/,
    ];
    const loggerPatterns = [
      /\bfunction\s+focusedTrain\s*\(/,
      /window\.focusedTrain\s*=\s*focusedTrain/,
      /window\.train\s*=\s*focusedTrain/,
    ];
    const missingBuilder = missingPatterns(focusedUi, builderPatterns);
    const missingLogger = missingPatterns(focusedUi, loggerPatterns);
    if (missingBuilder.length) fail('focused-ui.js exposes focused Builder hooks', missingBuilder.join(', '));
    else pass('focused-ui.js exposes focused Builder hooks');
    if (missingLogger.length) fail('focused-ui.js exposes focused Logger hooks', missingLogger.join(', '));
    else pass('focused-ui.js exposes focused Logger hooks');

    const builderMapPatterns = [
      /function\s+fBuilderMap\s*\(/,
      /function\s+fBuilderSuperset\s*\(/,
      /focusBuilderSuperset\(/,
      /window\.focusBuilderSuperset\s*=\s*fBuilderSuperset/,
      /destinationIsWarm/,
      /destinationIsCool/,
    ];
    const missingBuilderMap = missingPatterns(focusedUi, builderMapPatterns);
    if (missingBuilderMap.length) fail('focused Builder map supports supersets and block reordering', missingBuilderMap.join(', '));
    else pass('focused Builder map supports supersets and block reordering');

    const builderStrengthStart = focusedUi.indexOf('function fTrackingLabel');
    const builderConditioningStart = focusedUi.indexOf('function fConditionMeasureOptions');
    const builderTextStart = focusedUi.indexOf('function fBuilderText');
    const strengthBuilderSource = builderStrengthStart >= 0 && builderConditioningStart > builderStrengthStart
      ? focusedUi.slice(builderStrengthStart, builderConditioningStart)
      : '';
    const conditioningBuilderSource = builderConditioningStart >= 0 && builderTextStart > builderConditioningStart
      ? focusedUi.slice(builderConditioningStart, builderTextStart)
      : '';
    const strengthMeasurementChecks = [
      /<label>Sets<\/label>/,
      /<label>Tracking<\/label>/,
      /Reps \+ Kilos/,
      /Reps \+ %1RM/,
      /Each side/,
      /Seconds/,
      /For completion/,
    ];
    const conditioningMeasurementChecks = [
      /measurementType/,
      /Minutes/,
      /Seconds/,
      /Distance/,
      /Calories/,
      /Rounds/,
      /For completion/,
    ];
    const missingStrengthMeasurements = missingPatterns(strengthBuilderSource, strengthMeasurementChecks);
    const missingConditioningMeasurements = missingPatterns(conditioningBuilderSource, conditioningMeasurementChecks);
    if (missingStrengthMeasurements.length) fail('Builder strength measurements', missingStrengthMeasurements.join(', '));
    else pass('Builder strength measurements', 'sets, locked tracking modes, seconds, %1RM, and completion');
    if (missingConditioningMeasurements.length) fail('Builder conditioning measurements', missingConditioningMeasurements.join(', '));
    else pass('Builder conditioning measurements', 'minutes, seconds, distance, calories, rounds, completion');
    if (/\b(load|kg|previous best|working max)\b/i.test(strengthBuilderSource) || /\b(load|kg|previous best|working max)\b/i.test(conditioningBuilderSource)) {
      fail('Builder stays plan-only', 'load, kilo, or previous-best language found in the Builder controls');
    } else {
      pass('Builder stays plan-only', 'no load or previous-best controls');
    }

    const loggerRowsStart = focusedUi.indexOf('function fLoggerFieldDescriptors');
    const loggerStrengthStart = focusedUi.indexOf('function fLoggerStrength');
    const loggerInstructionStart = focusedUi.indexOf('function fLoggerInstruction');
    const loggerSupersetStart = focusedUi.indexOf('function fLoggerSuperset');
    const loggerSource = loggerRowsStart >= 0 && loggerInstructionStart > loggerRowsStart
      ? focusedUi.slice(loggerRowsStart, loggerInstructionStart)
      : '';
    const loggerStrengthSource = loggerStrengthStart >= 0 && loggerInstructionStart > loggerStrengthStart
      ? focusedUi.slice(loggerStrengthStart, loggerInstructionStart)
      : '';
    const lockedLoggerChecks = [
      /Sets/, /Completed/, /Kilos/, /fLoggerTrackingMode/, /focus-log-complete/,
    ];
    const missingLockedLogger = missingPatterns(loggerSource, lockedLoggerChecks);
    if (missingLockedLogger.length) fail('Logger renders locked dynamic fields', missingLockedLogger.join(', '));
    else pass('Logger renders locked dynamic fields', 'sets, selected measures, and completed controls');
    if (/addExtra\(\)|autofill\(\)|restMenu\(\)/.test(loggerStrengthSource)) {
      fail('Logger does not expose Builder changes', 'extra sets, autofill, or rest-menu controls found in the strength Logger');
    } else {
      pass('Logger does not expose Builder changes', 'no set-count, mode, or rest-prescription controls');
    }
  } else {
    fail('focused-ui.js exposes focused Builder hooks', 'focused-ui.js could not be read');
    fail('focused-ui.js exposes focused Logger hooks', 'focused-ui.js could not be read');
  }

  if (index) {
    const behaviorPatterns = [
      /durationMin/,
      /Completed sets start the timer automatically/,
      /hybridToggleSetCore/,
      /targetKind=function\(target\).*completion/,
    ];
    const missingBehavior = missingPatterns(index, behaviorPatterns);
    if (missingBehavior.length) fail('Logger behavior contracts', missingBehavior.join(', '));
    else pass('Logger behavior contracts', 'minute results, completion targets, and automatic rest');
  }

  if (pwa) {
    const installPatterns = [
      /beforeinstallprompt/,
      /\.prompt\s*\(/,
      /(?:window|root)\.(?:installPrivatePwa|installPWA|installApp|showInstallPrompt|promptInstall)\s*=/i,
      /serviceWorker\.register\s*\(/,
    ];
    const missingInstallPatterns = missingPatterns(pwa, installPatterns);
    if (missingInstallPatterns.length) {
      fail('pwa.js exposes install behavior', missingInstallPatterns.join(', '));
    } else {
      pass('pwa.js exposes install behavior');
    }
  } else {
    fail('pwa.js exposes install behavior', 'pwa.js could not be read');
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
