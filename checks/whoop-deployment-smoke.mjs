import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const requestedRoot = resolve(process.argv[2] || resolve(process.cwd()));
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

async function exists(relativePath) {
  try {
    await access(join(appRoot, ...relativePath.split('/')));
    return true;
  } catch {
    return false;
  }
}

async function listFunctionModules(dir, result = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    fail('walk Netlify Functions directory', error instanceof Error ? error.message : String(error));
    return result;
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) await listFunctionModules(absolute, result);
    else if (entry.name.endsWith('.mjs')) result.push(absolute);
  }
  return result;
}

function nodeCheck(file) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolveResult({ ok: false, detail: error.message }));
    child.on('close', (code) => resolveResult({ ok: code === 0, detail: stderr.trim() }));
  });
}

function commandOutput(command, args) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolveResult({ code: -1, stdout: Buffer.concat(stdout), stderr: error.message }));
    child.on('close', (code) => resolveResult({ code, stdout: Buffer.concat(stdout), stderr: stderr.trim() }));
  });
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  console.log(`WHOOP deployment smoke — ${appRoot}`);

  const packageSource = await readText('package.json');
  const lockSource = await readText('package-lock.json');
  const netlify = await readText('netlify.toml');
  const redirects = await readText('_redirects');
  const headers = await readText('_headers');
  const readme = await readText('readme.txt');
  const worker = await readText('service-worker.js');
  const integrationsUi = await readText('integrations-ui.js');

  let pkg = null;
  let lock = null;
  if (packageSource) {
    try {
      pkg = JSON.parse(packageSource);
      pass('app/package.json is valid JSON');
    } catch (error) {
      fail('app/package.json is valid JSON', error instanceof Error ? error.message : String(error));
    }
  }
  if (lockSource) {
    try {
      lock = JSON.parse(lockSource);
      pass('app/package-lock.json is valid JSON');
    } catch (error) {
      fail('app/package-lock.json is valid JSON', error instanceof Error ? error.message : String(error));
    }
  }

  if (pkg) {
    check(pkg.private === true, 'Netlify function package is private');
    check(pkg.type === 'module', 'Netlify function package uses ESM');
    check(typeof pkg.engines?.node === 'string' && /(?:^|[>=])\s*18\b/.test(pkg.engines.node), 'Netlify function package requires Node 18 or newer');
    check(Boolean(pkg.dependencies?.['@netlify/blobs']), 'Netlify Blobs dependency is declared');
  }
  if (lock) {
    check(lock.lockfileVersion >= 2, 'package lockfile is npm v7+ compatible');
    check(lock.packages?.['']?.dependencies?.['@netlify/blobs'] === pkg?.dependencies?.['@netlify/blobs'], 'lockfile root dependencies match package.json');
    check(Boolean(lock.packages?.['node_modules/@netlify/blobs']), 'lockfile contains @netlify/blobs');
  }

  check(
    Boolean(netlify) && /publish\s*=\s*["']\.["']/.test(netlify) && /directory\s*=\s*["']netlify\/functions["']/.test(netlify),
    'Netlify publishes the app root and deploys netlify/functions',
  );
  check(await exists('netlify/functions'), 'Netlify Functions directory exists');
  check(await exists('netlify/functions/_lib'), 'Netlify Functions shared library directory exists');

  const requiredFunctionFiles = [
    'netlify/functions/whoop-connect.mjs',
    'netlify/functions/whoop-callback.mjs',
    'netlify/functions/whoop-sync.mjs',
    'netlify/functions/whoop-webhook.mjs',
    'netlify/functions/_lib/whoop.mjs',
    'netlify/functions/_lib/oauth.mjs',
    'netlify/functions/_lib/crypto.mjs',
    'netlify/functions/_lib/session.mjs',
    'netlify/functions/_lib/store.mjs',
  ];
  for (const relativePath of requiredFunctionFiles) {
    check(await exists(relativePath), `deployed function file exists: ${relativePath}`);
  }

  const functionModules = await listFunctionModules(join(appRoot, 'netlify/functions'));
  const syntaxResults = await Promise.all(functionModules.map(async (absolute) => ({
    absolute,
    result: await nodeCheck(absolute),
  })));
  for (const { absolute, result } of syntaxResults) {
    const relativePath = relative(appRoot, absolute).replaceAll('\\', '/');
    check(result.ok, `Netlify Function syntax: ${relativePath}`, result.ok ? '' : result.detail);
  }
  check(functionModules.length >= 10, 'function bundle contains the expected integration surface', `${functionModules.length} .mjs modules`);

  check(Boolean(redirects) && /^\/privacy \/privacy\.html 200$/m.test(redirects), 'privacy route is preserved in Netlify redirects');
  check(Boolean(headers) && /\/privacy\.html[\s\S]*?Cache-Control:\s*no-cache/i.test(headers), 'privacy page has no-cache headers');
  check(Boolean(readme) && /Netlify Git|Netlify CLI|Netlify API/i.test(readme) && /static (?:drag-and-drop )?upload[\s\S]*?(?:will|does) not activate (?:server |the )?functions/i.test(readme), 'deployment handoff warns against static-only publication');
  check(Boolean(readme) && /netlify\/functions/.test(readme), 'deployment handoff names the Functions directory');

  if (worker) {
    check(!/\.netlify\/functions/.test(worker.match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/)?.[1] || ''), 'service worker app shell does not cache function routes');
    check(/pathname\.startsWith\(['"]\/\.netlify\/functions\//.test(worker), 'service worker bypasses authenticated function requests');
    check(/CACHE_NAME\s*=\s*['\"].*-v\d+-\d{4}-\d{2}-\d{2}['\"]/.test(worker), 'service worker cache version is date-stamped');
  }

  if (integrationsUi) {
    check(/integrations-status/.test(integrationsUi) && /ENDPOINTS/.test(integrationsUi), 'browser status request uses the deployed status Function');
    check(/integrations-disconnect/.test(integrationsUi) && /ENDPOINTS/.test(integrationsUi), 'browser disconnect request uses the deployed disconnect Function');
    check(/method:\s*['"]POST['"]/.test(integrationsUi) && /credentials:\s*['"]same-origin['"]/.test(integrationsUi), 'browser disconnect request is same-origin POST');
  }

  const workspaceRoot = resolve(appRoot, '..');
  const archiveCandidates = [
    join(workspaceRoot, 'THE-Hybrid-System-locked-logger-builder-2026-07-15.zip'),
  ];
  const archivePath = archiveCandidates.find((candidate) => existsSync(candidate));
  if (!archivePath) {
    pass('ZIP/package parity', 'no known deployment archive found; archive parity skipped');
  } else {
    const listing = await commandOutput('unzip', ['-Z1', archivePath]);
    if (listing.code !== 0) {
      fail('ZIP/package parity', listing.stderr || 'unzip could not list the deployment archive');
    } else {
      const entries = listing.stdout.toString('utf8').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
      const archiveEntry = (target) => entries.find((entry) => entry === target || entry.endsWith(`/${target}`));
      const archiveRequired = [
        'index.html',
        'integrations-ui.js',
        'service-worker.js',
        'netlify.toml',
        'package.json',
        'package-lock.json',
        'netlify/functions/whoop-connect.mjs',
        'netlify/functions/whoop-callback.mjs',
        'netlify/functions/whoop-sync.mjs',
        'netlify/functions/whoop-webhook.mjs',
        'netlify/functions/_lib/whoop.mjs',
        'netlify/functions/_lib/oauth.mjs',
        'netlify/functions/_lib/crypto.mjs',
        'netlify/functions/_lib/session.mjs',
        'netlify/functions/_lib/store.mjs',
      ];
      for (const target of archiveRequired) {
        check(Boolean(archiveEntry(target)), `deployment ZIP contains ${target}`);
      }

      const parityFiles = [
        'netlify.toml',
        'package.json',
        'package-lock.json',
        'service-worker.js',
        'integrations-ui.js',
        'netlify/functions/whoop-connect.mjs',
        'netlify/functions/whoop-callback.mjs',
        'netlify/functions/whoop-sync.mjs',
        'netlify/functions/whoop-webhook.mjs',
        'netlify/functions/_lib/whoop.mjs',
      ];
      for (const target of parityFiles) {
        const entry = archiveEntry(target);
        if (!entry) continue;
        let sourceBytes;
        try {
          sourceBytes = await readFile(join(appRoot, ...target.split('/')));
        } catch (error) {
          fail(`ZIP/package parity source ${target}`, error instanceof Error ? error.message : String(error));
          continue;
        }
        const extracted = await commandOutput('unzip', ['-p', archivePath, entry]);
        check(
          extracted.code === 0 && digest(extracted.stdout) === digest(sourceBytes),
          `deployment ZIP matches current source ${target}`,
          extracted.code === 0 ? '' : extracted.stderr || 'unzip could not read the entry',
        );
      }
    }
  }

  if (failures.length) {
    console.error(`WHOOP deployment smoke failed with ${failures.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log('WHOOP deployment smoke passed.');
  }
}

await main();
