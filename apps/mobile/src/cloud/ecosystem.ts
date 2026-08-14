import type { SupabaseClient } from '@supabase/supabase-js';
import { applyProductSyncNamespace, buildMergedSyncNamespace, type EngineDB, mondayOf, readNutritionPartition, SYNCED_SNAPSHOT_DOMAINS, withNutritionPartition, ymd } from '@hybrid/engine';
import {
  emptyEcosystemNamespace,
  sanitizeEcosystemNamespace,
  sanitizeSharedCore,
  type EcosystemSyncNamespace,
  type VersionedSnapshot,
} from '@hybrid/shared-core';

/** Enable only after the ecosystem SQL migration has been applied in staging. */
export const ECOSYSTEM_SYNC_ENABLED = process.env.EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC === '1';

type CoreRow = { schema_version: number; revision: number; writer: string; state: unknown; client_updated_at?: string | null };
type DomainRow = { domain: (typeof SYNCED_SNAPSHOT_DOMAINS)[number]; schema_version: number; revision: number; writer: string; snapshot: unknown; client_updated_at?: string | null };

/**
 * What a push needs to know about the nutrition slice.
 *
 * Separate from `db` in the signature because it IS separate on disk and on the
 * server; the day it becomes a field on EngineDB is the day a food log can
 * overwrite a training snapshot.
 */
export interface NutritionPush {
  /** The athlete's slice. Opaque here — @hybrid/nutrition-core owns its shape. */
  data: unknown;
  /**
   * The namespace the last pull returned. It is the ONLY carrier of the
   * server's current nutrition revision, because the EngineDB deliberately does
   * not retain that partition (see applyProductSyncNamespace). Without it every
   * cold start would push revision 1 and `upsert_athlete_domain_snapshot`'s
   * `where revision <` guard would drop the write with no error.
   */
  base?: EcosystemSyncNamespace;
}
type PlanRow = { week_start: string; schema_version: number; revision: number; writer: 'coordinator'; plan: unknown; client_generated_at?: string | null };

const millis = (value: string | null | undefined): number => {
  const n = value ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export async function pullEcosystem(client: SupabaseClient, userId: string): Promise<EcosystemSyncNamespace | null> {
  const [coreResult, domainResult, planResult] = await Promise.all([
    client.from('athlete_core').select('schema_version,revision,writer,state,client_updated_at').eq('user_id', userId).maybeSingle(),
    client.from('athlete_domain_snapshots').select('domain,schema_version,revision,writer,snapshot,client_updated_at').eq('user_id', userId).in('domain', [...SYNCED_SNAPSHOT_DOMAINS]),
    /* THE WEEK THAT GOVERNS TODAY, not the newest week on record.
     *
     * This read was `order('week_start', desc).limit(1)` until 14 August 2026,
     * which was right while only the Coordinator could write a week — it never
     * wrote ahead, so newest and current were the same row. A coach programming
     * in advance breaks that equivalence, and the consequences were both silent:
     *
     *   - Publish Thursday of week 2 for week 3, and the device's single
     *     weeklyPlan partition becomes week 3. `useCoachWeek` asks for the
     *     Monday of TODAY, gets a mismatch, and returns null — so the athlete's
     *     coach week vanishes from Home for the rest of week 2 and reappears on
     *     Monday. Nothing tells them, and nothing tells the coach.
     *   - Correct a mistake in week 2 after week 3 exists, and the server
     *     accepts it, returns a new version, and tells the coach "Published."
     *     The device is still pulling week 3. The edit never lands.
     *
     * The device holds ONE weekly plan and renders exactly one week, so asking
     * for that week is not a narrowing — it is the query matching the store.
     * A week published ahead simply arrives when it becomes current, which is
     * what the athlete's phone would show either way.
     *
     * Local, not UTC: this must agree with `ArcCoachWeekCard`'s
     * `mondayOf(ymd(new Date()))`, and `ymd` reads local components. An athlete
     * in Sydney asking for a UTC week would be a day out for most of their day.
     */
    client.from('athlete_weekly_plans').select('week_start,schema_version,revision,writer,plan,client_generated_at').eq('user_id', userId).eq('week_start', mondayOf(ymd(new Date()))).limit(1),
  ]);
  if (coreResult.error) throw coreResult.error;
  if (domainResult.error) throw domainResult.error;
  if (planResult.error) throw planResult.error;
  const coreRow = coreResult.data as CoreRow | null;
  const domainRows = (domainResult.data || []) as DomainRow[];
  const planRow = ((planResult.data || [])[0] || null) as PlanRow | null;
  if (!coreRow && !domainRows.length && !planRow) return null;
  const core = sanitizeSharedCore(coreRow?.state);
  const namespace = emptyEcosystemNamespace(core);
  return sanitizeEcosystemNamespace({
    ...namespace,
    coreSnapshot: coreRow ? { schemaVersion: 1, domain: 'core', revision: Math.max(0, coreRow.revision || 0), updatedAt: millis(coreRow.client_updated_at), writer: coreRow.writer || 'server', data: core } : undefined,
    partitions: {
      ...namespace.partitions,
      ...Object.fromEntries(domainRows.map((row) => [row.domain, { schemaVersion: 1, domain: row.domain, revision: Math.max(0, row.revision || 0), updatedAt: millis(row.client_updated_at), writer: row.writer || 'server', data: row.snapshot }])),
      weeklyPlan: planRow ? { schemaVersion: 1, domain: 'coordinator', revision: Math.max(0, planRow.revision || 0), updatedAt: millis(planRow.client_generated_at), writer: planRow.writer || 'coordinator', data: { weekStart: planRow.week_start, plan: planRow.plan } } : undefined,
    },
  });
}

/**
 * What a push reports back.
 *
 * `namespace` is what the caller stores in `EngineDB.ecosystem`. `stale` names
 * the domains the server's revision guard refused — see the note at the write
 * itself; the caller must not record such a push as clean.
 */
export interface EcosystemPushResult {
  namespace: EcosystemSyncNamespace;
  stale: string[];
  /**
   * The nutrition snapshot this push actually put on the wire, when one was
   * pushed at all.
   *
   * It is NOT part of `namespace` and must never become part of it: `namespace`
   * is what the caller stores in `EngineDB.ecosystem`, which `cloudFp` hashes,
   * so a food log in there pushes the whole training blob on every meal. But
   * the caller still has to LEARN the revision it just wrote — the server's
   * revision guard compares against it, and the only other carrier of that
   * number is the next pull. Without this the local base stayed at the last
   * PULLED revision for the whole foreground session, so every further
   * nutrition write in that session re-used a revision the server already held
   * and depended on the equal-revision timestamp tiebreak to land at all.
   *
   * Reported separately so it can be recorded in the pull-side base (a ref, not
   * the EngineDB) and nowhere else. Only meaningful when `stale` does not name
   * `nutrition`: a refused write did not happen and must not advance anything.
   */
  nutrition?: VersionedSnapshot<unknown>;
}

export async function pushEcosystem(
  client: SupabaseClient,
  db: EngineDB,
  writer: string,
  nutrition?: NutritionPush,
): Promise<EcosystemPushResult> {
  const namespace = buildMergedSyncNamespace(db, writer);
  /*
   * The nutrition partition is built onto a copy that is pushed and then
   * discarded. The RETURN value stays training-only because the caller stores
   * it in `EngineDB.ecosystem`, which `cloudFp` hashes — a food log in there
   * would push the entire training blob on every meal.
   *
   * The previous revision comes from the last pull rather than from that
   * discarded copy, for the reason documented on `NutritionPush.base`.
   */
  const outbound = nutrition
    ? withNutritionPartition(
        { ...namespace, partitions: { ...namespace.partitions, nutrition: nutrition.base?.partitions.nutrition } },
        nutrition.data,
        writer,
      )
    : namespace;
  const core = namespace.coreSnapshot;
  if (core) {
    const { error } = await client.rpc('upsert_athlete_core', { p_schema_version: core.schemaVersion, p_revision: core.revision, p_writer: core.writer, p_client_updated_at: new Date(core.updatedAt).toISOString(), p_state: core.data });
    if (error) throw error;
  }
  // EVERY domain snapshot, sequentially. The single-product build pushed only
  // its own partition here, which was correct then and a silent data hole the
  // moment one app hosted both worlds — the namespace above carries them all,
  // and skipping any would let that domain's snapshot go stale server-side
  // while app_state kept advancing.
  /*
   * The RPC RETURNS whether it wrote. A snapshot whose revision is not ahead
   * of the server's is dropped with no error — correct behaviour, and until
   * now invisible: both callers checked `error` only. A cold start pushes
   * revision 1 against a server at revision 12, the guard refuses it, and the
   * sync layer then recorded the push as clean, so it did not repeat until
   * unrelated content changed. Masked today by the unconditional legacy
   * `app_state` write carrying the same records, and real loss the moment that
   * read path is retired.
   *
   * Reported rather than thrown: a stale revision is a benign race that the
   * next reconcile heals with a refreshed base, and a thrown error would put a
   * scary banner in front of the athlete for it. The caller uses this to
   * decline to mark the push clean, so the next one retries.
   */
  const stale: string[] = [];
  for (const domainId of SYNCED_SNAPSHOT_DOMAINS) {
    const domain = outbound.partitions[domainId];
    if (!domain) continue;
    const { data: wrote, error } = await client.rpc('upsert_athlete_domain_snapshot', { p_domain: domainId, p_schema_version: domain.schemaVersion, p_revision: domain.revision, p_writer: domain.writer, p_client_updated_at: new Date(domain.updatedAt).toISOString(), p_snapshot: domain.data });
    if (error) throw error;
    if (wrote === false) stale.push(domainId);
  }
  await Promise.all(namespace.core.events.slice(-100).map(async (event) => {
    const { error } = await client.rpc('record_athlete_event', { p_idempotency_key: event.idempotencyKey, p_event_type: event.type, p_source_domain: event.sourceDomain, p_occurred_at: event.occurredAt, p_payload: event.payload });
    if (error) throw error;
  }));
  return { namespace, stale, nutrition: nutrition ? outbound.partitions.nutrition : undefined };
}

export { applyProductSyncNamespace, readNutritionPartition };
