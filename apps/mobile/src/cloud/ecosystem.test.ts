import type { SupabaseClient } from '@supabase/supabase-js';
import { mondayOf, ymd } from '@hybrid/engine';
import { pullEcosystem } from './ecosystem';

/*
 * WHICH WEEK THE PHONE ASKS FOR.
 *
 * This file exists for one bug, and the bug was invisible for as long as only
 * the Coordinator could write a week: it never wrote ahead, so "the newest
 * week on record" and "the week that governs today" were always the same row,
 * and `order('week_start', desc).limit(1)` was correct by coincidence.
 *
 * A coach programming a week in advance ends the coincidence. The device holds
 * exactly ONE weekly-plan partition and `ArcCoachWeekCard` renders exactly the
 * current week, so pulling week 3 on the Thursday of week 2 silently replaces
 * the week being lived with one that will not be rendered — and an edit
 * republished to week 2 afterwards never reaches the phone at all, while the
 * bench reports "Published."
 *
 * So the assertion here is on the QUERY, not on a merge result. The merge is
 * downstream of this and behaves correctly given the right row; nothing
 * downstream can recover from having been handed the wrong one.
 */

interface Call { table: string; filters: Record<string, string>; ordered: boolean }

function fakeClient(rows: Record<string, unknown[]>): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, filters: {}, ordered: false };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: () => builder,
        limit: () => Promise.resolve({ data: rows[table] ?? [], error: null }),
        order: () => { call.ordered = true; return builder; },
        eq: (column: string, value: string) => { call.filters[column] = value; return builder; },
        maybeSingle: () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const weekRow = (weekStart: string, writer: string) => ({
  week_start: weekStart,
  schema_version: 1,
  revision: 4,
  writer,
  plan: { schema: 'coach-week/1', weekStart, days: [] },
  client_generated_at: '2026-08-17T09:00:00.000Z',
});

describe('pullEcosystem — the weekly plan it asks for', () => {
  const thisWeek = () => mondayOf(ymd(new Date()));

  it('asks for the week that governs TODAY, by week_start', async () => {
    const { client, calls } = fakeClient({ athlete_weekly_plans: [weekRow(thisWeek(), 'coach')] });
    await pullEcosystem(client, 'user-1');

    const plans = calls.find((c) => c.table === 'athlete_weekly_plans');
    expect(plans?.filters.week_start).toBe(thisWeek());
    expect(plans?.filters.user_id).toBe('user-1');
  });

  it('does NOT take whichever week happens to be newest', async () => {
    /* The precise regression: an ordered read returns a week published ahead,
       which the card will refuse to render because its weekStart is not
       today's — so the athlete's coach week disappears until Monday. */
    const { client, calls } = fakeClient({ athlete_weekly_plans: [] });
    await pullEcosystem(client, 'user-1');

    expect(calls.find((c) => c.table === 'athlete_weekly_plans')?.ordered).toBe(false);
  });

  it('asks for a LOCAL week, agreeing with the card that renders it', async () => {
    /* `ArcCoachWeekCard` computes `mondayOf(ymd(new Date()))`, and `ymd` reads
       local components. A UTC week here would put an athlete in Sydney a day
       out for most of their day — pulling a week the card then rejects. */
    const { client, calls } = fakeClient({ athlete_weekly_plans: [] });
    await pullEcosystem(client, 'user-1');

    const asked = calls.find((c) => c.table === 'athlete_weekly_plans')?.filters.week_start;
    expect(asked).toBe(mondayOf(ymd(new Date())));
    /* And it is genuinely a Monday, whatever day the suite runs on. */
    expect(new Date(`${asked}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('carries the week through as the weeklyPlan partition, writer intact', async () => {
    const { client } = fakeClient({ athlete_weekly_plans: [weekRow(thisWeek(), 'coach')] });
    const namespace = await pullEcosystem(client, 'user-1');

    const partition = namespace?.partitions.weeklyPlan as { writer?: string; data?: { weekStart?: string } } | undefined;
    expect(partition?.writer).toBe('coach');
    expect(partition?.data?.weekStart).toBe(thisWeek());
  });

  it('leaves the partition absent when this week has no row, rather than substituting another week', async () => {
    const { client } = fakeClient({ athlete_weekly_plans: [] });
    const namespace = await pullEcosystem(client, 'user-1');
    expect(namespace?.partitions.weeklyPlan).toBeUndefined();
  });
});
