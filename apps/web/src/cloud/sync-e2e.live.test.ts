/*
 * LIVE end-to-end sync verification — real Supabase backend, real engine
 * primitives, no mocks. Skipped unless SB_E2E=1: it needs network egress to
 * supabase.co and creates one disposable auth user per run, so it belongs in
 * the manually-dispatched sync-e2e workflow, not the ordinary suite.
 *
 * The scenario is the merged app's whole reason to exist: "device A" pushes
 * one strength and one conditioning session; a fresh "device B" pulls and
 * must see BOTH kinds. Before the merge, a partitioned build would have
 * shown one.
 */
import { it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
import {
  applyPull,
  buildPushState,
  emptyDB,
  readNutritionPartition,
  sanitizeDB,
  withNutritionPartition,
  type EngineDB,
  type Session,
  type Workout,
} from '@hybrid/engine';
import { emptyEcosystemNamespace, sanitizeEcosystemNamespace } from '@hybrid/shared-core';
import { emptyNutritionDB, mergeNutrition, sanitizeNutritionDB, type NutritionDB } from '@hybrid/nutrition-core';

it.skipIf(process.env.SB_E2E !== '1')(
  'both disciplines round-trip through the real backend',
  { timeout: 60_000 },
  async () => {
    const email = `sync-e2e-${Date.now()}@example.com`;
    const password = `E2e!${Math.random().toString(36).slice(2)}Aa9`;

    const a = createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: false } });
    const { data: signup, error: se } = await a.auth.signUp({ email, password });
    if (se) throw new Error('signup: ' + se.message);
    if (!signup.session) throw new Error('no session returned — email confirmation is on; this test needs auto-confirm');

    const now = Date.now();
    const dbA: EngineDB = emptyDB();
    dbA.workouts = [
      { id: 'w-e2e-str', name: 'E2E Squat Day', blocks: [] },
      { id: 'w-e2e-con', name: 'E2E Row Intervals', kind: 'conditioning', blocks: [] },
    ] as unknown as Workout[];
    dbA.sessions = [
      { id: 's-e2e-str', workoutId: 'w-e2e-str', kind: 'strength', status: 'completed', completedAt: now - 60_000, date: new Date(now).toISOString().slice(0, 10), blocks: [] },
      { id: 's-e2e-con', workoutId: 'w-e2e-con', kind: 'conditioning', status: 'completed', completedAt: now - 30_000, date: new Date(now).toISOString().slice(0, 10), blocks: [] },
    ] as unknown as Session[];

    const clean = sanitizeDB(dbA);
    // If the fixture doesn't survive sanitizeDB, the test would "pass" by
    // syncing nothing — fail loudly on the fixture instead.
    expect(clean.sessions.map((s) => s.id).sort()).toEqual(['s-e2e-con', 's-e2e-str']);

    const state = buildPushState(clean, {});
    const { error: pe } = await a.from('app_state').upsert({ user_id: signup.session.user.id, state }, { onConflict: 'user_id' });
    if (pe) throw new Error('push: ' + pe.message);

    // Device B: fresh client, empty local database — the web dashboard's cold start.
    const b = createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: false } });
    const { data: signin, error: ie } = await b.auth.signInWithPassword({ email, password });
    if (ie) throw new Error('signin: ' + ie.message);
    const { data: row, error: re } = await b.from('app_state').select('state').eq('user_id', signin.session!.user.id).maybeSingle();
    if (re) throw new Error('pull: ' + re.message);
    const remoteState = (row?.state ?? {}) as Record<string, unknown>;
    const remote = remoteState.hybridEngine ? sanitizeDB(remoteState.hybridEngine as EngineDB) : null;
    const { db: merged } = applyPull(emptyDB(), remote);

    // Leave nothing behind but the inert disposable auth user.
    await b.from('app_state').delete().eq('user_id', signin.session!.user.id);

    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['w-e2e-con', 'w-e2e-str']);
    const bothKinds = merged.sessions.map((s) => `${s.id}:${(s as Session).kind ?? 'strength'}`).sort();
    expect(bothKinds).toEqual(['s-e2e-con:conditioning', 's-e2e-str:strength']);
  },
);

/*
 * THREE domains, ONE athlete, ONE round trip.
 *
 * The test above proves strength and conditioning survive `app_state`. This one
 * proves the third world does not cost them anything: the same device pushes a
 * training blob AND a nutrition partition for the same user, and a cold device B
 * pulls both. Two separate green tests over two separate users would prove the
 * two halves work in isolation, which is precisely the thing that was never in
 * doubt — the risk the rebuild scope named is a third domain touching the code
 * the C1/C2 bugs lived in.
 *
 * So the assertions that matter here are the NEGATIVE ones: the training blob
 * must contain no food, and the nutrition snapshot no workouts. If those two
 * ever cross, a meal has corrupted a training history or the reverse, and that
 * is a data-loss bug no unit test can see because both halves sanitize clean.
 *
 * Requires 20260807_nutrition_domain to be applied in the target project:
 * without it the RPC raises 'invalid domain', and this test is the thing that
 * says so before an athlete's phone does.
 */
it.skipIf(process.env.SB_E2E !== '1')(
  'strength, conditioning and nutrition round-trip together for one athlete',
  { timeout: 60_000 },
  async () => {
    const email = `nutrition-e2e-${Date.now()}@example.com`;
    const password = `E2e!${Math.random().toString(36).slice(2)}Aa9`;

    const a = createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: false } });
    const { data: signup, error: se } = await a.auth.signUp({ email, password });
    if (se) throw new Error('signup: ' + se.message);
    if (!signup.session) throw new Error('no session returned — email confirmation is on; this test needs auto-confirm');
    const userId = signup.session.user.id;

    // --- device A's TRAINING half, pushed the way the app pushes it ---
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const trainingA: EngineDB = emptyDB();
    trainingA.workouts = [
      { id: 'w-tri-str', name: 'E2E Squat Day', blocks: [] },
      { id: 'w-tri-con', name: 'E2E Row Intervals', kind: 'conditioning', blocks: [] },
    ] as unknown as Workout[];
    trainingA.sessions = [
      { id: 's-tri-str', workoutId: 'w-tri-str', kind: 'strength', status: 'completed', completedAt: now - 60_000, date: today, blocks: [] },
      { id: 's-tri-con', workoutId: 'w-tri-con', kind: 'conditioning', status: 'completed', completedAt: now - 30_000, date: today, blocks: [] },
    ] as unknown as Session[];
    const cleanTraining = sanitizeDB(trainingA);
    expect(cleanTraining.sessions.map((s) => s.id).sort()).toEqual(['s-tri-con', 's-tri-str']);
    const { error: tpe } = await a
      .from('app_state')
      .upsert({ user_id: userId, state: buildPushState(cleanTraining, {}) }, { onConflict: 'user_id' });
    if (tpe) throw new Error('push training: ' + tpe.message);

    const stamp = new Date().toISOString();
    const localA: NutritionDB = {
      ...emptyNutritionDB(),
      logEntries: [
        {
          id: 'n-e2e-a', userId, logDate: stamp.slice(0, 10), meal: 'breakfast', entryKind: 'food',
          foodId: null, customFoodId: null, recipeId: null, quantity: 1, unit: 'serving',
          calories: 400, proteinG: 30, carbsG: 40, fatG: 10, displayName: 'E2E Oats',
          nutrients: {}, notes: null, sourceSnapshot: {}, createdAt: stamp, updatedAt: stamp, deletedAt: null,
        },
      ],
    };
    // A fixture that does not survive sanitize would let this test "pass" by
    // syncing nothing.
    expect(sanitizeNutritionDB(localA).logEntries).toHaveLength(1);

    const nsA = withNutritionPartition(emptyEcosystemNamespace(), localA, 'hybrid:web', Date.now());
    const snapA = nsA.partitions.nutrition!;
    const { error: pe } = await a.rpc('upsert_athlete_domain_snapshot', {
      p_domain: 'nutrition',
      p_schema_version: snapA.schemaVersion,
      p_revision: snapA.revision,
      p_writer: snapA.writer,
      p_client_updated_at: new Date(snapA.updatedAt).toISOString(),
      p_snapshot: snapA.data,
    });
    if (pe) throw new Error('push nutrition: ' + pe.message);

    // Device B: a cold start that logged its own meal offline. Both meals must
    // survive — the additive rule, over the wire rather than in a unit test.
    const b = createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: false } });
    const { data: signin, error: ie } = await b.auth.signInWithPassword({ email, password });
    if (ie) throw new Error('signin: ' + ie.message);
    const localB: NutritionDB = {
      ...emptyNutritionDB(),
      logEntries: [{ ...localA.logEntries[0], id: 'n-e2e-b', displayName: 'E2E Rice' }],
    };

    const { data: rows, error: re } = await b
      .from('athlete_domain_snapshots')
      .select('domain,revision,writer,snapshot,client_updated_at')
      .eq('user_id', userId)
      .in('domain', ['nutrition']);
    if (re) throw new Error('pull nutrition: ' + re.message);

    // The training half, pulled by the SAME cold device in the same run.
    const { data: stateRow, error: tre } = await b
      .from('app_state').select('state').eq('user_id', userId).maybeSingle();
    if (tre) throw new Error('pull training: ' + tre.message);

    await b.from('athlete_domain_snapshots').delete().eq('user_id', userId);
    await b.from('app_state').delete().eq('user_id', userId);

    const remoteState = (stateRow?.state ?? {}) as Record<string, unknown>;
    const remoteTraining = remoteState.hybridEngine ? sanitizeDB(remoteState.hybridEngine as EngineDB) : null;
    const { db: mergedTraining } = applyPull(emptyDB(), remoteTraining);
    expect(mergedTraining.workouts.map((w) => w.id).sort()).toEqual(['w-tri-con', 'w-tri-str']);
    expect(mergedTraining.sessions.map((s) => `${s.id}:${(s as Session).kind ?? 'strength'}`).sort()).toEqual([
      's-tri-con:conditioning',
      's-tri-str:strength',
    ]);

    const row = (rows || [])[0];
    expect(row?.domain).toBe('nutrition');
    const pulled = sanitizeEcosystemNamespace({
      ...emptyEcosystemNamespace(),
      partitions: {
        nutrition: {
          schemaVersion: 1, domain: 'nutrition', revision: row!.revision,
          updatedAt: Date.parse(row!.client_updated_at as string) || 0,
          writer: row!.writer, data: row!.snapshot,
        },
      },
    });
    const remote = sanitizeNutritionDB(readNutritionPartition(pulled));
    const merged = mergeNutrition(sanitizeNutritionDB(localB), remote);
    expect(merged.logEntries.map((e) => e.id).sort()).toEqual(['n-e2e-a', 'n-e2e-b']);
    // Snapshot-at-log-time: the round trip must not have re-derived anything.
    expect(merged.logEntries.find((e) => e.id === 'n-e2e-a')?.calories).toBe(400);

    /*
     * The wall, measured on the wire. Neither payload may carry the other's
     * records: a food log inside `app_state.hybridEngine`, or a workout inside
     * the nutrition snapshot, is the exact cross-domain overwrite the separate
     * slice exists to make structurally impossible.
     */
    expect(JSON.stringify(remoteState)).not.toContain('E2E Oats');
    expect(JSON.stringify(row!.snapshot)).not.toContain('E2E Squat Day');
    expect((mergedTraining as unknown as Record<string, unknown>).logEntries).toBeUndefined();
    expect((merged as unknown as Record<string, unknown>).workouts).toBeUndefined();
    // And the training blob's own ecosystem namespace never carries nutrition:
    // `buildPushState` strips the partition so a meal cannot dirty the training
    // fingerprint and force a spurious training push.
    expect(readNutritionPartition(mergedTraining.ecosystem ?? emptyEcosystemNamespace())).toBeUndefined();
  },
);
