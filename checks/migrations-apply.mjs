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

/* The ARC deny suite needs a writer, because the coach tables grant no client
   INSERT at all — every write goes through a server-side command. Running the
   seed as the table owner is the honest model of that command layer: it is the
   only actor that can write, and the suite then proves what CLIENTS can and
   cannot see of what it wrote. */
const asOwnerSql = (sql) => runSql(sql);
const asOwnerSqlOut = (sql) => runSql(sql);
const asOwnerProbe = (sql) => runSql(refusalProbe(sql));

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

  /* ---------------------------------------------------------------------
   * ARC coach workspace — the deny suite docs/ARC_CLAUDE_HANDOFF.md mandates.
   *
   * EVERY ASSERTION HERE IS A COUNT, NOT AN ERROR. Postgres RLS removes rows
   * rather than raising, so an unauthorised read succeeds and returns nothing.
   * A test that asserted "this threw" would pass against a policy that grants
   * everything, and a UI that renders the empty result says "no training"
   * rather than "not allowed". Counting is the only honest probe.
   * ------------------------------------------------------------------- */
  console.log('\nARC coach workspace — tenancy, roles and immutability:\n');

  const ORG_1 = '11111111-1111-1111-1111-111111111111';
  const ORG_2 = '22222222-2222-2222-2222-222222222222';
  const COACH_1 = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
  const COACH_2 = 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2';
  const SUPPORT_1 = '55555555-5555-5555-5555-555555555555';
  const EX_COACH = 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0';
  const TPL = '33333333-3333-3333-3333-333333333333';
  const TPLV = '44444444-4444-4444-4444-444444444444';
  const ASSIGN = '66666666-6666-6666-6666-666666666666';
  const DECISION = '77777777-7777-7777-7777-777777777777';
  const RECEIPT = '88888888-8888-8888-8888-888888888888';

  /* Seeded as the table owner: these writes model what the server-side command
     layer does, which is the only sanctioned writer. */
  asOwnerSql(`
    insert into auth.users (id) values
      ('${COACH_1}'), ('${COACH_2}'), ('${SUPPORT_1}'), ('${EX_COACH}')
      on conflict do nothing;
    insert into public.organizations (id, name, created_by) values
      ('${ORG_1}', 'Org One', '${COACH_1}'),
      ('${ORG_2}', 'Org Two', '${COACH_2}');
    insert into public.organization_memberships (organization_id, user_id, role, status) values
      ('${ORG_1}', '${COACH_1}', 'coach', 'active'),
      ('${ORG_1}', '${SUPPORT_1}', 'support', 'active'),
      ('${ORG_1}', '${EX_COACH}', 'coach', 'revoked'),
      ('${ORG_1}', '${ATHLETE_A}', 'athlete', 'active'),
      ('${ORG_2}', '${COACH_2}', 'coach', 'active'),
      ('${ORG_2}', '${ATHLETE_B}', 'athlete', 'active');
    insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id) values
      ('${ORG_1}', '${COACH_1}', '${ATHLETE_A}'),
      ('${ORG_1}', '${EX_COACH}', '${ATHLETE_A}');
    insert into public.program_templates (id, organization_id, domain, name, created_by)
      values ('${TPL}', '${ORG_1}', 'strength', 'Base Strength', '${COACH_1}');
    insert into public.program_template_versions (id, template_id, version, published_by)
      values ('${TPLV}', '${TPL}', 1, '${COACH_1}');
    insert into public.program_assignments (id, organization_id, athlete_user_id, template_version_id, preferred_start_date, preferred_weekdays, created_by)
      values ('${ASSIGN}', '${ORG_1}', '${ATHLETE_A}', '${TPLV}', date '2026-08-10', '{1,3,5}', '${COACH_1}');
    insert into public.coach_decisions (id, organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
      values ('${DECISION}', '${ORG_1}', '${ATHLETE_A}', '${COACH_1}', 'assignment_created', 'idem-1');
    insert into public.decision_receipts (id, decision_id, organization_id, athlete_user_id, summary)
      values ('${RECEIPT}', '${DECISION}', '${ORG_1}', '${ATHLETE_A}', 'Program assigned');`);

  const countAs = (uid, sql) => lastLine(asAthlete(uid, `select count(*) ${sql};`));

  check("a coach sees their own athlete's assignment", () => {
    const got = countAs(COACH_1, `from public.program_assignments where id = '${ASSIGN}'`);
    if (got !== '1') throw new Error(`the legitimate read returned ${got}, so every deny below proves nothing`);
  });

  check('the athlete sees their own assignment and receipt', () => {
    const got = countAs(ATHLETE_A,
      `from public.program_assignments where id = '${ASSIGN}'`);
    const r = countAs(ATHLETE_A, `from public.decision_receipts where id = '${RECEIPT}'`);
    if (got !== '1' || r !== '1') throw new Error(`athlete saw ${got} assignment, ${r} receipt`);
  });

  check('CROSS-TENANT: a coach in another organisation sees nothing', () => {
    const got = countAs(COACH_2, `from public.program_assignments where id = '${ASSIGN}'`);
    if (got !== '0') throw new Error(`org 2's coach read ${got} of org 1's assignments`);
  });

  check('CROSS-ATHLETE: an athlete cannot read another athlete\'s assignment', () => {
    const got = countAs(ATHLETE_B, `from public.program_assignments where id = '${ASSIGN}'`);
    if (got !== '0') throw new Error(`athlete B read ${got} of athlete A's assignments`);
  });

  check('REVOKED MEMBERSHIP: a coach removed from the org loses access, assignment row notwithstanding', () => {
    const got = countAs(EX_COACH, `from public.program_assignments where id = '${ASSIGN}'`);
    if (got !== '0') throw new Error(`a revoked coach still read ${got} assignments`);
  });

  check('SUPPORT ROLE: support cannot read assignments, decisions or receipts', () => {
    const a = countAs(SUPPORT_1, `from public.program_assignments where id = '${ASSIGN}'`);
    const d = countAs(SUPPORT_1, `from public.coach_decisions where id = '${DECISION}'`);
    const r = countAs(SUPPORT_1, `from public.decision_receipts where id = '${RECEIPT}'`);
    if (a !== '0' || d !== '0' || r !== '0') throw new Error(`support read ${a}/${d}/${r} (assignment/decision/receipt)`);
  });

  check('GUESSED RECEIPT ID: knowing the id does not reveal it, and the miss is indistinguishable', () => {
    const real = countAs(ATHLETE_B, `from public.decision_receipts where id = '${RECEIPT}'`);
    const fake = countAs(ATHLETE_B, `from public.decision_receipts where id = '99999999-9999-9999-9999-999999999999'`);
    if (real !== '0' || fake !== '0') throw new Error(`guessing returned ${real} for a real id, ${fake} for a fake one`);
    if (real !== fake) throw new Error('a real id and a fake one answered differently — that leaks existence');
  });

  check('ROLE ESCALATION: no client role may write any of these tables', () => {
    for (const [who, sql] of [
      [COACH_1, `insert into public.organization_memberships (organization_id, user_id, role) values ('${ORG_1}', '${COACH_1}', 'owner')`],
      [COACH_2, `insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id) values ('${ORG_1}', '${COACH_2}', '${ATHLETE_A}')`],
      [ATHLETE_A, `insert into public.program_assignments (organization_id, athlete_user_id, template_version_id, preferred_start_date, created_by) values ('${ORG_1}', '${ATHLETE_A}', '${TPLV}', date '2026-08-10', '${ATHLETE_A}')`],
    ]) {
      const out = asAthlete(who, refusalProbe(sql));
      if (!out.includes('REFUSED')) throw new Error(`a client write was ACCEPTED: ${sql.slice(0, 60)}...`);
    }
  });

  check('REPLAYED IDEMPOTENCY KEY: the same key twice in one org is rejected', () => {
    const out = asOwnerProbe(
      `insert into public.coach_decisions (organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
       values ('${ORG_1}', '${ATHLETE_A}', '${COACH_1}', 'assignment_updated', 'idem-1')`);
    if (!out.includes('REFUSED')) throw new Error('a replayed idempotency key was accepted');
  });

  check('the same key in a DIFFERENT organisation is fine, so keys cannot be probed across tenants', () => {
    const out = asOwnerProbe(
      `insert into public.coach_decisions (organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
       values ('${ORG_2}', '${ATHLETE_B}', '${COACH_2}', 'assignment_created', 'idem-1')`);
    if (!out.includes('ACCEPTED')) throw new Error('idempotency is global rather than per-organisation');
  });

  check('IMMUTABLE: decisions, receipts and published versions cannot be edited or deleted', () => {
    for (const sql of [
      `update public.coach_decisions set kind = 'progression_approved' where id = '${DECISION}'`,
      `delete from public.coach_decisions where id = '${DECISION}'`,
      `update public.decision_receipts set summary = 'rewritten' where id = '${RECEIPT}'`,
      `delete from public.decision_receipts where id = '${RECEIPT}'`,
      `update public.program_template_versions set body = '{"x":1}'::jsonb where id = '${TPLV}'`,
    ]) {
      const out = asOwnerProbe(sql);
      if (!out.includes('REFUSED')) throw new Error(`an immutable record accepted: ${sql.slice(0, 50)}...`);
    }
  });

  check('an assignment carries INTENT, never resolved dates', () => {
    const got = lastLine(asAthlete(COACH_1,
      `select array_to_string(preferred_weekdays, ',') from public.program_assignments where id = '${ASSIGN}';`));
    if (got !== '1,3,5') throw new Error(`preferred weekdays read back as ${got}`);
    const cols = lastLine(asOwnerSqlOut(
      `select count(*) from information_schema.columns
        where table_name = 'program_assignments' and column_name in ('resolved_dates', 'calendar', 'placed_dates');`));
    if (cols !== '0') throw new Error(`the assignment table has ${cols} placement column(s) — the Coordinator owns placement`);
  });

} finally {
  try { asOwner(`pg_ctl -D ${dir}/data stop -m immediate`); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll migration checks passed.');
process.exit(failures ? 1 : 0);
