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
/*
 * KNOWN ENVIRONMENT GAPS — counted separately from failures, on purpose.
 *
 * pgvector (20260819_phase_f_knowledge_base's `create extension vector`) is a
 * COMPILED extension: it ships as its own package
 * (postgresql-<ver>-pgvector), not with the postgres this check borrows from
 * whatever machine it runs on. From 18 August 2026 the check was permanently
 * red anywhere that package was absent — which was everywhere, CI included —
 * and a check that is always red hides every NEW failure behind the one it
 * already reports. Red has to mean something.
 *
 * So a missing pgvector is named, printed loudly, and NOT counted as a
 * failure: the run exits green when that is the only problem, and red for
 * anything else. It is not allowed to pass silently in CI either — the
 * workflow installs postgresql-<ver>-pgvector before this step and greps the
 * output for `KNOWN ENVIRONMENT GAP`, failing the build if the marker
 * appears there: on the runner the extension IS installed, so a gap there
 * means the install broke, not the environment.
 *
 * The cost, stated plainly: on a machine without pgvector the phase F
 * migration does not apply, so nothing it creates exists for later probes.
 * Any future behaviour test against those objects must tolerate their
 * absence when `knownGaps > 0`, or the gap stops being green-capable.
 */
let knownGaps = 0;
const KNOWN_GAPS = [
  { pattern: /extension "vector" is not available/, name: 'pgvector is not installed (apt: postgresql-<ver>-pgvector)' },
];
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
    try {
      psql(`-q -f ${join(dir, f)}`);
      console.log(`  PASS — applies ${f}`);
    } catch (e) {
      const out = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
      const gap = KNOWN_GAPS.find((g) => g.pattern.test(out));
      if (gap) {
        knownGaps++;
        console.error(`  KNOWN ENVIRONMENT GAP — ${f} did not apply: ${gap.name}.`);
        console.error('      Not counted as a failure (see the knownGaps comment above), but nothing');
        console.error('      this migration creates exists for the rest of this run. CI installs the');
        console.error('      extension and FAILS on this marker, so the migration is still proven there.');
      } else {
        failures++;
        console.error(`  FAIL — applies ${f}: ${String(e.message || e).split('\n').slice(0, 3).join(' ')}`);
      }
    }
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

  // No `before`/`after`/`reversible` -- push_autocoach_receipt only accepts
  // these exact four keys, all closed vocabulary except targetPath/reasonCode
  // (see the migration's own header comment for why: a first draft carried
  // the raw exercise name through `before`/`after`, caught by adversarial
  // review before this ever reached a real coach).
  const AC_OPS = `'[{"type":"cap_intensity","targetPath":"blocks[0].exercises[1]","reasonCode":"low_readiness","materiality":"material"}]'::jsonb`;

  check('AUTOCOACH RECEIPT: the athlete pushes a receipt and the coach reads it', () => {
    asAthlete(ATHLETE_A, `select public.push_autocoach_receipt('${ORG_1}', 'ac-1', '2026-08-08T10:00:00Z'::timestamptz, date '2026-08-08', 'w1', 'applied', false, ${AC_OPS}, array['pain_hold_active']);`);
    const out = lastLine(asAthlete(COACH_1,
      `select count(*)::text from public.get_athlete_autocoach_receipts('${ORG_1}', '${ATHLETE_A}');`));
    if (out !== '1') throw new Error(`expected 1 receipt visible to the coach, got ${out}`);
  });

  check('AUTOCOACH RECEIPT: a replayed push returns the original, does not duplicate', () => {
    asAthlete(ATHLETE_A, `select public.push_autocoach_receipt('${ORG_1}', 'ac-1', '2026-08-08T10:00:00Z'::timestamptz, date '2026-08-08', 'w1', 'applied', false, ${AC_OPS}, array['pain_hold_active']);`);
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

  check('FINDING (block/set content leak): before/after are refused, even bypassing the client sanitiser', () => {
    /* The adversarial finding this migration was fixed for: raw calls to
       push_autocoach_receipt are reachable directly (EXECUTE granted to every
       athlete member), so the server, not just arc-athlete-sync.ts's
       sanitizeReceiptOperations, must refuse an operation carrying the raw
       exercise name a `before`/`after` field could smuggle through. */
    const withBeforeAfter = `'[{"type":"cap_intensity","targetPath":"blocks[0]","reasonCode":"low_readiness","materiality":"material","before":"Bulgarian Split Squat above @7","after":"Bulgarian Split Squat capped @7"}]'::jsonb`;
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'ac-leak-attempt', now(), current_date, 'w1', 'applied', false, ${withBeforeAfter}, '{}')`));
    if (!wasRefused(out)) throw new Error('an operation carrying before/after (raw exercise content) was accepted');
  });

  check('AUTOCOACH RECEIPT: an unrecognised operation type is refused', () => {
    const badType = `'[{"type":"sabotage","targetPath":"blocks[0]","reasonCode":"low_readiness","materiality":"material"}]'::jsonb`;
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'ac-bad-type', now(), current_date, 'w1', 'applied', false, ${badType}, '{}')`));
    if (!wasRefused(out)) throw new Error('an unrecognised operation type was accepted');
  });

  check('AUTOCOACH RECEIPT: an unrecognised reason code is refused', () => {
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'ac-bad-reason', now(), current_date, 'w1', 'applied', false, '[]'::jsonb, array['sabotage'])`));
    if (!wasRefused(out)) throw new Error('an unrecognised reason code was accepted');
  });

  check('AUTOCOACH RECEIPT: an implausible far-future occurred_at is refused', () => {
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'ac-future', '9999-01-01T00:00:00Z'::timestamptz, date '2026-08-08', 'w1', 'applied', false, '[]'::jsonb, '{}')`));
    if (!wasRefused(out)) throw new Error('an implausible occurred_at was accepted, letting it sort first forever');
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

  /* ---------------------------------------------------------------------
   * The still-open half of the erasure gap, now closed:
   * coach_decisions.actor_user_id was `not null ... on delete restrict`,
   * which blocked deleting a COACH's auth.users row outright. A minimal,
   * actor-ONLY fixture user is used here on purpose — COACH_1 is also
   * `organizations.created_by`/`program_templates.created_by`/etc., all
   * SEPARATELY `on delete restrict`, and deleting COACH_1 would hit one of
   * those first, proving nothing about the specific fix this migration
   * makes. ERASABLE_COACH_1/2 exist ONLY as a coach_decisions actor.
   * ------------------------------------------------------------------- */
  const ERASABLE_COACH_1 = 'ea5ab1e0-0001-0001-0001-ea5ab1e00001';
  const ERASABLE_COACH_2 = 'ea5ab1e0-0002-0002-0002-ea5ab1e00002';
  const ERASURE_DECISION_1 = '9c9c9c9c-0001-0001-0001-9c9c9c9c0001';
  const ERASURE_DECISION_2 = '9c9c9c9c-0002-0002-0002-9c9c9c9c0002';
  asOwnerSql(`
    insert into auth.users (id) values ('${ERASABLE_COACH_1}'), ('${ERASABLE_COACH_2}') on conflict do nothing;
    insert into public.coach_decisions (id, organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
      values ('${ERASURE_DECISION_1}', '${ORG_1}', '${ATHLETE_A}', '${ERASABLE_COACH_1}', 'assignment_created', 'erasure-test-1');
    insert into public.coach_decisions (id, organization_id, athlete_user_id, actor_user_id, kind, idempotency_key)
      values ('${ERASURE_DECISION_2}', '${ORG_1}', '${ATHLETE_A}', '${ERASABLE_COACH_2}', 'assignment_created', 'erasure-test-2');`);

  check('ERASURE (actor): deleting a COACH erases actor_user_id, not the decision', () => {
    const out = asOwnerProbe(`delete from auth.users where id = '${ERASABLE_COACH_1}'`);
    if (!out.includes('ACCEPTED')) throw new Error(`the coach could not be erased: ${lastLine(out)}`);
    const actor = lastLine(asOwnerSqlOut(
      `select coalesce(actor_user_id::text, 'NULL') from public.coach_decisions where id = '${ERASURE_DECISION_1}';`));
    if (actor !== 'NULL') throw new Error(`expected actor_user_id nulled, got ${actor}`);
    const stillThere = lastLine(asOwnerSqlOut(
      `select count(*) from public.coach_decisions where id = '${ERASURE_DECISION_1}';`));
    if (stillThere !== '1') throw new Error('the decision row itself was lost, not just its actor');
  });

  check('ERASURE (actor): the escape hatch permits ONLY the actor moving to null, nothing else riding along', () => {
    /* ERASABLE_COACH_2's row still has a non-null actor -- a genuinely
       erasure-shaped update (actor_user_id -> null) that ALSO changes `kind`
       in the same statement must still be refused, proving the escape hatch
       checks every other column, not just that the actor went null. */
    const out = asOwnerProbe(
      `update public.coach_decisions set actor_user_id = null, kind = 'progression_approved' where id = '${ERASURE_DECISION_2}'`);
    if (!wasRefused(out)) throw new Error('an update smuggled a kind change alongside actor erasure');
    const kind = lastLine(asOwnerSqlOut(`select kind from public.coach_decisions where id = '${ERASURE_DECISION_2}';`));
    if (kind !== 'assignment_created') throw new Error(`kind changed to ${kind} despite the refusal`);
  });

  check('ERASURE (actor): a payload change riding along with actor erasure is also refused', () => {
    /* The `kind` test above proves ONE column is still checked. Payload is a
       DIFFERENT column, checked by a different clause in the schema-generic
       jsonb diff -- this is the concrete regression an adversarial review
       named: an edit that accidentally dropped just the payload comparison
       would stay green if `kind` were the only column ever exercised. */
    const out = asOwnerProbe(
      `update public.coach_decisions set actor_user_id = null, payload = '{"forged":true}'::jsonb where id = '${ERASURE_DECISION_2}'`);
    if (!wasRefused(out)) throw new Error('a payload change was smuggled in alongside actor erasure');
  });

  check('ERASURE (actor): the escape hatch refuses actor REASSIGNMENT, only ever a null', () => {
    /* The design decision this migration makes is explicit: anonymise the
       actor, never transfer it. Moving actor_user_id from one real coach to
       ANOTHER real coach must be refused exactly like any other mutation --
       there is no legitimate reason a decision's actor would change to a
       different living identity. */
    const out = asOwnerProbe(
      `update public.coach_decisions set actor_user_id = '${ERASABLE_COACH_1}' where id = '${ERASURE_DECISION_2}'`);
    if (!wasRefused(out)) throw new Error('actor_user_id was reassigned to a different identity instead of only being nulled');
  });

  /* ---------------------------------------------------------------------
   * ERASURE (creators): the other five `on delete restrict` columns
   * docs/RISK_REGISTER.md named as still open when the actor fix shipped.
   * ONE erasable coach seeds a row on every affected table so a single
   * account deletion proves every column nulls out together, the same
   * shape a real erasure request looks like. A SEPARATE coach seeds the
   * two triggered tables' escape-hatch negative tests, so `old.<col>` is
   * still non-null when the smuggled update runs.
   * ------------------------------------------------------------------- */
  const ERASABLE_COACH_3 = 'ea5ab1e0-0003-0003-0003-ea5ab1e00003';
  const ERASABLE_COACH_4 = 'ea5ab1e0-0004-0004-0004-ea5ab1e00004';
  const ERASE_ORG = '9d9d9d9d-0001-0001-0001-9d9d9d9d0001';
  const ERASE_TPL = '9d9d9d9d-0002-0002-0002-9d9d9d9d0002';
  const ERASE_TPLV = '9d9d9d9d-0003-0003-0003-9d9d9d9d0003';
  const ERASE_BLOCK = '9d9d9d9d-0004-0004-0004-9d9d9d9d0004';
  const ERASE_ASSIGN = '9d9d9d9d-0005-0005-0005-9d9d9d9d0005';
  const ERASE_INPUT = '9d9d9d9d-0006-0006-0006-9d9d9d9d0006';
  const ERASE_TPLV_2 = '9d9d9d9d-0007-0007-0007-9d9d9d9d0007';
  const ERASE_INPUT_2 = '9d9d9d9d-0008-0008-0008-9d9d9d9d0008';
  asOwnerSql(`
    insert into auth.users (id) values ('${ERASABLE_COACH_3}'), ('${ERASABLE_COACH_4}') on conflict do nothing;
    insert into public.organizations (id, name, created_by) values ('${ERASE_ORG}', 'Erasure Test Org', '${ERASABLE_COACH_3}');
    insert into public.program_templates (id, organization_id, domain, name, created_by)
      values ('${ERASE_TPL}', '${ORG_1}', 'strength', 'Erasure Test Template', '${ERASABLE_COACH_3}');
    insert into public.program_template_versions (id, template_id, version, published_by)
      values ('${ERASE_TPLV}', '${ERASE_TPL}', 1, '${ERASABLE_COACH_3}');
    insert into public.training_block_templates (id, organization_id, domain, name, created_by)
      values ('${ERASE_BLOCK}', '${ORG_1}', 'strength', 'Erasure Test Block', '${ERASABLE_COACH_3}');
    insert into public.program_assignments (id, organization_id, athlete_user_id, template_version_id, preferred_start_date, preferred_weekdays, created_by)
      values ('${ERASE_ASSIGN}', '${ORG_1}', '${ATHLETE_A}', '${TPLV}', date '2026-10-01', '{1,3}', '${ERASABLE_COACH_3}');
    insert into public.assignment_input_versions (id, assignment_id, version, created_by)
      values ('${ERASE_INPUT}', '${ERASE_ASSIGN}', 1, '${ERASABLE_COACH_3}');
    insert into public.program_template_versions (id, template_id, version, published_by)
      values ('${ERASE_TPLV_2}', '${ERASE_TPL}', 2, '${ERASABLE_COACH_4}');
    insert into public.assignment_input_versions (id, assignment_id, version, created_by)
      values ('${ERASE_INPUT_2}', '${ERASE_ASSIGN}', 2, '${ERASABLE_COACH_4}');`);

  check('ERASURE (creators): deleting a coach nulls every creator/publisher column that names them, across every table, and none of the rows are lost', () => {
    const out = asOwnerProbe(`delete from auth.users where id = '${ERASABLE_COACH_3}'`);
    if (!out.includes('ACCEPTED')) throw new Error(`the coach could not be erased: ${lastLine(out)}`);
    const check6 = lastLine(asOwnerSqlOut(`select
        (select coalesce(created_by::text,'NULL') from public.organizations where id = '${ERASE_ORG}')
        || '/' || (select coalesce(created_by::text,'NULL') from public.program_templates where id = '${ERASE_TPL}')
        || '/' || (select coalesce(published_by::text,'NULL') from public.program_template_versions where id = '${ERASE_TPLV}')
        || '/' || (select coalesce(created_by::text,'NULL') from public.training_block_templates where id = '${ERASE_BLOCK}')
        || '/' || (select coalesce(created_by::text,'NULL') from public.program_assignments where id = '${ERASE_ASSIGN}')
        || '/' || (select coalesce(created_by::text,'NULL') from public.assignment_input_versions where id = '${ERASE_INPUT}');`));
    if (check6 !== 'NULL/NULL/NULL/NULL/NULL/NULL') throw new Error(`expected all six columns null, got ${check6}`);
    const stillThere = lastLine(asOwnerSqlOut(`select
        (select count(*) from public.organizations where id = '${ERASE_ORG}')
        + (select count(*) from public.program_templates where id = '${ERASE_TPL}')
        + (select count(*) from public.program_template_versions where id = '${ERASE_TPLV}')
        + (select count(*) from public.training_block_templates where id = '${ERASE_BLOCK}')
        + (select count(*) from public.program_assignments where id = '${ERASE_ASSIGN}')
        + (select count(*) from public.assignment_input_versions where id = '${ERASE_INPUT}');`));
    if (stillThere !== '6') throw new Error(`expected all six rows to survive, got ${stillThere} of 6`);
  });

  check('ERASURE (creators): program_template_versions escape hatch refuses a rule_set_version change riding along', () => {
    const out = asOwnerProbe(
      `update public.program_template_versions set published_by = null, rule_set_version = 'v2-forged' where id = '${ERASE_TPLV_2}'`);
    if (!wasRefused(out)) throw new Error('a rule_set_version change was smuggled in alongside published_by erasure');
  });

  check('ERASURE (creators): assignment_input_versions escape hatch refuses a proposals change riding along', () => {
    const out = asOwnerProbe(
      `update public.assignment_input_versions set created_by = null, proposals = '[{"forged":true}]'::jsonb where id = '${ERASE_INPUT_2}'`);
    if (!wasRefused(out)) throw new Error('a proposals change was smuggled in alongside created_by erasure');
  });

  /*
   * ---------------------------------------------------------------------
   * Getting onto a roster, and having a name (20260813).
   *
   * The property being proved is the one the whole design rests on: the
   * COACH's half of an invite links nobody, and the ATHLETE's redemption is
   * what writes the row. Every deny here would look like working software if
   * it were broken — a coach who could attach a stranger would simply see an
   * extra athlete, and nothing on the screen would say the athlete never
   * agreed.
   * ------------------------------------------------------------------- */
  console.log('\nARC roster invites and athlete names — the athlete consents:\n');

  const NEWBIE = 'a9a9a9a9-0001-0001-0001-a9a9a9a9a9a9';
  asOwnerSql(`insert into auth.users (id) values ('${NEWBIE}') on conflict do nothing;`);

  const inviteCode = (coach) => lastLine(asOwnerSqlOut(
    `select code from public.coach_athlete_invites where coach_user_id = '${coach}' and accepted_at is null and revoked_at is null order by created_at desc limit 1;`));
  const rosterCount = (coach, athlete) => lastLine(asOwnerSqlOut(
    `select count(*) from public.coach_athlete_assignments where coach_user_id = '${coach}' and athlete_user_id = '${athlete}' and status = 'active';`));

  check('INVITE: a coach can mint a code, and it puts nobody on their roster', () => {
    const out = asAthlete(COACH_1, refusalProbe(`perform public.create_coach_invite('${ORG_1}')`));
    if (!out.includes('ACCEPTED')) throw new Error(`the legitimate mint was refused: ${lastLine(out)}`);
    if (rosterCount(COACH_1, NEWBIE) !== '0') throw new Error('minting an invite attached an athlete — the consent model is inverted');
  });

  check('INVITE: a coach cannot mint into an organisation they do not coach', () => {
    const out = asAthlete(COACH_1, refusalProbe(`perform public.create_coach_invite('${ORG_2}')`));
    if (!wasRefused(out)) throw new Error('a coach minted an invite into another tenant');
  });

  check('INVITE: no other coach can read the code — it is a bearer secret', () => {
    // RLS FILTERS, so this asserts on a COUNT. An empty answer here is the
    // denial; an exception would prove nothing either way.
    const mine = countAs(COACH_1, `from public.coach_athlete_invites where coach_user_id = '${COACH_1}'`);
    if (mine === '0') throw new Error('the legitimate read returned nothing, so the deny below proves nothing');
    const theirs = countAs(COACH_3, `from public.coach_athlete_invites where coach_user_id = '${COACH_1}'`);
    if (theirs !== '0') throw new Error(`a colleague read ${theirs} of another coach's invite codes`);
  });

  check('INVITE: the ATHLETE redeeming it is what creates the roster row', () => {
    const code = inviteCode(COACH_1);
    const out = asAthlete(NEWBIE, refusalProbe(`perform public.redeem_coach_invite('${code}')`));
    if (!out.includes('ACCEPTED')) throw new Error(`the athlete could not redeem: ${lastLine(out)}`);
    if (rosterCount(COACH_1, NEWBIE) !== '1') throw new Error('redemption did not create the roster row');
    // And the row AUTHORISES — an assignment without the athlete-side
    // membership would be a roster entry that every read still filters away.
    const authorised = lastLine(asAthlete(COACH_1, `select public.coaches_athlete('${ORG_1}', '${NEWBIE}');`));
    if (authorised !== 't') throw new Error('the roster row exists but authorises nothing');
  });

  check('INVITE: a code is single-use', () => {
    const code = lastLine(asOwnerSqlOut(
      `select code from public.coach_athlete_invites where accepted_by = '${NEWBIE}' limit 1;`));
    const out = asAthlete(ATHLETE_B, refusalProbe(`perform public.redeem_coach_invite('${code}')`));
    if (!wasRefused(out)) throw new Error('a spent code was redeemed a second time');
  });

  check('INVITE: a revoked code is refused, and revoking cannot unlink a redeemed one', () => {
    asAthlete(COACH_1, `select public.create_coach_invite('${ORG_1}');`);
    const code = inviteCode(COACH_1);
    const id = lastLine(asOwnerSqlOut(`select id from public.coach_athlete_invites where code = '${code}';`));
    const killed = asAthlete(COACH_1, refusalProbe(`perform public.revoke_coach_invite('${id}')`));
    if (!killed.includes('ACCEPTED')) throw new Error(`the coach could not revoke their own code: ${lastLine(killed)}`);
    const out = asAthlete(ATHLETE_B, refusalProbe(`perform public.redeem_coach_invite('${code}')`));
    if (!wasRefused(out)) throw new Error('a revoked code was still redeemable');

    const spent = lastLine(asOwnerSqlOut(`select id from public.coach_athlete_invites where accepted_by = '${NEWBIE}' limit 1;`));
    const refused = asAthlete(COACH_1, refusalProbe(`perform public.revoke_coach_invite('${spent}')`));
    if (!wasRefused(refused)) throw new Error('revoking a spent code was allowed — that would look like unlinking an athlete');
    if (rosterCount(COACH_1, NEWBIE) !== '1') throw new Error('the athlete was unlinked by an invite revocation');
  });

  check('INVITE: an athlete who was REVOKED can rejoin by redeeming a new code', () => {
    /* This check exists because the bug it catches shipped once. The membership
       upsert's `revoked_at = null` looks like tidiness and is not:
       `organization_membership_revoked_at` asserts that the stamp and the
       status agree, so setting `status = 'active'` while a revoked_at is still
       stamped violates it and aborts the WHOLE redemption.

       A retype of `redeem_coach_invite` in 20260814 dropped that clause, and
       every other redeem check here passed — because they all use an athlete
       who is either brand new or has never been revoked. A previously-revoked
       athlete is the ONLY input that reaches the line. */
    asOwnerSql(`update public.organization_memberships
                   set status = 'revoked', revoked_at = now()
                 where organization_id = '${ORG_1}' and user_id = '${NEWBIE}';`);
    const before = lastLine(asOwnerSqlOut(
      `select status from public.organization_memberships
        where organization_id = '${ORG_1}' and user_id = '${NEWBIE}';`));
    if (before !== 'revoked') throw new Error('the setup did not revoke the membership, so this proves nothing');

    asAthlete(COACH_1, `select public.create_coach_invite('${ORG_1}');`);
    const code = inviteCode(COACH_1);
    const out = asAthlete(NEWBIE, refusalProbe(`perform public.redeem_coach_invite('${code}')`));
    if (!out.includes('ACCEPTED')) throw new Error(`a revoked athlete could not rejoin: ${lastLine(out)}`);

    const after = lastLine(asOwnerSqlOut(
      `select status || '|' || coalesce(revoked_at::text, '') from public.organization_memberships
        where organization_id = '${ORG_1}' and user_id = '${NEWBIE}';`));
    if (after !== 'active|') throw new Error(`membership came back as '${after}' — status and stamp must agree`);
    /* And it must AUTHORISE again, not merely exist. */
    const authorised = lastLine(asAthlete(COACH_1, `select public.coaches_athlete('${ORG_1}', '${NEWBIE}');`));
    if (authorised !== 't') throw new Error('the athlete rejoined but the coach still cannot read them');
  });

  check('NAME: the athlete sets their own, and their coach may read it', () => {
    const out = asAthlete(NEWBIE, refusalProbe(`perform public.set_athlete_display_name('Riley Roster')`));
    if (!out.includes('ACCEPTED')) throw new Error(`the athlete could not set their own name: ${lastLine(out)}`);
    const asCoach = lastLine(asAthlete(COACH_1, `select display_name from public.athlete_profiles where user_id = '${NEWBIE}';`));
    if (asCoach !== 'Riley Roster') throw new Error(`the coach read '${asCoach}' instead of the published name`);
  });

  check('NAME: nobody else can read it, however senior', () => {
    // COACH_3 is a legitimate, active coach in the SAME organisation — just
    // not this athlete's. Within-tenant is the boundary that gets forgotten.
    const got = countAs(COACH_3, `from public.athlete_profiles where user_id = '${NEWBIE}'`);
    if (got !== '0') throw new Error('a coach who does not coach this athlete read their name');
  });

  check('NAME: a coach cannot set an athlete’s name, and a blank withdraws it', () => {
    /* Asserted TWICE, and the second half is the one that matters. RLS alone
       would let this UPDATE "succeed" against zero rows — fail-closed, but
       reported as accepted — so the migration revokes the write privilege
       outright and the name is re-read to prove nothing moved either way. */
    const forged = asAthlete(COACH_1, refusalProbe(
      `update public.athlete_profiles set display_name = 'Forged' where user_id = '${NEWBIE}'`));
    if (!wasRefused(forged)) throw new Error('a coach wrote into an athlete profile directly');
    const still = lastLine(asOwnerSqlOut(`select display_name from public.athlete_profiles where user_id = '${NEWBIE}';`));
    if (still !== 'Riley Roster') throw new Error(`the athlete's name became '${still}'`);

    asAthlete(NEWBIE, `select public.set_athlete_display_name(null);`);
    const left = lastLine(asOwnerSqlOut(`select count(*) from public.athlete_profiles where user_id = '${NEWBIE}';`));
    if (left !== '0') throw new Error('the athlete could publish a name but not withdraw it');
  });

  /* ---------------------------------------------------------------------
   * A COACH PUBLISHES THE WEEK.
   *
   * Until 13 August 2026 `athlete_weekly_plans` carried
   * `check (writer = 'coordinator')` — the database physically refused a week
   * written by anything but the athlete's own device. Widening that is the
   * single largest authority change this schema has made, so the checks below
   * are about the two ways it could go wrong quietly rather than loudly:
   * a publish that lands where it should not, and a publish that reports
   * success while changing nothing.
   * ------------------------------------------------------------------- */
  console.log('\nARC coach week publish — the coach owns the week, and it actually lands:\n');

  const MONDAY = '2026-08-17';
  const weekBody = (label) => `'${JSON.stringify({ label, days: [] }).replace(/'/g, "''")}'::jsonb`;
  const planRow = (athlete, field) => lastLine(asOwnerSqlOut(
    `select ${field} from public.athlete_weekly_plans where user_id = '${athlete}' and week_start = '${MONDAY}';`));

  check('WEEK: the coach publishes, and the athlete row becomes theirs', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '${MONDAY}', ${weekBody('v1')}, 'pub:1')`));
    if (!out.includes('ACCEPTED')) throw new Error(`a legitimate publish was refused: ${lastLine(out)}`);
    if (planRow(ATHLETE_A, 'writer') !== 'coach') throw new Error('the week was not marked coach-written');
  });

  check('WEEK: a coach cannot publish to an athlete who is not theirs', () => {
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '${MONDAY}', ${weekBody('intruder')}, 'pub:x')`));
    if (!wasRefused(out)) throw new Error('a coach published into an athlete they do not coach');
    /* Within-tenant, not cross-tenant: COACH_3 is a legitimate ORG_1 coach.
       The deny that matters is the relationship one, not the org one. */
  });

  check('WEEK: the athlete cannot publish their own coach week', () => {
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '${MONDAY}', ${weekBody('self')}, 'pub:self')`));
    if (!wasRefused(out)) throw new Error('an athlete published a coach week for themselves');
  });

  check('WEEK: a replayed publish returns the original, it does not publish twice', () => {
    asAthlete(COACH_1, `select public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '${MONDAY}', ${weekBody('replay')}, 'pub:1');`);
    const versions = lastLine(asOwnerSqlOut(
      `select count(*) from public.coach_week_plan_versions v join public.coach_week_plans p on p.id = v.week_plan_id where p.athlete_user_id = '${ATHLETE_A}' and p.week_start = '${MONDAY}';`));
    if (versions !== '1') throw new Error(`a replay created a second version (${versions} exist)`);
  });

  check('WEEK: the revision STEPS PAST the coordinator, so the publish is not silently discarded', () => {
    /* The failure this exists for: publish_athlete_weekly_plan's upsert only
       wins `where revision < excluded.revision`. A coach publish carrying a
       stale revision succeeds as a statement, changes nothing, and reports
       success — the coach is told it landed and the athlete never sees it.
       Here the athlete's device writes revision 50 AFTER a coach week exists,
       and the next coach publish must clear it rather than tie it. */
    asOwnerSql(`update public.athlete_weekly_plans set revision = 50, writer = 'coordinator' where user_id = '${ATHLETE_A}' and week_start = '${MONDAY}';`);
    asAthlete(COACH_1, `select public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '${MONDAY}', ${weekBody('after-device')}, 'pub:2');`);
    const rev = Number(planRow(ATHLETE_A, 'revision'));
    if (!(rev > 50)) throw new Error(`the coach publish did not clear the device revision (${rev})`);
    if (planRow(ATHLETE_A, 'writer') !== 'coach') throw new Error('the coach publish was silently discarded');
  });

  check('WEEK: the optimistic lock refuses a stale base version', () => {
    const current = Number(lastLine(asOwnerSqlOut(
      `select coalesce(max(v.version), 0) from public.coach_week_plan_versions v join public.coach_week_plans p on p.id = v.week_plan_id where p.athlete_user_id = '${ATHLETE_A}' and p.week_start = '${MONDAY}';`)));
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '${MONDAY}', ${weekBody('stale')}, 'pub:3', ${current - 1})`));
    if (!wasRefused(out)) throw new Error('a stale base version overwrote a newer week');
  });

  check('WEEK: a non-Monday week is refused rather than quietly stored', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '2026-08-19', ${weekBody('wednesday')}, 'pub:4')`));
    if (!wasRefused(out)) throw new Error('a week starting mid-week was accepted, so two weeks can claim the same days');
  });

  check('WEEK: a DEVICE write cannot take a week the coach published', () => {
    /* `publish_athlete_weekly_plan` upserts `writer = 'coordinator'` and, until
       14 August 2026, carried no writer predicate — so any call at a higher
       revision replaced a coach's week, stamped it 'coordinator', and returned
       TRUE. The coach was never told; their week just stopped being the
       athlete's week.

       Latent only by accident: no client has ever called that function. The
       Coordinator's deletion makes a future call more likely to be a mistake
       than a design, which is why the predicate is worth having rather than
       relying on nobody wiring it up. */
    const before = planRow(ATHLETE_A, 'revision');
    const out = lastLine(asAthlete(ATHLETE_A,
      `select public.publish_athlete_weekly_plan('${MONDAY}', 1, 9999, now(), '{"label":"device"}'::jsonb);`));
    if (out !== 'f') throw new Error(`the device write reported '${out}' — it must refuse a coach week, and say so`);
    if (planRow(ATHLETE_A, 'writer') !== 'coach') throw new Error('a device write took the coach week');
    if (planRow(ATHLETE_A, 'revision') !== before) throw new Error('the coach week was modified by a refused write');
  });

  check('WEEK: the same device write still wins when NO coach owns the week', () => {
    /* The other half, or the check above would pass against a function that
       refuses everything. ATHLETE_B has no coach week, so the ordinary
       coordinator path must still work exactly as 20260804 wrote it. */
    const out = lastLine(asAthlete(ATHLETE_B,
      `select public.publish_athlete_weekly_plan('${MONDAY}', 1, 7, now(), '{"label":"device-b"}'::jsonb);`));
    if (out !== 't') throw new Error(`an uncontested device write was refused ('${out}')`);
    if (planRow(ATHLETE_B, 'writer') !== 'coordinator') throw new Error('the device write did not land');
  });

  check('WEEK: a SECOND coach republishing takes the attribution with the body', () => {
    /* `coach_week_plans` is unique on (org, athlete, week) and `coach_user_id`
       was written on INSERT only, so a colleague republishing replaced the
       BODY and left the athlete told the FIRST coach wrote it.
       `readCoachWeekAttribution` reads exactly this column, and a confidently
       wrong name is worse than the null it otherwise degrades to. */
    const first = lastLine(asOwnerSqlOut(
      `select coach_user_id from public.coach_week_plans where athlete_user_id = '${ATHLETE_A}' and week_start = '${MONDAY}';`));
    if (first !== COACH_1) throw new Error(`setup: expected COACH_1 to own the row, found ${first}`);

    /* COACH_3 is legitimate, in the SAME organisation. Put ATHLETE_A on their
       roster so the publish is authorised — that is the whole scenario. */
    asOwnerSql(`insert into public.coach_athlete_assignments (organization_id, coach_user_id, athlete_user_id, status)
                values ('${ORG_1}', '${COACH_3}', '${ATHLETE_A}', 'active')
                on conflict (organization_id, coach_user_id, athlete_user_id) do update set status = 'active', revoked_at = null;`);
    asAthlete(COACH_3, `select public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '${MONDAY}', ${weekBody('by-coach-3')}, 'pub:c3');`);

    const now = lastLine(asOwnerSqlOut(
      `select coach_user_id from public.coach_week_plans where athlete_user_id = '${ATHLETE_A}' and week_start = '${MONDAY}';`));
    if (now !== COACH_3) throw new Error(`the athlete is still told ${now === COACH_1 ? 'the FIRST coach' : now} published a week the second coach wrote`);
    /* And the version row agreed all along — this makes the two consistent
       rather than inventing a new source of truth. */
    const publishedBy = lastLine(asOwnerSqlOut(
      `select v.published_by from public.coach_week_plan_versions v
         join public.coach_week_plans p on p.id = v.week_plan_id
        where p.athlete_user_id = '${ATHLETE_A}' and p.week_start = '${MONDAY}'
        order by v.version desc limit 1;`));
    if (publishedBy !== COACH_3) throw new Error('the version row does not name the publishing coach');

    /* PUT THE ROSTER BACK. `SELF: it authorises nothing about anybody else`
       further down asserts COACH_3 cannot reach ATHLETE_A, which is exactly
       the access this check grants itself. Leaving it would make that check
       fail for a reason that has nothing to do with what it tests — and these
       run against one shared database, in order. */
    asOwnerSql(`delete from public.coach_athlete_assignments
                 where organization_id = '${ORG_1}' and coach_user_id = '${COACH_3}' and athlete_user_id = '${ATHLETE_A}';`);
  });

  check('WEEK: nobody can write these tables directly, not even the coach who owns the row', () => {
    /* RLS is not enough for UPDATE and DELETE — it FILTERS, so the statement
       matches zero rows and SUCCEEDS. The migration revokes the privilege
       outright; this proves the refusal is real and the row did not move. */
    const forged = asAthlete(COACH_1, refusalProbe(
      `update public.coach_week_plan_versions set body = '{"label":"forged"}'::jsonb`));
    if (!wasRefused(forged)) throw new Error('a coach edited an immutable published version');
    const del = asAthlete(COACH_1, refusalProbe(`delete from public.coach_week_plans`));
    if (!wasRefused(del)) throw new Error('a coach deleted a week plan row directly');
  });

  check('WEEK: the athlete can READ the week that governs their training', () => {
    const seen = lastLine(asAthlete(ATHLETE_A,
      `select count(*) from public.coach_week_plans where athlete_user_id = '${ATHLETE_A}';`));
    if (seen === '0') throw new Error('the athlete cannot see the week they have been given');
    const other = lastLine(asAthlete(ATHLETE_B,
      `select count(*) from public.coach_week_plans where athlete_user_id = '${ATHLETE_A}';`));
    if (other !== '0') throw new Error("an athlete read another athlete's week");
  });

  check('WEEK: the athlete can see WHO published it — the name read goes both ways', () => {
    /* Found while building the Android card, not by reading: the original
       name policy was `self or someone I coach`, both branches pointing the
       same way down the relationship, so an athlete reading their COACH's row
       was refused. A week arriving from an unnameable "your coach" is
       unverifiable — who put this session in my week is the one thing an
       athlete should be able to check. */
    asAthlete(COACH_1, `select public.set_athlete_display_name('Sam Coach');`);
    const seen = lastLine(asAthlete(ATHLETE_A,
      `select display_name from public.athlete_profiles where user_id = '${COACH_1}';`));
    if (seen !== 'Sam Coach') throw new Error(`the athlete cannot see their own coach's name (got '${seen}')`);
    /* And no wider than that: a coach two steps away is still nobody. */
    const stranger = lastLine(asAthlete(ATHLETE_B,
      `select count(*) from public.athlete_profiles where user_id = '${COACH_1}';`));
    if (stranger !== '0') throw new Error('an unrelated athlete could read a coach profile');
  });

  check('HELD: an athlete can report a session the safety layer stopped', () => {
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'held:1', now(), current_date, 'arc:w1', 'held', false, '[]'::jsonb, array['pain_hold_active'])`));
    if (!out.includes('ACCEPTED')) throw new Error(`a held receipt was refused: ${lastLine(out)}`);
    const kind = lastLine(asOwnerSqlOut(
      `select action from public.autocoach_receipts where client_entry_id = 'held:1';`));
    if (kind !== 'held') throw new Error(`the receipt recorded '${kind}'`);
  });

  check('HELD: the coach can read it, and can tell WHICH flag stopped the session', () => {
    /* The point of the whole step: "held for injury" and "ignored me" must not
       look the same on the bench. */
    const codes = lastLine(asAthlete(COACH_1,
      `select array_to_string(reason_codes, ',') from public.autocoach_receipts where client_entry_id = 'held:1';`));
    if (!codes.includes('pain_hold_active')) throw new Error(`the coach cannot see why it was held (got '${codes}')`);
  });

  check('HELD: a hold carries no session content — only the id the coach already authored', () => {
    /* No name travels. The coach resolves `workout_id` against their own
       published week, so block and set level content still never crosses. A
       raw caller trying to smuggle content through `operations` is refused by
       the same element-by-element validation every other receipt gets. */
    const smuggle = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'held:2', now(), current_date, 'arc:w1', 'held', false, '[{"type":"rest_or_pause","targetPath":"x","reasonCode":"r","materiality":"high","extra":"Back Squat 100kg"}]'::jsonb, array['pain_hold_active'])`));
    if (!wasRefused(smuggle)) throw new Error('a held receipt smuggled a fifth field past the operations validator');
  });

  check('HELD: an invented action is still refused — the vocabulary stayed closed', () => {
    const out = asAthlete(ATHLETE_A, refusalProbe(
      `perform public.push_autocoach_receipt('${ORG_1}', 'held:3', now(), current_date, 'arc:w1', 'skipped', false, '[]'::jsonb, array['pain_hold_active'])`));
    if (!wasRefused(out)) throw new Error("widening the action list opened it — 'skipped' was accepted");
  });

  check('END: the ATHLETE can leave, without their coach\u2019s permission', () => {
    /* The gap this closes: nothing in the system could set an assignment to
       'revoked'. That is half a consent model — an athlete consents by
       redeeming an invite, and consent you cannot withdraw is enrolment. */
    if (rosterCount(COACH_1, NEWBIE) !== '1') throw new Error('setup: NEWBIE should be on COACH_1 roster');
    const out = asAthlete(NEWBIE, refusalProbe(`perform public.end_coach_relationship('${ORG_1}', '${NEWBIE}')`));
    if (!out.includes('ACCEPTED')) throw new Error(`the athlete could not leave: ${lastLine(out)}`);

    const state = lastLine(asOwnerSqlOut(
      `select status || '|' || (revoked_at is not null)::text from public.coach_athlete_assignments
        where organization_id = '${ORG_1}' and coach_user_id = '${COACH_1}' and athlete_user_id = '${NEWBIE}';`));
    if (state !== 'revoked|true') throw new Error(`assignment is '${state}' — status and stamp must move together`);

    /* And it actually ENDS the reads, which is the whole point. */
    const authorised = lastLine(asAthlete(COACH_1, `select public.coaches_athlete('${ORG_1}', '${NEWBIE}');`));
    if (authorised !== 'f') throw new Error('the relationship ended on paper but the coach can still read them');
  });

  check('END: no new week can be published to someone who left', () => {
    const out = asAthlete(COACH_1, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${NEWBIE}', '${MONDAY}', ${weekBody('after-leaving')}, 'end:1')`));
    if (!wasRefused(out)) throw new Error('a coach published to an athlete who had left');
  });

  check('END: leaving does NOT delete the week already published — the athlete does that', () => {
    /* Deliberate, and stated in the migration: a coach owns the week they
       published, deleting it would leave the athlete with nothing (there is no
       Coordinator to recompute one), and `athlete_plans_delete` already lets
       them clear it themselves. Leaving and erasing are different acts. */
    asOwnerSql(`insert into public.athlete_weekly_plans (user_id, week_start, schema_version, revision, writer, plan, client_generated_at)
                values ('${NEWBIE}', '${MONDAY}', 1, 1, 'coach', '{"label":"left-behind"}'::jsonb, now())
                on conflict (user_id, week_start) do update set writer = 'coach', plan = excluded.plan;`);
    const still = lastLine(asAthlete(NEWBIE,
      `select count(*) from public.athlete_weekly_plans where user_id = '${NEWBIE}' and week_start = '${MONDAY}';`));
    if (still !== '1') throw new Error('the published week vanished when the relationship ended');

    /* The erasure path the migration points at, proved rather than asserted. */
    asAthlete(NEWBIE, `delete from public.athlete_weekly_plans where user_id = '${NEWBIE}' and week_start = '${MONDAY}';`);
    const gone = lastLine(asAthlete(NEWBIE,
      `select count(*) from public.athlete_weekly_plans where user_id = '${NEWBIE}' and week_start = '${MONDAY}';`));
    if (gone !== '0') throw new Error('the athlete cannot clear their own week');
  });

  check('END: a THIRD party cannot end someone else\u2019s relationship', () => {
    /* COACH_3 is a legitimate, active ORG_1 coach — the within-tenant boundary
       that gets forgotten. This is a two-party relationship and nobody else
       gets to end it. */
    const out = asAthlete(COACH_3, refusalProbe(`perform public.end_coach_relationship('${ORG_1}', '${ATHLETE_A}')`));
    if (!wasRefused(out)) throw new Error('an unrelated coach ended a relationship that was not theirs');
    const alive = lastLine(asAthlete(COACH_1, `select public.coaches_athlete('${ORG_1}', '${ATHLETE_A}');`));
    if (alive !== 't') throw new Error('the refused call ended the relationship anyway');
  });

  check('END: the COACH can end it too, and ending twice is refused not silent', () => {
    const out = asAthlete(COACH_1, refusalProbe(`perform public.end_coach_relationship('${ORG_1}', '${ATHLETE_A}')`));
    if (!out.includes('ACCEPTED')) throw new Error(`the coach could not end it: ${lastLine(out)}`);
    /* A second call must REFUSE rather than report success over nothing —
       "already ended" and "ended just now" are different facts. */
    const again = asAthlete(COACH_1, refusalProbe(`perform public.end_coach_relationship('${ORG_1}', '${ATHLETE_A}')`));
    if (!wasRefused(again)) throw new Error('ending an already-ended relationship reported success');
  });

  check('END: the athlete keeps their organisation membership, so other coaches survive', () => {
    /* Revoking the membership as well would evict them from every OTHER coach
       in the organisation — one relationship ending would silently end the
       rest. */
    const membership = lastLine(asOwnerSqlOut(
      `select status from public.organization_memberships where organization_id = '${ORG_1}' and user_id = '${ATHLETE_A}';`));
    if (membership !== 'active') throw new Error(`membership became '${membership}' — ending ONE relationship must not evict them`);

    /* PUT THE ROSTER BACK. These checks ended COACH_1 <-> ATHLETE_A, and later
       checks assert that OTHER coaches cannot reach ATHLETE_A. Those would
       still pass with the relationship gone — but for the wrong reason, which
       is how a deny test quietly stops proving anything. One shared database,
       run in order, so state has to be left as it was found. */
    asOwnerSql(`update public.coach_athlete_assignments
                   set status = 'active', revoked_at = null
                 where organization_id = '${ORG_1}' and coach_user_id = '${COACH_1}' and athlete_user_id = '${ATHLETE_A}';`);
    const back = lastLine(asAthlete(COACH_1, `select public.coaches_athlete('${ORG_1}', '${ATHLETE_A}');`));
    if (back !== 't') throw new Error('failed to restore the roster for the checks that follow');
  });

  check('SELF: a coach can put THEMSELF on their own roster, and publish to it', () => {
    /* The owner is currently the only athlete, so "write my own week" is the
       first real use of this feature. Until 14 August a `coach_athlete_distinct`
       constraint and an explicit refusal in `redeem_coach_invite` blocked it. */
    asAthlete(COACH_1, `select public.create_coach_invite('${ORG_1}');`);
    const code = inviteCode(COACH_1);
    const out = asAthlete(COACH_1, refusalProbe(`perform public.redeem_coach_invite('${code}')`));
    if (!out.includes('ACCEPTED')) throw new Error(`self-redemption was refused: ${lastLine(out)}`);
    if (rosterCount(COACH_1, COACH_1) !== '1') throw new Error('the coach is not on their own roster');

    const pub = asAthlete(COACH_1, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${COACH_1}', '2026-08-24', ${weekBody('my own week')}, 'self:1')`));
    if (!pub.includes('ACCEPTED')) throw new Error(`a self-publish was refused: ${lastLine(pub)}`);
    const writer = lastLine(asOwnerSqlOut(
      `select writer from public.athlete_weekly_plans where user_id = '${COACH_1}' and week_start = '2026-08-24';`));
    if (writer !== 'coach') throw new Error(`the self-published week is written by '${writer}'`);
  });

  check('SELF: it authorises nothing about anybody else', () => {
    /* The whole risk of dropping that constraint is that it quietly widens
       something. It does not: coaches_athlete still needs an active assignment
       and active memberships on BOTH sides, so COACH_3 — a real ORG_1 coach —
       still cannot reach ATHLETE_A, and self-coaching gave COACH_1 nothing new
       about anyone but themselves. */
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.publish_coach_week('${ORG_1}', '${ATHLETE_A}', '2026-08-24', ${weekBody('nope')}, 'self:2')`));
    if (!wasRefused(out)) throw new Error('dropping the self-coaching guard widened access to other athletes');
  });

  check('WEEK: a self-coached athlete is untouched — coordinator still writes', () => {
    const out = asAthlete(ATHLETE_B, refusalProbe(
      `perform public.publish_athlete_weekly_plan('${MONDAY}', 1, 1, now(), '{}'::jsonb)`));
    if (!out.includes('ACCEPTED')) throw new Error(`the unchanged coordinator path broke: ${lastLine(out)}`);
    if (planRow(ATHLETE_B, 'writer') !== 'coordinator') throw new Error('a self-coached week stopped being coordinator-written');
  });

  /* ---------------------------------------------------------------------
   * ARC bootstrap — one person, no organisation, to a week on a phone.
   *
   * EVERY SCENARIO ABOVE STARTS FROM A SEEDED ORGANISATION, written by the
   * table owner. That is an honest model of the server-side command layer, but
   * it means the suite never once exercised the step a real first user has to
   * take: there is no org, and `public.organizations` has no INSERT policy for
   * any role, deliberately. Until 15 August 2026 there was no way past that at
   * all, and the bench said so on Settings — accurately, with no cure.
   *
   * This block runs the chain a new coach actually runs, in order, through the
   * client role only:
   *
   *   create_organization -> create_coach_invite -> redeem_coach_invite
   *     -> publish_coach_week -> get_athlete_week_plan
   *
   * Nothing here is seeded as the owner. If any link needs a privilege a real
   * signed-in user does not have, this fails.
   * ------------------------------------------------------------------- */
  console.log('\nARC bootstrap — from no organisation to a published week, as a client:\n');

  const FOUNDER = 'f0f0f0f0-0001-0001-0001-f0f0f0f0f0f0';
  asOwnerSql(`insert into auth.users (id) values ('${FOUNDER}') on conflict do nothing;`);

  /* Deliberately no `set_config` of the JWT claims: an anonymous caller has no
     `sub`, and the grant is what must stop them, not a null check in the body. */
  const asAnon = (sql) => runSql(`set role anon;\n${sql}`);

  /* `get_athlete_week_plan` returns a PROJECTION, not the stored row — it
     rebuilds `plan` out of `entries` and `decisions` and drops everything else.
     So the body published here has to be entry-shaped, or the read-back would
     assert over a plan the function correctly emptied and prove nothing. */
  const BOOT_WEEK = `'${JSON.stringify({
    entries: [{ proposalId: 'boot-1', domain: 'strength', date: '2026-08-17', status: 'planned', title: 'Squat day' }],
  }).replace(/'/g, "''")}'::jsonb`;

  const orgCount = () => lastLine(asOwnerSqlOut('select count(*) from public.organizations;'));
  const founderOrg = () => lastLine(asOwnerSqlOut(
    `select organization_id from public.organization_memberships
      where user_id = '${FOUNDER}' and role = 'owner' and status = 'active';`));

  check('BOOTSTRAP: create_organization writes the org and the owner membership together', () => {
    const out = asAthlete(FOUNDER, refusalProbe(`perform public.create_organization('Founder Barbell')`));
    if (!out.includes('ACCEPTED')) throw new Error(`a signed-in user could not create an organisation: ${lastLine(out)}`);

    const org = founderOrg();
    if (!/^[0-9a-f-]{36}$/.test(org)) {
      throw new Error('the organisation exists with no owner membership — an orphan nothing can ever reach');
    }
    const row = lastLine(asOwnerSqlOut(
      `select name || '/' || created_by from public.organizations where id = '${org}';`));
    if (row !== `Founder Barbell/${FOUNDER}`) throw new Error(`the organisation row is wrong: ${row}`);
  });

  check('BOOTSTRAP: a blank name is refused, and leaves no half-made organisation', () => {
    /* The pair commits together or not at all — that is the entire reason this
       is an RPC and not an INSERT policy, so the rollback is the assertion. */
    const before = orgCount();
    const out = asAthlete(FOUNDER, refusalProbe(`perform public.create_organization('   ')`));
    if (!wasRefused(out)) throw new Error('an organisation was created with a blank name');
    if (orgCount() !== before) throw new Error('the refused call left a row behind');
  });

  check('BOOTSTRAP: anon cannot create an organisation', () => {
    /* `alter default privileges` in the prelude grants anon table access, the
       way a Supabase project does, so the EXECUTE revoke in the migration is
       the only thing standing here. */
    const out = asAnon(refusalProbe(`perform public.create_organization('Anonymous Barbell')`));
    if (!wasRefused(out)) throw new Error('an unauthenticated caller created an organisation');
  });

  check('BOOTSTRAP: create_coach_invite can still see pgcrypto wherever it lives', () => {
    /* THE ONE PRODUCTION FAILURE THIS SUITE COULD NOT HAVE CAUGHT, asserted in
       the only form that works in both environments.
       `gen_random_bytes(integer) does not exist (42883)` on the first real
       invite: the function is `security definer set search_path = public`, and
       Supabase installs pgcrypto into `extensions` while a bare local Postgres
       — this cluster — installs it into `public`. So calling the function
       proves nothing here; it passes either way. What can be checked anywhere
       is the pin itself. */
    const cfg = lastLine(asOwnerSqlOut(
      `select coalesce(array_to_string(proconfig, ' '), '') from pg_proc
        where proname = 'create_coach_invite' and pronamespace = 'public'::regnamespace;`));
    if (!/search_path=/.test(cfg)) {
      throw new Error('create_coach_invite has no pinned search_path — a definer function must always pin one');
    }
    if (!/\bextensions\b/.test(cfg)) {
      throw new Error(`the pin excludes the extensions schema, so gen_random_bytes is unreachable on Supabase: ${cfg}`);
    }
    if (!/\bpublic\b/.test(cfg)) {
      throw new Error(`the pin excludes public, so the function cannot see its own tables: ${cfg}`);
    }
  });

  check('BOOTSTRAP: the founder invites themself and publishes their own week', () => {
    const org = founderOrg();
    const mint = asAthlete(FOUNDER, refusalProbe(`perform public.create_coach_invite('${org}')`));
    if (!mint.includes('ACCEPTED')) throw new Error(`the founder could not mint an invite: ${lastLine(mint)}`);

    const code = inviteCode(FOUNDER);
    const redeem = asAthlete(FOUNDER, refusalProbe(`perform public.redeem_coach_invite('${code}')`));
    if (!redeem.includes('ACCEPTED')) throw new Error(`the founder could not redeem their own code: ${lastLine(redeem)}`);
    if (rosterCount(FOUNDER, FOUNDER) !== '1') throw new Error('redeeming put nobody on the roster');

    const pub = asAthlete(FOUNDER, refusalProbe(
      `perform public.publish_coach_week('${org}', '${FOUNDER}', '${MONDAY}', ${BOOT_WEEK}, 'boot:1')`));
    if (!pub.includes('ACCEPTED')) throw new Error(`the founder could not publish to themself: ${lastLine(pub)}`);
  });

  check('BOOTSTRAP: the published week reads back through get_athlete_week_plan', () => {
    /* The last link, and the one that decides whether a phone sees anything.
       Asserting on the BODY rather than on a row count: the write path and the
       read path agreeing that a row exists is not the same as the athlete
       getting the week the coach actually sent. */
    const org = founderOrg();
    const title = lastLine(asAthlete(FOUNDER,
      `select result->'plan'->'entries'->0->>'title'
         from public.get_athlete_week_plan('${org}', '${FOUNDER}', date '${MONDAY}') as result;`));
    if (title !== 'Squat day') throw new Error(`the week did not read back — got '${title}'`);
  });

  check('BOOTSTRAP: the founder’s organisation is invisible to everyone else', () => {
    /* A new tenancy boundary is created by every bootstrap, and it is created
       by the client rather than by a seed — so it gets the same deny the
       seeded orgs get. */
    const out = asAthlete(COACH_3, refusalProbe(
      `perform public.publish_coach_week('${founderOrg()}', '${FOUNDER}', '${MONDAY}', ${weekBody('intruder')}, 'boot:x')`));
    if (!wasRefused(out)) throw new Error('an unrelated coach reached into a freshly bootstrapped organisation');
    const seen = lastLine(asAthlete(COACH_3,
      `select count(*) from public.organizations where id = '${founderOrg()}';`));
    if (seen !== '0') throw new Error('an unrelated coach can read the new organisation');
  });

} finally {
  try { asOwner(`pg_ctl -D ${dir}/data stop -m immediate`); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}

if (knownGaps) {
  console.error(`\n${knownGaps} KNOWN ENVIRONMENT GAP(S) — see the lines above. Green here does NOT cover them; CI does.`);
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll migration checks passed.');
process.exit(failures ? 1 : 0);
