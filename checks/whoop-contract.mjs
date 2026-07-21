import { createHmac } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

async function fileExists(relativePath) {
  try {
    await access(join(appRoot, ...relativePath.split('/')));
    return true;
  } catch {
    return false;
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
  const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.toml', '.txt']);
  const textFiles = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    fail('walk static package', error instanceof Error ? error.message : String(error));
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
  console.log(`WHOOP contract check — ${appRoot}`);

  const requiredFiles = [
    'netlify.toml',
    'package.json',
    'package-lock.json',
    '_redirects',
    '_headers',
    'readme.txt',
    'privacy.html',
    'index.html',
    'integrations/whoop-adapter.js',
    'netlify/functions/_lib/config.mjs',
    'netlify/functions/_lib/crypto.mjs',
    'netlify/functions/_lib/http.mjs',
    'netlify/functions/_lib/oauth.mjs',
    'netlify/functions/_lib/session.mjs',
    'netlify/functions/_lib/store.mjs',
    'netlify/functions/_lib/whoop.mjs',
    'netlify/functions/whoop-connect.mjs',
    'netlify/functions/whoop-callback.mjs',
    'netlify/functions/whoop-sync.mjs',
    'netlify/functions/whoop-webhook.mjs',
    'netlify/functions/integrations-status.mjs',
    'netlify/functions/integrations-disconnect.mjs',
  ];

  const sources = new Map();
  for (const relativePath of requiredFiles) {
    const source = await readText(relativePath);
    if (source !== null) {
      sources.set(relativePath, source);
      pass(`required WHOOP/deployment file ${relativePath}`);
    }
  }

  const whoop = sources.get('netlify/functions/_lib/whoop.mjs') || '';
  const config = sources.get('netlify/functions/_lib/config.mjs') || '';
  const oauth = sources.get('netlify/functions/_lib/oauth.mjs') || '';
  const crypto = sources.get('netlify/functions/_lib/crypto.mjs') || '';
  const session = sources.get('netlify/functions/_lib/session.mjs') || '';
  const store = sources.get('netlify/functions/_lib/store.mjs') || '';
  const connect = sources.get('netlify/functions/whoop-connect.mjs') || '';
  const callback = sources.get('netlify/functions/whoop-callback.mjs') || '';
  const sync = sources.get('netlify/functions/whoop-sync.mjs') || '';
  const webhook = sources.get('netlify/functions/whoop-webhook.mjs') || '';
  const disconnect = sources.get('netlify/functions/integrations-disconnect.mjs') || '';
  const status = sources.get('netlify/functions/integrations-status.mjs') || '';
  const adapter = sources.get('integrations/whoop-adapter.js') || '';
  const index = sources.get('index.html') || '';
  const readme = sources.get('readme.txt') || '';
  const privacy = sources.get('privacy.html') || '';

  check(
    /connectLambda/.test(store) && /connectNetlifyBlobs/.test(store) && /event\.blobs/.test(store),
    'Netlify Lambda-compatible runtime initializes the Blobs context',
  );
  check(
    /consistency:\s*['"]eventual['"]/.test(store) && !/consistency:\s*['"]strong['"]/.test(store),
    'Netlify Blobs store uses Lambda-compatible consistency',
  );
  for (const [label, source] of [
    ['WHOOP connect', connect],
    ['WHOOP callback', callback],
    ['WHOOP sync', sync],
    ['WHOOP webhook', webhook],
    ['integration status', status],
    ['integration disconnect', disconnect],
  ]) {
    check(/connectNetlifyBlobs\(event\)/.test(source), `${label} initializes Netlify Blobs before persistence`);
  }

  const whoopExports = [
    'WHOOP_SCOPES',
    'createWhoopAuthUrl',
    'exchangeWhoopCode',
    'refreshWhoopToken',
    'whoopFetch',
    'normalizeWhoopRecovery',
    'normalizeWhoopPayload',
    'fetchWhoopSnapshot',
    'verifyWhoopWebhook',
  ];
  for (const name of whoopExports) {
    check(hasExport(whoop, name), `WHOOP helper export ${name}`, 'netlify/functions/_lib/whoop.mjs');
  }

  const requiredScopes = [
    'offline',
    'read:recovery',
    'read:cycles',
    'read:sleep',
    'read:workout',
    'read:profile',
    'read:body_measurement',
  ];
  for (const scope of requiredScopes) {
    check(quotePattern(scope).test(whoop), `WHOOP OAuth scope ${scope}`);
  }

  check(
    hasAll(whoop, [
      /https:\/\/api\.prod\.whoop\.com\/developer\/v2/,
      /https:\/\/api\.prod\.whoop\.com\/oauth\/oauth2/,
      /WHOOP_SCOPES\.join/,
      /(?:redirect_uri:\s*config\.whoopCallback|callbackUrl\(\))/,
      /response_type:\s*['"]code['"]/, 
      /state\b/,
    ]),
    'WHOOP OAuth/API base contract',
    'production V2 API, authorization-code flow, state, and configured callback',
  );
  check(
    hasAll(whoop, [
      /client_secret:\s*config\.whoopClientSecret/,
      /grant_type:\s*['"]authorization_code['"]/,
      /grant_type:\s*['"]refresh_token['"]/,
      /content-type['"]?\s*:\s*['"]application\/x-www-form-urlencoded['"]/,
    ]),
    'WHOOP token exchange and refresh stay server-side',
    'client secret is used only by the token request',
  );

  const snapshotPaths = [
    ['/recovery', 7],
    ['/cycle', 7],
    ['/activity/sleep', 7],
    ['/activity/workout', 'MAX_WORKOUTS'],
  ];
  for (const [path, limit] of snapshotPaths) {
    check(
      whoop.includes(path) && (whoop.includes(`${path}?limit=${limit}`) || new RegExp(`fetchCollection\\(['"]${path}['"][\\s\\S]*?,\\s*${limit}\\s*\\)`).test(whoop)),
      `WHOOP snapshot endpoint ${path} (limit ${limit})`,
    );
  }
  check(quotePattern('/user/profile/basic').test(callback), 'WHOOP profile endpoint', 'callback records provider identity');

  const normalizedFields = [
    'source',
    'date',
    'recoveryScore',
    'sleepPerformance',
    'hrvMs',
    'restingHr',
    'strain',
    'capturedAt',
  ];
  for (const field of normalizedFields) {
    check(
      new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(whoop),
      `server normalized recovery field ${field}`,
    );
    check(
      new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(adapter),
      `browser normalized recovery field ${field}`,
    );
  }
  check(/source:\s*['"]whoop['"]/.test(adapter), 'browser WHOOP adapter identifies its provider');
  check(
    /canUseWhoopSample/.test(adapter) &&
      (/Number\.isFinite\(sample\[field\]\)/.test(adapter) || /typeof\s+value\s*===\s*['"]number['"]/.test(adapter)),
    'browser WHOOP adapter accepts normalized numeric samples only',
  );
  check(!/api\.prod\.whoop\.com|oauth\/oauth2|client_secret\s*[:=]/i.test(adapter), 'browser WHOOP adapter has no provider API or secret boundary crossing');

  check(
    hasAll(connect, [
      /sessionFromEvent/,
      /newState/,
      /savePending/,
      /['"]whoop['"]/,
      /createWhoopAuthUrl/,
      /sessionCookie/,
      /redirect\(/,
    ]),
    'WHOOP connect creates session-bound OAuth state',
  );
  check(
    hasAll(oauth, [
      /randomBytes\(/,
      /base64url/,
      /oauth:pending:/,
      /createdAt:\s*Date\.now\(\)/,
      /deleteKey\(\s*key\s*\)/,
      /10\s*\*\s*60\s*\*\s*1000/,
      /typeof state !== ['"]string['"]|!state/,
    ]),
    'OAuth state is random, single-use, and expires',
  );
  check(
    hasAll(callback, [
      /consumePending/,
      /q\.state/,
      /!pending|!code|invalid_oauth_response/,
      /invalid_oauth_state/,
      /pending\.sid/,
    ]),
    'WHOOP callback rejects missing/unknown OAuth state or code',
  );
  check(
    /sessionFromEvent\s*\(\s*event\s*\)/.test(callback) &&
      /consumePending\([\s\S]*?sid\s*\)/.test(callback),
    'WHOOP callback binds OAuth state to the callback browser session',
    'pending.sid must match sessionFromEvent(event)',
  );
  check(
    /COOKIE\s*=\s*['"]hybrid_sid['"]/.test(session) &&
      /HttpOnly/.test(session) &&
      /Secure/.test(session) &&
      /SameSite=Lax/.test(session) &&
      /createHmac\(['"]sha256['"]/.test(session),
    'browser session cookie is signed and hardened',
  );
  check(
    /whoopCallback:\s*`\$\{BASE_URL\}\/\.netlify\/functions\/whoop-callback`/.test(config) &&
      /whoopWebhook:\s*`\$\{BASE_URL\}\/\.netlify\/functions\/whoop-webhook`/.test(config),
    'WHOOP callback and webhook use configured exact function paths',
  );
  check(
    !/redirect\(\s*(?:q\.|event\.|body|payload)/.test(callback) &&
      /(?:redirect|result)\((?:['"`])\/\?integration=whoop/.test(callback),
    'WHOOP callback redirects are fixed app-relative destinations',
  );

  check(
    hasAll(webhook, [
      /method\(\s*event\s*,\s*\[['"]POST['"]\]\s*\)/,
      /rawBody\(event\)/,
      /eventHeader\(event, ['"]x-whoop-signature['"]\)/,
      /eventHeader\(event, ['"]x-whoop-signature-timestamp['"]\)/,
      /verifyWhoopWebhook\(\s*raw/,
      /invalid_signature/,
      /JSON\.parse\(raw\)/,
      /whoopWebhookEventKey\(/,
      /webhook:event:whoop:/,
      /duplicate:\s*true/,
    ]),
    'WHOOP webhook has POST, raw-body HMAC, and deduplication protections',
  );
  check(
    hasAll(whoop, [
      /createHmac\(['"]sha256['"]/, 
      /\.update\(/,
      /\$\{(?:timestamp|providedTimestamp)\}\$\{(?:rawBody|body)\}/,
      /\.digest\(['"]base64['"]\)/,
      /timingSafeEqual\(/,
      /(?:!signature\s*\|\|\s*!timestamp|providedSignature|providedTimestamp)/,
    ]),
    'WHOOP webhook signature uses timestamp plus raw body and constant-time comparison',
  );
  check(
    /waitUntil/.test(webhook) && /await work/.test(webhook),
    'WHOOP webhook completes background sync safely in Netlify execution',
  );

  check(
    /encryptJson\(token\)/.test(oauth) && /decryptJson\(record\.encrypted\)/.test(oauth) && /token:\$\{provider\}:|token:provider:/.test(oauth),
    'WHOOP tokens are encrypted before storage and decrypted on load',
  );
  check(
    /createCipheriv\(['"]aes-256-gcm['"]/.test(crypto) && /setAuthTag\(/.test(crypto) && /requireConfig\(['"]sessionSecret['"]\)/.test(crypto),
    'token records use AES-GCM with the server session secret',
  );
  check(
    /refreshWhoopToken/.test(sync) && /refresh_token/.test(sync) &&
      /mergeWhoopToken\(/.test(sync) &&
      /saveToken\(\s*['"]whoop['"]/.test(sync),
    'manual WHOOP sync persists the rotated refresh-token response',
  );
  check(
    /refreshWhoopToken/.test(webhook) && /refresh_token/.test(webhook) &&
      /mergeWhoopToken\(/.test(webhook) &&
      /saveToken\(\s*['"]whoop['"]/.test(webhook),
    'webhook WHOOP sync persists the rotated refresh-token response',
  );
  check(
    /method\(\s*event\s*,\s*\[['"]POST['"]\]\s*\)/.test(disconnect) &&
      /sessionFromEvent\s*\(\s*event\s*\)/.test(disconnect) &&
      /removeToken\(/.test(disconnect),
    'disconnect is POST-only, session-scoped, and removes local WHOOP records',
  );
  check(
    /revokeWhoopToken\s*\(/.test(disconnect) || /revoke(?:UserOauthAccess|OauthAccess|ProviderToken)\s*\(/i.test(disconnect),
    'WHOOP disconnect revokes provider access before local deletion',
    'the boundary contract requires provider revocation, not only local token removal',
  );
  check(/saveToken/.test(callback) && /pending\.sid/.test(callback) && /providerUserId/.test(callback), 'WHOOP callback maps provider identity to the initiating session');
  check(/sidForProvider/.test(webhook) && /payload\??\.user_id/.test(webhook), 'WHOOP webhook maps provider user IDs back to a session');

  const requiredEnv = [
    'APP_BASE_URL',
    'APP_SESSION_SECRET',
    'WHOOP_CLIENT_ID',
    'WHOOP_CLIENT_SECRET',
  ];
  for (const name of requiredEnv) {
    check(new RegExp(`process\\.env\\.${name}\\b`).test(config), `server reads required environment variable ${name}`);
    check(new RegExp(`\\b${name}\\b`).test(readme), `deployment docs name environment variable ${name}`);
  }
  check(/https:\/\/thehybridengine1\.netlify\.app\/privacy\.html/.test(readme), 'production privacy policy URL is documented');
  check(/https:\/\/thehybridengine1\.netlify\.app\/\.netlify\/functions\/whoop-callback/.test(readme), 'production WHOOP OAuth callback URL is documented');
  check(/https:\/\/thehybridengine1\.netlify\.app\/\.netlify\/functions\/whoop-webhook/.test(readme), 'production WHOOP webhook URL is documented');
  check(/WHOOP|server-side|credentials are not stored/i.test(privacy) && /credentials.*server-side/i.test(privacy), 'privacy policy states WHOOP credentials stay server-side');

  check(/whoop-connect/.test(index) && /integrations-status/.test(index) && /integrations-disconnect/.test(index) && /whoop-sync/.test(index), 'app UI uses the integration function endpoints');
  check(/Connect WHOOP/.test(index) && /WHOOP_ENDPOINTS\.connect/.test(index), 'Settings exposes a WHOOP connect entry');
  check(/whoopCard/.test(index) && /whoopCardHtml/.test(index) && /ringx/.test(index) && /syncWhoop/.test(index), 'Home exposes a WHOOP-style recovery snapshot with sync states');
  check(/whoop-connect/.test(index) || /integrations-ui\.js/.test(index), 'app shell includes the WHOOP integration entry point');

  const staticFiles = await walkTextFiles(appRoot, (relativePath) => (
    relativePath === 'netlify' || relativePath.startsWith('netlify/functions/') ||
    relativePath === 'node_modules' || relativePath.startsWith('node_modules/') ||
    relativePath === 'vendor' || relativePath.startsWith('vendor/') ||
    relativePath === 'checks' || relativePath.startsWith('checks/')
  ));
  const secretPatterns = [
    { label: 'OpenRouter key', pattern: /sk-or-v1-[A-Za-z0-9_-]{20,}/i },
    { label: 'WHOOP client secret literal', pattern: /WHOOP_CLIENT_SECRET\s*[:=]\s*(['"`])(?!(?:undefined|null)\1)(?:\\.|(?!\1)[^\r\n])*\1/i },
    { label: 'session secret literal', pattern: /APP_SESSION_SECRET\s*[:=]\s*(['"`])(?!(?:undefined|null)\1)(?:\\.|(?!\1)[^\r\n])*\1/i },
    { label: 'access/refresh token literal', pattern: /(?:access_token|refresh_token|client_secret)\s*[:=]\s*(['"`])(?!(?:undefined|null)\1)(?:\\.|(?!\1)[^\r\n])*\1/i },
    { label: 'WHOOP API in browser package', pattern: /https:\/\/api\.prod\.whoop\.com/i },
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
    for (const { label, pattern } of secretPatterns) {
      if (pattern.test(source)) {
        secretFindings += 1;
        fail(`browser-facing secret scan — ${relativePath}`, label);
      }
    }
    if (/process\.env\.(?:WHOOP|APP_SESSION_SECRET)/.test(source)) {
      secretFindings += 1;
      fail(`browser-facing env boundary — ${relativePath}`, 'provider/session environment access found outside netlify/functions');
    }
  }
  if (!secretFindings) pass('browser-facing files contain no provider/session secret material', `${staticFiles.length} text files scanned`);

  process.env.APP_BASE_URL = 'https://thehybridengine1.netlify.app';
  process.env.WHOOP_CLIENT_ID = 'contract-client-id';
  process.env.WHOOP_CLIENT_SECRET = 'contract-test-secret';
  try {
    const moduleUrl = `${pathToFileURL(join(appRoot, 'netlify/functions/_lib/whoop.mjs')).href}?whoop-contract=${Date.now()}`;
    const whoopRuntime = await import(moduleUrl);
    const authUrl = new URL(whoopRuntime.createWhoopAuthUrl('Abc12345'));
    check(authUrl.origin === 'https://api.prod.whoop.com' && authUrl.pathname === '/oauth/oauth2/auth', 'WHOOP runtime auth URL uses the production authorization endpoint');
    check(authUrl.searchParams.get('redirect_uri') === 'https://thehybridengine1.netlify.app/.netlify/functions/whoop-callback', 'WHOOP runtime auth URL uses the exact callback redirect');
    check(authUrl.searchParams.get('state') === 'Abc12345', 'WHOOP runtime auth URL carries the generated state');
    check(authUrl.searchParams.get('scope') === requiredScopes.join(' '), 'WHOOP runtime auth URL requests the handoff scopes');

    const rawBody = JSON.stringify({ trace_id: 'contract-event', user_id: 'contract-user' });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', 'contract-test-secret').update(`${timestamp}${rawBody}`).digest('base64');
    check(whoopRuntime.verifyWhoopWebhook(rawBody, signature, timestamp), 'WHOOP runtime accepts a valid base64 HMAC webhook signature');
    check(!whoopRuntime.verifyWhoopWebhook(`${rawBody}x`, signature, timestamp), 'WHOOP runtime rejects a changed webhook body');
    check(!whoopRuntime.verifyWhoopWebhook(rawBody, signature, ''), 'WHOOP runtime rejects a missing webhook timestamp');

    const normalized = whoopRuntime.normalizeWhoopPayload({
      recovery: { records: [{ date: '2026-07-14T07:00:00Z', score: { recovery_score: 82, hrv_rmssd_milli: 54, resting_heart_rate: 48 } }] },
      cycle: { records: [{ score: { strain: 11.2 } }] },
      sleep: { records: [{ score: { sleep_performance_percentage: 91 } }] },
    });
    check(
      normalized.source === 'whoop' && normalized.date === '2026-07-14' &&
        normalized.recoveryScore === 82 && normalized.sleepPerformance === 91 &&
        normalized.hrvMs === 54 && normalized.restingHr === 48 && normalized.strain === 11.2,
      'WHOOP runtime normalization matches the app recovery contract',
    );
  } catch (error) {
    fail('WHOOP helper runtime contract', error instanceof Error ? error.message : String(error));
  }

  if (failures.length) {
    console.error(`WHOOP contract check failed with ${failures.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log('WHOOP contract checks passed.');
  }
}

await main();
