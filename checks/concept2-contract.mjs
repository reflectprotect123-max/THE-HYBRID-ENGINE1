import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * Concept2 Logbook contract check — the Concept2-shaped twin of
 * checks/whoop-contract.mjs. Same output style (PASS/FAIL lines, non-zero
 * exit on any failure), same source-scan-plus-runtime-import approach, but
 * asserting Concept2's ACTUAL contract rather than WHOOP's:
 *
 *   - COMMA-delimited OAuth scopes (not WHOOP's space-delimited).
 *   - log.concept2.com hosts, not api.prod.whoop.com.
 *   - the versioned `application/vnd.c2logbook.v1+json` Accept header.
 *   - NO webhook integration — sync is pull-based, so this does not (and must
 *     not) demand HMAC/webhook machinery that intentionally does not exist.
 *   - NO token-revocation endpoint — disconnect is local-only by design, so
 *     this asserts the ABSENCE of a revoke call rather than its presence.
 *   - Concept2's `time` field is tenths of a second; the engine-side
 *     conversion to plain seconds is asserted directly.
 */

const checkDir = fileURLToPath(new URL('.', import.meta.url));
const requestedRoot = resolve(process.argv[2] || resolve(checkDir, '..'));
const appRoot = existsSync(join(requestedRoot, 'app', 'index.html'))
  ? join(requestedRoot, 'app')
  : requestedRoot;

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

async function readText(relativePath) {
  try {
    return await readFile(join(appRoot, ...relativePath.split('/')), 'utf8');
  } catch (error) {
    fail(`read ${relativePath}`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function hasExport(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bexport\\s+(?:(?:async)\\s+)?(?:function|const|let|var)\\s+${escaped}\\b`).test(source);
}

function hasAll(source, patterns) {
  return patterns.every((pattern) => pattern.test(source));
}

function quotePattern(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['\"]${escaped}['\"]|\\x60${escaped}\\x60`);
}

async function walkTextFiles(dir, skipDirectory) {
  const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.toml', '.tsx', '.ts', '.txt']);
  const textFiles = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    fail('walk source tree', error instanceof Error ? error.message : String(error));
    return textFiles;
  }

  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    const relativePath = relative(appRoot, absolute).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (!skipDirectory(relativePath)) textFiles.push(...await walkTextFiles(absolute, skipDirectory));
      continue;
    }
    if (textExtensions.has(relativePath.slice(relativePath.lastIndexOf('.'))) || ['_headers', '_redirects'].includes(entry.name)) {
      textFiles.push({ absolute, relativePath });
    }
  }
  return textFiles;
}

async function main() {
  console.log(`Concept2 contract check — ${appRoot}`);

  const requiredFiles = [
    'netlify.toml',
    'package.json',
    'pnpm-lock.yaml',
    '_redirects',
    '_headers',
    'packages/engine/src/types.ts',
    'packages/engine/src/concept2.ts',
    'apps/web/src/cloud/concept2.tsx',
    'apps/mobile/src/cloud/concept2.tsx',
    'packages/config/src/index.ts',
    'netlify/functions/_lib/config.mjs',
    'netlify/functions/_lib/concept2.mjs',
    'netlify/functions/_lib/oauth.mjs',
    'netlify/functions/concept2-connect.mjs',
    'netlify/functions/concept2-callback.mjs',
    'netlify/functions/concept2-sync.mjs',
    'netlify/functions/integrations-status.mjs',
    'netlify/functions/integrations-disconnect.mjs',
  ];

  const sources = new Map();
  for (const relativePath of requiredFiles) {
    const source = await readText(relativePath);
    if (source !== null) {
      sources.set(relativePath, source);
      pass(`required Concept2/deployment file ${relativePath}`);
    }
  }

  const concept2 = sources.get('netlify/functions/_lib/concept2.mjs') || '';
  const config = sources.get('netlify/functions/_lib/config.mjs') || '';
  const connect = sources.get('netlify/functions/concept2-connect.mjs') || '';
  const callback = sources.get('netlify/functions/concept2-callback.mjs') || '';
  const sync = sources.get('netlify/functions/concept2-sync.mjs') || '';
  const status = sources.get('netlify/functions/integrations-status.mjs') || '';
  const disconnect = sources.get('netlify/functions/integrations-disconnect.mjs') || '';
  const sample = sources.get('packages/engine/src/types.ts') || '';
  const matcher = sources.get('packages/engine/src/concept2.ts') || '';
  const ui =
    (sources.get('apps/web/src/cloud/concept2.tsx') || '') +
    (sources.get('apps/mobile/src/cloud/concept2.tsx') || '') +
    (sources.get('packages/config/src/index.ts') || '');

  for (const [label, source] of [
    ['Concept2 connect', connect],
    ['Concept2 callback', callback],
    ['Concept2 sync', sync],
  ]) {
    check(/connectNetlifyBlobs\(event\)/.test(source), `${label} initializes Netlify Blobs before persistence`);
  }

  const concept2Exports = [
    'CONCEPT2_SCOPES',
    'createConcept2AuthUrl',
    'exchangeConcept2Code',
    'refreshConcept2Token',
    'mergeConcept2Token',
    'concept2Fetch',
    'listConcept2Results',
    'getConcept2Result',
    'getConcept2Strokes',
    'normalizeConcept2Result',
    'isConcept2Unauthorized',
    'concept2ErrorResponse',
  ];
  for (const name of concept2Exports) {
    check(hasExport(concept2, name), `Concept2 helper export ${name}`, 'netlify/functions/_lib/concept2.mjs');
  }

  const requiredScopes = ['user:read', 'results:read'];
  for (const scope of requiredScopes) {
    check(quotePattern(scope).test(concept2), `Concept2 OAuth scope ${scope}`);
  }
  check(
    /CONCEPT2_SCOPES\.join\(['"],['"]\)/.test(concept2),
    'Concept2 OAuth scopes are COMMA-delimited',
    'Concept2 documents comma separation, unlike WHOOP\'s space-delimited scope string',
  );

  check(
    hasAll(concept2, [
      /BASE\s*=\s*['"]https:\/\/log\.concept2\.com['"]/,
      /AUTH\s*=\s*`\$\{BASE\}\/oauth`/,
      /API\s*=\s*`\$\{BASE\}\/api`/,
      /\$\{AUTH\}\/authorize/,
      /\$\{AUTH\}\/access_token/,
      /response_type:\s*['"]code['"]/,
      /state\b/,
    ]),
    'Concept2 OAuth/API base contract',
    'log.concept2.com authorization-code flow with state',
  );
  check(
    hasAll(concept2, [
      /client_secret:\s*config\.concept2ClientSecret/,
      /grant_type:\s*['"]authorization_code['"]/,
      /grant_type:\s*['"]refresh_token['"]/,
      /content-type['"]?\s*:\s*['"]application\/x-www-form-urlencoded['"]/,
    ]),
    'Concept2 token exchange and refresh stay server-side',
    'client secret is used only by the token request',
  );
  check(
    quotePattern('application/vnd.c2logbook.v1+json').test(concept2),
    'Concept2 API requests use the versioned Accept header',
    'the Logbook API requires application/vnd.c2logbook.v1+json, not plain application/json',
  );
  check(quotePattern('/users/me/results').test(concept2), 'Concept2 results list endpoint');
  check(/results\/\$\{encodeURIComponent/.test(concept2) && /\/strokes/.test(concept2), 'Concept2 per-result and strokes endpoints');
  check(
    /status === 404[\s\S]{0,40}return null/.test(concept2) || /error\.status === 404\)\s*return null/.test(concept2),
    'Concept2 strokes 404 is treated as data (no per-stroke capture), not an error',
  );

  const normalizedFields = [
    'provider',
    'externalId',
    'providerUserId',
    'modality',
    'startedAt',
    'durationRaw',
    'distanceRaw',
    'workoutType',
    'syncedAt',
  ];
  for (const field of normalizedFields) {
    check(
      new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(concept2),
      `server normalized result field ${field}`,
    );
    check(
      new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\??\\s*:`).test(sample),
      `client normalized result field ${field}`,
    );
  }
  check(/provider:\s*['"]concept2_logbook['"]/.test(concept2), 'normalized result is stamped with the concept2_logbook provider tag');

  check(
    hasAll(connect, [
      /sessionFromEvent/,
      /newState/,
      /savePending/,
      /['"]concept2['"]/,
      /createConcept2AuthUrl/,
      /sessionCookie/,
      /redirect\(/,
    ]),
    'Concept2 connect creates session-bound OAuth state',
  );
  check(
    hasAll(callback, [
      /consumePending/,
      /q\.state/,
      /!pending/,
      /invalid_oauth_state/,
      /pending\.owner/,
    ]),
    'Concept2 callback rejects missing/unknown OAuth state or code',
  );
  check(
    /sessionFromEvent\s*\(\s*event\s*\)/.test(callback) &&
      /consumePending\([\s\S]*?sid\s*\)/.test(callback),
    'Concept2 callback binds OAuth state to the callback browser session',
  );
  check(
    /concept2Callback:\s*`\$\{BASE_URL\}\/\.netlify\/functions\/concept2-callback`/.test(config),
    'Concept2 callback uses a configured exact function path',
  );
  check(
    !/redirect\(\s*(?:q\.|event\.|body|payload)/.test(callback) &&
      /(?:redirect|result)\((?:['"`])\/\?integration=concept2/.test(callback),
    'Concept2 callback redirects are fixed app-relative destinations',
  );

  check(
    hasAll(connect, [
      /client === ['"]native['"]/,
      /ownerFromEvent/,
      /identity\.kind !== ['"]user['"]/,
      /authorizeUrl/,
      /NATIVE_RETURN_URL/,
    ]),
    'native connect is JSON, requires a verified Supabase user, and never anonymous',
  );

  // Concept2 has no encryption code of its own — it reuses _lib/oauth.mjs's
  // saveToken/loadToken, whose encryption whoop-contract.mjs already exercises
  // at runtime (AES-GCM via _lib/crypto.mjs). What THIS check owns is the half
  // whoop-contract.mjs cannot see: that Concept2's own callback/sync actually
  // route through that shared, encrypting store — by provider key 'concept2' —
  // rather than reading or writing a token some other way.
  const oauthLib = sources.get('netlify/functions/_lib/oauth.mjs') || '';
  check(
    /encryptJson\(token\)/.test(oauthLib) && /decryptJson\(record\.encrypted\)/.test(oauthLib),
    'the shared oauth store Concept2 tokens pass through encrypts on save and decrypts on load',
  );
  check(
    /saveToken\(\s*['"]concept2['"]/.test(callback) &&
      /loadTokenRecord\(\s*['"]concept2['"]/.test(sync) &&
      !/token\s*[:=][^=]*\{[^}]*access_token/i.test(callback + sync),
    'Concept2 callback and sync persist/load tokens only through the shared encrypted store, never a plaintext field of their own',
  );
  check(
    /refreshConcept2Token/.test(sync) && /refresh_token/.test(sync) &&
      /mergeConcept2Token\(/.test(sync) &&
      /saveToken\(\s*['"]concept2['"]/.test(sync),
    'Concept2 sync persists the rotated refresh-token response',
  );

  // Concept2's own KNOWN_GAPS/RESEARCH_REPORT document no webhook integration
  // at all — sync is pull-based only. This check asserts that ABSENCE holds
  // (no concept2-webhook function, no HMAC signature verification bolted onto
  // the provider module) rather than demanding machinery that would be a
  // fabrication of a contract Concept2 never offered.
  check(
    !existsSync(join(appRoot, 'netlify/functions/concept2-webhook.mjs')),
    'Concept2 has no webhook function — sync is intentionally pull-based only',
  );
  check(
    !/verifyConcept2Webhook|x-concept2-signature/i.test(concept2),
    'the Concept2 provider module implements no webhook-signature verification',
    'there is nothing to verify: Concept2 offers no webhook to receive',
  );

  // Mirror image of WHOOP's disconnect check: Concept2's documented API has no
  // token-revocation endpoint, so disconnect must be local-only. Asserting the
  // ABSENCE of a revoke call is the actual contract here, not a gap to fill.
  check(
    /provider === ['"]concept2['"]/.test(disconnect) &&
      /removeToken\(\s*['"]concept2['"]/.test(disconnect),
    'Concept2 disconnect removes local records for the concept2 provider',
  );
  check(
    !/revokeConcept2Token|revokeConcept2Access/.test(disconnect) &&
      !/revokeConcept2Token|revokeConcept2Access/.test(concept2),
    'Concept2 disconnect does not call a provider revocation endpoint',
    'Concept2 documents no token-revocation endpoint — local-only removal is the whole operation',
  );

  check(
    /concept2Results\[0\]\?\.startedAt/.test(status) && /resultCount:\s*concept2Results\.length/.test(status),
    'integration status summarizes Concept2 result count and latest result without the full list',
  );

  check(/loadTokenRecord\(['"]concept2['"]/.test(sync) || /loadToken\(['"]concept2['"]/.test(sync), 'Concept2 sync loads the stored token by provider key');
  check(/backfill/.test(sync) && /90/.test(sync), 'Concept2 sync supports an explicit backfill window');
  check(/updated_after|updatedAfter/.test(sync), 'Concept2 sync uses incremental updated_after windows after the first sync');

  // The tenths-of-a-second duration conversion is Concept2-specific (every
  // other engine `dur` is plain seconds) and easy to silently regress.
  check(
    /durationRaw\s*\/\s*10/.test(matcher),
    'engine-side matcher converts Concept2 durationRaw (tenths of a second) to plain seconds',
    'result.durationRaw / 10, not a pass-through — every other engine dur is already in seconds',
  );
  check(/CONCEPT2_TYPE_TO_MODALITY/.test(matcher) && /rower:\s*['"]row['"]/.test(matcher), 'Concept2 raw machine types are mapped to the engine Modality union, never passed through');
  check(/CONCEPT2_MATCH_WINDOW_MS/.test(matcher), 'a Concept2 result is matched to a session inside a bounded time window');

  const requiredEnv = ['CONCEPT2_CLIENT_ID', 'CONCEPT2_CLIENT_SECRET'];
  for (const name of requiredEnv) {
    check(new RegExp(`process\\.env\\.${name}\\b`).test(config), `server reads required environment variable ${name}`);
  }

  check(/concept2Connect/.test(ui) && /concept2Sync/.test(ui), 'client uses the integration function endpoints');
  check(/FN\.concept2Connect/.test(ui) && /FN\.concept2Sync/.test(ui), 'client reaches those endpoints through the shared table, not by hand-written path');
  check(!/log\.concept2\.com|client_secret\s*[:=]/i.test(ui), 'client has no provider API host or secret — every call is brokered by a Function');

  const staticFiles = await walkTextFiles(appRoot, (relativePath) => (
    relativePath === 'netlify' || relativePath.startsWith('netlify/functions/') ||
    relativePath === 'node_modules' || relativePath.endsWith('/node_modules') || relativePath.includes('node_modules/') ||
    relativePath === 'vendor' || relativePath.startsWith('vendor/') ||
    relativePath === 'checks' || relativePath.startsWith('checks/') ||
    relativePath === '.claude' || relativePath.startsWith('.claude/') ||
    // Same reasoning as whoop-contract.mjs: real source lives under netlify/,
    // packages/, and apps/. Everything else — planning docs, research
    // bundles, and gitignored agent scratch paths under .superpowers/ — is
    // neither published nor source, and scanning it produces only noise (this
    // is the exact class of false positive whoop-contract.mjs currently
    // reports 2 of, from .superpowers/ scratch paths it does not exclude).
    relativePath === 'docs' || relativePath.startsWith('docs/') ||
    relativePath === '.superpowers' || relativePath.startsWith('.superpowers/') ||
    (relativePath !== '' && !relativePath.startsWith('netlify') && !relativePath.startsWith('packages') && !relativePath.startsWith('apps') &&
      !['package.json', 'pnpm-lock.yaml', 'netlify.toml', '_headers', '_redirects'].includes(relativePath))
  ));
  const secretPatterns = [
    { label: 'Concept2 client secret literal', pattern: /CONCEPT2_CLIENT_SECRET\s*[:=]\s*(['"`])(?!(?:undefined|null)\1)(?:\\.|(?!\1)[^\r\n])*\1/i },
    {
      label: 'access/refresh token literal',
      pattern: /(access_token|refresh_token|client_secret)\s*[:=]\s*(['"`])(?!(?:undefined|null)\2)((?:\\.|(?!\2)[^\r\n])*)\2/gi,
      credible: (m) => {
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        return norm(m[3]) !== norm(m[1]);
      },
    },
    { label: 'Concept2 API in browser package', pattern: /https:\/\/log\.concept2\.com/i },
  ];
  let secretFindings = 0;
  for (const { absolute, relativePath } of staticFiles) {
    let source;
    try {
      source = await readFile(absolute, 'utf8');
    } catch (error) {
      fail(`scan browser-facing file ${relativePath}`, error instanceof Error ? error.message : String(error));
      continue;
    }
    for (const { label, pattern, credible } of secretPatterns) {
      let hit = false;
      if (credible) {
        pattern.lastIndex = 0;
        for (let m; (m = pattern.exec(source)); ) {
          if (credible(m)) {
            hit = true;
            break;
          }
        }
      } else {
        hit = pattern.test(source);
      }
      if (hit) {
        secretFindings += 1;
        fail(`browser-facing secret scan — ${relativePath}`, label);
      }
    }
    if (/process\.env\.CONCEPT2/.test(source) && !relativePath.startsWith('netlify/functions/')) {
      secretFindings += 1;
      fail(`browser-facing env boundary — ${relativePath}`, 'provider environment access found outside netlify/functions');
    }
  }
  if (!secretFindings) pass('browser-facing files contain no Concept2 provider secret material', `${staticFiles.length} text files scanned`);

  process.env.APP_BASE_URL = 'https://thehybridengine1.netlify.app';
  process.env.CONCEPT2_CLIENT_ID = 'contract-client-id';
  process.env.CONCEPT2_CLIENT_SECRET = 'contract-test-secret';
  process.env.APP_SESSION_SECRET = 'contract-session-secret';
  try {
    const moduleUrl = `${pathToFileURL(join(appRoot, 'netlify/functions/_lib/concept2.mjs')).href}?concept2-contract=${Date.now()}`;
    const concept2Runtime = await import(moduleUrl);
    const state = 'a'.repeat(concept2Runtime.CONCEPT2_STATE_LENGTH);
    const authUrl = new URL(concept2Runtime.createConcept2AuthUrl(state));
    check(authUrl.origin === 'https://log.concept2.com' && authUrl.pathname === '/oauth/authorize', 'Concept2 runtime auth URL uses the production authorization endpoint');
    check(authUrl.searchParams.get('redirect_uri') === 'https://thehybridengine1.netlify.app/.netlify/functions/concept2-callback', 'Concept2 runtime auth URL uses the exact callback redirect');
    check(authUrl.searchParams.get('state') === state, 'Concept2 runtime auth URL carries the generated state');
    check(authUrl.searchParams.get('scope') === concept2Runtime.CONCEPT2_SCOPES.join(','), 'Concept2 runtime auth URL requests comma-delimited handoff scopes');
    check(!authUrl.searchParams.get('scope').includes(' '), 'Concept2 scope parameter is not space-delimited (that is WHOOP\'s format, not Concept2\'s)');

    let rejectedShortState = false;
    try {
      concept2Runtime.createConcept2AuthUrl('short');
    } catch (error) {
      rejectedShortState = error?.code === 'invalid_state';
    }
    check(rejectedShortState, 'Concept2 runtime rejects an OAuth state of the wrong length');

    const normalized = concept2Runtime.normalizeConcept2Result({
      id: 987654,
      user_id: 555,
      type: 'rower',
      date_utc: '2026-07-14T07:00:00Z',
      time: 152350,
      distance: 5000,
      time_formatted: '4:13:55.0',
      workout_type: 'FixedDistanceSplits',
      source: 'ErgData',
      verified: true,
      ranked: false,
      privacy: 'public',
      workout: { splits: [{ time: 1000 }] },
    }, { syncedAt: '2026-07-14T08:00:00Z' });
    check(
      normalized.provider === 'concept2_logbook' && normalized.externalId === '987654' &&
        normalized.providerUserId === '555' && normalized.modality === 'rower' &&
        normalized.startedAt === '2026-07-14T07:00:00Z' && normalized.durationRaw === 152350 &&
        normalized.distanceRaw === 5000 && normalized.workoutType === 'FixedDistanceSplits' &&
        normalized.strokeDataAvailable === false && normalized.syncedAt === '2026-07-14T08:00:00Z',
      'Concept2 runtime normalization matches the app result contract',
    );

    const wrappedResult = { data: { id: 1, type: 'skierg', date: '2026-01-01', workout_type: null } };
    const normalizedWrapped = concept2Runtime.normalizeConcept2Result(wrappedResult);
    check(normalizedWrapped.modality === 'skierg' && normalizedWrapped.workoutType === 'unknown', 'Concept2 normalization unwraps a {data:...} envelope and defaults an unknown workout type');

    check(concept2Runtime.isConcept2Unauthorized({ status: 401 }) === true, 'Concept2 runtime treats HTTP 401 as unauthorized');
    check(concept2Runtime.isConcept2Unauthorized({ status: 500 }) === false, 'Concept2 runtime does not treat a server error as unauthorized');

    const rateLimited = concept2Runtime.concept2ErrorResponse({ status: 429, retryAfter: '30' });
    check(rateLimited.status === 429 && rateLimited.headers?.['retry-after'] === '30', 'Concept2 rate-limit errors surface a retry-after header');
    const reauth = concept2Runtime.concept2ErrorResponse({ status: 401 });
    check(reauth.status === 401 && reauth.body?.error === 'reauthorization_required', 'Concept2 unauthorized errors surface a reauthorization response');
  } catch (error) {
    fail('Concept2 helper runtime contract', error instanceof Error ? error.message : String(error));
  }

  if (failures.length) {
    console.error(`Concept2 contract check failed with ${failures.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log('Concept2 contract checks passed.');
  }
}

await main();
