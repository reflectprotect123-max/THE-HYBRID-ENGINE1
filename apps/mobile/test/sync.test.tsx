/*
 * The real sync provider, driven end to end.
 *
 * The engine suite already proves `restrictToProduct`, `applyPull` and
 * `buildPushState` behave in isolation. It cannot prove that sync.tsx CALLS
 * them in the right order — and that ordering is the whole bug: filtering the
 * push payload, or either operand going into the merge, permanently loses the
 * other product's records (a locally-authored never-synced workout; a legacy
 * mixed record's conditioning half). A regression that moved the filter back
 * up to those call sites would have left every engine test green.
 *
 * So this file mounts the actual `DbProvider`/`SyncProvider` pair the app
 * mounts, against a fake Supabase, and asserts the two halves of the invariant
 * separately: what goes UP must be unfiltered, what stays on DISK must be this
 * build's product only.
 *
 * The global Supabase mock in test/setup.ts returns a null client on purpose —
 * every other test wants the signed-out degradation. This file wants the
 * opposite, so it overrides that mock for its own module registry, which is
 * what a file-level jest.mock does.
 */
import { act, render } from '@testing-library/react-native';
import { LS_KEY, type EngineDB, type Workout } from '@hybrid/engine';
import { DbProvider, useDb } from '../src/store/db';
import { storage } from '../src/store/storage';

/* ---- the fake server ---------------------------------------------------- */

/** The single `app_state` row, as the server holds it. Starts absent. */
const mockRow: { state: Record<string, unknown> | null } = { state: null };
/** Every `state` payload handed to `.upsert()`, oldest first. */
const mockPushes: Record<string, unknown>[] = [];
/** Runs inside the upsert await — i.e. while a push is genuinely in flight. */
const mockDuringPush: { fn: (() => void) | null } = { fn: null };

const mockUser = {
  id: 'athlete-1',
  aud: 'authenticated',
  email: 'athlete@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};

const mockClient = {
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

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockClient }));

/* ---- the module under test ---------------------------------------------- */

/*
 * `src/product.ts` reads EXPO_PUBLIC_HYBRID_PRODUCT once, at module eval, so
 * it has to be set BEFORE anything pulls that module in. Static imports are
 * hoisted above this line, which is why sync.tsx is reached by a dynamic
 * import below instead — nothing imported above touches src/product.
 *
 * Unset would also mean strength (that is the repo's convention, and what the
 * strength EAS profiles rely on); naming it is what makes this test still
 * assert about a strength build if that ever changes.
 */
const PREVIOUS_PRODUCT = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
process.env.EXPO_PUBLIC_HYBRID_PRODUCT = 'strength';

type SyncModule = typeof import('../src/cloud/sync');
type ProductModule = typeof import('../src/product');

/* babel-preset-expo leaves `import()` as a NATIVE dynamic import, which jest
   cannot execute without --experimental-vm-modules; `require` is the deferred
   load that works here, and it still goes through the mocked registry above.
   Declared locally because this package's tsconfig does not pull in node's
   global types. */
declare const require: (id: string) => unknown;

const sync = require('../src/cloud/sync') as SyncModule;
const product = require('../src/product') as ProductModule;

afterAll(() => {
  if (PREVIOUS_PRODUCT === undefined) delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  else process.env.EXPO_PUBLIC_HYBRID_PRODUCT = PREVIOUS_PRODUCT;
});

beforeEach(() => {
  mockRow.state = null;
  mockPushes.length = 0;
  mockDuringPush.fn = null;
});

/* ---- fixtures ----------------------------------------------------------- */

const workout = (id: string, kind: 'strength' | 'conditioning'): Workout => ({
  id,
  kind,
  name: id,
  blocks: [],
  updatedAt: 1_700_000_000_000,
});

const STRENGTH = workout('w-strength', 'strength');
const CONDITIONING = workout('w-conditioning', 'conditioning');

const seed = (db: Partial<EngineDB>) => {
  const full: EngineDB = { workouts: [], sessions: [], settings: {}, ...db };
  storage.setItem(LS_KEY, JSON.stringify(full));
};

/** The workout ids in whatever a push put on the wire. */
const pushedWorkoutIds = (state: Record<string, unknown>): string[] =>
  ((state.hybridEngine as EngineDB).workouts || []).map((w) => w.id);

/* ---- harness ------------------------------------------------------------ */

type SyncApi = ReturnType<SyncModule['useSync']>;
type DbApi = ReturnType<typeof useDb>;

let syncApi!: SyncApi;
let dbApi!: DbApi;

function Probe() {
  syncApi = sync.useSync();
  dbApi = useDb();
  return null;
}

/**
 * The app's own provider order: DbProvider outside, because SyncProvider reads
 * the store through `useDb()` (see App.tsx).
 */
const mount = () =>
  render(
    <DbProvider>
      <sync.SyncProvider>
        <Probe />
      </sync.SyncProvider>
    </DbProvider>,
  );

/**
 * Let the mount-time auth handshake and the reconcile it triggers run to
 * completion. `getSession()` resolves a promise, that sets `user`, and the
 * effect keyed on `user` fires `reconcile` without awaiting it — so there is a
 * chain of microtask generations to drain before the store has settled. Timers
 * are faked suite-wide, so this cannot be a sleep.
 */
const settle = async () => {
  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
};

/* ---- tests -------------------------------------------------------------- */

it('reads its product from the environment', () => {
  expect(product.PRODUCT_ID).toBe('strength');
});

it('pushes both products unfiltered and keeps only its own on the device', async () => {
  seed({ workouts: [STRENGTH, CONDITIONING] });
  mount();
  await settle();

  // A second, explicit reconcile through the public API — the mount-time one
  // has finished by now, so this is not swallowed by the in-flight guard.
  await act(async () => {
    await syncApi.syncNow();
  });

  expect(syncApi.error).toBe('');
  expect(mockPushes.length).toBeGreaterThan(0);

  // C2's guard: the push payload is built from the UNFILTERED merge. If the
  // product filter is ever moved back above `buildPushState`, the conditioning
  // workout silently stops being backed up and this fails.
  expect(pushedWorkoutIds(mockPushes[0])).toEqual(
    expect.arrayContaining(['w-strength', 'w-conditioning']),
  );

  // ...and it is still on the server after the device has pruned it locally,
  // which is what makes the pruning below non-destructive (C1's guard).
  expect(pushedWorkoutIds(mockRow.state as Record<string, unknown>)).toEqual(
    expect.arrayContaining(['w-strength', 'w-conditioning']),
  );

  // The feature itself: a strength build carries strength records only.
  expect(dbApi.db.workouts.map((w) => w.id)).toEqual(['w-strength']);
});

it('does not clobber a set logged while the post-pull push is still in flight', async () => {
  seed({ workouts: [STRENGTH, CONDITIONING] });
  mount();

  // Fires inside the upsert await, so it lands in the store AFTER reconcile
  // took the snapshot it writes back — the exact race that an overwriting
  // write-back discarded.
  mockDuringPush.fn = () => {
    dbApi.update((draft) => {
      draft.workouts.push(workout('w-logged-mid-push', 'strength'));
    });
  };

  await settle();

  expect(syncApi.error).toBe('');
  expect(mockDuringPush.fn).toBeNull(); // the race was actually exercised
  expect(dbApi.db.workouts.map((w) => w.id).sort()).toEqual(['w-logged-mid-push', 'w-strength']);
});
