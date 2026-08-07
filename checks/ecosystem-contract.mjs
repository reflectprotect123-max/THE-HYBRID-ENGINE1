/* Static guard for the multi-app Supabase boundary. It intentionally does not
 * need credentials: the dangerous failures here are missing RLS, a non-atomic
 * revision write, or a weekly-plan function that is callable by an anonymous
 * client. A staging round-trip belongs in a deployment job with real secrets.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv[2] || '.');
const file = resolve(root, 'supabase/migrations/20260804_fitness_ecosystem_contracts.sql');
const sql = await readFile(file, 'utf8');
let failures = 0;
const check = (condition, message) => {
  if (condition) console.log('PASS — ' + message);
  else { console.log('FAIL — ' + message); failures += 1; }
};
const has = (pattern) => pattern.test(sql);

for (const table of ['athlete_core', 'athlete_domain_snapshots', 'athlete_events', 'athlete_weekly_plans']) {
  check(has(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}`, 'i')), `migration creates ${table}`);
  check(has(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i')), `${table} has RLS enabled`);
  check(has(new RegExp(`create\\s+policy[\\s\\S]+?on\\s+public\\.${table}`, 'i')), `${table} has an ownership policy`);
}

for (const fn of ['upsert_athlete_core', 'upsert_athlete_domain_snapshot', 'publish_athlete_weekly_plan', 'record_athlete_event']) {
  check(has(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}`, 'i')), `migration creates ${fn}`);
  check(has(new RegExp(`public\\.${fn}[\\s\\S]+?security\\s+definer`, 'i')), `${fn} is server-owned and checks auth inside the function`);
  check(has(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}`, 'i')), `${fn} is not executable by public`);
  check(has(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]+?to\\s+authenticated`, 'i')), `${fn} is executable by authenticated users`);
}

check(has(/primary\s+key\s*\(user_id,\s*domain\)/i), 'domain snapshots are uniquely partitioned per user');
check(has(/primary\s+key\s*\(user_id,\s*idempotency_key\)/i), 'events are idempotent per user');
check(has(/constraint\s+athlete_plan_writer\s+check\s*\(writer\s*=\s*'coordinator'\)/i), 'weekly plans have a Coordinator-only writer invariant');
check(!has(/create\s+policy\s+athlete_(?:core|domain|events|plans)_(?:insert|update)/i), 'snapshot/event writes are not exposed as unrestricted direct table writes');
check(has(/where\s+public\.athlete_(?:core|domain_snapshots|weekly_plans)\.revision\s*<\s*excluded\.revision/i), 'snapshot writes reject stale revisions');
check(has(/on\s+conflict\s*\(user_id,\s*idempotency_key\)\s+do\s+nothing/i), 'event retries are idempotent');
check(!/grant\s+.*\s+to\s+anon/i.test(sql), 'migration grants no ecosystem write capability to anon');

/* The nutrition domain arrives as a widening migration, never as an edit to
 * the applied 20260804 file. Assert both: the original still carries the
 * narrow lists, and the follow-up admits 'nutrition' everywhere a domain is
 * enumerated — table constraint AND the plpgsql guard inside the RPC, since
 * the RPCs are the only supported write path.
 */
const nutritionFile = resolve(root, 'supabase/migrations/20260807_nutrition_domain.sql');
const nutritionSql = await readFile(nutritionFile, 'utf8');
const hasNutrition = (pattern) => pattern.test(nutritionSql);

check(!/'nutrition'/i.test(sql), 'applied 20260804 migration is not edited to add nutrition');
check(
  hasNutrition(/constraint\s+athlete_domain_name\s+check\s*\(domain\s+in\s*\([^)]*'nutrition'[^)]*\)\)/i),
  'nutrition migration widens the athlete_domain_name constraint',
);
check(
  hasNutrition(/constraint\s+athlete_event_source\s+check\s*\(source_domain\s+in\s*\([^)]*'nutrition'[^)]*\)\)/i),
  'nutrition migration widens the athlete_event_source constraint',
);
check(
  hasNutrition(/p_domain\s+not\s+in\s*\([^)]*'nutrition'[^)]*\)/i),
  'nutrition migration widens the upsert_athlete_domain_snapshot domain guard',
);
check(
  hasNutrition(/p_source_domain\s+not\s+in\s*\([^)]*'nutrition'[^)]*\)/i),
  'nutrition migration widens the record_athlete_event source guard',
);
for (const constraintName of ['athlete_domain_name', 'athlete_event_source']) {
  check(
    hasNutrition(new RegExp(`drop\\s+constraint\\s+if\\s+exists\\s+${constraintName}`, 'i')),
    `nutrition migration drops ${constraintName} idempotently before re-adding it`,
  );
}
check(/--\s*ROLLBACK/i.test(nutritionSql), 'nutrition migration documents its rollback statements');
check(!/grant\s+.*\s+to\s+anon/i.test(nutritionSql), 'nutrition migration grants no ecosystem write capability to anon');

if (failures) process.exitCode = 1;
else console.log('\nAll ecosystem-contract static checks passed.');
