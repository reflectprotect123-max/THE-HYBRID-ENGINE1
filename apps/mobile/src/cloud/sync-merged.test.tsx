/*
 * The real sync provider, driven end to end — MERGED app (env unset).
 *
 * The merged app hosts both worlds, so unlike sync.test.tsx's legacy build it
 * must keep BOTH kinds on device: nothing is pruned, in any direction. These
 * tests are the C1/C2 lessons pointed the other way — the partition path they
 * guard is the one thing that must NOT happen here.
 *
 * Same file-registry tricks as sync.test.tsx (see its comments): env bound
 * before the lazy requires, fake Supabase via file-level jest.mock, server
 * mock shared from syncHarness. Additionally the ecosystem module is mocked
 * with its flag ON so the writer identity and namespace shape are observable;
 * the namespace itself is built by the real engine code, whose correctness
 * ecosystem-merged.test.ts (engine suite) already proves.
 */
import { act, render } from '@testing-library/react-native';
import type { EngineDB } from '@hybrid/engine';
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
  seedRemote,
  workout,
} from '../../test/syncHarness';

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockClient }));

/** writer + namespace handed to pushEcosystem, captured per push. */
const mockEcosystemPushes: { writer: string; partitions: string[] }[] = [];
jest.mock('./ecosystem', () => ({
  ECOSYSTEM_SYNC_ENABLED: true,
  pullEcosystem: async () => null,
  pushEcosystem: async (_client: unknown, source: EngineDB, writer: string) => {
    mockEcosystemPushes.push({
      writer,
      partitions: Object.keys(source.ecosystem?.partitions ?? {}).sort(),
    });
    // The real `pushEcosystem` reports the domains the server's revision guard
    // refused alongside the namespace; nothing is refused here.
    return { namespace: source.ecosystem, stale: [] };
  },
  applyProductSyncNamespace: (db: EngineDB) => db,
}));

/* ---- the modules under test, env bound first ----------------------------- */

const PREVIOUS_PRODUCT = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;

type SyncModule = typeof import('./sync');

declare const require: (id: string) => unknown;

const sync = require('./sync') as SyncModule;
const { DbProvider, useDb } = require('../store/db') as typeof import('../store/db');
/* SyncProvider reads the nutrition slice as well as the engine one, so the
   harness has to supply both stores — the mount is what proves the two
   providers are genuinely siblings and neither owns the other. */
const { NutritionProvider } = require('../store/nutrition') as typeof import('../store/nutrition');

afterAll(() => {
  if (PREVIOUS_PRODUCT === undefined) delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  else process.env.EXPO_PUBLIC_HYBRID_PRODUCT = PREVIOUS_PRODUCT;
});

beforeEach(() => {
  resetServer();
  mockEcosystemPushes.length = 0;
});

/* ---- per-file harness ---------------------------------------------------- */

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
      <NutritionProvider>
        <sync.SyncProvider>
          <Probe />
        </sync.SyncProvider>
      </NutritionProvider>
    </DbProvider>,
  );

const settle = async () => {
  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
};

/* ---- tests --------------------------------------------------------------- */

it('starts with the retired product variable unset', () => {
  // The merged app has no flavor flag; product.ts only guards against a
  // stale profile setting the retired variable (see product.test.ts).
  expect(process.env.EXPO_PUBLIC_HYBRID_PRODUCT).toBeUndefined();
});

it('keeps BOTH kinds on device after a reconcile', async () => {
  seed({ workouts: [STRENGTH] });
  seedRemote({ workouts: [CONDITIONING] });
  mount();
  await settle();

  expect(syncApi.error).toBe('');
  // The merged app prunes nothing: the remote conditioning workout lands and
  // stays, next to the local strength one.
  expect(dbApi.db.workouts.map((w) => w.id).sort()).toEqual(['w-conditioning', 'w-strength']);
});

it('upgrade path: a device previously narrowed to strength recovers conditioning from the server', async () => {
  // What a partitioned strength install left on disk…
  seed({ workouts: [STRENGTH] });
  // …while the server still holds the legacy mixed blob.
  seedRemote({ workouts: [STRENGTH, CONDITIONING] });
  mount();
  await settle();

  expect(syncApi.error).toBe('');
  expect(dbApi.db.workouts.map((w) => w.id).sort()).toEqual(['w-conditioning', 'w-strength']);
  // And nothing on the server lost a kind in the process.
  expect(pushedWorkoutIds(mockRow.state as Record<string, unknown>)).toEqual(
    expect.arrayContaining(['w-strength', 'w-conditioning']),
  );
});

it('writes as hybrid:mobile with both ecosystem partitions', async () => {
  seed({ workouts: [STRENGTH, CONDITIONING] });
  mount();
  await settle();
  await act(async () => {
    await syncApi.syncNow();
  });

  expect(syncApi.error).toBe('');
  expect(mockEcosystemPushes.length).toBeGreaterThan(0);
  const last = mockEcosystemPushes[mockEcosystemPushes.length - 1];
  expect(last.writer).toBe('hybrid:mobile');
  // Both product partitions must be present. The namespace also carries the
  // athleteState/weeklyPlan domains — those belong to whole-athlete-state and
  // the Coordinator and are none of this test's business.
  expect(last.partitions).toEqual(expect.arrayContaining(['conditioning', 'strength']));
});

it('a conditioning set logged mid-push survives — the 5 Aug residual is gone here', async () => {
  seed({ workouts: [STRENGTH] });
  mount();

  // In the legacy build this exact window could still lose an OTHER-product
  // record (documented residual in sync.tsx). In the merged app nothing is
  // pruned, so it must survive.
  mockDuringPush.fn = () => {
    dbApi.update((draft) => {
      draft.workouts.push(workout('w-cond-mid-push', 'conditioning'));
    });
  };

  await settle();

  expect(syncApi.error).toBe('');
  expect(mockDuringPush.fn).toBeNull(); // the race was actually exercised
  expect(dbApi.db.workouts.map((w) => w.id).sort()).toEqual(['w-cond-mid-push', 'w-strength']);
});
