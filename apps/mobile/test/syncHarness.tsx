/*
 * Shared server-side of the sync tests: the fake Supabase and the fixtures.
 *
 * Deliberately NO React here, and no import that reaches src/product or
 * src/cloud/* — sync test files must bind EXPO_PUBLIC_* env vars BEFORE those
 * modules evaluate, and a static import from this harness runs first (imports
 * hoist). Each test file therefore keeps its own Probe/mount/settle and
 * requires the modules under test lazily; this file owns only what is safe to
 * share. Jest gives every test file its own module registry, so the mutable
 * state below is per-file, not cross-file.
 */
import { LS_KEY, type EngineDB, type Workout } from '@hybrid/engine';
import { storage } from '../src/store/storage';
/* Both storage KEYS, so the device can be wiped between tests. Leaf modules —
   neither reaches src/product or src/cloud/*, so the import-order rule above
   still holds. */
import { NUTRITION_LS_KEY } from '../src/store/nutrition';

/** The single `app_state` row, as the server holds it. Starts absent. */
export const mockRow: { state: Record<string, unknown> | null } = { state: null };
/** Every `state` payload handed to `.upsert()`, oldest first. */
export const mockPushes: Record<string, unknown>[] = [];
/** Runs inside the upsert await — i.e. while a push is genuinely in flight. */
export const mockDuringPush: { fn: (() => void) | null } = { fn: null };

export const mockUser = {
  id: 'athlete-1',
  aud: 'authenticated',
  email: 'athlete@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};

/* ---- the ecosystem tables --------------------------------------------------
 *
 * `athlete_core`, `athlete_domain_snapshots` and `athlete_weekly_plans`, plus
 * the three security-definer RPCs that are the only supported writes to them.
 *
 * `upsert_athlete_domain_snapshot` reproduces the REAL monotonic predicate from
 * supabase/migrations/20260807_nutrition_domain.sql, boolean return included:
 * a snapshot that is not ahead of what the server holds is dropped with no
 * error, and the client is expected to notice via that boolean. Faking a
 * blanket "always accepted" here is precisely what let a stale-revision bug
 * live in the sync layer with a green suite.
 */
export interface DomainSnapshotRow {
  domain: string;
  schema_version: number;
  revision: number;
  writer: string;
  snapshot: unknown;
  client_updated_at: string | null;
}

export const mockEcosystem: {
  core: { schema_version: number; revision: number; writer: string; state: unknown; client_updated_at: string | null } | null;
  domains: Map<string, DomainSnapshotRow>;
  plans: unknown[];
  /** Every domain snapshot write attempt, accepted or not, oldest first. */
  writes: { domain: string; revision: number; accepted: boolean; snapshot: unknown }[];
  /** Domains the server answers `false` for whatever the revision — i.e. some
   *  other writer is ahead. The revision arithmetic is exercised for real
   *  elsewhere; this is how a refusal is put in front of the client on demand. */
  refuse: Set<string>;
} = { core: null, domains: new Map(), plans: [], writes: [], refuse: new Set() };

const ms = (v: string | null | undefined): number => {
  const n = v ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
};

/*
 * Held open while ONE push is in flight, when a test wants to control ordering.
 *
 * Consumed by the first upsert that sees it, so a later push is NOT gated —
 * otherwise the gate itself would serialise the two and the test could not tell
 * a guarded sync layer from an unguarded one.
 */
export const mockGate: { promise: Promise<void> | null; release: (() => void) | null } = {
  promise: null,
  release: null,
};

/** Make the NEXT app_state upsert block until `mockGate.release()` is called. */
export const gatePush = () => {
  mockGate.promise = new Promise<void>((resolve) => {
    mockGate.release = () => {
      mockGate.release = null;
      resolve();
    };
  });
};

/** Push lifecycle, so a test can prove two pushes never overlap on the wire. */
export const mockPushLog: string[] = [];

export const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: { user: mockUser } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
    signOut: async () => ({ error: null }),
  },
  from: (table: string) => {
    // Chainable exactly as far as the cloud modules chain it — app_state's
    // .select().eq().maybeSingle() / .upsert(), and the ecosystem reads'
    // .select().eq().in() and .select().eq().order().limit(). Anything else
    // would be inventing a contract.
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      in: async () => ({ data: Array.from(mockEcosystem.domains.values()), error: null }),
      limit: async () => ({ data: mockEcosystem.plans, error: null }),
      maybeSingle: async () => {
        if (table === 'athlete_core') return { data: mockEcosystem.core, error: null };
        return {
          data: mockRow.state ? { state: mockRow.state, updated_at: '2026-08-05T00:00:00.000Z' } : null,
          error: null,
        };
      },
      upsert: async (row: { user_id: string; state: Record<string, unknown> }) => {
        mockPushLog.push('push:start');
        // The window a concurrent local edit lands in: the push has been sent
        // and not yet returned, so `reconcile`'s pre-push snapshot is stale.
        const during = mockDuringPush.fn;
        mockDuringPush.fn = null;
        if (during) during();
        const gate = mockGate.promise;
        if (gate) {
          mockGate.promise = null;
          await gate;
        }
        mockPushes.push(row.state);
        mockRow.state = row.state;
        mockPushLog.push('push:state-written');
        return { error: null };
      },
    };
    return q;
  },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'upsert_athlete_core') {
      mockEcosystem.core = {
        schema_version: args.p_schema_version as number,
        revision: args.p_revision as number,
        writer: args.p_writer as string,
        state: args.p_state,
        client_updated_at: (args.p_client_updated_at as string) ?? null,
      };
      return { data: true, error: null };
    }
    if (fn === 'upsert_athlete_domain_snapshot') {
      const domain = args.p_domain as string;
      const revision = args.p_revision as number;
      const at = (args.p_client_updated_at as string) ?? null;
      const held = mockEcosystem.domains.get(domain);
      const accepted = mockEcosystem.refuse.has(domain)
        ? false
        : !held
          || held.revision < revision
          || (held.revision === revision && ms(held.client_updated_at) <= ms(at));
      if (accepted) {
        mockEcosystem.domains.set(domain, {
          domain,
          schema_version: args.p_schema_version as number,
          revision,
          writer: args.p_writer as string,
          snapshot: args.p_snapshot,
          client_updated_at: at,
        });
      }
      mockEcosystem.writes.push({ domain, revision, accepted, snapshot: args.p_snapshot });
      if (domain === 'nutrition') mockPushLog.push(`nutrition:${revision}:${accepted ? 'ok' : 'refused'}`);
      return { data: accepted, error: null };
    }
    if (fn === 'record_athlete_event') return { data: true, error: null };
    throw new Error(`unmocked rpc ${fn}`);
  },
};

/** beforeEach body shared by every sync test file.
 *
 *  Clears the DEVICE too. Jest gives each test FILE its own module registry but
 *  not each test, so the MMKV shim behind `storage` is one Map for the whole
 *  file: without this a slice logged in one test is still on disk in the next,
 *  and an assertion about what a device pushed silently includes an earlier
 *  test's meals. */
export const resetServer = () => {
  storage.removeItem(LS_KEY);
  storage.removeItem(NUTRITION_LS_KEY);
  mockRow.state = null;
  mockPushes.length = 0;
  mockDuringPush.fn = null;
  mockEcosystem.core = null;
  mockEcosystem.domains.clear();
  mockEcosystem.plans.length = 0;
  mockEcosystem.writes.length = 0;
  mockEcosystem.refuse.clear();
  mockPushLog.length = 0;
  mockGate.promise = null;
  mockGate.release = null;
};

/** The nutrition partition as the server holds it, if any. */
export const remoteNutrition = (): DomainSnapshotRow | undefined => mockEcosystem.domains.get('nutrition');

/** Seed the server's nutrition partition — i.e. what another device has pushed. */
export const seedRemoteNutrition = (
  snapshot: unknown,
  revision: number,
  clientUpdatedAt = '2026-08-05T00:00:00.000Z',
) => {
  mockEcosystem.domains.set('nutrition', {
    domain: 'nutrition',
    schema_version: 1,
    revision,
    writer: 'hybrid:other-device',
    snapshot,
    client_updated_at: clientUpdatedAt,
  });
};

/* ---- fixtures ----------------------------------------------------------- */

export const workout = (id: string, kind: 'strength' | 'conditioning'): Workout => ({
  id,
  kind,
  name: id,
  blocks: [],
  updatedAt: 1_700_000_000_000,
});

export const STRENGTH = workout('w-strength', 'strength');
export const CONDITIONING = workout('w-conditioning', 'conditioning');

export const seed = (db: Partial<EngineDB>) => {
  const full: EngineDB = { workouts: [], sessions: [], settings: {}, ...db };
  storage.setItem(LS_KEY, JSON.stringify(full));
};

/** Seed the fake server's app_state row directly (a "remote" precondition). */
export const seedRemote = (db: Partial<EngineDB>) => {
  const full: EngineDB = { workouts: [], sessions: [], settings: {}, ...db };
  mockRow.state = { hybridEngine: full };
};

/** The workout ids in whatever a push put on the wire. */
export const pushedWorkoutIds = (state: Record<string, unknown>): string[] =>
  ((state.hybridEngine as EngineDB).workouts || []).map((w) => w.id);
