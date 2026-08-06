import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyProductSyncNamespace,
  buildMergedSyncNamespace,
  type EngineDB,
} from '@hybrid/engine';
import {
  emptyEcosystemNamespace,
  sanitizeEcosystemNamespace,
  sanitizeSharedCore,
  type EcosystemSyncNamespace,
} from '@hybrid/shared-core';

/** Enable only after the ecosystem SQL migration has been applied in staging. */
export const ECOSYSTEM_SYNC_ENABLED = process.env.EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC === '1';

type CoreRow = { schema_version: number; revision: number; writer: string; state: unknown; client_updated_at?: string | null };
type DomainRow = { domain: 'strength' | 'conditioning'; schema_version: number; revision: number; writer: string; snapshot: unknown; client_updated_at?: string | null };
type PlanRow = { week_start: string; schema_version: number; revision: number; writer: 'coordinator'; plan: unknown; client_generated_at?: string | null };

const millis = (value: string | null | undefined): number => {
  const n = value ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export async function pullEcosystem(client: SupabaseClient, userId: string): Promise<EcosystemSyncNamespace | null> {
  const [coreResult, domainResult, planResult] = await Promise.all([
    client.from('athlete_core').select('schema_version,revision,writer,state,client_updated_at').eq('user_id', userId).maybeSingle(),
    client.from('athlete_domain_snapshots').select('domain,schema_version,revision,writer,snapshot,client_updated_at').eq('user_id', userId).in('domain', ['strength', 'conditioning']),
    client.from('athlete_weekly_plans').select('week_start,schema_version,revision,writer,plan,client_generated_at').eq('user_id', userId).order('week_start', { ascending: false }).limit(1),
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

export async function pushEcosystem(client: SupabaseClient, db: EngineDB, writer: string): Promise<EcosystemSyncNamespace> {
  const namespace = buildMergedSyncNamespace(db, writer);
  const core = namespace.coreSnapshot;
  if (core) {
    const { error } = await client.rpc('upsert_athlete_core', { p_schema_version: core.schemaVersion, p_revision: core.revision, p_writer: core.writer, p_client_updated_at: new Date(core.updatedAt).toISOString(), p_state: core.data });
    if (error) throw error;
  }
  // BOTH domain snapshots, sequentially. The single-product build pushed only
  // its own partition here, which was correct then and a silent data hole the
  // moment one app hosted both worlds — the merged namespace above carries
  // both, and skipping either would let one discipline's snapshot go stale
  // server-side while app_state kept advancing.
  for (const domainId of ['strength', 'conditioning'] as const) {
    const domain = namespace.partitions[domainId];
    if (!domain) continue;
    const { error } = await client.rpc('upsert_athlete_domain_snapshot', { p_domain: domainId, p_schema_version: domain.schemaVersion, p_revision: domain.revision, p_writer: domain.writer, p_client_updated_at: new Date(domain.updatedAt).toISOString(), p_snapshot: domain.data });
    if (error) throw error;
  }
  await Promise.all(namespace.core.events.slice(-100).map(async (event) => {
    const { error } = await client.rpc('record_athlete_event', { p_idempotency_key: event.idempotencyKey, p_event_type: event.type, p_source_domain: event.sourceDomain, p_occurred_at: event.occurredAt, p_payload: event.payload });
    if (error) throw error;
  }));
  return namespace;
}

export { applyProductSyncNamespace };
