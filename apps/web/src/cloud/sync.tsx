import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient, type Session as AuthSession, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
import { applyPull, buildProductSyncNamespace, buildPushState, cloudFp, mergeEngines, sanitizeDB, type EngineDB } from '@hybrid/engine';
import type { EcosystemSyncNamespace } from '@hybrid/shared-core';
import { emptyNutritionDB, mergeNutrition, sanitizeNutritionDB, type NutritionDB } from '@hybrid/nutrition-core';
import { useDb } from '../store/db';
import { useNutrition } from '../store/nutrition';
import { humanizeError } from '../errors';
import {
  applyProductSyncNamespace as applyEcosystemNamespace,
  ECOSYSTEM_SYNC_ENABLED,
  pullEcosystem,
  pushEcosystem,
  readNutritionPartition,
} from './ecosystem';
import { PRODUCT_ID } from '../product';
import { useProgressionLedger } from '../coach/progression-store';
import { getLedgerEntries } from '../autocoach/ledger';
import {
  acceptAssignment as acceptAssignmentRpc,
  applyPendingArcDecisions,
  declineAssignment as declineAssignmentRpc,
  getMyArcOrgId,
  listPendingAssignments,
  materializeAcceptedAssignments,
  pushAutocoachReceipts,
  pushProgressionProposals,
  type PendingAssignment,
} from './arc-athlete-sync';

/*
 * Cloud sync.
 *
 * The shape of this is dictated by one requirement: two devices must be able to
 * schedule and log between syncs without either losing work. That is why a pull
 * MERGES by record rather than overwriting, and why a push merges against
 * whatever the remote already holds.
 *
 * All of those rules are in @hybrid/engine and tested there. This file is only
 * the network and the React wiring.
 */

interface SyncCtx {
  enabled: boolean;
  user: User | null;
  busy: boolean;
  error: string;
  syncedAt: number;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  /** Program assignments a real coach has proposed, awaiting this athlete's
   *  own accept/decline. Empty for the overwhelming majority of accounts,
   *  which have no coaching relationship at all. */
  pendingAssignments: readonly PendingAssignment[];
  acceptAssignment: (assignmentId: string) => Promise<void>;
  declineAssignment: (assignmentId: string) => Promise<void>;
}

const Ctx = createContext<SyncCtx | null>(null);

const client: SupabaseClient | null = (() => {
  try {
    if (!SUPABASE.url || !SUPABASE.anonKey) return null;
    return createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  } catch {
    return null;
  }
})();

/**
 * The one Supabase client this app has.
 *
 * Exported so the coach repository can read through it rather than construct a
 * second one: two clients over the same storage means two gotrue instances
 * refreshing the same session, and they race each other into signing the user
 * out. The mobile app learned this and says so in the same place.
 *
 * Null when the build has no Supabase config. Every caller must treat that as
 * "offline", not as an error.
 */
export const supabaseClient: SupabaseClient | null = client;

const ECOSYSTEM_WRITER = `${PRODUCT_ID}:web`;

/* A slice nobody has written to yet. Phase 0 ships no nutrition UI, so this is
   every athlete's slice — pushing it would create a nutrition row for all of
   them and revision-churn it for nothing. Once either side holds a partition
   the push is unconditional, so a slice that legitimately becomes empty again
   still reaches the server. */
const EMPTY_NUTRITION_FP = JSON.stringify(emptyNutritionDB());

const nutritionFp = (n: NutritionDB): string => JSON.stringify(n);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { db, update } = useDb();
  const { nutrition, replace: replaceNutrition } = useNutrition();
  const ledger = useProgressionLedger();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncedAt, setSyncedAt] = useState(0);
  const [pendingAssignments, setPendingAssignments] = useState<readonly PendingAssignment[]>([]);
  const arcOrgRef = useRef<string | null>(null);

  // The DB changes on every logged set; reading it through a ref keeps the
  // reconcile callback stable so the visibility listener isn't torn down and
  // rebuilt mid-session.
  const dbRef = useRef(db);
  dbRef.current = db;
  const lastFp = useRef<string | null>(null);
  // The nutrition slice lives outside the EngineDB, so `cloudFp` says nothing
  // about it — without its own fingerprint a logged meal would never arm a
  // push, and with a SHARED one a logged set would push the food log.
  const nutritionRef = useRef(nutrition);
  nutritionRef.current = nutrition;
  const lastNutritionFp = useRef<string | null>(null);
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  /* The last namespace the server handed us: the only carrier of the nutrition
     revision, since the EngineDB deliberately does not retain that partition.
     A cold start before the first pull pushes revision 1, the RPC ignores it,
     and the next reconcile re-pushes with the right revision — see the
     needs-push comparison below, which is what makes that self-healing. */
  const remoteNamespace = useRef<EcosystemSyncNamespace | null>(null);
  const inFlight = useRef(false);
  const pushTimer = useRef<number | null>(null);

  /*
   * Fold the merge result INTO the current draft rather than assigning over it.
   *
   * `next` is computed from a snapshot of `dbRef.current` taken BEFORE the
   * pull's network round trips. A set confirmed during that await is already
   * in memory and on disk; assigning `next` field-by-field over a fresh draft
   * overwrote it in BOTH — and then pushed the truncated state. Merging with
   * the same engine primitive the rest of the sync path trusts cannot lose it,
   * because `mergeEngines` is additive in both directions.
   *
   * This is the mobile app's fix (apps/mobile/src/cloud/sync.tsx), which the
   * web file did not receive at the time. Reachable only with
   * VITE_HYBRID_ECOSYSTEM_SYNC=1, which is what opens the await window.
   */
  const applyMerged = useCallback(
    (next: EngineDB) => {
      update((draft) => {
        const folded = sanitizeDB(mergeEngines(draft, next));
        draft.workouts = folded.workouts;
        draft.sessions = folded.sessions;
        draft.settings = folded.settings;
        draft.core = folded.core;
        draft.ecosystem = folded.ecosystem;
      });
      // `dbRef.current = next` is deliberately gone: `next` is the unfolded
      // pre-await snapshot, so pinning the ref to it would put back the
      // staleness this merge exists to remove. The component body reassigns
      // the ref on the render `update()` schedules.
    },
    [update],
  );

  const pushNow = useCallback(
    async (force: boolean, knownRemote?: Record<string, unknown>) => {
      if (!client || !user) return;
      const fp = cloudFp(dbRef.current);
      const nfp = nutritionFp(nutritionRef.current);
      if (!force && fp === lastFp.current && nfp === lastNutritionFp.current) return;

      // Read the current row first so unrelated keys in this user's state
      // survive, and so the merge is against what is actually up there rather
      // than against what we last saw.
      let existing = knownRemote;
      if (!existing) {
        // A swallowed read error was indistinguishable from an empty row, so a
        // network blip / 500 / RLS refusal turned the next push into a
        // truncating overwrite of another device's records and unrelated state
        // keys. Treat a read failure as fatal for this push, like reconcile
        // (:186) already does.
        const { data, error: e } = await client
          .from('app_state').select('state').eq('user_id', user.id).maybeSingle();
        if (e) throw e;
        existing = (data?.state ?? {}) as Record<string, unknown>;
      }

      let source = dbRef.current;
      let namespace: ReturnType<typeof buildProductSyncNamespace> | undefined;
      if (ECOSYSTEM_SYNC_ENABLED) {
        namespace = buildProductSyncNamespace(source, PRODUCT_ID, ECOSYSTEM_WRITER);
        source = { ...source, core: namespace.core, ecosystem: namespace };
        dbRef.current = source;
      }
      const state = buildPushState(source, existing);
      const { error: e } = await client.from('app_state').upsert({ user_id: user.id, state }, { onConflict: 'user_id' });
      if (e) throw e;
      if (ECOSYSTEM_SYNC_ENABLED) {
        const carryNutrition = nfp !== EMPTY_NUTRITION_FP || !!remoteNamespace.current?.partitions.nutrition;
        const { namespace: pushed, stale } = await pushEcosystem(
          client,
          source,
          ECOSYSTEM_WRITER,
          carryNutrition ? { data: nutritionRef.current, base: remoteNamespace.current ?? undefined } : undefined,
        );
        // `pushed` carries no nutrition partition by contract — assigning one
        // into the EngineDB here would put the food log inside `cloudFp`.
        update((draft) => {
          draft.core = pushed.core;
          draft.ecosystem = pushed;
        });
        if (stale.length) {
          // The server refused a snapshot on its revision guard. Leaving the
          // fingerprints unrecorded is what makes the next push retry with a
          // refreshed base instead of treating this one as clean and going
          // quiet until unrelated content changes.
          setSyncedAt(Date.now());
          return;
        }
      }
      lastFp.current = cloudFp(source);
      lastNutritionFp.current = nfp;
      setSyncedAt(Date.now());
    },
    [user, update],
  );

  /*
   * Fold the server's nutrition partition into the local slice. Returns whether
   * the local side holds anything the server does not, i.e. whether a push is
   * owed.
   *
   * ADDITIVE IN BOTH DIRECTIONS: `mergeNutrition` unions by key, so a meal
   * logged only here and a meal logged only on the other device both survive.
   * Taking either side whole is the merge that cost this repo user data twice.
   */
  const reconcileNutrition = useCallback(
    (remote: EcosystemSyncNamespace): boolean => {
      const payload = readNutritionPartition(remote);
      // `undefined` means the server has never heard about this athlete's
      // nutrition, which is NOT an empty slice: sanitizing it into one and
      // merging would be a no-op, but treating it as "in sync" would leave a
      // populated local slice unpushed forever.
      const remoteSlice = payload === undefined ? null : sanitizeNutritionDB(payload);
      const local = sanitizeNutritionDB(nutritionRef.current);
      if (!remoteSlice) return nutritionFp(local) !== EMPTY_NUTRITION_FP;
      let merged: NutritionDB;
      try {
        merged = mergeNutrition(local, remoteSlice);
      } catch {
        // `mergeNutrition` throws by design when the two schema versions differ
        // — silent corruption is worse. Contained here so a newer build's
        // nutrition schema cannot abort the TRAINING sync running around it;
        // the local slice is left alone until a build that understands both.
        return false;
      }
      const mergedFp = nutritionFp(merged);
      if (mergedFp !== nutritionFp(nutritionRef.current)) {
        nutritionRef.current = merged;
        replaceNutrition(merged);
      }
      return mergedFp !== nutritionFp(remoteSlice);
    },
    [replaceNutrition],
  );

  const reconcile = useCallback(async () => {
    if (!client || !user || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const { data, error: e1 } = await client
        .from('app_state')
        .select('state,updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (e1) throw e1;

      const remoteState = (data?.state ?? {}) as Record<string, unknown>;
      const rawRemote = remoteState.hybridEngine as EngineDB | undefined;
      // The pulled state is foreign input — an older client, or a buggy one,
      // may have written it — so it is hardened before it can reach a merge.
      const remote = rawRemote ? sanitizeDB(rawRemote) : null;

      const { db: mergedDb, needsPush: legacyNeedsPush } = applyPull(dbRef.current, remote);
      let merged = mergedDb;
      let needsPush = legacyNeedsPush;
      if (ECOSYSTEM_SYNC_ENABLED) {
        const ecosystemRemote = await pullEcosystem(client, user.id);
        if (ecosystemRemote) {
          remoteNamespace.current = ecosystemRemote;
          if (reconcileNutrition(ecosystemRemote)) needsPush = true;
          const ecosystemMerged = applyEcosystemNamespace(merged, ecosystemRemote);
          if (cloudFp(ecosystemMerged) !== cloudFp(merged)) needsPush = true;
          merged = ecosystemMerged;
        }
      }
      // `merged` was computed from a snapshot taken before the awaits above.
      // Fold it against whatever the ref holds NOW so a set logged during the
      // pull is in the push, then persist that same fold.
      if (merged !== dbRef.current) {
        const folded = sanitizeDB(mergeEngines(dbRef.current, merged));
        dbRef.current = folded;
        applyMerged(folded);
      }
      if (needsPush) await pushNow(true, remoteState);

      /*
       * The BACKEND -> ATHLETE half of the ARC loop, best-effort and
       * deliberately isolated in its own try/catch: an athlete with no
       * coach — the common case — has no organisation membership, every
       * call below refuses, and that refusal must never become an error
       * banner on the training sync that has nothing to do with it.
       *
       * Runs AFTER the pull above, so a coach's decision applies against
       * this device's freshest known baseline, not a stale pre-pull one.
       */
      try {
        const orgId = await getMyArcOrgId(client, user.id);
        arcOrgRef.current = orgId;
        if (orgId) {
          const { settings: patchedSettings } = await applyPendingArcDecisions(client, user.id, dbRef.current.settings);
          if (patchedSettings) {
            update((draft) => { draft.settings = patchedSettings; });
            dbRef.current = { ...dbRef.current, settings: patchedSettings };
          }
          const decided = new Set(ledgerRef.current.decisions.map((d) => d.proposalId));
          const pending = ledgerRef.current.proposals.filter((p) => !decided.has(p.id));
          await pushProgressionProposals(client, orgId, pending);
          await pushAutocoachReceipts(client, orgId, getLedgerEntries());
          setPendingAssignments(await listPendingAssignments(client, user.id));

          const existingWorkoutIds = new Set(dbRef.current.workouts.map((w) => w.id));
          const newWorkouts = await materializeAcceptedAssignments(client, user.id, existingWorkoutIds);
          if (newWorkouts.length > 0) {
            update((draft) => {
              for (const w of newWorkouts) {
                if (!draft.workouts.some((existing) => existing.id === w.id)) draft.workouts.push(w);
              }
            });
            const toAdd = newWorkouts.filter((w) => !dbRef.current.workouts.some((existing) => existing.id === w.id));
            dbRef.current = { ...dbRef.current, workouts: [...dbRef.current.workouts, ...toAdd] };
          }
        } else {
          setPendingAssignments([]);
        }
      } catch {
        /* Best-effort — see the comment above. Nothing here is allowed to
           fail the training sync it rides alongside. */
      }

      setSyncedAt(Date.now());
    } catch (e) {
      setError(humanizeError(e, 'sync'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [user, applyMerged, pushNow, reconcileNutrition, update]);

  /* ---- auth ---- */
  useEffect(() => {
    if (!client) return;
    let alive = true;
    void client.auth.getSession().then(({ data }) => {
      if (alive) setUser(data.session?.user ?? null);
    });
    const { data: sub } = client.auth.onAuthStateChange((_e, session: AuthSession | null) => {
      setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Reconcile on sign-in, and whenever the app comes back to the foreground —
  // this is what pulls a freshly assigned session onto the calendar.
  useEffect(() => {
    if (!user) return;
    void reconcile();
    const onVis = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user, reconcile]);

  // Debounced push on local change. 900ms because a set confirm writes several
  // times in quick succession and each one must not become a round trip.
  useEffect(() => {
    if (!user) return;
    /* The fingerprint check used to run HERE, which meant a full
       JSON.stringify of every workout and session on every keystroke of a set
       field, purely to decide whether to arm a timer. pushNow already computes
       the same fingerprint and no-ops when it is unchanged, so the work now
       happens once per quiet period instead of once per character. */
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      void pushNow(false).catch((e) => setError(humanizeError(e, 'sync')));
    }, 900);
    return () => {
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
    };
    // `nutrition` is in the deps for the same reason `db` is: it is a separate
    // slice, so a logged meal changes nothing the `db` dependency would catch.
  }, [db, nutrition, user, pushNow]);

  const value = useMemo<SyncCtx>(
    () => ({
      enabled: !!client,
      user,
      busy,
      error,
      syncedAt,
      signIn: async (email, password) => {
        if (!client) return 'Cloud sync is not configured.';
        const { error: e } = await client.auth.signInWithPassword({ email: email.trim(), password });
        return e ? humanizeError(e, 'sign-in') : null;
      },
      signUp: async (email, password) => {
        if (!client) return 'Cloud sync is not configured.';
        const { data, error: e } = await client.auth.signUp({ email: email.trim(), password });
        if (e) return humanizeError(e, 'sign-up');
        // Without email confirmation there is no session yet — say so rather
        // than leaving the user staring at an unchanged screen.
        return data.session ? null : 'Account created. Check your email to confirm, then sign in.';
      },
      signOut: async () => {
        if (!client) return;
        await client.auth.signOut();
        setUser(null);
        lastFp.current = null;
        lastNutritionFp.current = null;
        remoteNamespace.current = null;
        arcOrgRef.current = null;
        setPendingAssignments([]);
      },
      syncNow: reconcile,
      pendingAssignments,
      acceptAssignment: async (assignmentId: string) => {
        if (!client || !arcOrgRef.current) return;
        await acceptAssignmentRpc(client, arcOrgRef.current, assignmentId);
        setPendingAssignments((current) => current.filter((a) => a.id !== assignmentId));
      },
      declineAssignment: async (assignmentId: string) => {
        if (!client || !arcOrgRef.current) return;
        await declineAssignmentRpc(client, arcOrgRef.current, assignmentId);
        setPendingAssignments((current) => current.filter((a) => a.id !== assignmentId));
      },
    }),
    [user, busy, error, syncedAt, reconcile, pendingAssignments],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSync outside SyncProvider');
  return c;
}
