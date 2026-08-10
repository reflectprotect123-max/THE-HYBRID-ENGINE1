/*
 * The real sync provider, driven end to end — MERGED app (env unset).
 *
 * The merged app hosts both worlds, so unlike a single-product build it must
 * keep BOTH kinds on device: nothing is pruned, in any direction. The first
 * tests here are the C1/C2 lessons pointed the other way — the partition path
 * they guard is the one thing that must NOT happen here.
 *
 * Same file-registry tricks throughout: env bound before the lazy requires,
 * fake Supabase via file-level jest.mock, server mock shared from syncHarness.
 *
 * WHAT CHANGED (Aug 2026): `./ecosystem` used to be MOCKED here, with
 * `pullEcosystem: async () => null` and a hardcoded `stale: []`. That mock made
 * the writer identity observable and everything else invisible — the revision
 * arithmetic, the server's monotonic guard, the nutrition partition's base, and
 * the client's handling of a refused push all sat behind it, and three
 * data-losing bugs lived in exactly that gap with this suite green. The real
 * module now runs against a fake server that reproduces
 * `upsert_athlete_domain_snapshot`'s predicate and boolean return
 * (supabase/migrations/20260807_nutrition_domain.sql).
 */
import { act, render } from '@testing-library/react-native';
import type { EngineDB } from '@hybrid/engine';
import { emptyNutritionDB, type FoodLogEntry, type NutritionDB } from '@hybrid/nutrition-core';
import {
  CONDITIONING,
  STRENGTH,
  gatePush,
  mockClient,
  mockDuringPush,
  mockEcosystem,
  mockGate,
  mockPushLog,
  mockRow,
  pushedWorkoutIds,
  remoteNutrition,
  resetServer,
  seed,
  seedRemote,
  seedRemoteNutrition,
  workout,
} from '../../test/syncHarness';

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockClient }));

/* ---- the modules under test, env bound first ----------------------------- */

const PREVIOUS_PRODUCT = process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
/* The ecosystem path is what every test below exercises, and the flag is read
   once at module scope — so it has to be bound before the requires, not in a
   beforeEach. */
const PREVIOUS_ECOSYSTEM = process.env.EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC;
process.env.EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC = '1';

type SyncModule = typeof import('./sync');

declare const require: (id: string) => unknown;

const sync = require('./sync') as SyncModule;
const { DbProvider, useDb } = require('../store/db') as typeof import('../store/db');
/* SyncProvider reads the nutrition slice as well as the engine one, so the
   harness has to supply both stores — the mount is what proves the two
   providers are genuinely siblings and neither owns the other. */
const { NutritionProvider, useNutrition } = require('../store/nutrition') as typeof import('../store/nutrition');

afterAll(() => {
  if (PREVIOUS_PRODUCT === undefined) delete process.env.EXPO_PUBLIC_HYBRID_PRODUCT;
  else process.env.EXPO_PUBLIC_HYBRID_PRODUCT = PREVIOUS_PRODUCT;
  if (PREVIOUS_ECOSYSTEM === undefined) delete process.env.EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC;
  else process.env.EXPO_PUBLIC_HYBRID_ECOSYSTEM_SYNC = PREVIOUS_ECOSYSTEM;
});

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  jest.useRealTimers();
});

/* ---- per-file harness ---------------------------------------------------- */

type SyncApi = ReturnType<SyncModule['useSync']>;
type DbApi = ReturnType<typeof useDb>;
type NutritionApi = ReturnType<typeof useNutrition>;

let syncApi!: SyncApi;
let dbApi!: DbApi;
let nutritionApi!: NutritionApi;

function Probe() {
  syncApi = sync.useSync();
  dbApi = useDb();
  nutritionApi = useNutrition();
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

/** Let the 900ms debounce fire and the push it starts run to completion. */
const flushDebouncedPush = async () => {
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  await settle();
};

/* ---- nutrition fixtures -------------------------------------------------- */

const entry = (id: string, updatedAt = '2026-08-05T10:00:00.000Z'): FoodLogEntry => ({
  id,
  userId: 'athlete-1',
  logDate: '2026-08-05',
  meal: 'breakfast',
  entryKind: 'quick_add',
  foodId: null,
  customFoodId: null,
  recipeId: null,
  quantity: 1,
  unit: 'serving',
  calories: 100,
  proteinG: 10,
  carbsG: 10,
  fatG: 1,
  displayName: id,
  nutrients: {},
  notes: null,
  sourceSnapshot: {},
  createdAt: updatedAt,
  updatedAt,
  deletedAt: null,
});

const slice = (ids: string[], schemaVersion = 1): NutritionDB => ({
  ...emptyNutritionDB(),
  schemaVersion,
  logEntries: ids.map((id) => entry(id)),
});

const logMeal = (id: string) =>
  act(() => {
    nutritionApi.update((draft) => {
      draft.logEntries.push(entry(id));
    });
  });

const remoteMealIds = (): string[] =>
  ((remoteNutrition()?.snapshot as NutritionDB | undefined)?.logEntries ?? []).map((e) => e.id).sort();

const nutritionWrites = () => mockEcosystem.writes.filter((w) => w.domain === 'nutrition');

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
  // Read off the fake server rather than off a mocked push: these are the rows
  // `upsert_athlete_domain_snapshot` actually accepted.
  expect(mockEcosystem.domains.get('strength')?.writer).toBe('hybrid:mobile');
  expect(mockEcosystem.domains.get('conditioning')?.writer).toBe('hybrid:mobile');
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

/* ---- the nutrition revision base ----------------------------------------- */

it('advances the nutrition base after a push, so a second meal in the same session is not stale', async () => {
  /*
   * The bug this pins: `pushEcosystem` returns a training-only namespace, so
   * the ONLY writer of the locally-cached nutrition revision used to be the
   * pull. A second meal logged before the next reconcile therefore computed its
   * revision from the revision the server had already moved past — the guard's
   * whole purpose defeated for the rest of the foreground session.
   *
   * Deliberately NO reconcile between the two meals: a reconcile refreshes the
   * base from the server and would hide exactly what is under test. That is
   * also why this drives the 900ms debounce rather than `syncNow`.
   */
  jest.useFakeTimers();
  seedRemoteNutrition(slice(['r-1']), 5);
  seed({ workouts: [STRENGTH] });
  mount();
  await settle();

  await logMeal('m-1');
  await flushDebouncedPush();
  await logMeal('m-2');
  await flushDebouncedPush();

  const writes = nutritionWrites();
  expect(writes.length).toBeGreaterThanOrEqual(2);
  // Not one refusal, and the revision strictly climbs: 5 on the server, 6 for
  // the first meal, 7 for the second. Before the fix the second push re-used 6.
  expect(writes.every((w) => w.accepted)).toBe(true);
  expect(remoteNutrition()?.revision).toBe(7);
  expect(remoteMealIds()).toEqual(['m-1', 'm-2', 'r-1']);
  expect(syncApi.error).toBe('');
});

it('does not claim a sync when the server refused the push', async () => {
  // The server's revision guard drops a snapshot that is not ahead of what it
  // holds, with no error. `pushNow` used to stamp `syncedAt` on that path
  // anyway, so Settings rendered "Last synced <time>" for a write that never
  // happened — which is what made the stale-revision bug invisible.
  mockEcosystem.refuse.add('strength');
  seed({ workouts: [STRENGTH] });
  mount();
  await settle();

  expect(mockEcosystem.writes.some((w) => w.domain === 'strength' && !w.accepted)).toBe(true);
  expect(syncApi.syncedAt).toBe(0);
  expect(syncApi.error).toMatch(/have not been sent/i);
});

it('a nutrition schema mismatch blocks the nutrition PUSH, not just the merge', async () => {
  /*
   * `mergeNutrition` throws when the two slices disagree on `schemaVersion`,
   * and `reconcileNutrition` catches it and answers "no push owed". That was
   * never enough: the push arms off its own fingerprint and a carry-forward
   * flag that is true whenever a remote partition exists, so it fired anyway
   * and sent this build's OLDER slice on the NEWER remote's revision —
   * overwriting a divergence it had just admitted it could not read.
   */
  seedRemoteNutrition(slice(['r-1'], 2), 5);
  seed({ workouts: [STRENGTH] });
  mount();
  await settle();

  // The training sync around it still ran…
  expect(mockEcosystem.domains.get('strength')?.writer).toBe('hybrid:mobile');
  // …and the nutrition partition was not touched, in any revision.
  expect(nutritionWrites()).toHaveLength(0);
  expect(remoteNutrition()?.revision).toBe(5);
  expect(remoteMealIds()).toEqual(['r-1']);
  // And the athlete is told, rather than the divergence being discarded.
  expect(syncApi.error).toMatch(/nutrition/i);
});

it('keeps the nutrition push blocked for later writes in the same session', async () => {
  jest.useFakeTimers();
  seedRemoteNutrition(slice(['r-1'], 2), 5);
  mount();
  await settle();

  // A meal logged after the refusal must not re-open the path: this build still
  // cannot read what the server holds.
  await logMeal('m-1');
  await flushDebouncedPush();

  expect(nutritionWrites()).toHaveLength(0);
  expect(remoteMealIds()).toEqual(['r-1']);
});

it('serialises pushes, so a debounced push cannot overlap a reconcile s own', async () => {
  /*
   * `reconcile` has always had an in-flight guard; `pushNow` had none, and the
   * debounce calls it directly. Two pushes were therefore free to be on the
   * wire at once, and the one that landed last won the server's equal-revision
   * tiebreak — regardless of which carried the merged data.
   *
   * What is asserted is the property the fix guarantees: the pushes are ordered
   * against each other, never interleaved. (The data-loss variant of this race
   * is not reproducible from the outside: both pushes read the live refs when
   * their turn comes, so once they are ordered they carry the same merged
   * slice.)
   */
  jest.useFakeTimers();
  seedRemoteNutrition(slice(['r-1']), 5);
  mount();
  await settle();
  mockPushLog.length = 0;

  await logMeal('m-1');
  gatePush(); // the debounced push will block mid-flight
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });

  // Another device's entry appears while that push hangs, and the athlete
  // foregrounds the app / taps Sync now.
  seedRemoteNutrition(slice(['r-1', 'r-2']), 6, '2026-08-05T12:00:00.000Z');
  let reconciled!: Promise<void>;
  await act(async () => {
    reconciled = syncApi.syncNow();
    await Promise.resolve();
  });
  await act(async () => {
    mockGate.release?.();
    await reconciled;
  });
  await settle();

  // No push started while another was still on the wire.
  const starts = mockPushLog.filter((l) => l.startsWith('push:'));
  for (let i = 0; i < starts.length; i += 2) {
    expect(starts[i]).toBe('push:start');
    expect(starts[i + 1]).toBe('push:state-written');
  }
  expect(starts.length % 2).toBe(0);
  // And the other device's entry is still on the server afterwards.
  expect(remoteMealIds()).toEqual(['m-1', 'r-1', 'r-2']);
});
