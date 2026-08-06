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

export const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: { user: mockUser } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
    signOut: async () => ({ error: null }),
  },
  from: () => {
    // Chainable exactly as far as sync.tsx chains it: .select().eq().maybeSingle()
    // and .upsert(). Anything else would be inventing a contract.
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: mockRow.state ? { state: mockRow.state, updated_at: '2026-08-05T00:00:00.000Z' } : null,
        error: null,
      }),
      upsert: async (row: { user_id: string; state: Record<string, unknown> }) => {
        // The window a concurrent local edit lands in: the push has been sent
        // and not yet returned, so `reconcile`'s pre-push snapshot is stale.
        const during = mockDuringPush.fn;
        mockDuringPush.fn = null;
        if (during) during();
        mockPushes.push(row.state);
        mockRow.state = row.state;
        return { error: null };
      },
    };
    return q;
  },
};

/** beforeEach body shared by every sync test file. */
export const resetServer = () => {
  mockRow.state = null;
  mockPushes.length = 0;
  mockDuringPush.fn = null;
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
