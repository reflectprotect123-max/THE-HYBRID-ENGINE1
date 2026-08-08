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
const DEBUG = process.env.PGCHECK_DEBUG === '1';

/* Arbitrary SQL is easier to get right in a file than through six layers of
   shell and psql quoting, so every ad-hoc script below is written to disk and
   run with -f. `-tAq` gives bare tuples, and stderr is folded in because the
   refusal assertions read NOTICE output. */
let sqlSeq = 0;
const runSql = (sql) => {
  const f = join(dir, `probe-${sqlSeq++}.sql`);
  writeFileSync(f, sql);
  chmodSync(f, 0o644);
  try {
    return psql(`-tAq -f ${f} 2>&1`);
  } catch (e) {
    if (DEBUG) console.error(`--- probe ${f} exited non-zero ---\n${sql}\n--- output ---\n${e.stdout ?? ''}${e.stderr ?? ''}`);
    throw e;
  }
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
exception when others then raise notice 'REFUSED [%] %', sqlstate, sqlerrm;
end $probe$;`;

/* THE SQLSTATE IS REPORTED ABOVE, AND `wasRefused()` READS IT.
 *
 * `exception when others` catches the failure a test is for and also every
 * failure that means the TEST is broken — a renamed function, a dropped table,
 * a typo in a column name. All of those raise, so all of them were being
 * scored as successful denials. A suite that passes louder as the schema
 * disappears is worse than no suite, so the two classes are separated here.
 *
 * 42883 undefined_function, 42P01 undefined_table, 42703 undefined_column,
 * 42601 syntax_error, 42P02 undefined_parameter. */
const BROKEN_PROBE = new Set(['42883', '42P01', '42703', '42601', '42P02']);
const refusalState = (out) => (out.match(/REFUSED \[([0-9A-Z]+)\]/) ?? [])[1] ?? null;
const wasRefused = (out) => {
  const state = refusalState(out);
  if (state === null) return false;
  if (BROKEN_PROBE.has(state)) {
    throw new Error(`the probe itself is broken (SQLSTATE ${state}) — that is not a denial: ${lastLine(out)}`);
  }
  return true;
};

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
    if (!wasRefused(out)) throw new Error(`the write was ACCEPTED: ${out.trim().split('\n').slice(-2).join(' ')}`);
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
  /* THE ACTOR THIS SUITE DID NOT HAVE.
     Every "unauthorised coach" above was COACH_2, who is in the OTHER
     organisation — so every deny they proved was a tenancy deny, and the
     within-tenant boundary went untested. COACH_3 is a fully legitimate,
     active coach in ORG_1 who simply does not coach ATHLETE_A. They are the
     realistic adversary: same tenant, same key space, same visibility of
     template versions and memberships, no relationship to this athlete. */
  const COACH_3 = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
  /* COACH_3's own athlete, so COACH_3 can make authorised calls of their own
     and we can ask whose data comes back. */
  const ATHLETE_E = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  /* An athlete who LEFT the organisation. The assignment row survives, as it
     does in practice; the membership does not. */
  const ATHLETE_D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const ASSIGN_D = '6d6d6d6d-6d6d-6d6d-6d6d-6d6d6d6d6d6d';
  const TPL = '33333333-3333-3333-3333-333333333333';
  const TPLV = '44444444-4444-4444-4444-444444444444';
  const ASSIGN = '66666666-6666-6666-6666-666666666666';
  const DECISION = '77777777-7777-7777-7777-777777777777';
  const RECEIPT = '88888888-8888-8888-8888-888888888888';

  /* Seeded as the table owner: these writes model what the server-side command
     layer does, which is the only sanctioned writer. */
  asOwnerSql(`
    insert into auth.users (id) values
      ('${COACH_1}'), ('${COACH_2}'), ('${COACH_3}'), ('${SUPPORT_1}'), ('${EX_COACH}'),
      ('${ATHLETE_D}'), ('${ATHLETE_E}')
      on conflict do nothing;
    insert into public.organizations (id, name, created_by) values
      ('${ORG_1}', 'Org One', '${COACH_1}'),
      ('${ORG_2}', 'Org Two', '${COACH_2}');
    insert into public.organization_memberships (organization_id, user_id, role, status, revoked_at) values
      ('${ORG_1}', '${COACH_1}', 'coach', 'active', null),
      ('${ORG_1}', '${COACH_3}', 'coach', 'active', null),
      ('${ORG_1}', '${SUPPORT_1}', 'support', 'active', null),
      ('${ORG_1}', '${EX_COACH}', 'coach', 'revoked', now()),
      ('${ORG_1}', '${ATHLETE_A}', 'athlete', 'active', null),
      ('${ORG_1}', '${ATHLETE_E}', 'athlete', 'active', null),
      -- The athlete who left. Their coach's membership is untouched.
      ('${ORG_1}', '${ATHLETE_D}', 'athlete', 'revoked', now()),
      ('${ORG_2}', '${COACH_2}', 'coach', 'active', null),
      ('${ORG_2}', '${ATHLETE_B}', 'athlete', 'active', null);
    insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id) values
      ('${ORG_1}', '${COACH_1}', '${ATHLETE_A}'),
      ('${ORG_1}', '${COACH_1}', '${ATHLETE_D}'),
      -- COACH_1 also coaches ATHLETE_E, alongside COACH_3 -- the actor the
      -- workout-library cross-athlete leak test needs: one coach who
      -- legitimately coaches TWO different athletes in the same org.
      ('${ORG_1}', '${COACH_1}', '${ATHLETE_E}'),
      ('${ORG_1}', '${COACH_3}', '${ATHLETE_E}'),
      ('${ORG_1}', '${EX_COACH}', '${ATHLETE_A}');
    insert into public.program_templates (id, organization_id, domain, name, created_by)
      values ('${TPL}', '${ORG_1}', 'strength', 'Base Strength', '${COACH_1}');
    insert into public.program_template_versions (id, template_id, version, published_by)
      values ('${TPLV}', '${TPL}', 1, '${COACH_1}');
    insert into public.program_assignments (id, organization_id, athlete_user_id, template_version_id, preferred_start_date, preferred_weekdays, created_by)
      values ('${ASSIGN}', '${ORG_1}', '${ATHLETE_A}', '${TPLV}', date '2026-08-10', '{1,3,5}', '${COACH_1}');
    insert into public.program_assignments (id, organization_id, athlete_user_id, template_version_id, preferred_start_date, preferred_weekdays, created_by)
      values ('${ASSIGN_D}', '${ORG_1}', '${ATHLETE_D}', '${TPLV}', date '2026-08-10', '{2,4}', '${COACH_1}');
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
      if (!wasRefused(out)) throw new Error(`a client write was ACCEPTED: ${sql.slice(0, 60)}...`);
    }
  });

  check('REPLAYED IDEMPOTENCY KEY: the same key, athlete and kind twice is rejected', () => {
    const out = asOwnerProbe(
      `insert into public.coach_decisions (organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
       values ('${ORG_1}', '${ATHLETE_A}', '${COACH_1}', 'assignment_created', 'idem-1')`);
    if (!wasRefused(out)) throw new Error('a replayed idempotency key was accepted');
  });

  check('the same key in a DIFFERENT organisation is fine, so keys cannot be probed across tenants', () => {
    const out = asOwnerProbe(
      `insert into public.coach_decisions (organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
       values ('${ORG_2}', '${ATHLETE_B}', '${COACH_2}', 'assignment_created', 'idem-1')`);
    if (!out.includes('ACCEPTED')) throw new Error('idempotency is global rather than per-organisation');
  });

  check('the same key for a DIFFERENT KIND is fine — a collision used to return a write that never happened', () => {
    /* Keys are derivable from the athlete and the template version, so one key
       legitimately describes several decisions about the same assignment. When
       uniqueness ignored `kind`, the second of those collided, the command
       found a decision whose payload named no assignment, and returned NULL —
       which the client reads as success. */
    const out = asOwnerProbe(
      `insert into public.coach_decisions (organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
       values ('${ORG_1}', '${ATHLETE_A}', '${COACH_1}', 'assignment_updated', 'idem-1')`);
    if (!out.includes('ACCEPTED')) throw new Error('idempotency ignores kind, so two kinds of decision collide');
  });

  check('the same key for a DIFFERENT ATHLETE is fine, so one coach cannot probe another coach\'s key space', () => {
    const out = asOwnerProbe(
      `insert into public.coach_decisions (organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
       values ('${ORG_1}', '${ATHLETE_E}', '${COACH_3}', 'assignment_created', 'idem-1')`);
    if (!out.includes('ACCEPTED')) throw new Error('idempotency is org-wide, so a derivable key is an existence oracle across athletes');
  });

  check("ATHLETE LEFT THE ORG: their coach loses access even though the assignment row remains", () => {
    /* The membership on the ATHLETE's side is the one that is easy to omit —
       `coaches_athlete` originally joined only the coach's. Deleting an
       athlete's membership then revoked nothing, and their pain flag kept
       reaching a coach they had left. */
    const rows = countAs(COACH_1, `from public.program_assignments where id = '${ASSIGN_D}'`);
    if (rows !== '0') throw new Error(`a departed athlete's coach still read ${rows} assignment(s)`);
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.get_athlete_training_summary('${ORG_1}', '${ATHLETE_D}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error("a departed athlete's summary was still readable");
  });

  check('WITHIN-TENANT: a real coach in the same org who does not coach this athlete sees nothing', () => {
    const a = countAs(COACH_3, `from public.program_assignments where id = '${ASSIGN}'`);
    const d = countAs(COACH_3, `from public.coach_decisions where id = '${DECISION}'`);
    const r = countAs(COACH_3, `from public.decision_receipts where id = '${RECEIPT}'`);
    if (a !== '0' || d !== '0' || r !== '0') {
      throw new Error(`a same-org coach read ${a}/${d}/${r} of an athlete who is not theirs`);
    }
  });

  check('REVOKED_AT CANNOT DISAGREE WITH STATUS: a paper-only revocation is rejected', () => {
    /* `revoked_at` used to be decorative. Stamping it alone read as revoked to
       a human and as fully active to every policy in the file — the audit trail
       saying access ended while access continued. */
    for (const sql of [
      `insert into public.organization_memberships (organization_id, user_id, role, status, revoked_at)
         values ('${ORG_1}', '${COACH_2}', 'coach', 'active', now())`,
      `insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id, status, revoked_at)
         values ('${ORG_1}', '${COACH_3}', '${ATHLETE_A}', 'active', now())`,
      `insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id, status, revoked_at)
         values ('${ORG_1}', '${COACH_2}', '${ATHLETE_E}', 'revoked', null)`,
    ]) {
      const out = asOwnerProbe(sql);
      if (!wasRefused(out)) throw new Error(`a revocation that contradicts itself was accepted: ${sql.slice(0, 70)}...`);
    }
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
      if (!wasRefused(out)) throw new Error(`an immutable record accepted: ${sql.slice(0, 50)}...`);
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


  /* The write path. RLS grants no client INSERT at all, so every one of these
     goes through create_program_assignment — which means these tests probe the
     door rather than the floor. Here a refusal IS the right assertion: the
     function raises, unlike a policy, which merely filters. */
  const callAssign = (uid, org, athlete, key, tplv = TPLV) => asAthlete(uid, refusalProbe(
    `perform public.create_program_assignment('${org}', '${athlete}', '${tplv}', date '2026-09-01', '{1,3}'::smallint[], '${key}')`));

  check('COMMAND: a coach can assign to their own athlete', () => {
    const out = callAssign(COACH_1, ORG_1, ATHLETE_A, 'cmd-ok-1');
    if (!out.includes('ACCEPTED')) throw new Error(`the legitimate command was refused: ${out.trim().split('\n').pop()}`);
  });

  check('COMMAND: it wrote the assignment, a decision AND a receipt, in one go', () => {
    const got = lastLine(asOwnerSqlOut(
      `select (select count(*) from public.program_assignments where organization_id = '${ORG_1}')
           || '/' || (select count(*) from public.coach_decisions where idempotency_key = 'cmd-ok-1')
           || '/' || (select count(*) from public.decision_receipts r
                       join public.coach_decisions d on d.id = r.decision_id
                      where d.idempotency_key = 'cmd-ok-1');`));
    /* Three assignments in ORG_1: the two seeded (ATHLETE_A, ATHLETE_D) plus
       the one this command just wrote. One decision and one receipt for the
       key, which is the part being asserted. */
    if (got !== '3/1/1') throw new Error(`assignment/decision/receipt counts were ${got}`);
  });

  check('COMMAND: a replay returns the original instead of writing twice', () => {
    const out = callAssign(COACH_1, ORG_1, ATHLETE_A, 'cmd-ok-1');
    if (!out.includes('ACCEPTED')) throw new Error('a replay errored rather than returning the original');
    const got = lastLine(asOwnerSqlOut(
      `select count(*) from public.coach_decisions where idempotency_key = 'cmd-ok-1';`));
    if (got !== '1') throw new Error(`the replay created ${got} decisions`);
  });

  check('COMMAND: a coach cannot assign to an athlete who is not theirs', () => {
    const out = callAssign(COACH_2, ORG_1, ATHLETE_A, 'cmd-cross-1');
    if (!wasRefused(out)) throw new Error("another org's coach wrote an assignment");
  });

  check('COMMAND: a revoked coach cannot assign', () => {
    const out = callAssign(EX_COACH, ORG_1, ATHLETE_A, 'cmd-revoked-1');
    if (!wasRefused(out)) throw new Error('a revoked coach wrote an assignment');
  });

  check('COMMAND: an athlete cannot assign to themselves', () => {
    const out = callAssign(ATHLETE_A, ORG_1, ATHLETE_A, 'cmd-self-1');
    if (!wasRefused(out)) throw new Error('an athlete assigned a program to themselves');
  });

  check('COMMAND: support cannot assign', () => {
    const out = callAssign(SUPPORT_1, ORG_1, ATHLETE_A, 'cmd-support-1');
    if (!wasRefused(out)) throw new Error('support wrote an assignment');
  });

  check("COMMAND: a coach cannot assign another tenant's template version", () => {
    asOwnerSql(`
      insert into public.program_templates (id, organization_id, domain, name, created_by)
        values ('aaaa1111-0000-0000-0000-000000000001', '${ORG_2}', 'strength', 'Org2 Program', '${COACH_2}');
      insert into public.program_template_versions (id, template_id, version, published_by)
        values ('aaaa1111-0000-0000-0000-000000000002', 'aaaa1111-0000-0000-0000-000000000001', 1, '${COACH_2}');`);
    const out = callAssign(COACH_1, ORG_1, ATHLETE_A, 'cmd-tpl-1', 'aaaa1111-0000-0000-0000-000000000002');
    if (!wasRefused(out)) throw new Error("a coach assigned another organisation's program");
  });

  check('COMMAND: the refusal does not say WHICH check failed, so athletes cannot be enumerated', () => {
    const notMine = callAssign(COACH_2, ORG_1, ATHLETE_A, 'cmd-probe-1');
    const notReal = callAssign(COACH_2, ORG_1, '00000000-0000-0000-0000-0000000000ff', 'cmd-probe-2');
    const norm = (s) => (s.match(/REFUSED \[[0-9A-Z]+\] (.*)/) ?? [])[1] ?? s;
    if (norm(notMine) !== norm(notReal)) {
      throw new Error(`a real athlete and a fake one produced different errors: "${norm(notMine)}" vs "${norm(notReal)}"`);
    }
  });

  check('COMMAND: a replay is scoped to the ATHLETE, not just the organisation', () => {
    /* The one that mattered most. `create_program_assignment` is SECURITY
       DEFINER, so its replay lookup is not filtered by RLS — whatever the
       predicate omits, nothing else supplies. Keyed on the organisation alone,
       it returned ANOTHER coach's athlete's assignment to any coach in the
       organisation who reused a key, and the key is derivable from two values
       the read policies already hand out.
       COACH_3 is authorised for ATHLETE_E and reuses COACH_1's key. What comes
       back must be ATHLETE_E's own new assignment. */
    const got = lastLine(asAthlete(COACH_3,
      `select athlete_user_id from public.create_program_assignment(
         '${ORG_1}', '${ATHLETE_E}', '${TPLV}', date '2026-09-01', '{1,3}'::smallint[], 'cmd-ok-1');`));
    if (got === ATHLETE_A) throw new Error("a reused key handed one coach another coach's athlete's assignment");
    if (got !== ATHLETE_E) throw new Error(`expected the caller's own athlete, got ${got}`);
  });


  /* The projection. This is the function that lets a coach see anything at all
     about another person, so it gets the most hostile tests in this file. */
  console.log('\nARC — the authorised, tenant-scoped projection:\n');

  asOwnerSql(`
    insert into public.athlete_domain_snapshots (user_id, domain, writer, snapshot) values
      ('${ATHLETE_A}', 'strength', 'test', jsonb_build_object('sessions', jsonb_build_array(
         jsonb_build_object('id','s1','kind','strength','date','2026-08-10','status','complete'),
         jsonb_build_object('id','s2','kind','strength','date','2026-08-12','status','planned'))))
      on conflict (user_id, domain) do update set snapshot = excluded.snapshot;
    insert into public.athlete_domain_snapshots (user_id, domain, writer, snapshot) values
      ('${ATHLETE_A}', 'conditioning', 'test', jsonb_build_object('sessions', jsonb_build_array(
         jsonb_build_object('id','c1','kind','conditioning','date','2026-08-11','status','complete'))))
      on conflict (user_id, domain) do update set snapshot = excluded.snapshot;
    insert into public.athlete_core (user_id, state) values
      ('${ATHLETE_A}', jsonb_build_object('safety', jsonb_build_object('painHold', jsonb_build_object('active', true))))
      on conflict (user_id) do update set state = excluded.state;`);

  const summary = (uid, org, athlete) => lastLine(asAthlete(uid,
    `select strength_completed || '/' || strength_planned || '/' || conditioning_completed
         || '/' || conditioning_planned || '/' || has_safety_flag
       from public.get_athlete_training_summary('${org}', '${athlete}', date '2026-08-10');`));

  check('PROJECTION: a coach gets their athlete\'s week as counts', () => {
    const got = summary(COACH_1, ORG_1, ATHLETE_A);
    if (got !== '1/2/1/1/true') throw new Error(`expected 1/2/1/1/true (strength 1 of 2, conditioning 1 of 1, pain flag), got ${got}`);
  });

  check('PROJECTION: the pain flag travels, so a coach is not told the opposite of what happened', () => {
    const got = summary(COACH_1, ORG_1, ATHLETE_A);
    if (!got.endsWith('/true')) throw new Error(`an active pain hold did not reach the coach: ${got}`);
  });

  check('PROJECTION: another tenant\'s coach is refused', () => {
    const out = asAthlete(COACH_2, refusalProbe(
      `perform public.get_athlete_training_summary('${ORG_1}', '${ATHLETE_A}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error("another org's coach read the summary");
  });

  check('PROJECTION: a revoked coach is refused', () => {
    const out = asAthlete(EX_COACH, refusalProbe(
      `perform public.get_athlete_training_summary('${ORG_1}', '${ATHLETE_A}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error('a revoked coach read the summary');
  });

  check('PROJECTION: support is refused', () => {
    const out = asAthlete(SUPPORT_1, refusalProbe(
      `perform public.get_athlete_training_summary('${ORG_1}', '${ATHLETE_A}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error('support read the summary');
  });

  check('PROJECTION: another athlete is refused', () => {
    const out = asAthlete(ATHLETE_B, refusalProbe(
      `perform public.get_athlete_training_summary('${ORG_1}', '${ATHLETE_A}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error("athlete B read athlete A's summary");
  });

  check('PROJECTION: it returns COUNTS and cannot return the snapshot', () => {
    /* The privacy boundary. A coach learns how the week went; they do not get
       the athlete's every logged set. If a column ever carries jsonb, this
       fails — which is the point. */
    /* A function's TABLE return is not in information_schema.columns —
       pg_get_function_result is where it lives. */
    const ret = lastLine(asOwnerSqlOut(
      `select pg_get_function_result(p.oid) from pg_proc p
        where p.proname = 'get_athlete_training_summary';`));
    if (!ret) throw new Error('the projection function was not found');
    if (/json/i.test(ret)) throw new Error(`the projection returns json: ${ret}`);
    /* And the raw snapshot stays unreadable directly. Either answer is
       correct and they are different mechanisms: a hard permission denial (no
       grant on the table) or an empty set (RLS filtering). What must never
       happen is a row coming back. */
    const raw = asAthlete(COACH_1, `do $p$ declare n integer; begin
      select count(*) into n from public.athlete_domain_snapshots where user_id = '${ATHLETE_A}';
      raise notice 'ROWS %', n;
    exception when others then raise notice 'REFUSED'; end $p$;`);
    if (!/REFUSED|ROWS 0/.test(raw)) {
      throw new Error(`a coach read the athlete's raw snapshots directly: ${lastLine(raw)}`);
    }
  });

  /* The snapshot is athlete-written and arrives through a write path that does
     not validate its interior. If a bad shape can abort this function, then one
     athlete can suppress the pain flag the projection exists to carry — for
     themselves, by writing nonsense. That is the failure mode being closed. */
  asOwnerSql(`
    insert into public.athlete_domain_snapshots (user_id, domain, writer, snapshot) values
      ('${ATHLETE_E}', 'strength', 'test', '{"sessions":{"not":"an array"}}'::jsonb)
      on conflict (user_id, domain) do update set snapshot = excluded.snapshot;
    insert into public.athlete_domain_snapshots (user_id, domain, writer, snapshot) values
      ('${ATHLETE_E}', 'nutrition', 'test', '{"logEntries":"not an array either"}'::jsonb)
      on conflict (user_id, domain) do update set snapshot = excluded.snapshot;
    insert into public.athlete_core (user_id, state) values
      ('${ATHLETE_E}', jsonb_build_object('safety', jsonb_build_object(
         'painHold', jsonb_build_object('active', 'maybe'))))
      on conflict (user_id) do update set state = excluded.state;`);

  check('PROJECTION: a malformed snapshot degrades to zero counts, it does not abort the answer', () => {
    const got = summary(COACH_3, ORG_1, ATHLETE_E);
    if (got !== '0/0/0/0/false') throw new Error(`expected 0/0/0/0/false from an unusable snapshot, got ${got}`);
  });

  check('PROJECTION: an absent illness field is unknown, not unwell', () => {
    /* `is distinct from 'clear'` reads a missing field as a raised flag, which
       puts "Pain or illness flag is active" beside every athlete who has never
       filled it in — and a flag that is always on is a flag nobody reads. */
    const got = summary(COACH_3, ORG_1, ATHLETE_E);
    if (!got.endsWith('/false')) throw new Error(`an athlete with no illness data was reported as flagged: ${got}`);
  });

  check('PROJECTION: an illness that IS recorded and is not clear does flag', () => {
    asOwnerSql(`update public.athlete_core
                   set state = jsonb_set(state, '{safety,illness}', '{"status":"suspected"}'::jsonb)
                 where user_id = '${ATHLETE_E}';`);
    const got = summary(COACH_3, ORG_1, ATHLETE_E);
    if (!got.endsWith('/true')) throw new Error(`a recorded illness did not reach the coach: ${got}`);
  });

  /* ---------------------------------------------------------------------
   * ARC — get_athlete_workout_library, per docs/ARC_LAYER3_DESIGN.md §6.
   * Six findings came out of that design's own adversarial review before any
   * SQL existed; each test below is named for the finding it proves closed.
   * ------------------------------------------------------------------- */
  console.log('\nARC — the coach workout library:\n');

  const WORKOUT_1 = 'strength:sessA:squat:1000';
  const bodyOf = (name) => JSON.stringify({ name, blocks: [] }).replace(/'/g, "''");

  const saveDraft = (uid, org, athlete, workoutId, kind, body, baseVersion) => lastLine(asAthlete(uid,
    `select id || '|' || base_version || '|' || template_id from public.save_workout_draft(
       '${org}', '${athlete}', '${workoutId}', '${kind}', '${body}'::jsonb,
       ${baseVersion === null || baseVersion === undefined ? 'null' : baseVersion});`));

  check('WORKOUT LIBRARY: first save creates a draft at version 0', () => {
    const got = saveDraft(COACH_1, ORG_1, ATHLETE_A, WORKOUT_1, 'strength', bodyOf('Squat day'), null);
    const [, version] = got.split('|');
    if (version !== '0') throw new Error(`expected base_version 0 on first save, got: ${got}`);
  });

  check('WORKOUT LIBRARY: a further save against the right version advances it', () => {
    const got = saveDraft(COACH_1, ORG_1, ATHLETE_A, WORKOUT_1, 'strength', bodyOf('Squat day v2'), 0);
    const [, version] = got.split('|');
    if (version !== '1') throw new Error(`expected base_version 1, got: ${got}`);
  });

  check('FINDING (stale version): a save against a stale base_version is rejected, not merged', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.save_workout_draft('${ORG_1}', '${ATHLETE_A}', '${WORKOUT_1}', 'strength', '${bodyOf('stale')}'::jsonb, 0)`));
    if (!wasRefused(out)) throw new Error('a stale-version save was accepted rather than rejected');
  });

  check('a draft cannot change kind after creation', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.save_workout_draft('${ORG_1}', '${ATHLETE_A}', '${WORKOUT_1}', 'conditioning', '${bodyOf('x')}'::jsonb, 1)`));
    if (!wasRefused(out)) throw new Error('a draft was allowed to switch kind mid-life');
  });

  check("FINDING (race → duplicate template): two drafts cannot share one (org, athlete, workout_id)", () => {
    /* This is the direct-write proxy for the race save_workout_draft closes
       with ON CONFLICT: the unique constraint it relies on must actually
       exist and actually fire, or two concurrent first saves would each
       believe they won. A second, unrelated template stands in for the
       "second concurrent caller minted its own template row" half of the
       race — what must be impossible is a SECOND draft for the same
       (org, athlete, workout_id), regardless of which template it points at. */
    const dupTemplateId = lastLine(asOwnerSqlOut(
      `insert into public.program_templates (organization_id, domain, name, athlete_user_id, created_by)
         values ('${ORG_1}', 'strength', 'dup', '${ATHLETE_A}', '${COACH_1}')
         returning id;`));
    const out = asOwnerProbe(
      `insert into public.coach_workout_drafts (organization_id, athlete_user_id, coach_user_id, workout_id, template_id, kind, body, updated_by)
         values ('${ORG_1}', '${ATHLETE_A}', '${COACH_1}', '${WORKOUT_1}', '${dupTemplateId}', 'strength', '{}'::jsonb, '${COACH_1}')`);
    if (!wasRefused(out)) throw new Error('a second draft for the same (org, athlete, workout_id) was accepted');
  });

  check('WORKOUT LIBRARY: get_athlete_workout_library returns the drafting coach their athlete\'s drafts', () => {
    const got = lastLine(asAthlete(COACH_1,
      `select count(*) from public.get_athlete_workout_library('${ORG_1}', '${ATHLETE_A}');`));
    if (got !== '1') throw new Error(`expected 1 draft, got ${got}`);
  });

  check('WORKOUT LIBRARY: a same-org coach who does not coach this athlete gets nothing from it', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.get_athlete_workout_library('${ORG_1}', '${ATHLETE_A}')`));
    if (!wasRefused(out)) throw new Error("a non-coaching coach's call to get_athlete_workout_library was not refused");
  });

  check('ROLE ESCALATION: no client role may write coach_workout_drafts directly', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `insert into public.coach_workout_drafts (organization_id, athlete_user_id, coach_user_id, workout_id, template_id, kind, body, updated_by)
         select organization_id, athlete_user_id, coach_user_id, 'direct-insert', template_id, kind, body, updated_by
           from public.coach_workout_drafts where workout_id = '${WORKOUT_1}' limit 1`));
    if (!wasRefused(out)) throw new Error('a client role wrote coach_workout_drafts directly');
  });

  let publishedVersionId;
  check('WORKOUT LIBRARY: publish snapshots the draft, publishes the template, and assigns it', () => {
    const out = lastLine(asAthlete(COACH_1,
      `select template_version_id from public.publish_workout_draft(
         '${ORG_1}', '${ATHLETE_A}', '${WORKOUT_1}', 1, date '2026-09-07', '{2,4}'::smallint[], 'publish-1');`));
    if (!out || out === '') throw new Error('publish_workout_draft did not return an assignment');
    publishedVersionId = out;
    const status = lastLine(asOwnerSqlOut(
      `select status from public.program_templates t
         join public.coach_workout_drafts d on d.template_id = t.id
        where d.workout_id = '${WORKOUT_1}' and d.athlete_user_id = '${ATHLETE_A}';`));
    if (status !== 'published') throw new Error(`expected template status published, got ${status}`);
  });

  check('WORKOUT LIBRARY: a replayed publish returns the original assignment, no second template version', () => {
    const templateId = lastLine(asOwnerSqlOut(
      `select template_id from public.coach_workout_drafts where workout_id = '${WORKOUT_1}' and athlete_user_id = '${ATHLETE_A}';`));
    const before = lastLine(asOwnerSqlOut(
      `select count(*) from public.program_template_versions where template_id = '${templateId}';`));
    asAthlete(COACH_1, `select public.publish_workout_draft(
       '${ORG_1}', '${ATHLETE_A}', '${WORKOUT_1}', 1, date '2026-09-07', '{2,4}'::smallint[], 'publish-1');`);
    const after = lastLine(asOwnerSqlOut(
      `select count(*) from public.program_template_versions where template_id = '${templateId}';`));
    if (before !== after) throw new Error(`a replayed publish minted a new version: ${before} -> ${after}`);
  });

  check('FINDING (one-off dates): a dates-based workout is refused at publish, not silently dropped', () => {
    saveDraft(COACH_1, ORG_1, ATHLETE_A, 'strength:sessA:oneoff:2000', 'strength',
      JSON.stringify({ name: 'One-off', blocks: [], dates: ['2026-09-10'] }).replace(/'/g, "''"), null);
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.publish_workout_draft('${ORG_1}', '${ATHLETE_A}', 'strength:sessA:oneoff:2000', 0, date '2026-09-10', '{}'::smallint[], 'publish-oneoff-1')`));
    if (!wasRefused(out)) throw new Error('a one-off dated workout was published rather than refused');
  });

  check('FINDING (private template leak): a same-org coach who does not coach this athlete cannot see the published private template', () => {
    if (!publishedVersionId) throw new Error('setup failed: no published version to check');
    const templateCount = lastLine(asAthlete(COACH_3,
      `select count(*) from public.program_templates t
         join public.program_template_versions v on v.template_id = t.id
        where v.id = '${publishedVersionId}';`));
    const versionCount = lastLine(asAthlete(COACH_3,
      `select count(*) from public.program_template_versions where id = '${publishedVersionId}';`));
    if (templateCount !== '0' || versionCount !== '0') {
      throw new Error(`a non-coaching same-org coach read ${templateCount} template(s), ${versionCount} version(s) of a private template`);
    }
  });

  check('FINDING (private template leak): the OWNING coach and the athlete themselves can still see it', () => {
    const coachSees = lastLine(asAthlete(COACH_1,
      `select count(*) from public.program_template_versions where id = '${publishedVersionId}';`));
    const athleteSees = lastLine(asAthlete(ATHLETE_A,
      `select count(*) from public.program_template_versions where id = '${publishedVersionId}';`));
    if (coachSees !== '1' || athleteSees !== '1') {
      throw new Error(`expected the owning coach and the athlete to both see it: coach=${coachSees} athlete=${athleteSees}`);
    }
  });

  check('CRITICAL — a private template cannot be assigned to a DIFFERENT athlete the same coach also coaches', () => {
    /* COACH_1 coaches both ATHLETE_A and ATHLETE_E. Build and publish a
       private draft for ATHLETE_E, then try to assign that exact version to
       ATHLETE_A instead. Before this fix, create_program_assignment only
       checked the template's ORGANISATION, never its ATHLETE, so this
       succeeded — one athlete's private workout content, assigned to
       another, by a coach who happened to be authorised for both. */
    saveDraft(COACH_1, ORG_1, ATHLETE_E, 'strength:sessE:bench:3000', 'strength', bodyOf('Bench day'), null);
    const eVersionId = lastLine(asAthlete(COACH_1,
      `select template_version_id from public.publish_workout_draft(
         '${ORG_1}', '${ATHLETE_E}', 'strength:sessE:bench:3000', 0, date '2026-09-07', '{1,3}'::smallint[], 'publish-e-1');`));
    if (!eVersionId) throw new Error('setup failed: could not publish a private draft for ATHLETE_E');

    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.create_program_assignment('${ORG_1}', '${ATHLETE_A}', '${eVersionId}', date '2026-09-08', '{1}'::smallint[], 'cmd-leak-1')`));
    if (!wasRefused(out)) {
      throw new Error("COACH_1 assigned ATHLETE_E's private workout to ATHLETE_A — the cross-athlete leak the design review found");
    }
  });

  /* ---------------------------------------------------------------------
   * ARC — progression proposals, trends, nutrition review, week plan and
   * session detail, per docs/ARC_LAYER3_DESIGN.md §§1-5 (§6 is the workout
   * library, tested above). Tests are named for the finding they close.
   * ------------------------------------------------------------------- */
  console.log('\nARC — progression proposals, trends and nutrition review:\n');

  const pushProposal = (uid, org, domain, subject, clientKey, before, after, confidence, hard, direction, sourceAt) =>
    lastLine(asAthlete(uid,
      `select id || '|' || status from public.push_progression_proposal(
         '${org}', '${domain}', '${subject}', '${clientKey}',
         ${before === null ? 'null' : `'${before}'::jsonb`}, '${after}'::jsonb,
         '${confidence}', ${hard}, '${direction}', '${sourceAt}'::timestamptz);`));

  let proposalIdA;
  check('PROGRESSION: an athlete can push their own proposal', () => {
    const out = pushProposal(ATHLETE_A, ORG_1, 'strength', 'Back Squat', 'strength:sq', null,
      '{"kg":100,"at":1000}', 'high', false, 'increase', '2026-08-08T00:00:00Z');
    const [id, status] = out.split('|');
    if (!id || status !== 'pending') throw new Error(`expected a pending proposal, got: ${out}`);
    proposalIdA = id;
  });

  check('PROGRESSION: a coach who is not this athlete\'s org role "athlete" cannot push on their behalf', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.push_progression_proposal('${ORG_1}', 'strength', 'Bench', 'strength:bp', null, '{"kg":80}'::jsonb, 'low', false, 'increase', '2026-08-08T00:00:00Z')`));
    if (!wasRefused(out)) throw new Error("a non-athlete role pushed a proposal as if it were the athlete's own");
  });

  check('PROGRESSION: a repeated push (same org, athlete, domain, key, source_at) replays, not duplicates', () => {
    const before = lastLine(asOwnerSqlOut(`select count(*) from public.progression_proposal_snapshots where athlete_user_id = '${ATHLETE_A}';`));
    pushProposal(ATHLETE_A, ORG_1, 'strength', 'Back Squat (retry)', 'strength:sq', null,
      '{"kg":100,"at":1000}', 'high', false, 'increase', '2026-08-08T00:00:00Z');
    const after = lastLine(asOwnerSqlOut(`select count(*) from public.progression_proposal_snapshots where athlete_user_id = '${ATHLETE_A}';`));
    if (before !== after) throw new Error(`a replayed push created a new row: ${before} -> ${after}`);
  });

  check('FINDING (idempotency omits domain): a strength and a conditioning proposal sharing a key and timestamp do not collide', () => {
    const before = lastLine(asOwnerSqlOut(`select count(*) from public.progression_proposal_snapshots where athlete_user_id = '${ATHLETE_A}';`));
    pushProposal(ATHLETE_A, ORG_1, 'conditioning', 'Row 2k', 'strength:sq', null,
      '{"level":3}', 'medium', false, 'hold', '2026-08-08T00:00:00Z');
    const after = lastLine(asOwnerSqlOut(`select count(*) from public.progression_proposal_snapshots where athlete_user_id = '${ATHLETE_A}';`));
    if (Number(after) !== Number(before) + 1) {
      throw new Error(`a conditioning proposal sharing a key/timestamp with a strength one collided instead of coexisting: ${before} -> ${after}`);
    }
  });

  check('FINDING (safety signal reaches the reviewer): a hard proposal is visible as hard to the coach', () => {
    pushProposal(ATHLETE_A, ORG_1, 'strength', 'Deadlift (pain hold)', 'strength:dl', null,
      '{"kg":140}', 'low', true, 'review', '2026-08-08T00:00:00Z');
    const out = lastLine(asAthlete(COACH_1,
      `select bool_or(hard) from public.get_athlete_progression_proposals('${ORG_1}', '${ATHLETE_A}');`));
    if (out !== 't') throw new Error('a hard=true proposal did not reach the coach as hard=true');
  });

  check('PROGRESSION: a same-org coach who does not coach this athlete is refused', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform count(*) from public.get_athlete_progression_proposals('${ORG_1}', '${ATHLETE_A}')`));
    if (!wasRefused(out)) throw new Error('a non-coaching coach read the progression proposals');
  });

  let progressionDecision;
  check('PROGRESSION: a coach can approve a pending proposal', () => {
    const out = lastLine(asAthlete(COACH_1,
      `select kind from public.decide_progression_proposal('${ORG_1}', '${ATHLETE_A}', '${proposalIdA}', 'approved', 'decide-1');`));
    if (out !== 'progression_approved') throw new Error(`expected progression_approved, got ${out}`);
    const status = lastLine(asOwnerSqlOut(`select status from public.progression_proposal_snapshots where id = '${proposalIdA}';`));
    if (status !== 'approved') throw new Error(`proposal status did not flip to approved: ${status}`);
    progressionDecision = true;
  });

  check('PROGRESSION: a replayed decision returns the original, does not re-decide', () => {
    if (!progressionDecision) throw new Error('setup failed: no prior decision to replay');
    const out = asAthlete(COACH_1,
      `select kind from public.decide_progression_proposal('${ORG_1}', '${ATHLETE_A}', '${proposalIdA}', 'approved', 'decide-1');`);
    if (!out.includes('progression_approved')) throw new Error('a replayed decision did not return the original');
  });

  check('PROGRESSION: an already-decided proposal cannot be decided again under a new key', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.decide_progression_proposal('${ORG_1}', '${ATHLETE_A}', '${proposalIdA}', 'declined', 'decide-2')`));
    if (!wasRefused(out)) throw new Error('an already-decided proposal was decided a second time');
  });

  check('PROGRESSION: a non-coaching coach cannot decide', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.decide_progression_proposal('${ORG_1}', '${ATHLETE_A}', '${proposalIdA}', 'approved', 'decide-3')`));
    if (!wasRefused(out)) throw new Error('a non-coaching coach decided a proposal');
  });

  check('PROGRESSION: a coach cannot decide a proposal under the WRONG athlete', () => {
    /* COACH_1 coaches both ATHLETE_A and ATHLETE_E. proposalIdA belongs to
       ATHLETE_A -- deciding it while claiming ATHLETE_E must be refused, the
       same cross-athlete shape the workout-library CRITICAL finding closed. */
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.decide_progression_proposal('${ORG_1}', '${ATHLETE_E}', '${proposalIdA}', 'approved', 'decide-4')`));
    if (!wasRefused(out)) throw new Error("a proposal was decided under an athlete it doesn't belong to");
  });

  console.log('\nARC — athlete trend snapshots:\n');

  check('TRENDS: the athlete pushes a trend series and the coach reads the latest', () => {
    asAthlete(ATHLETE_A, `select public.push_trend_snapshot('${ORG_1}', 'lift_trend', '[{"date":"2026-08-01","e1rm":100}]'::jsonb, '2026-08-01T00:00:00Z'::timestamptz);`);
    asAthlete(ATHLETE_A, `select public.push_trend_snapshot('${ORG_1}', 'lift_trend', '[{"date":"2026-08-08","e1rm":102}]'::jsonb, '2026-08-08T00:00:00Z'::timestamptz);`);
    const out = lastLine(asAthlete(COACH_1,
      `select points::text from public.get_athlete_trend_series('${ORG_1}', '${ATHLETE_A}', 'lift_trend');`));
    if (!out.includes('102')) throw new Error(`expected the MOST RECENT trend snapshot, got: ${out}`);
  });

  check('TRENDS: a non-coaching coach is refused', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.get_athlete_trend_series('${ORG_1}', '${ATHLETE_A}', 'lift_trend')`));
    if (!wasRefused(out)) throw new Error('a non-coaching coach read a trend series');
  });

  console.log('\nARC — nutrition review, two tiers:\n');

  asOwnerSql(`
    insert into public.daily_log_status (user_id, log_date, status) values
      ('${ATHLETE_A}', '2026-08-10', 'complete'), ('${ATHLETE_A}', '2026-08-11', 'partial');
    insert into public.weight_entries (user_id, measured_at, weight_kg) values
      ('${ATHLETE_A}', '2026-08-10T07:00:00Z', 82.4);
    insert into public.expenditure_estimates (user_id, window_start, window_end, estimate_kcal, trend_slope_kg_per_week, confidence, state)
      values ('${ATHLETE_A}', '2026-08-01', '2026-08-14', 2600, -0.2, 'medium', 'updating');`);

  check('NUTRITION SUMMARY: a coach reads counts and computed signals with no grant needed', () => {
    const out = lastLine(asAthlete(COACH_1,
      `select logged_days || '/' || trend_direction || '/' || estimate_confidence
         from public.get_athlete_nutrition_summary('${ORG_1}', '${ATHLETE_A}', date '2026-08-10');`));
    if (out !== '2/losing/medium') throw new Error(`expected 2/losing/medium, got ${out}`);
  });

  check('NUTRITION WINDOW: refused without a consent grant, even though the coach really coaches this athlete', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.get_athlete_nutrition_window('${ORG_1}', '${ATHLETE_A}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error('raw nutrition detail was readable with no consent grant at all');
  });

  check("NUTRITION GRANT: an athlete cannot grant access to someone who isn't actually their coach", () => {
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.set_nutrition_read_grant('${ORG_1}', '${COACH_3}', true)`));
    if (!wasRefused(out)) throw new Error('a grant was created for a non-coach');
  });

  check('NUTRITION WINDOW: readable once granted, and every read is logged to coach_read_audit', () => {
    asAthlete(ATHLETE_A, `select public.set_nutrition_read_grant('${ORG_1}', '${COACH_1}', true);`);
    const out = lastLine(asAthlete(COACH_1,
      `select (result->'dailyStatus') is not null from public.get_athlete_nutrition_window('${ORG_1}', '${ATHLETE_A}', date '2026-08-10') as result;`));
    if (out !== 't') throw new Error('a granted coach could not read the nutrition window');
    const logged = lastLine(asOwnerSqlOut(
      `select count(*) from public.coach_read_audit where athlete_user_id = '${ATHLETE_A}' and rpc_name = 'get_athlete_nutrition_window';`));
    if (logged === '0') throw new Error('a raw nutrition read was not logged to coach_read_audit');
  });

  check('NUTRITION WINDOW: the athlete can see the audit log of who read their data', () => {
    const out = lastLine(asAthlete(ATHLETE_A,
      `select count(*) from public.coach_read_audit where athlete_user_id = '${ATHLETE_A}';`));
    if (out === '0') throw new Error("the athlete could not see the audit log of reads on their own data");
  });

  check('FINDING (nutrition gate not AND-ed): revoking the grant refuses the very next read, live', () => {
    asAthlete(ATHLETE_A, `select public.set_nutrition_read_grant('${ORG_1}', '${COACH_1}', false);`);
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.get_athlete_nutrition_window('${ORG_1}', '${ATHLETE_A}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error('a revoked coach could still read the nutrition window');
  });

  console.log('\nARC — the read-only week plan and session detail:\n');

  asOwnerSql(`
    insert into public.athlete_weekly_plans (user_id, week_start, plan) values
      ('${ATHLETE_A}', '2026-08-10', '${JSON.stringify({
        entries: [{ proposalId: 'p1', domain: 'strength', date: '2026-08-11', status: 'scheduled', title: 'Squat day' }],
        decisions: [{ proposalId: 'p1', action: 'scheduled', reasonCode: 'accepted', explanation: 'Placed without violating safety, spacing or interference rules.' }],
      }).replace(/'/g, "''")}'::jsonb)
      on conflict (user_id, week_start) do update set plan = excluded.plan;`);

  check('WEEK PLAN: a coach reads entries, decisions and session summaries for the week', () => {
    const out = lastLine(asAthlete(COACH_1,
      `select jsonb_array_length(result->'plan'->'entries') || '/' || jsonb_array_length(result->'sessions')
         from public.get_athlete_week_plan('${ORG_1}', '${ATHLETE_A}', date '2026-08-10') as result;`));
    const [entries, sessions] = out.split('/');
    if (entries !== '1') throw new Error(`expected 1 plan entry, got ${entries}`);
    if (Number(sessions) < 1) throw new Error(`expected at least 1 session summary, got ${sessions}`);
  });

  check('WEEK PLAN: a malformed weekly plan degrades to empty structures rather than aborting', () => {
    asOwnerSql(`
      insert into public.athlete_weekly_plans (user_id, week_start, plan) values
        ('${ATHLETE_E}', '2026-08-10', '{"entries":"not an array","decisions":42}'::jsonb)
      on conflict (user_id, week_start) do update set plan = excluded.plan;`);
    const out = lastLine(asAthlete(COACH_3,
      `select jsonb_array_length(result->'plan'->'entries') || '/' || jsonb_array_length(result->'plan'->'decisions')
         from public.get_athlete_week_plan('${ORG_1}', '${ATHLETE_E}', date '2026-08-10') as result;`));
    if (out !== '0/0') throw new Error(`expected 0/0 from a malformed plan, got ${out}`);
  });

  check('WEEK PLAN: a non-coaching coach gets nothing', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.get_athlete_week_plan('${ORG_1}', '${ATHLETE_A}', date '2026-08-10')`));
    if (!wasRefused(out)) throw new Error('a non-coaching coach read the week plan');
  });

  check('SESSION DETAIL: a coach can request one session and the read is audited', () => {
    const sessionId = lastLine(asAthlete(COACH_1,
      `select result->'sessions'->0->>'id' from public.get_athlete_week_plan('${ORG_1}', '${ATHLETE_A}', date '2026-08-10') as result;`));
    if (!sessionId) throw new Error('setup failed: no session id available to request detail for');
    const detail = lastLine(asAthlete(COACH_1,
      `select (public.request_session_detail('${ORG_1}', '${ATHLETE_A}', '${sessionId}') ->> 'id');`));
    if (detail !== sessionId) throw new Error(`expected session ${sessionId}, got ${detail}`);
    const logged = lastLine(asOwnerSqlOut(
      `select count(*) from public.coach_read_audit where athlete_user_id = '${ATHLETE_A}' and rpc_name = 'request_session_detail';`));
    if (logged === '0') throw new Error('session detail read was not logged');
  });

  check('SESSION DETAIL: a non-existent session id is refused, not silently null', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.request_session_detail('${ORG_1}', '${ATHLETE_A}', 'does-not-exist')`));
    if (!wasRefused(out)) throw new Error('a non-existent session id was accepted');
  });

  check('SESSION DETAIL: a non-coaching coach is refused', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.request_session_detail('${ORG_1}', '${ATHLETE_A}', 's1')`));
    if (!wasRefused(out)) throw new Error('a non-coaching coach read session detail');
  });

  /* ---------------------------------------------------------------------
   * ARC — the assignment lifecycle. Every prior test left an assignment in
   * 'draft' forever; these prove the missing accept/decline half.
   * ------------------------------------------------------------------- */
  console.log('\nARC — the assignment lifecycle (accept / decline):\n');

  const LIFECYCLE_ASSIGN = '9a9a9a9a-9a9a-9a9a-9a9a-9a9a9a9a9a9a';
  asOwnerSql(`
    insert into public.program_assignments (id, organization_id, athlete_user_id, template_version_id, preferred_start_date, preferred_weekdays, created_by)
      values ('${LIFECYCLE_ASSIGN}', '${ORG_1}', '${ATHLETE_A}', '${TPLV}', date '2026-09-14', '{1,3,5}', '${COACH_1}');`);

  check('LIFECYCLE: it starts in draft, per create_program_assignment, and no other command moves it', () => {
    const state = lastLine(asOwnerSqlOut(`select state from public.program_assignments where id = '${LIFECYCLE_ASSIGN}';`));
    if (state !== 'draft') throw new Error(`expected a fresh assignment to start in draft, got ${state}`);
  });

  check("LIFECYCLE: a coach cannot accept an athlete's assignment — consent is the athlete's alone", () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.accept_program_assignment('${ORG_1}', '${LIFECYCLE_ASSIGN}', 'accept-wrong-actor')`));
    if (!wasRefused(out)) throw new Error("a coach accepted their athlete's own assignment");
  });

  check("LIFECYCLE: a different athlete cannot accept someone else's assignment", () => {
    const out = asAthlete(ATHLETE_B, refusalProbe(
      `perform public.accept_program_assignment('${ORG_1}', '${LIFECYCLE_ASSIGN}', 'accept-wrong-athlete')`));
    if (!wasRefused(out)) throw new Error("athlete B accepted athlete A's assignment");
  });

  check('LIFECYCLE: the athlete accepts, and it writes a decision and a receipt', () => {
    const state = lastLine(asAthlete(ATHLETE_A,
      `select state from public.accept_program_assignment('${ORG_1}', '${LIFECYCLE_ASSIGN}', 'accept-1');`));
    if (state !== 'accepted') throw new Error(`expected accepted, got ${state}`);
    const counts = lastLine(asOwnerSqlOut(
      `select (select count(*) from public.coach_decisions where organization_id = '${ORG_1}' and athlete_user_id = '${ATHLETE_A}' and kind = 'assignment_accepted' and idempotency_key = 'accept-1')
           || '/' || (select count(*) from public.decision_receipts r join public.coach_decisions d on d.id = r.decision_id where d.idempotency_key = 'accept-1');`));
    if (counts !== '1/1') throw new Error(`expected one decision and one receipt, got ${counts}`);
  });

  check('LIFECYCLE: a replayed accept returns the original, does not re-decide', () => {
    const out = asAthlete(ATHLETE_A, `select state from public.accept_program_assignment('${ORG_1}', '${LIFECYCLE_ASSIGN}', 'accept-1');`);
    if (!out.includes('accepted')) throw new Error('a replayed accept did not return the original state');
    const count = lastLine(asOwnerSqlOut(
      `select count(*) from public.coach_decisions where idempotency_key = 'accept-1';`));
    if (count !== '1') throw new Error(`the replay created ${count} decisions`);
  });

  check('LIFECYCLE: an already-accepted assignment cannot be accepted again under a new key, nor declined', () => {
    const acceptOut = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.accept_program_assignment('${ORG_1}', '${LIFECYCLE_ASSIGN}', 'accept-2')`));
    if (!wasRefused(acceptOut)) throw new Error('an already-accepted assignment was accepted again');
    const declineOut = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.decline_program_assignment('${ORG_1}', '${LIFECYCLE_ASSIGN}', 'decline-1')`));
    if (!wasRefused(declineOut)) throw new Error('an already-accepted assignment was declined');
  });

  check('LIFECYCLE: decline moves a fresh assignment to withdrawn, with its own decision and receipt', () => {
    const declineAssign = '9b9b9b9b-9b9b-9b9b-9b9b-9b9b9b9b9b9b';
    asOwnerSql(`
      insert into public.program_assignments (id, organization_id, athlete_user_id, template_version_id, preferred_start_date, preferred_weekdays, created_by)
        values ('${declineAssign}', '${ORG_1}', '${ATHLETE_A}', '${TPLV}', date '2026-09-15', '{2,4}', '${COACH_1}');`);
    const state = lastLine(asAthlete(ATHLETE_A,
      `select state from public.decline_program_assignment('${ORG_1}', '${declineAssign}', 'decline-2');`));
    if (state !== 'withdrawn') throw new Error(`expected withdrawn, got ${state}`);
    const counts = lastLine(asOwnerSqlOut(
      `select (select count(*) from public.coach_decisions where kind = 'assignment_withdrawn' and idempotency_key = 'decline-2')
           || '/' || (select count(*) from public.decision_receipts r join public.coach_decisions d on d.id = r.decision_id where d.idempotency_key = 'decline-2');`));
    if (counts !== '1/1') throw new Error(`expected one decision and one receipt, got ${counts}`);
  });

  /* ---------------------------------------------------------------------
   * ARC — visibility into what auto-coach did (docs/RISK_REGISTER.md R3).
   * Mirrors the trend-snapshot suite's shape: push is athlete-only, read is
   * coach-only, and a replay must not duplicate.
   * ------------------------------------------------------------------- */
  console.log('\nARC — autonomous adjustment receipts:\n');

  const AC_OPS = `'[{"type":"drop_set","targetPath":"blocks[0].exercises[1]","before":"3x8","after":"2x8","reasonCode":"pain_flag","materiality":"material","reversible":true}]'::jsonb`;

  check('AUTOCOACH RECEIPT: the athlete pushes a receipt and the coach reads it', () => {
    asAthlete(ATHLETE_A, `select public.push_autocoach_receipt('${ORG_1}', 'ac-1', '2026-08-08T10:00:00Z'::timestamptz, date '2026-08-08', 'w1', 'applied', false, ${AC_OPS}, array['pain_flag']);`);
    const out = lastLine(asAthlete(COACH_1,
      `select count(*)::text from public.get_athlete_autocoach_receipts('${ORG_1}', '${ATHLETE_A}');`));
    if (out !== '1') throw new Error(`expected 1 receipt visible to the coach, got ${out}`);
  });

  check('AUTOCOACH RECEIPT: a replayed push returns the original, does not duplicate', () => {
    asAthlete(ATHLETE_A, `select public.push_autocoach_receipt('${ORG_1}', 'ac-1', '2026-08-08T10:00:00Z'::timestamptz, date '2026-08-08', 'w1', 'applied', false, ${AC_OPS}, array['pain_flag']);`);
    const out = lastLine(asAthlete(COACH_1,
      `select count(*)::text from public.get_athlete_autocoach_receipts('${ORG_1}', '${ATHLETE_A}');`));
    if (out !== '1') throw new Error(`expected the replay to leave exactly 1 row, got ${out}`);
  });

  check('AUTOCOACH RECEIPT: a coach cannot push on the athlete\'s behalf', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'ac-coach-attempt', now(), current_date, 'w1', 'applied', false, '[]'::jsonb, '{}')`));
    if (!wasRefused(out)) throw new Error('a coach pushed a receipt as if they were the athlete');
  });

  check('AUTOCOACH RECEIPT: a non-coaching coach cannot read', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.get_athlete_autocoach_receipts('${ORG_1}', '${ATHLETE_A}')`));
    if (!wasRefused(out)) throw new Error('a non-coaching coach read autocoach receipts');
  });

  check('AUTOCOACH RECEIPT: a coach in another organisation cannot read', () => {
    const out = asAthlete(COACH_2, refusalProbe(
      `perform public.get_athlete_autocoach_receipts('${ORG_1}', '${ATHLETE_A}')`));
    if (!wasRefused(out)) throw new Error("org 2's coach read org 1's autocoach receipts");
  });

  check('AUTOCOACH RECEIPT: an athlete cannot push into an organisation they are not enrolled in', () => {
    const out = asAthlete(ATHLETE_B, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'ac-wrong-org', now(), current_date, 'w1', 'applied', false, '[]'::jsonb, '{}')`));
    if (!wasRefused(out)) throw new Error('athlete B pushed a receipt into org 1, which they are not a member of');
  });

  check('AUTOCOACH RECEIPT: invalid action is refused, not silently coerced', () => {
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'ac-bad-action', now(), current_date, 'w1', 'sabotage', false, '[]'::jsonb, '{}')`));
    if (!wasRefused(out)) throw new Error('an invalid action value was accepted');
  });

  /* ---------------------------------------------------------------------
   * Immutability's two remaining holes. Both are destructive, so they run
   * last: the erasure test really does delete an organisation.
   * ------------------------------------------------------------------- */
  console.log('\nARC — immutability, erasure and the statements that go around both:\n');

  check('TRUNCATE cannot empty the audit trail — row triggers do not fire for it', () => {
    for (const t of ['coach_decisions', 'decision_receipts', 'program_template_versions', 'assignment_input_versions']) {
      const out = asOwnerProbe(`truncate table public.${t} cascade`);
      if (!wasRefused(out)) throw new Error(`${t} was truncated past its immutability trigger`);
    }
  });

  check('ERASURE STILL WORKS: removing the organisation cascades through the immutable records', () => {
    /* An audit record that cannot be deleted under ANY circumstance makes an
       erasure request impossible to satisfy — the cascade hits the trigger and
       the whole statement rolls back. The trigger therefore yields only when
       the parent it describes is already gone, which is exactly what a cascade
       looks like from inside it. */
    const out = asOwnerProbe(`delete from public.organizations where id = '${ORG_2}'`);
    if (!out.includes('ACCEPTED')) {
      throw new Error(`an organisation could not be deleted, so erasure is impossible: ${lastLine(out)}`);
    }
    const left = lastLine(asOwnerSqlOut(
      `select count(*) from public.coach_decisions where organization_id = '${ORG_2}';`));
    if (left !== '0') throw new Error(`${left} decision(s) survived the organisation's deletion`);
  });

  check('and a DIRECT delete is still refused, so the erasure hole is only that', () => {
    const out = asOwnerProbe(`delete from public.coach_decisions where id = '${DECISION}'`);
    if (!wasRefused(out)) throw new Error('a decision was deleted while its organisation and athlete still existed');
  });

} finally {
  try { asOwner(`pg_ctl -D ${dir}/data stop -m immediate`); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll migration checks passed.');
process.exit(failures ? 1 : 0);
