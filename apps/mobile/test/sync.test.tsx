/*
 * The real sync provider, driven end to end — LEGACY single-product build.
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
 * build's product only. The merged app's counterpart lives in
 * sync-merged.test.tsx; the fake server and fixtures are shared via
 * syncHarness.tsx.
 *
 * The global Supabase mock in test/setup.ts returns a null client on purpose —
 * every other test wants the signed-out degradation. This file wants the
 * opposite, so it overrides that mock for its own module registry, which is
 * what a file-level jest.mock does.
 */
import { act, render } from '@testing-library/react-native';
import {
  CONDITIONING,
  STRENGTH,
  mockClient,
  mockDuringPush,
  mockPushes,
  mockRow,
  pushedWorkoutIds,
  resetServer,
  seed,
  workout,
} from './syncHarness';

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockClient }));

/* ---- the module under test ---------------------------------------------- */

/*
 * `src/product.ts` reads EXPO_PUBLIC_HYBRID_PRODUCT once, at module eval, so
 * it has to be set BEFORE anything pulls that module in. Static imports are
 * hoisted above this line, which is why sync.tsx is reached by a deferred
 * require below instead — nothing imported above touches src/product (the
 * harness deliberately imports no src/cloud or src/product module).
 *
 * Unset now means the MERGED app (see product.ts) — naming `strength` here is
 * what keeps this file asserting about a legacy strength build.
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

beforeEach(resetServer);

/* ---- harness (per-file: needs the lazily-required sync module) ----------- */

/**
 * The app's own provider order: DbProvider outside, because SyncProvider reads
 * the store through `useDb()` (see App.tsx). The store module is required
 * lazily for the same reason sync is — store/db.tsx reaches src/product, so a
 * static import would hoist product's env read above the binding line.
 */
const { DbProvider, useDb } = require('../src/store/db') as typeof import('../src/store/db');

type SyncApi = ReturnType<SyncModule['useSync']>;
type DbApi = ReturnType<typeof useDb>;

let syncApi!: SyncApi;
let dbApi!: DbApi;

function Probe() {
  syncApi = sync.useSync();
  dbApi = useDb();
  return null;
}

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
  expect(product.IS_MERGED).toBe(false);
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
