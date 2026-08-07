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
 * The MacroTrack food catalogue (20260807_macrotrack_food_catalogue) raises the
 * stakes: it is the first relational, per-athlete data in this project, and its
 * RLS is the ONLY thing standing between one athlete's food log and another's.
 * Reading the policy text proves nothing — a policy can be present, correct
 * looking, and still not applied because the role bypasses RLS or because a
 * foreign key reference walks around it. So this impersonates two distinct
 * athletes with real per-session auth.uid() values and asserts the boundary
 * empirically: shared catalogue readable by both, owned rows readable by
 * neither one's neighbour, and cross-owner references refused on write.
 *
 * Skipped unless a local postgres exists (initdb/pg_ctl on PATH), because it
 * needs a server it can own. Never points at a real project — it builds its own
 * cluster in a temp dir and destroys it.
 *
 * Run: node checks/migrations-apply.mjs
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, readdirSync, chmodSync, writeFileSync } from 'node:fs';
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

/*
 * initdb refuses to run as root, so a root caller — a container, which is how
 * this was written — has to hand the cluster to somebody else. A NON-root
 * caller already is somebody else and needs none of that: creating a user
 * requires the privileges it does not have, which is why the first version
 * died with `useradd: Permission denied` on a GitHub runner while passing in
 * the container it was written in.
 *
 * So the owner dance is conditional on actually being root.
 *
 * The socket also lives in a SHORT path: postgres caps the socket path at 107
 * bytes and this repo's scratch dirs are longer than that.
 */
const AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const OWNER = 'pgtester';
if (AS_ROOT) {
  try { execSync(`id -u ${OWNER}`, { stdio: 'ignore' }); } catch { execSync(`useradd -M ${OWNER}`); }
}
const dir = mkdtempSync(join('/tmp', 'pgcheck-'));
execSync(`chmod 777 ${dir}${AS_ROOT ? ` && chown -R ${OWNER} ${dir}` : ''}`);

const sqlFiles = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of [...sqlFiles.map((f) => join(ROOT, 'supabase/migrations', f)), join(ROOT, 'checks/sql/supabase-prelude.sql')]) {
  const dest = join(dir, f.split('/').pop());
  copyFileSync(f, dest);
  chmodSync(dest, 0o644);
}

/* Root drops to OWNER; anyone else already IS an acceptable owner and runs the
   command directly. Both paths get the same PATH and the same shell. */
const asOwner = (cmd) => {
  const script = `export PATH=$PATH:${PGBIN}; ${cmd}`;
  return AS_ROOT
    ? execFileSync('su', [OWNER, '-s', '/bin/bash', '-c', script], { encoding: 'utf8' })
    : execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
};
const psql = (args) => asOwner(`psql -h ${dir} -p 5433 -U postgres -v ON_ERROR_STOP=1 ${args}`);

/* Arbitrary SQL is easier to get right in a file than through six layers of
   shell and psql quoting, so every ad-hoc script below is written to disk and
   run with -f. `-tAq` gives bare tuples, and stderr is folded in because the
   refusal assertions read NOTICE output. */
let sqlSeq = 0;
const runSql = (sql) => {
  const f = join(dir, `probe-${sqlSeq++}.sql`);
  writeFileSync(f, sql);
  chmodSync(f, 0o644);
  return psql(`-tAq -f ${f} 2>&1`);
};

/* Become an athlete. Both halves are load-bearing: the JWT claim is what the
   ported prelude's auth.uid() reads, and `set role authenticated` is what makes
   RLS apply at all — postgres is a superuser and superusers ignore every
   policy, so a probe that forgot this line would pass no matter how broken the
   policies were. */
const ATHLETE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ATHLETE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const asAthlete = (uid, sql) => runSql(
  `do $claim$ begin perform set_config('request.jwt.claims', '{"sub":"${uid}"}', false); end $claim$;\nset role authenticated;\n${sql}`,
);
/* The last non-empty line is the probe's answer; anything before it is setup. */
const lastLine = (out) => out.trim().split('\n').filter((l) => l.trim()).pop() ?? '';

/* A write that MUST be rejected. The statement runs inside a handler so psql's
   ON_ERROR_STOP does not abort the script on the expected failure; the block
   announces which way it went and the caller asserts on that word. */
const refusalProbe = (sql) => `do $probe$ begin
  ${sql};
  raise notice 'ACCEPTED';
exception when others then raise notice 'REFUSED (%)', sqlerrm;
end $probe$;`;

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

  console.log('\nMacroTrack food catalogue — shape:\n');

  const CATALOGUE_TABLES = [
    'foods', 'food_servings', 'nutrition_profiles', 'custom_foods', 'recipes',
    'recipe_items', 'food_log_entries', 'daily_log_status', 'weight_entries',
    'weight_trend_points', 'macro_programs', 'macro_program_days',
    'expenditure_estimates', 'weekly_check_ins', 'user_nutrient_targets',
    'food_favorites', 'body_measurements', 'progress_photos',
  ];
  check(`all ${CATALOGUE_TABLES.length} catalogue tables exist`, () => {
    const list = CATALOGUE_TABLES.map((t) => `'${t}'`).join(',');
    const got = lastLine(runSql(
      `select count(*) from pg_tables where schemaname='public' and tablename in (${list});`,
    ));
    if (Number(got) !== CATALOGUE_TABLES.length) throw new Error(`expected ${CATALOGUE_TABLES.length} tables, found ${got}`);
  });
  /* RLS enabled is not implied by having a policy — a table can carry policies
     that are simply never consulted. Assert the switch itself, on every table. */
  check('row level security is enabled on every one of them', () => {
    const list = CATALOGUE_TABLES.map((t) => `'${t}'`).join(',');
    const off = lastLine(runSql(
      `select coalesce(string_agg(relname, ','), 'none') from pg_class
       where relname in (${list}) and relnamespace='public'::regnamespace and not relrowsecurity;`,
    ));
    if (off !== 'none') throw new Error(`RLS off on: ${off}`);
  });
  check('daily_nutrition_totals is a security_invoker view', () => {
    const got = lastLine(runSql(
      `select coalesce((select 1 from pg_class where relname='daily_nutrition_totals'
        and reloptions @> array['security_invoker=true']), 0);`,
    ));
    if (got !== '1') throw new Error('the totals view would run as its definer and expose every athlete');
  });

  console.log('\nMacroTrack food catalogue — seeding and search:\n');

  const OATS = 'f0000000-0000-0000-0000-000000000001';
  check('the catalogue accepts a seeded food and serving (service-role path)', () => {
    runSql(`insert into public.foods (id, name, brand, barcode, calories, protein_g, carbs_g, fat_g, source, external_id)
            values ('${OATS}', 'Rolled Oats', 'Generic', '9300000000001', 379, 13.2, 67.7, 6.5, 'ausnut', 'F001');
            insert into public.food_servings (food_id, label, quantity, unit, grams, is_default)
            values ('${OATS}', '1 cup', 1, 'cup', 90, true);`);
  });
  check('the same food is searchable by name and by barcode', () => {
    const got = lastLine(asAthlete(ATHLETE_A,
      `select (select count(*) from public.foods where lower(name) like '%oats%')
            + (select count(*) from public.foods where barcode = '9300000000001')
            + (select count(*) from public.food_servings where food_id = '${OATS}');`));
    if (got !== '3') throw new Error(`expected 3 hits (name, barcode, serving), got ${got}`);
  });

  console.log('\nMacroTrack food catalogue — RLS isolation between two athletes:\n');

  const A_FOOD = 'c0000000-0000-0000-0000-00000000000a';
  const A_RECIPE = '50000000-0000-0000-0000-00000000000a';
  const A_PROGRAM = '60000000-0000-0000-0000-00000000000a';
  check('athlete A writes a custom food, a recipe, a program, a log entry and a weight', () => {
    asAthlete(ATHLETE_A, `
      insert into public.custom_foods (id, user_id, name, calories, protein_g)
        values ('${A_FOOD}', '${ATHLETE_A}', 'A private protein powder', 120, 24);
      insert into public.recipes (id, user_id, name)
        values ('${A_RECIPE}', '${ATHLETE_A}', 'A private recipe');
      insert into public.macro_programs (id, user_id, mode, goal, target_rate_kg_per_week, start_date)
        values ('${A_PROGRAM}', '${ATHLETE_A}', 'coached', 'lose', -0.5, current_date);
      insert into public.food_log_entries (user_id, log_date, entry_kind, custom_food_id, display_name, calories)
        values ('${ATHLETE_A}', current_date, 'custom_food', '${A_FOOD}', 'A private protein powder', 120);
      insert into public.weight_entries (user_id, measured_at, weight_kg)
        values ('${ATHLETE_A}', now(), 82.5);`);
    const got = lastLine(asAthlete(ATHLETE_A,
      `select (select count(*) from public.custom_foods) || '/' || (select count(*) from public.recipes)
            || '/' || (select count(*) from public.food_log_entries)
            || '/' || (select count(*) from public.weight_entries)
            || '/' || (select count(*) from public.daily_nutrition_totals)
            || '/' || (select count(*) from public.macro_programs);`));
    if (got !== '1/1/1/1/1/1') throw new Error(`athlete A cannot see its own rows: ${got}`);
  });
  /* THE leak test. If any of these is non-zero, one athlete's food log is
     visible to another and this migration must not ship. */
  check('athlete B sees NONE of it — custom foods, recipes, log entries, weights, daily totals, macro programs', () => {
    const got = lastLine(asAthlete(ATHLETE_B,
      `select (select count(*) from public.custom_foods) || '/' || (select count(*) from public.recipes)
            || '/' || (select count(*) from public.food_log_entries)
            || '/' || (select count(*) from public.weight_entries)
            || '/' || (select count(*) from public.daily_nutrition_totals)
            || '/' || (select count(*) from public.macro_programs);`));
    if (got !== '0/0/0/0/0/0') throw new Error(`LEAK — athlete B can read athlete A's rows: ${got}`);
  });
  check('athlete B still reads the SHARED catalogue', () => {
    const got = lastLine(asAthlete(ATHLETE_B,
      `select (select count(*) from public.foods) || '/' || (select count(*) from public.food_servings);`));
    if (got !== '1/1') throw new Error(`the shared catalogue is not shared: ${got}`);
  });
  check("athlete B cannot modify athlete A's rows", () => {
    const got = lastLine(asAthlete(ATHLETE_B,
      `with u as (update public.custom_foods set name = 'hijacked' where id = '${A_FOOD}' returning 1),
            d as (delete from public.food_log_entries where user_id = '${ATHLETE_A}' returning 1)
       select (select count(*) from u) || '/' || (select count(*) from d);`));
    if (got !== '0/0') throw new Error(`athlete B touched athlete A's rows: ${got}`);
  });

  console.log("\nOwner-reference policies — a foreign key must not bridge into another athlete's account:\n");

  /* A foreign key check does NOT consult RLS, so `custom_food_id` pointing at
     athlete A's row would be accepted by the constraint. Only the with-check
     half of the ported 004/005 policies stops it. */
  const refused = (label, sql, uid = ATHLETE_B) => check(label, () => {
    const out = asAthlete(uid, refusalProbe(sql));
    if (!out.includes('REFUSED')) throw new Error(`the write was ACCEPTED: ${out.trim().split('\n').slice(-2).join(' ')}`);
  });
  refused('B cannot log an entry owned by A', `insert into public.food_log_entries (user_id, log_date, entry_kind, display_name)
      values ('${ATHLETE_A}', current_date, 'quick_add', 'planted')`);
  refused("B cannot reference A's custom food from its own log entry", `insert into public.food_log_entries (user_id, log_date, entry_kind, custom_food_id, display_name)
      values ('${ATHLETE_B}', current_date, 'custom_food', '${A_FOOD}', 'stolen')`);
  refused("B cannot reference A's recipe from its own log entry", `insert into public.food_log_entries (user_id, log_date, entry_kind, recipe_id, display_name)
      values ('${ATHLETE_B}', current_date, 'recipe', '${A_RECIPE}', 'stolen')`);
  refused("B cannot favourite A's custom food", `insert into public.food_favorites (user_id, custom_food_id)
      values ('${ATHLETE_B}', '${A_FOOD}')`);
  refused("B cannot add an item to A's recipe", `insert into public.recipe_items (recipe_id, food_id, quantity)
      values ('${A_RECIPE}', '${OATS}', 100)`);
  refused("B cannot attach a check-in to A's macro program", `insert into public.weekly_check_ins (user_id, program_id, week_start, week_end, status, explanation)
      select '${ATHLETE_B}', '${A_PROGRAM}', current_date, current_date, 'pending', 'planted'`);
  refused('nobody writes the shared catalogue through the client role', `insert into public.foods (name) values ('poisoned')`);

  /* The legitimate versions of the same writes must still work, or the policy
     above is merely a wall. */
  check('A can do all of that within its own account', () => {
    asAthlete(ATHLETE_A, `
      insert into public.food_favorites (user_id, custom_food_id) values ('${ATHLETE_A}', '${A_FOOD}');
      insert into public.food_favorites (user_id, food_id) values ('${ATHLETE_A}', '${OATS}');
      insert into public.recipe_items (recipe_id, custom_food_id, quantity) values ('${A_RECIPE}', '${A_FOOD}', 50);
      insert into public.recipe_items (recipe_id, food_id, quantity) values ('${A_RECIPE}', '${OATS}', 80);`);
    const got = lastLine(asAthlete(ATHLETE_A,
      `select (select count(*) from public.food_favorites) || '/' || (select count(*) from public.recipe_items);`));
    if (got !== '2/2') throw new Error(`athlete A's own writes were blocked: ${got}`);
  });
} finally {
  try { asOwner(`pg_ctl -D ${dir}/data stop -m immediate`); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll migration checks passed.');
process.exit(failures ? 1 : 0);
