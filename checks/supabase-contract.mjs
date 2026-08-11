/*
 * Supabase contract test — the login + sync path, checked without a network.
 *
 * Until someone actually signs in nothing proves the ported queries still
 * name real tables and real columns. A typo in a `.select()` string is a
 * runtime 400 that only shows up as "sync failed" on a phone. So:
 *
 * (a) STATIC (always runs, no credentials, no network):
 *     Parse supabase-schema.sql for tables, columns and unique constraints,
 *     then statically extract every `.from(...)` query chain out of
 *       - apps/web/src/cloud/sync.tsx
 *     and assert every table, every selected/inserted/filtered column exists,
 *     and every `onConflict` arbiter is backed by a real unique constraint.
 *     Also pins the handful of literals RLS actually keys off — status values
 *     and the onConflict targets — because those are silent failures, not
 *     errors: an RLS policy rejecting a row returns "no rows", not a message.
 *
 * (b) LIVE (opt-in): set SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD and it
 *     signs in and exercises the real round trip. Skips cleanly otherwise.
 *
 * Run: node checks/supabase-contract.mjs
 * Live: SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... node checks/supabase-contract.mjs
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.cwd(), process.argv[2] || '.');
let failures = 0;
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && r.then)
      return r
        .then(() => console.log('PASS — ' + name))
        .catch((e) => {
          console.log('FAIL — ' + name + ': ' + e.message);
          failures += 1;
        });
    console.log('PASS — ' + name);
  } catch (e) {
    console.log('FAIL — ' + name + ': ' + e.message);
    failures += 1;
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/* ==================================================================
 * 1. Parse supabase-schema.sql
 * ================================================================== */

/** Split a parenthesised list on commas that sit at depth 0. */
function splitTop(src) {
  const out = [];
  let depth = 0;
  let cur = '';
  let q = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Grab the balanced (...) starting at `open`. Returns [inner, indexAfterClose]. */
function balanced(src, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      q = c;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return [src.slice(open + 1, i), i + 1];
    }
  }
  return [src.slice(open + 1), src.length];
}

const CONSTRAINT_WORDS = new Set([
  'primary',
  'unique',
  'foreign',
  'check',
  'constraint',
  'exclude',
  'like',
]);

function parseSchema(sql) {
  // Strip $$ … $$ function bodies first: they contain SQL that is not DDL for
  // these tables and would otherwise confuse the table scanner.
  const noBodies = sql.replace(/\$\$[\s\S]*?\$\$/g, ' /*body*/ ');
  const tables = new Map(); // name -> Set(columns)
  const uniques = new Map(); // name -> Array<Array<column>>

  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(noBodies))) {
    const name = m[1];
    const [inner] = balanced(noBodies, re.lastIndex - 1);
    const cols = new Set();
    const uq = uniques.get(name) || [];
    splitTop(inner).forEach((raw) => {
      const line = raw.trim().replace(/\s+/g, ' ');
      if (!line) return;
      const first = (line.split(/[\s(]/)[0] || '').toLowerCase();
      if (CONSTRAINT_WORDS.has(first)) {
        // table-level constraint: primary key (a,b) / unique (a,b)
        const um = /^(?:primary\s+key|unique)\s*\(/i.exec(line);
        if (um) uq.push(splitTop(balanced(line, line.indexOf('(', um[0].length - 1))[0]).map((s) => s.trim()));
        return;
      }
      const col = line.split(/\s/)[0];
      if (!col) return;
      cols.add(col);
      if (/\bprimary\s+key\b/i.test(line) || /\bunique\b/i.test(line)) uq.push([col]);
    });
    tables.set(name, cols);
    uniques.set(name, uq);
  }

  // create unique index … on public.tbl (a, b, c)
  const ir = /create\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w"]+\s+on\s+(?:public\.)?(\w+)\s*\(/gi;
  while ((m = ir.exec(noBodies))) {
    const tbl = m[1];
    const [inner] = balanced(noBodies, ir.lastIndex - 1);
    const list = uniques.get(tbl) || [];
    list.push(splitTop(inner).map((s) => s.trim().split(/\s/)[0]));
    uniques.set(tbl, list);
  }

  // Policies, so the static side can reason about which literals RLS keys off.
  const policies = [];
  const pr = /create\s+policy\s+("[^"]+"|\w+)\s+on\s+(?:public\.)?(\w+)\s+for\s+(\w+)([\s\S]*?);/gi;
  while ((m = pr.exec(noBodies))) {
    policies.push({ name: m[1].replace(/"/g, ''), table: m[2], cmd: m[3].toLowerCase(), body: m[4] });
  }

  return { tables, uniques, policies };
}

const schemaSql = await readFile(resolve(root, 'supabase-schema.sql'), 'utf8');
const schema = parseSchema(schemaSql);

/* ==================================================================
 * 2. Statically extract query chains from the client sources
 * ================================================================== */

const IDENT = /[A-Za-z_$][\w$]*/y;

/** Read a JS string literal starting at `i` (must be a quote). */
function readString(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < src.length; j += 1) {
    const c = src[j];
    if (c === '\\') {
      out += src[j + 1];
      j += 1;
      continue;
    }
    if (c === q) return { value: out, end: j + 1 };
    out += c;
  }
  return null;
}

/** First string literal argument of a call's argument text, or null. */
function firstStringArg(argText) {
  const s = argText.replace(/^\s+/, '');
  const r = readString(s, 0);
  return r ? r.value : null;
}

/** Split a JS argument list on top-level commas (brace/bracket/paren aware). */
function splitArgs(src) {
  const out = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const r = readString(src, i);
      if (!r) break;
      cur += src.slice(i, r.end);
      i = r.end;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Keys of the object literal `argText`, at depth 1 only.
 *
 * Only identifiers sitting in KEY POSITION count — i.e. immediately after the
 * opening `{` or after a depth-1 comma. Without that, `{ user_id: user.id }`
 * would report `id` as a column because it happens to be followed by a comma.
 * Shorthand (`{ user_id, state }`) is accepted, which is how sync.tsx writes it.
 */
function objectKeys(argText) {
  const s = argText.trim();
  if (!s.startsWith('{')) return null;
  const keys = [];
  let depth = 0;
  let keyPos = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const r = readString(s, i);
      if (!r) break;
      if (depth === 1 && keyPos && /^\s*:/.test(s.slice(r.end))) keys.push(r.value);
      keyPos = false;
      i = r.end;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth += 1;
      keyPos = depth === 1 && c === '{';
      i += 1;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      keyPos = false;
      i += 1;
      continue;
    }
    if (c === ',') {
      keyPos = depth === 1;
      i += 1;
      continue;
    }
    if (depth === 1 && keyPos) {
      IDENT.lastIndex = i;
      const im = IDENT.exec(s);
      if (im && im.index === i) {
        const after = s.slice(IDENT.lastIndex);
        // `k: v` (explicit) or `k` / `k,` / `k}` (shorthand)
        if (/^\s*[:,}]/.test(after)) keys.push(im[0]);
        keyPos = false;
        i = IDENT.lastIndex;
        continue;
      }
    }
    keyPos = false;
    i += 1;
  }
  return keys;
}

/** The payload object of an insert/upsert/update call — its FIRST argument. */
function payloadKeys(argText) {
  const first = splitArgs(argText)[0];
  return first ? objectKeys(first) : null;
}

/**
 * Walk every `.from('tbl')` and collect the chained calls that follow it.
 * Requires a *string literal* argument, which is what keeps `Array.from(...)`
 * out of the results.
 */
function extractChains(src, file) {
  const chains = [];
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;
  for (let i = 0; i < src.length; i += 1) {
    if (!src.startsWith('.from(', i)) continue;
    const open = i + '.from'.length;
    const [arg, after] = balanced(src, open);
    const tbl = firstStringArg(arg);
    if (!tbl) continue; // Array.from({…}) and friends
    const chain = { table: tbl, file, line: lineAt(i), calls: [] };
    let p = after;
    for (;;) {
      while (p < src.length && /[\s\n]/.test(src[p])) p += 1;
      if (src[p] !== '.') break;
      IDENT.lastIndex = p + 1;
      const im = IDENT.exec(src);
      if (!im || im.index !== p + 1) break;
      const method = im[0];
      let q = IDENT.lastIndex;
      while (q < src.length && /[\s\n]/.test(src[q])) q += 1;
      if (src[q] !== '(') break;
      const [cArg, cAfter] = balanced(src, q);
      chain.calls.push({ method, arg: cArg, line: lineAt(p) });
      p = cAfter;
      if (method === 'then' || method === 'catch') break;
    }
    chains.push(chain);
    i = after - 1;
  }
  return chains;
}

const SOURCES = [
  'apps/web/src/cloud/sync.tsx',
];

const chains = [];
for (const rel of SOURCES) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    console.log('FAIL — source missing: ' + rel);
    failures += 1;
    continue;
  }
  chains.push(...extractChains(await readFile(abs, 'utf8'), rel));
}

/* Column-naming filter methods: first argument is a column name. */
const FILTERS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'is',
  'in',
  'contains',
  'order',
  'not',
]);

/** Every (table, column, where) reference the extracted chains make. */
function references() {
  const refs = [];
  const add = (chain, col, kind, line) => refs.push({ table: chain.table, column: col, kind, file: chain.file, line });
  chains.forEach((chain) => {
    chain.calls.forEach((c) => {
      if (c.method === 'select') {
        const s = firstStringArg(c.arg);
        if (!s) return;
        s.split(',')
          .map((x) => x.trim())
          .filter((x) => x && x !== '*' && !x.includes('('))
          .forEach((col) => add(chain, col, 'select', c.line));
        return;
      }
      if (c.method === 'insert' || c.method === 'upsert' || c.method === 'update') {
        (payloadKeys(c.arg) || []).forEach((col) => add(chain, col, c.method, c.line));
        return;
      }
      if (FILTERS.has(c.method)) {
        const col = firstStringArg(c.arg);
        if (col) add(chain, col, c.method, c.line);
      }
    });
  });
  return refs;
}

const refs = references();

/* ---------- the static assertions ---------- */

t('schema parses into the six expected tables', () => {
  ['app_state', 'coach_library', 'coach_athletes', 'programs', 'assignments', 'athlete_feed'].forEach((n) => {
    assert(schema.tables.has(n), 'table not parsed out of supabase-schema.sql: ' + n);
    assert((schema.tables.get(n) || new Set()).size > 0, 'no columns parsed for table: ' + n);
  });
});

t('the query extractor actually found queries in every source', () => {
  SOURCES.forEach((rel) => {
    const n = chains.filter((c) => c.file === rel).length;
    assert(n > 0, 'no .from() chains extracted from ' + rel + ' — the extractor is broken, not the code');
  });
  // Floor lowered from 20 to 10 when the coach system's assignments/
  // athlete_feed/coach_athletes queries were removed (approved removal, not a
  // regression) — app code now only queries app_state. Still high enough to
  // catch the extractor itself silently breaking.
  assert(refs.length > 10, 'suspiciously few column references extracted: ' + refs.length);
});

t('every table named by a client query exists in the schema', () => {
  const bad = [];
  chains.forEach((c) => {
    if (!schema.tables.has(c.table)) bad.push(c.file + ':' + c.line + ' → from(' + c.table + ')');
  });
  assert(!bad.length, 'unknown table(s):\n    ' + bad.join('\n    '));
});

t('every column named by a client query exists on that table', () => {
  const bad = [];
  refs.forEach((r) => {
    const cols = schema.tables.get(r.table);
    if (!cols) return; // reported by the table test above
    if (!cols.has(r.column))
      bad.push(r.file + ':' + r.line + ' → ' + r.table + '.' + r.column + ' (' + r.kind + ')');
  });
  assert(!bad.length, 'unknown column(s):\n    ' + bad.join('\n    '));
});

t('every upsert onConflict target is backed by a unique constraint', () => {
  const bad = [];
  let seen = 0;
  chains.forEach((chain) => {
    chain.calls.forEach((c) => {
      if (c.method !== 'upsert') return;
      // second argument object: { onConflict: 'a,b' }
      const om = /onConflict\s*:\s*(['"`])([^'"`]*)\1/.exec(c.arg);
      if (!om) {
        bad.push(chain.file + ':' + c.line + ' → upsert on ' + chain.table + ' with no onConflict arbiter');
        return;
      }
      seen += 1;
      const target = om[2].split(',').map((s) => s.trim());
      const uq = schema.uniques.get(chain.table) || [];
      const ok = uq.some((u) => u.length === target.length && u.every((col, i) => col === target[i]));
      if (!ok)
        bad.push(
          chain.file + ':' + c.line + ' → ' + chain.table + ' onConflict(' + target.join(',') +
            ') has no matching unique constraint; available: ' + (uq.map((u) => '(' + u.join(',') + ')').join(' ') || 'none'),
        );
    });
  });
  // Floor lowered from 3 to 2 when the coach system's athlete_feed digest
  // upsert was removed (approved removal, not a regression) — web and mobile
  // each still upsert app_state, which this floor now reflects exactly.
  assert(seen >= 2, 'expected at least 2 upserts across the sources, found ' + seen);
  assert(!bad.length, 'bad onConflict arbiter(s):\n    ' + bad.join('\n    '));
});

t('every column written by an insert/upsert is nullable or supplied', () => {
  // NOT NULL without a default must be present in the payload, otherwise the
  // insert 400s at runtime with a message no user can act on.
  const required = new Map(); // table -> Set(columns)
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi;
  let m;
  const noBodies = schemaSql.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  while ((m = re.exec(noBodies))) {
    const [inner] = balanced(noBodies, re.lastIndex - 1);
    const need = new Set();
    splitTop(inner).forEach((raw) => {
      const line = raw.trim().replace(/\s+/g, ' ');
      const first = (line.split(/[\s(]/)[0] || '').toLowerCase();
      if (CONSTRAINT_WORDS.has(first)) return;
      const col = line.split(/\s/)[0];
      const notNull = /\bnot\s+null\b/i.test(line) || /\bprimary\s+key\b/i.test(line);
      const hasDefault = /\bdefault\b/i.test(line);
      if (col && notNull && !hasDefault) need.add(col);
    });
    required.set(m[1], need);
  }
  const bad = [];
  chains.forEach((chain) => {
    chain.calls.forEach((c) => {
      if (c.method !== 'insert' && c.method !== 'upsert') return;
      const keys = new Set(payloadKeys(c.arg) || []);
      (required.get(chain.table) || new Set()).forEach((col) => {
        if (!keys.has(col)) bad.push(chain.file + ':' + c.line + ' → ' + chain.table + '.' + col + ' is NOT NULL with no default and is not in the payload');
      });
    });
  });
  assert(!bad.length, 'missing required column(s):\n    ' + bad.join('\n    '));
});

/* ---------- RLS literal pins ----------
 * These are the values RLS compares against. Getting one wrong is invisible:
 * the policy simply matches nothing and the app shows an empty state. */

t("assignments RLS still pins status='assigned' (schema only — app no longer queries this table)", () => {
  // The coach system was removed from both apps (approved removal): no client
  // source queries `assignments` any more, so this no longer asserts anything
  // about app code, only that the schema's own policy text hasn't drifted.
  // supabase-schema.sql itself is untouched — dropping these tables in
  // production is a separate, explicit, user-run action (not this check's
  // concern) — so the policy this test pins still legitimately exists.
  const p = schema.policies.find((x) => x.table === 'assignments' && /athlete/.test(x.name) && x.cmd === 'select');
  assert(p, 'as_select_athlete policy not found in the schema');
  assert(/status\s*=\s*'assigned'/.test(p.body), "policy no longer pins status='assigned'");
  const pulls = chains.filter((c) => c.table === 'assignments' && c.calls.some((x) => x.method === 'select'));
  pulls.forEach((c) => {
    const byAthlete = c.calls.some((x) => x.method === 'eq' && firstStringArg(x.arg) === 'athlete_id');
    if (!byAthlete) return; // a coach-side read is governed by as_select_coach instead
    const st = c.calls.find((x) => x.method === 'eq' && firstStringArg(x.arg) === 'status');
    assert(st, c.file + ':' + c.line + " → athlete assignments select without an eq('status', …); RLS only exposes 'assigned' rows");
    assert(/'assigned'/.test(st.arg), c.file + ':' + st.line + " → status filter is not 'assigned'");
  });
});

t("coach_athletes reads are gated on status='active' on both sides", () => {
  const pa = schema.policies.find((x) => x.table === 'coach_athletes' && /athlete_read/.test(x.name));
  assert(pa && /status\s*=\s*'active'/.test(pa.body), "ca_athlete_read no longer pins status='active'");
  chains
    .filter((c) => c.table === 'coach_athletes' && c.calls.some((x) => x.method === 'select'))
    .forEach((c) => {
      const st = c.calls.find((x) => x.method === 'eq' && firstStringArg(x.arg) === 'status');
      if (!st) return; // the coach's own full listing legitimately reads pending rows too
      assert(/'active'|'pending'/.test(st.arg), c.file + ':' + st.line + ' → unexpected coach_athletes status literal');
    });
});

t('athlete_feed is only ever written by the athlete themselves', () => {
  // af_coach_read is SELECT-only by design. Any write chain here must key off
  // athlete_id, never coach_id, or it is rejected by af_owner's with-check.
  chains
    .filter((c) => c.table === 'athlete_feed')
    .forEach((c) => {
      c.calls.forEach((x) => {
        if (!['insert', 'upsert', 'update'].includes(x.method)) return;
        const keys = payloadKeys(x.arg) || [];
        assert(keys.includes('athlete_id'), c.file + ':' + x.line + ' → athlete_feed write without athlete_id fails af_owner');
        assert(!keys.includes('coach_id'), c.file + ':' + x.line + ' → athlete_feed has no coach_id column');
      });
    });
});

/*
 * This used to compare the React apps against the vanilla app's table usage —
 * a MIGRATION check, and a good one while there were two implementations to
 * keep honest. The vanilla app is gone, so the reference is gone with it.
 *
 * What replaced it is stronger rather than weaker: the schema is the real
 * authority on which tables exist, and a client naming one that
 * supabase-schema.sql does not create is a runtime 404 in production — which
 * the old check could never have caught, because both implementations could
 * have been wrong together.
 */
t('every table a client touches is one the schema actually creates', () => {
  const declared = new Set(
    [...schemaSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1].toLowerCase()),
  );
  assert(declared.size > 0, 'no CREATE TABLE found in supabase-schema.sql — the parse, not the schema, is wrong');
  const used = new Set(chains.map((c) => c.table.toLowerCase()));
  const undeclared = [...used].filter((x) => !declared.has(x));
  assert(!undeclared.length, 'client queries a table the schema never creates: ' + undeclared.join(', '));
});

/* ==================================================================
 * 3. OPTIONAL LIVE MODE — real network, real credentials.
 * ================================================================== */

const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASSWORD = process.env.SUPABASE_TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.log('\nSKIP — live Supabase round trip: set SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD to run it.');
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll supabase-contract static checks passed.');
  process.exit(failures ? 1 : 0);
}

console.log('\n--- LIVE MODE (credentials present) ---');

/* Credentials for the project itself come from the same single source the apps
 * use, so this cannot drift from what ships. Env vars still win. */
async function projectConfig() {
  let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  let anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    const cfg = await readFile(resolve(root, 'packages/config/src/index.ts'), 'utf8').catch(() => '');
    const u = /url:\s*env\([^)]*\)\s*\|\|\s*'([^']+)'/.exec(cfg);
    const k = /anonKey:[\s\S]*?\|\|\s*'([^']+)'/.exec(cfg);
    url = url || (u ? u[1] : '');
    anonKey = anonKey || (k ? k[1] : '');
  }
  return { url, anonKey };
}

async function loadSupabase() {
  const candidates = [
    '@supabase/supabase-js',
    resolve(root, 'node_modules/@supabase/supabase-js/dist/module/index.js'),
    resolve(root, 'apps/web/node_modules/@supabase/supabase-js/dist/module/index.js'),
  ];
  for (const c of candidates) {
    try {
      const spec = c.startsWith('@') ? c : pathToFileURL(c).href;
      const mod = await import(spec);
      if (mod.createClient) return mod;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const sb = await loadSupabase();
if (!sb) {
  console.log('SKIP — live mode: @supabase/supabase-js is not installed anywhere in this tree.');
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll supabase-contract static checks passed.');
  process.exit(failures ? 1 : 0);
}

const { url, anonKey } = await projectConfig();
if (!url || !anonKey) {
  console.log('FAIL — live mode: could not resolve the Supabase url/anon key.');
  process.exit(1);
}

const client = sb.createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
let uid = null;
let madeAssignmentId = null;
const marker = 'contract-check-' + Date.now();

await t('sign in with the test credentials', async () => {
  const { data, error } = await client.auth.signInWithPassword({ email: EMAIL.trim(), password: PASSWORD });
  assert(!error, 'sign-in failed: ' + (error && error.message));
  assert(data.session && data.user, 'sign-in returned no session');
  uid = data.user.id;
});

await t('app_state: upsert then read back (the whole athlete sync path)', async () => {
  assert(uid, 'not signed in');
  const { data: before } = await client.from('app_state').select('state').eq('user_id', uid).maybeSingle();
  const state = Object.assign({}, (before && before.state) || {}, { __contractCheck: marker });
  const { error: e1 } = await client.from('app_state').upsert({ user_id: uid, state }, { onConflict: 'user_id' });
  assert(!e1, 'app_state upsert failed: ' + (e1 && e1.message));
  const { data, error: e2 } = await client.from('app_state').select('state,updated_at').eq('user_id', uid).maybeSingle();
  assert(!e2, 'app_state select failed: ' + (e2 && e2.message));
  assert(data && data.state && data.state.__contractCheck === marker, 'app_state did not read back what was written');
  assert(data.updated_at, 'updated_at missing — the set_app_state_updated_at trigger is not installed');
  // Put the row back the way it was found.
  const restored = Object.assign({}, (before && before.state) || {});
  delete restored.__contractCheck;
  await client.from('app_state').upsert({ user_id: uid, state: restored }, { onConflict: 'user_id' });
});

await t('assignments: self-assign, read back as the athlete, then delete', async () => {
  assert(uid, 'not signed in');
  const date = new Date().toISOString().slice(0, 10);
  // Clear out any leftover row from a previous run before re-inserting.
  await client.from('assignments').delete().eq('coach_id', uid).eq('athlete_id', uid).eq('scheduled_date', date).is('program_id', null);
  const { data: ins, error: e1 } = await client
    .from('assignments')
    .insert({
      coach_id: uid,
      athlete_id: uid,
      program_id: null,
      week_index: null,
      day_index: null,
      scheduled_date: date,
      session_snapshot: { name: marker, blocks: [] },
      status: 'assigned',
    })
    .select('id')
    .maybeSingle();
  assert(!e1, 'assignments insert failed (RLS as_insert or a column mismatch): ' + (e1 && e1.message));
  madeAssignmentId = ins && ins.id;
  assert(madeAssignmentId, 'insert returned no id');

  const { data, error: e2 } = await client
    .from('assignments')
    .select('id,scheduled_date,session_snapshot,updated_at,status')
    .eq('athlete_id', uid)
    .eq('status', 'assigned');
  assert(!e2, 'assignments select failed: ' + (e2 && e2.message));
  const row = (data || []).find((r) => r.id === madeAssignmentId);
  assert(row, 'the row just inserted is not visible to the athlete read — as_select_athlete rejected it');
  assert(row.session_snapshot && row.session_snapshot.name === marker, 'session_snapshot did not survive the round trip');
  assert(row.updated_at, 'updated_at missing — the touch_assignments trigger is not installed');

  const { error: e3 } = await client.from('assignments').delete().eq('id', madeAssignmentId);
  assert(!e3, 'assignments delete failed: ' + (e3 && e3.message));
  const { data: gone } = await client.from('assignments').select('id').eq('id', madeAssignmentId);
  assert(!(gone || []).length, 'the assignment survived its delete');
  madeAssignmentId = null;
});

await t('coach_athletes + athlete_feed: the link read and the digest write', async () => {
  assert(uid, 'not signed in');
  const { error: e1 } = await client.from('coach_athletes').select('id,coach_id,label').eq('athlete_id', uid).eq('status', 'active');
  assert(!e1, 'coach_athletes select failed: ' + (e1 && e1.message));
  // athlete_feed is owned outright by the athlete, so this works with or
  // without a coach link — it is the write path that needs proving.
  const { error: e2 } = await client
    .from('athlete_feed')
    .upsert({ athlete_id: uid, payload: { __contractCheck: marker }, updated_at: new Date().toISOString() }, { onConflict: 'athlete_id' });
  assert(!e2, 'athlete_feed upsert failed: ' + (e2 && e2.message));
  const { data, error: e3 } = await client.from('athlete_feed').select('payload,updated_at').eq('athlete_id', uid).maybeSingle();
  assert(!e3, 'athlete_feed select failed: ' + (e3 && e3.message));
  assert(data && data.payload && data.payload.__contractCheck === marker, 'athlete_feed did not read back what was written');
});

if (madeAssignmentId) await client.from('assignments').delete().eq('id', madeAssignmentId);
await client.auth.signOut();

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nAll supabase-contract checks (static + live) passed.');
process.exit(failures ? 1 : 0);
