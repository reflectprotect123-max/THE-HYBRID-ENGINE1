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
    'pnpm-lock.yaml',
    '_redirects',
    '_headers',
    'README.md',
    'privacy.html',
    'packages/engine/src/types.ts',
    'apps/web/src/cloud/whoop.tsx',
    'apps/mobile/src/cloud/whoop.tsx',
    'packages/config/src/index.ts',
    'netlify/functions/_lib/config.mjs',
    'netlify/functions/_lib/crypto.mjs',
    'netlify/functions/_lib/http.mjs',
    'netlify/functions/_lib/identity.mjs',
    'netlify/functions/_lib/oauth.mjs',
    'netlify/functions/_lib/session.mjs',
    'netlify/functions/_lib/store.mjs',
    'netlify/functions/_lib/supabase.mjs',
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
  const identity = sources.get('netlify/functions/_lib/identity.mjs') || '';
  const supabase = sources.get('netlify/functions/_lib/supabase.mjs') || '';
  const connect = sources.get('netlify/functions/whoop-connect.mjs') || '';
  const callback = sources.get('netlify/functions/whoop-callback.mjs') || '';
  const sync = sources.get('netlify/functions/whoop-sync.mjs') || '';
  const webhook = sources.get('netlify/functions/whoop-webhook.mjs') || '';
  const disconnect = sources.get('netlify/functions/integrations-disconnect.mjs') || '';
  const status = sources.get('netlify/functions/integrations-status.mjs') || '';
  /* The browser side of WHOOP is now two React clients over one shared
     endpoint table, not a vanilla adapter plus an inline UI. Concatenated
     because the assertions below are about the SURFACE the origin exposes —
     which endpoints get called, and what never appears client-side — and that
     property has to hold across both apps or it holds in neither. */
  const sample = sources.get('packages/engine/src/types.ts') || '';
  const ui =
    (sources.get('apps/web/src/cloud/whoop.tsx') || '') +
    (sources.get('apps/mobile/src/cloud/whoop.tsx') || '') +
    (sources.get('packages/config/src/index.ts') || '');
  const readme = sources.get('README.md') || '';
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
    /* The client half of this contract used to live in a vanilla adapter that
       re-declared every field. It is now ONE shared type that all three apps
       import, so the field belonging to the client surface means the field
       existing on WhoopSample — a mismatch between server and client is a
       compile error rather than a thing this file has to notice. */
    check(
      new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\??\\s*:`).test(sample),
      `client normalized recovery field ${field}`,
    );
  }
  check(/source\?\s*:/.test(sample), 'client sample type carries its provider');

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
      // `pending.owner`, was `pending.sid` — see the note on the identity
      // mapping check further down. The pending record still carries a sid and
      // still enforces it for browser authorizations; it is simply no longer
      // the thing tokens are keyed by.
      /pending\.owner/,
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
  /*
   * Was: `sessionFromEvent(event)`. The property being asserted is that
   * disconnect acts on the CALLER'S OWN records and nobody else's, and that is
   * unchanged — what changed is that a caller can now prove who it is two ways.
   * `ownerFromEvent` resolves both (cookie for a browser, verified Supabase
   * token for the app) and is the only way either handler learns an owner, so
   * pinning the cookie helper by name would now assert the transport rather
   * than the boundary.
   */
  check(
    /method\(\s*event\s*,\s*\[['"]POST['"]\]\s*\)/.test(disconnect) &&
      /ownerFromEvent\s*\(\s*event\s*\)/.test(disconnect) &&
      /removeToken\(/.test(disconnect),
    'disconnect is POST-only, owner-scoped, and removes local WHOOP records',
  );
  check(
    /revokeWhoopToken\s*\(/.test(disconnect) || /revoke(?:UserOauthAccess|OauthAccess|ProviderToken)\s*\(/i.test(disconnect),
    'WHOOP disconnect revokes provider access before local deletion',
    'the boundary contract requires provider revocation, not only local token removal',
  );
  /*
   * Was: `pending.sid`. Same assertion — the tokens are filed under whoever
   * STARTED the authorization and never under whoever happened to arrive at the
   * callback — but the pending record now names that party `owner`, because for
   * a native authorization it is a verified Supabase user and there is no sid
   * to speak of. `pending.sid` still exists and is still enforced for browser
   * authorizations; it is just no longer the thing tokens are keyed by.
   */
  check(/saveToken/.test(callback) && /pending\.owner/.test(callback) && /providerUserId/.test(callback), 'WHOOP callback maps provider identity to the initiating owner');
  /*
   * Was: `sidForProvider`. Same assertion — an inbound webhook is resolved from
   * WHOOP's user id to local records rather than trusting anything in the
   * payload — but the index is now a LIST. One person legitimately holds two
   * grants for one WHOOP account (a browser session and their signed-in phone
   * are different owners by design), and a single-valued index silently pointed
   * every webhook at whichever surface connected last.
   */
  check(/ownersForProvider/.test(webhook) && /payload\??\.user_id/.test(webhook), 'WHOOP webhook maps provider user IDs back to every owner holding that grant');

  /* ------------------------------------------------------------------ *
   * The native identity path.
   *
   * A phone hands WHOOP's consent screen to the system browser, which has its
   * own cookie jar — so the `hybrid_sid` cookie the callback sets is written
   * where the app can never read it. Everything below asserts the replacement:
   * a WHOOP connection is filed under a SERVER-VERIFIED Supabase user, and the
   * cookie path is untouched underneath it.
   * ------------------------------------------------------------------ */
  check(
    hasAll(identity, [
      /export\s+async\s+function\s+ownerFromEvent/,
      /verifySupabaseAccessToken/,
      /sessionFromEvent/,
      /u:/,
    ]),
    'identity resolves an owner from either a verified Supabase token or the session cookie',
  );
  check(
    !/catch[\s\S]{0,160}sessionFromEvent/.test(identity),
    'a rejected bearer token is never downgraded to an anonymous cookie session',
    'a downgrade would hand a forged token whatever connection the cookie riding alongside it owned',
  );
  check(
    hasAll(supabase, [
      /ALGORITHMS\s*=\s*new Set\(\[['"]HS256['"]/,
      /claims\.iss !== expectedIssuer/,
      /includes\(['"]authenticated['"]\)/,
      /claims\.role !== ['"]authenticated['"]/,
      /now >= exp/,
      /timingSafeEqual\(/,
      /UUID\.test\(userId\)/,
    ]),
    'Supabase token verification pins algorithm, issuer, audience, role, expiry and subject',
    'signature alone is not enough: the PUBLIC anon key is a JWT signed with the same secret',
  );
  check(
    !/console\.(?:log|error|warn|info|debug)/.test(supabase) && !/console\.(?:log|error|warn|info|debug)/.test(identity),
    'the identity layer never logs a credential',
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
    'a browser navigation cannot carry an Authorization header, and a token in the query string leaks',
  );
  check(
    /NATIVE_RETURN_URL\s*=\s*['"][a-z][a-z0-9+.-]*:\/\//.test(config) && /NATIVE_RETURN_URL/.test(callback),
    'the callback returns a native authorization to a fixed app URL scheme',
    'the destination comes from the pending record we wrote, never from the request',
  );

  if (await fileExists('apps/mobile/src/cloud/whoop.tsx')) {
    const mobile = await readText('apps/mobile/src/cloud/whoop.tsx');
    check(
      hasAll(mobile || '', [
        /authorization['"]?\s*:\s*['"]Bearer /,
        /client=native/,
        /getInitialURL/,
      ]),
      'the native client authenticates with a bearer token and handles the return deep link',
    );
    check(
      !/credentials:\s*['"]include['"]/.test(mobile || ''),
      'the native client no longer relies on a cookie the system browser holds',
    );
    check(
      !/openURL\((?:fnUrl\()?FN\.whoopConnect/.test(mobile || ''),
      'the native client asks the server to start the authorization before opening a browser',
      'handing whoop-connect straight to the OS is what produced a connection the app could never see',
    );
  }

  // SUPABASE_URL/SUPABASE_JWT_SECRET are additive and are what the NATIVE app's
  // identity rests on. They are listed here for the same reason the four above
  // are: an integration whose deployment steps are not written down is an
  // integration that works only on the machine it was built on.
  //
  // "required" here means the server reads it and the docs name it — NOT that
  // every deployment must set a value. SUPABASE_JWT_SECRET is only consulted on
  // the HS256 branch, and this project signs ES256 (Settings -> JWT Keys shows
  // ECC P-256 as current), so it is deliberately unset in production. What must
  // stay true is that the variable remains documented, because a project that
  // has NOT migrated still needs it and would otherwise fail with no clue why.
  const requiredEnv = [
    'APP_BASE_URL',
    'APP_SESSION_SECRET',
    'WHOOP_CLIENT_ID',
    'WHOOP_CLIENT_SECRET',
    'SUPABASE_URL',
    'SUPABASE_JWT_SECRET',
  ];
  for (const name of requiredEnv) {
    check(new RegExp(`process\\.env\\.${name}\\b`).test(config), `server reads required environment variable ${name}`);
    check(new RegExp(`\\b${name}\\b`).test(readme), `deployment docs name environment variable ${name}`);
  }
  check(/https:\/\/thehybridengine1\.netlify\.app\/privacy\.html/.test(readme), 'production privacy policy URL is documented');
  check(/https:\/\/thehybridengine1\.netlify\.app\/\.netlify\/functions\/whoop-callback/.test(readme), 'production WHOOP OAuth callback URL is documented');
  check(/https:\/\/thehybridengine1\.netlify\.app\/\.netlify\/functions\/whoop-webhook/.test(readme), 'production WHOOP webhook URL is documented');
  check(/WHOOP|server-side|credentials are not stored/i.test(privacy) && /credentials.*server-side/i.test(privacy), 'privacy policy states WHOOP credentials stay server-side');

  check(/whoop-connect/.test(ui) && /integrations-status/.test(ui) && /integrations-disconnect/.test(ui) && /whoop-sync/.test(ui), 'client uses the integration function endpoints');
  check(/FN\.whoopConnect/.test(ui) && /FN\.whoopSync/.test(ui), 'client reaches those endpoints through the shared table, not by hand-written path');
  /* The property that actually matters, and the reason this file exists: the
     browser never talks to WHOOP, only to this origin's own functions. A
     client that learned the provider's API would be one refresh-token leak
     away from an incident. */
  check(!/api\.prod\.whoop\.com|oauth\/oauth2|client_secret\s*[:=]/i.test(ui), 'client has no provider API host or secret — every call is brokered by a Function');

  const staticFiles = await walkTextFiles(appRoot, (relativePath) => (
    relativePath === 'netlify' || relativePath.startsWith('netlify/functions/') ||
    // ANY node_modules, not only the root one. A workspace package has its own,
    // and Vite's dep pre-bundling cache lives inside it — none of it is
    // published (the publish directory is apps/web/dist) and all of it is
    // gitignored, but the scanner used to walk straight into it and read a
    // minified copy of supabase-js as if it were a browser-facing file.
    relativePath === 'node_modules' || relativePath.endsWith('/node_modules') || relativePath.includes('node_modules/') ||
    relativePath === 'vendor' || relativePath.startsWith('vendor/') ||
    relativePath === 'checks' || relativePath.startsWith('checks/') ||
    /*
     * Agent scaffolding, and in particular .claude/worktrees — a git worktree
     * there is a SECOND FULL CHECKOUT of this repo. Its netlify/ and checks/
     * copies arrive as '.claude/worktrees/<name>/netlify/...', which matches
     * none of the exclusions above, so the scan reported this check's own
     * fixture literals and the real server-side functions as browser-facing
     * secrets. Nothing under .claude is source or is published.
     */
    relativePath === '.claude' || relativePath.startsWith('.claude/')
  ));
  const secretPatterns = [
    { label: 'OpenRouter key', pattern: /sk-or-v1-[A-Za-z0-9_-]{20,}/i },
    { label: 'WHOOP client secret literal', pattern: /WHOOP_CLIENT_SECRET\s*[:=]\s*(['"`])(?!(?:undefined|null)\1)(?:\\.|(?!\1)[^\r\n])*\1/i },
    { label: 'session secret literal', pattern: /APP_SESSION_SECRET\s*[:=]\s*(['"`])(?!(?:undefined|null)\1)(?:\\.|(?!\1)[^\r\n])*\1/i },
    /*
     * Scanned across BUILT bundles too, not just source — a secret baked in at
     * build time (a mis-prefixed VITE_* var, a define()) exists nowhere in the
     * tree and would otherwise ship unnoticed.
     *
     * That means this runs over minified third-party code, where a field-name
     * constant map is normal: supabase-js emits `access_token:"access_token"`.
     * A value that IS its own key is a name, not a credential, so it is the one
     * shape dropped here. Everything else — including a short or odd-looking
     * literal — still fails, because the cost of a false negative is a leaked
     * token and the cost of a false positive is reading one line.
     */
    {
      label: 'access/refresh token literal',
      pattern: /(access_token|refresh_token|client_secret)\s*[:=]\s*(['"`])(?!(?:undefined|null)\2)((?:\\.|(?!\2)[^\r\n])*)\2/gi,
      credible: (m) => {
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        return norm(m[3]) !== norm(m[1]);
      },
    },
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
    if (/process\.env\.(?:WHOOP|APP_SESSION_SECRET)/.test(source)) {
      secretFindings += 1;
      fail(`browser-facing env boundary — ${relativePath}`, 'provider/session environment access found outside netlify/functions');
    }
  }
  if (!secretFindings) pass('browser-facing files contain no provider/session secret material', `${staticFiles.length} text files scanned`);

  process.env.APP_BASE_URL = 'https://thehybridengine1.netlify.app';
  process.env.WHOOP_CLIENT_ID = 'contract-client-id';
  process.env.WHOOP_CLIENT_SECRET = 'contract-test-secret';
  process.env.APP_SESSION_SECRET = 'contract-session-secret';
  process.env.SUPABASE_URL = 'https://contract-project.supabase.co';
  process.env.SUPABASE_JWT_SECRET = 'contract-supabase-jwt-secret';
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

  /* ------------------------------------------------------------------ *
   * Runtime: the native identity path.
   *
   * These are the assertions that would have caught the original bug, and the
   * ones that keep its replacement honest. They run the real modules — nothing
   * here is a regex over source.
   * ------------------------------------------------------------------ */
  try {
    const suffix = `whoop-contract=${Date.now()}`;
    const load = (relativePath) => import(`${pathToFileURL(join(appRoot, relativePath)).href}?${suffix}`);
    const supabaseRuntime = await load('netlify/functions/_lib/supabase.mjs');
    const identityRuntime = await load('netlify/functions/_lib/identity.mjs');
    const sessionRuntime = await load('netlify/functions/_lib/session.mjs');
    const oauthRuntime = await load('netlify/functions/_lib/oauth.mjs');

    const b64u = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signHs256 = (input, secret) => createHmac('sha256', secret).update(input).digest('base64url');
    const jwt = (claims, { secret = 'contract-supabase-jwt-secret', header = { alg: 'HS256', typ: 'JWT' } } = {}) => {
      const input = `${b64u(header)}.${b64u(claims)}`;
      return `${input}.${signHs256(input, secret)}`;
    };
    const seconds = Math.floor(Date.now() / 1000);
    const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const claimsFor = (overrides = {}) => ({
      sub: USER_ID,
      iss: 'https://contract-project.supabase.co/auth/v1',
      aud: 'authenticated',
      role: 'authenticated',
      iat: seconds - 60,
      exp: seconds + 3600,
      ...overrides,
    });
    const bearerEvent = (token, cookie) => ({ headers: { authorization: `Bearer ${token}`, ...(cookie ? { cookie } : {}) } });
    const rejects = async (token, label) => {
      try {
        await supabaseRuntime.verifySupabaseAccessToken(token);
        fail(`Supabase token verification rejects ${label}`, 'the token was accepted');
      } catch (error) {
        check(error?.status === 401, `Supabase token verification rejects ${label}`, error?.code || '');
      }
    };

    const goodToken = jwt(claimsFor());
    const verified = await supabaseRuntime.verifySupabaseAccessToken(goodToken);
    check(verified.userId === USER_ID, 'a valid Supabase access token resolves to its subject');

    const owner = await identityRuntime.ownerFromEvent(bearerEvent(goodToken));
    check(owner.kind === 'user' && owner.owner === `u:${USER_ID}` && owner.userId === USER_ID, 'a bearer-authenticated request is attributed to that Supabase user');

    // The cookie path, byte-identical to before: this is the assertion that
    // already-connected web athletes are not quietly disconnected.
    const cookieSid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const cookie = sessionRuntime.sessionCookie(cookieSid).split(';')[0];
    const cookieOwner = await identityRuntime.ownerFromEvent({ headers: { cookie } });
    check(cookieOwner.kind === 'browser' && cookieOwner.owner === cookieSid, 'a cookie-only request keeps its existing session-keyed owner');

    // Precedence: a token wins over a cookie, and a BAD token loses to nothing.
    const bothOwner = await identityRuntime.ownerFromEvent(bearerEvent(goodToken, cookie));
    check(bothOwner.owner === `u:${USER_ID}`, 'a request carrying both credentials is attributed to the signed-in user');
    try {
      await identityRuntime.ownerFromEvent(bearerEvent(jwt(claimsFor(), { secret: 'not-the-secret' }), cookie));
      fail('a forged bearer token is not downgraded to the cookie session', 'the request was accepted as a browser session');
    } catch (error) {
      check(error?.status === 401, 'a forged bearer token is not downgraded to the cookie session', error?.code || '');
    }

    try {
      await identityRuntime.ownerFromEvent({ headers: { authorization: 'Bearer not-a-jwt', cookie } });
      fail('a malformed Authorization header is not treated as anonymous', 'the request was accepted as a browser session');
    } catch (error) {
      check(error?.status === 401, 'a malformed Authorization header is not treated as anonymous', error?.code || '');
    }

    await rejects(jwt(claimsFor(), { secret: 'not-the-secret' }), 'a forged signature');
    await rejects(jwt(claimsFor({ exp: seconds - 3600, iat: seconds - 7200 })), 'an expired token');
    await rejects(jwt(claimsFor(), { header: { alg: 'none', typ: 'JWT' } }), 'an unsigned "alg: none" token');
    await rejects(jwt(claimsFor({ iss: 'https://someone-elses-project.supabase.co/auth/v1' })), 'a token from another issuer');
    await rejects(jwt(claimsFor({ aud: 'anon' })), 'a token for the wrong audience');
    await rejects(jwt(claimsFor({ sub: 'not-a-uuid' })), 'a token whose subject is not a user id');
    // The exact shape of the PUBLIC anon key from packages/config: same secret,
    // same signature, no business being treated as a person.
    await rejects(jwt({ iss: 'supabase', ref: 'contract-project', role: 'anon', iat: seconds - 60, exp: seconds + 3600 }), 'the public anon key');
    await rejects(jwt(claimsFor({ role: 'service_role' })), 'a service-role key');

    // OAuth state. A tampered state string resolves to no pending record at
    // all, which is the `null` case; the rest are the rules that record is
    // judged by, exercised without a Netlify Blobs context.
    const now = Date.now();
    const browserPending = { owner: cookieSid, kind: 'browser', sid: cookieSid, createdAt: now };
    check(oauthRuntime.pendingIsUsable(browserPending, cookieSid, now)?.owner === cookieSid, 'a browser authorization completes in the browser that started it');
    check(oauthRuntime.pendingIsUsable(browserPending, 'some-other-session', now) === null, 'a state redeemed from a different browser is rejected');
    check(oauthRuntime.pendingIsUsable(null, cookieSid, now) === null, 'a tampered or unknown state is rejected');
    check(oauthRuntime.pendingIsUsable({ ...browserPending, createdAt: now - 11 * 60 * 1000 }, cookieSid, now) === null, 'an expired OAuth state is rejected');
    check(oauthRuntime.pendingIsUsable({ ...browserPending, createdAt: now + 60 * 1000 }, cookieSid, now) === null, 'an OAuth state created in the future is rejected');
    check(await oauthRuntime.consumePending('whoop', '', cookieSid) === null, 'an empty OAuth state never reaches the store');
    const nativePending = { owner: `u:${USER_ID}`, kind: 'native', sid: null, createdAt: now };
    check(oauthRuntime.pendingIsUsable(nativePending, undefined, now)?.owner === `u:${USER_ID}`, 'a native authorization is attributed without a cookie');
    check(oauthRuntime.pendingIsUsable(nativePending, 'any-callback-session', now)?.owner === `u:${USER_ID}`, 'a native authorization does not depend on the callback browser');
    // Records written by the previous design must still complete, or every
    // authorization in flight during the deploy breaks.
    check(oauthRuntime.pendingIsUsable({ sid: cookieSid, createdAt: now }, cookieSid, now)?.owner === cookieSid, 'an in-flight pre-deploy OAuth state still completes');
  } catch (error) {
    fail('native identity runtime contract', error instanceof Error ? error.message : String(error));
  }

  if (failures.length) {
    console.error(`WHOOP contract check failed with ${failures.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log('WHOOP contract checks passed.');
  }
}

await main();
