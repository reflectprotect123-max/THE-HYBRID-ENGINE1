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
import { applyPull, buildPushState, emptyDB, sanitizeDB, type EngineDB, type Session, type Workout } from '@hybrid/engine';

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
