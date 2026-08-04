import {
  emptyEcosystemNamespace,
  mergeEcosystemNamespaces,
  sanitizeEcosystemNamespace,
  sharedCoreFingerprint,
  type EcosystemSyncNamespace,
  type VersionedSnapshot,
} from '@hybrid/shared-core';
import { ensureSharedCore, mergeEngines, sanitizeDB } from './db';
import { isCondWorkout } from './session';
import type { EngineDB, Settings, Workout, Session } from './types';

export type ProductSyncDomain = 'strength' | 'conditioning';

/** The opaque payload carried by one product's server-owned snapshot. */
export interface ProductSnapshotData {
  workouts: Workout[];
  sessions: Session[];
  /**
   * Only progression/history and shared organisation settings are copied;
   * profile/recovery facts live in shared-core. Tombstones are deliberately
   * present in both partitions so a delete made by one app cannot be undone
   * by an older snapshot from the other app.
   */
  settings: Partial<Pick<Settings, 'liftProgress' | 'conProgress' | 'conditioning' | 'conditioningAck' | 'mobility' | 'folders' | 'deletedIds'>>;
}

const domainKey = (domain: ProductSyncDomain): 'strength' | 'conditioning' => domain;

const isConditioningRecord = (record: Workout | Session): boolean => record.kind === 'conditioning';

function productData(db: EngineDB, domain: ProductSyncDomain): ProductSnapshotData {
  const conditioning = domain === 'conditioning';
  const workouts = db.workouts.filter((w) => (conditioning ? isCondWorkout(w) : !isCondWorkout(w)));
  const sessions = db.sessions.filter((s) => (conditioning ? isConditioningRecord(s) : !isConditioningRecord(s)));
  const settings: ProductSnapshotData['settings'] = conditioning
    ? {
        conProgress: db.settings.conProgress,
        conditioning: db.settings.conditioning,
        conditioningAck: db.settings.conditioningAck,
        folders: db.settings.folders,
        deletedIds: db.settings.deletedIds,
      }
    : {
        liftProgress: db.settings.liftProgress,
        mobility: db.settings.mobility,
        folders: db.settings.folders,
        deletedIds: db.settings.deletedIds,
      };
  return { workouts, sessions, settings };
}

const fingerprint = (data: ProductSnapshotData): string => JSON.stringify(data);

/**
 * Add the current product's data to the local ecosystem namespace.
 *
 * Revision increments are content-based, not push-based: retrying a failed
 * request does not manufacture a newer snapshot, while a real domain edit
 * cannot be hidden behind a wall-clock tie.
 */
export function buildProductSyncNamespace(
  db: EngineDB,
  domain: ProductSyncDomain,
  writer: string,
  now = Date.now(),
): EcosystemSyncNamespace {
  const migrated = ensureSharedCore(db, now);
  const namespace = migrated.ecosystem ? sanitizeEcosystemNamespace(migrated.ecosystem) : emptyEcosystemNamespace(migrated.core);
  const core = migrated.core!;
  const previousCore = namespace.coreSnapshot;
  const nextCore = previousCore && sharedCoreFingerprint(previousCore.data) === sharedCoreFingerprint(core)
    ? previousCore
    : {
        schemaVersion: 1 as const,
        domain: 'core' as const,
        revision: (previousCore?.revision ?? 0) + 1,
        updatedAt: now,
        writer,
        data: core,
      } satisfies VersionedSnapshot<typeof core>;
  const data = productData(migrated, domain);
  const previous = namespace.partitions[domainKey(domain)];
  const next: VersionedSnapshot<ProductSnapshotData> = previous && fingerprint(previous.data as ProductSnapshotData) === fingerprint(data)
    ? previous as VersionedSnapshot<ProductSnapshotData>
    : {
        schemaVersion: 1,
        domain,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: now,
        writer,
        data,
      };
  return {
    ...namespace,
    core,
    coreSnapshot: nextCore,
    partitions: { ...namespace.partitions, [domain]: next },
  };
}

function payloadToDB(value: unknown): EngineDB | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Partial<ProductSnapshotData>;
  if (!Array.isArray(p.workouts) || !Array.isArray(p.sessions)) return null;
  return {
    workouts: p.workouts,
    sessions: p.sessions,
    settings: p.settings && typeof p.settings === 'object' && !Array.isArray(p.settings) ? p.settings as Settings : {},
  };
}

/**
 * Fold a server namespace into the local engine without allowing a product's
 * stale snapshot to erase logged work. The existing record-level merge remains
 * the final arbiter, then the namespace is retained for the next retry.
 */
export function applyProductSyncNamespace(db: EngineDB, remoteInput: EcosystemSyncNamespace): EngineDB {
  const remote = sanitizeEcosystemNamespace(remoteInput);
  const ecosystem = mergeEcosystemNamespaces(db.ecosystem ?? emptyEcosystemNamespace(db.core), remote);
  let merged = db;
  for (const domain of ['strength', 'conditioning'] as const) {
    const payload = payloadToDB(remote.partitions[domain]?.data);
    if (payload) merged = mergeEngines(merged, sanitizeDB(payload));
  }
  merged = {
    ...merged,
    core: ecosystem.core,
    ecosystem,
  };
  return sanitizeDB(merged);
}
