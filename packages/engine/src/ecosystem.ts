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
   *
   * `liftProgress` was removed from this Pick on 19 August 2026: the field was
   * deleted from `Settings` with the rest of old strength (17 August 2026) and
   * only still compiled here via Settings' index signature. Legacy data an old
   * client pushed still flows regardless: `payloadToDB` passes the settings
   * blob through opaquely and `mergeSettings`' winner-wins Object.assign
   * carries unknown keys — the field was only ever re-projected on the way
   * out, never filtered on the way in.
   */
  settings: Partial<Pick<Settings, 'conProgress' | 'conditioning' | 'conditioningAck' | 'mobility' | 'folders' | 'deletedIds'>>;
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
    /*
     * The nutrition partition round-trips through this function — it survived
     * `sanitizeEcosystemNamespace` and `mergeEcosystemNamespaces` above, and
     * `readNutritionPartition(remoteInput)` is how the caller collects it —
     * but it is deliberately NOT retained in the EngineDB.
     *
     * `cloudFp` hashes `db.ecosystem`, so a food log parked in here would make
     * every meal dirty the TRAINING fingerprint and push the whole training
     * blob to `app_state`. Dropping it is what makes the two slices independent
     * rather than merely separately stored.
     */
    ecosystem: { ...ecosystem, partitions: { ...ecosystem.partitions, nutrition: undefined } },
  };
  return sanitizeDB(merged);
}

/**
 * Namespace for the MERGED mobile app: both domain partitions, composed from
 * the single-domain builder so every contract rule that holds for one domain
 * holds for both — this is deliberately not a third code path. Order
 * (strength, then conditioning) is arbitrary but fixed; the second call
 * receives the first call's core and namespace so bookkeeping is threaded,
 * not forked.
 */
export function buildMergedSyncNamespace(
  db: EngineDB,
  writer: string,
  now = Date.now(),
): EcosystemSyncNamespace {
  const first = buildProductSyncNamespace(db, 'strength', writer, now);
  const threaded = { ...db, core: first.core, ecosystem: first };
  return buildProductSyncNamespace(threaded, 'conditioning', writer, now);
}

/**
 * Every domain snapshot the apps read and write, in ONE list.
 *
 * A reviewer counted three hand-maintained copies of this (the pull filter in
 * each app, the push loop in the merged app), and a list that drifts is a
 * domain written but never read back, or read and never written — invisible
 * until an athlete's data is already one-way. Reads may scope to this list;
 * nothing here ever filters the RECORDS inside a snapshot.
 */
export const SYNCED_SNAPSHOT_DOMAINS = ['strength', 'conditioning', 'nutrition'] as const;

/**
 * Carry the nutrition slice as its own partition.
 *
 * SHAPE: a sibling of `buildMergedSyncNamespace` taking an already-built
 * namespace plus an opaque payload — NOT a fourth argument to that function.
 * `buildMergedSyncNamespace` exists to PROJECT an `EngineDB` into partitions;
 * handing it the nutrition blob as well would put a workout and a food log in
 * one function's scope, one mis-scoped filter away from writing training
 * records into the nutrition partition or the reverse. That is the exact shape
 * of the two merges that already cost this repo user data. Here `productData`
 * holds no nutrition and this holds no `EngineDB`, so the corruption is not a
 * bug to be avoided — it is a value neither function can reach.
 *
 * `data` stays `unknown` for the same reason: @hybrid/engine models no
 * nutrition schema and must not start, so no engine change can reshape the
 * payload. @hybrid/nutrition-core owns sanitize and merge at both ends.
 */
export function withNutritionPartition(
  namespace: EcosystemSyncNamespace,
  data: unknown,
  writer: string,
  now = Date.now(),
): EcosystemSyncNamespace {
  const previous = namespace.partitions.nutrition;
  // Content-based revisions, as in buildProductSyncNamespace: a retried push
  // must not manufacture a snapshot newer than the one the server already holds.
  const unchanged = previous !== undefined
    && JSON.stringify(previous.data ?? null) === JSON.stringify(data ?? null);
  const next: VersionedSnapshot<unknown> = unchanged
    ? previous
    : {
        schemaVersion: 1,
        domain: 'nutrition',
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: now,
        writer,
        data,
      };
  return { ...namespace, partitions: { ...namespace.partitions, nutrition: next } };
}

/**
 * The opaque nutrition payload a pull returned, for @hybrid/nutrition-core to
 * sanitize and merge. Returns `undefined` when the server has never been told
 * about this athlete's nutrition — which is not the same as an empty slice, and
 * the caller must not confuse the two into a write.
 */
export function readNutritionPartition(namespace: EcosystemSyncNamespace): unknown {
  return namespace.partitions.nutrition?.data;
}
