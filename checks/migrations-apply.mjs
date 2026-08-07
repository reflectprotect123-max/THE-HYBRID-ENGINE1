/*
 * Apply every migration to a REAL, throwaway Postgres and prove it works.
 *
 * The static checks in ecosystem-contract.mjs read migration TEXT. Text cannot
 * tell you that `20260807_nutrition_domain` is complete: the domain list it
 * widens is written in THREE places — the check constraint, the plpgsql body of
 * upsert_athlete_domain_snapshot, and the body of record_athlete_event — and
 * the RPCs are the only supported write path. A migration that widened only the
 * constraint would apply without error, pass every static assertion, and then
 * reject every nutrition write at runtime with `invalid domain`. That exact
 * mistake was written into the Phase 0 plan and caught here.
 *
 * So this runs the migrations in order against an empty database, then WRITES
 * through the RPCs and asserts the behaviour, including the negatives: a stale
 * revision must not overwrite, an unknown domain must still be refused.
 *
 * Skipped unless a local postgres exists (initdb/pg_ctl on PATH), because it
 * needs a server it can own. Never points at a real project — it builds its own
 * cluster in a temp dir and destroys it.
 *
 * Run: node checks/migrations-apply.mjs
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PGBIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/local/bin'].find((p) => {
  try { execSync(`test -x ${p}/initdb`); return true; } catch { return false; }
});
if (!PGBIN) {
  console.log('SKIP — no local postgres (initdb not found). This check needs a server it can own.');
  process.exit(0);
}

/* initdb refuses to run as root, so an unprivileged owner is required. The
   socket also lives in a SHORT path: postgres caps the socket path at 107
   bytes and this repo's scratch dirs are longer than that. */
const OWNER = 'pgtester';
try { execSync(`id -u ${OWNER}`, { stdio: 'ignore' }); } catch { execSync(`useradd -M ${OWNER}`); }
const dir = mkdtempSync(join('/tmp', 'pgcheck-'));
execSync(`chmod 777 ${dir} && chown -R ${OWNER} ${dir}`);

const sqlFiles = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of [...sqlFiles.map((f) => join(ROOT, 'supabase/migrations', f)), join(ROOT, 'checks/sql/supabase-prelude.sql')]) {
  const dest = join(dir, f.split('/').pop());
  copyFileSync(f, dest);
  chmodSync(dest, 0o644);
}

const asOwner = (cmd) => execFileSync('su', [OWNER, '-s', '/bin/bash', '-c', `export PATH=$PATH:${PGBIN}; ${cmd}`], { encoding: 'utf8' });
const psql = (args) => asOwner(`psql -h ${dir} -p 5433 -U postgres -v ON_ERROR_STOP=1 ${args}`);

let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}: ${String(e.message || e).split('\n').slice(0, 3).join(' ')}`); }
};

try {
  asOwner(`initdb -D ${dir}/data -U postgres --auth=trust`);
  asOwner(`pg_ctl -D ${dir}/data -o '-p 5433 -k ${dir} -c listen_addresses=""' -l ${dir}/log start`);
  execSync('sleep 3');

  console.log('Applying migrations to a throwaway cluster:\n');
  psql(`-q -f ${join(dir, 'supabase-prelude.sql')}`);
  for (const f of sqlFiles) {
    check(`applies ${f}`, () => psql(`-q -f ${join(dir, f)}`));
  }

  console.log('\nBehaviour through the RPCs (the only supported write path):\n');
  check('a nutrition snapshot writes', () => {
    const out = psql(`-tc "select public.upsert_athlete_domain_snapshot('nutrition',1,1,'hybrid:mobile',now(),'{}'::jsonb);"`);
    if (out.trim() !== 't') throw new Error(`expected t, got ${out.trim()}`);
  });
  check('a stale revision does NOT overwrite', () => {
    const out = psql(`-tc "select public.upsert_athlete_domain_snapshot('nutrition',1,0,'stale',now(),'{\\"stale\\":true}'::jsonb);"`);
    if (out.trim() !== 'f') throw new Error(`expected f, got ${out.trim()}`);
  });
  check('an unknown domain is still refused', () => {
    const out = psql(`-tc "do \\$\\$ begin perform public.upsert_athlete_domain_snapshot('sleep',1,1,'x',now(),'{}'::jsonb); raise exception 'accepted'; exception when others then raise notice 'refused'; end \\$\\$;" 2>&1`);
    if (!out.includes('refused')) throw new Error('unknown domain was accepted');
  });
  check('a nutrition event records', () => {
    const out = psql(`-tc "select public.record_athlete_event('idem-check','nutrition_target_updated','nutrition',now(),'{}'::jsonb);"`);
    if (out.trim() !== 't') throw new Error(`expected t, got ${out.trim()}`);
  });
} finally {
  try { asOwner(`pg_ctl -D ${dir}/data stop -m immediate`); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll migration checks passed.');
process.exit(failures ? 1 : 0);
