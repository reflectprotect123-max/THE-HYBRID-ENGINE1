/*
 * WHOOP's write into the shared core, and the one thing it must not do.
 *
 * `cloudFp` — the training sync's dirty check — excludes `settings.whoopDaily`
 * precisely so a WHOOP poll cannot churn a push. It does NOT exclude `core`,
 * and `recordDaily` writes `core.updatedAt: Date.now()` on the same path. So
 * for as long as that write was unconditional, every poll (including the
 * automatic background refresh, and the one that runs on every mount) changed
 * the fingerprint and armed a FULL training-data push with nothing about the
 * athlete's training having changed.
 *
 * The provider is driven through its real `refresh()`, over a faked `fetch`:
 * the point is what lands in the store, and mocking `recordDaily` itself would
 * test nothing.
 */
import { act, render } from '@testing-library/react-native';
import { cloudFp, ymd } from '@hybrid/engine';
import { DbProvider, useDb } from '../store/db';

/* WhoopProvider is mounted inside SyncProvider in the app and reads the
   signed-in user from it. Nothing here needs cloud sync — and mounting the real
   provider would drag a Supabase client and the whole push path into a test
   about a local write. */
jest.mock('./sync', () => ({ useSync: () => ({ user: null }) }));

/* whoop.tsx builds its own read-only Supabase client for the access token. With
   no SUPABASE config in the test env it is never constructed; this keeps the
   test honest if that ever changes. */
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { useWhoop, WhoopProvider } from './whoop';

const TODAY = ymd(new Date());

/** What the integrations-status function answers with. Mutable per test. */
let statusBody: Record<string, unknown> = {};

const sample = (over: Record<string, unknown> = {}) => ({
  date: TODAY,
  recoveryScore: 72,
  strain: 9.4,
  hrvMs: 54,
  restingHr: 49,
  sleepPerformance: 88,
  capturedAt: '2026-08-10T06:00:00.000Z',
  source: 'whoop',
  ...over,
});

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  statusBody = { whoop: { connected: true, normalized: sample(), lastSyncAt: '2026-08-10T06:05:00.000Z' } };
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => statusBody,
  }));
});

type DbApi = ReturnType<typeof useDb>;
type WhoopApi = ReturnType<typeof useWhoop>;

let dbApi!: DbApi;
let whoopApi!: WhoopApi;

function Probe() {
  dbApi = useDb();
  whoopApi = useWhoop();
  return null;
}

const mount = () =>
  render(
    <DbProvider>
      <WhoopProvider>
        <Probe />
      </WhoopProvider>
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

it('records the day the first time it hears about it', async () => {
  mount();
  await settle();

  const row = dbApi.db.core?.whoopDaily.find((r) => r.date === TODAY);
  expect(row).toMatchObject({ recoveryScore: 72, hrvMs: 54, restingHr: 49, sleepPerformance: 88 });
});

it('does not touch core — or the sync fingerprint — when the poll learns nothing new', async () => {
  /* The clock is driven deliberately. `recordDaily`'s stamp is `Date.now()`,
     and two writes inside the same millisecond produce the SAME stamp — so a
     real-time version of this test passes against the unconditional write it
     exists to catch. A minute between the two polls is what makes the
     difference between "skipped the write" and "wrote the same thing" visible. */
  jest.useFakeTimers();
  mount();
  await settle();

  const before = dbApi.db.core?.updatedAt;
  const fpBefore = cloudFp(dbApi.db);
  expect(before).toBeTruthy();

  jest.setSystemTime(Date.now() + 60_000);
  // The same day, the same numbers: exactly what every subsequent poll returns.
  await act(async () => {
    await whoopApi.refresh();
  });
  await settle();

  expect(dbApi.db.core?.updatedAt).toBe(before);
  expect(cloudFp(dbApi.db)).toBe(fpBefore);
});

it('still records the day when a number actually changed', async () => {
  jest.useFakeTimers();
  mount();
  await settle();
  const fpBefore = cloudFp(dbApi.db);

  jest.setSystemTime(Date.now() + 60_000);
  statusBody = { whoop: { connected: true, normalized: sample({ recoveryScore: 41, strain: 14.2 }) } };
  await act(async () => {
    await whoopApi.refresh();
  });
  await settle();

  expect(dbApi.db.core?.whoopDaily.find((r) => r.date === TODAY)).toMatchObject({
    recoveryScore: 41,
    strain: 14.2,
  });
  // The fingerprint MOVES here — a real reading is exactly what a push is for.
  // (`core.updatedAt` alone would be a poor assertion: two writes inside the
  // same millisecond carry the same stamp.)
  expect(cloudFp(dbApi.db)).not.toBe(fpBefore);
  // One row for the day, not two.
  expect(dbApi.db.core?.whoopDaily.filter((r) => r.date === TODAY)).toHaveLength(1);
});
