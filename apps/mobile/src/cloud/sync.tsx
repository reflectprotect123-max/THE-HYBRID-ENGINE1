import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createClient, type Session as AuthSession, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
import {
  applyPull,
  buildMergedSyncNamespace,
  buildPushState,
  cloudFp,
  mergeEngines,
  sanitizeDB,
  type EngineDB,
} from '@hybrid/engine';
import type { EcosystemSyncNamespace } from '@hybrid/shared-core';
import { emptyNutritionDB, mergeNutrition, sanitizeNutritionDB, type NutritionDB } from '@hybrid/nutrition-core';
import { useDb } from '../store/db';
import { storage } from '../store/storage';
import { humanizeError } from '../errors';
import {
  applyProductSyncNamespace as applyEcosystemNamespace,
  ECOSYSTEM_SYNC_ENABLED,
  pullEcosystem,
  pushEcosystem,
  readNutritionPartition,
} from './ecosystem';
import {
  acceptAssignment as acceptAssignmentRpc,
  clearArcOrgCache,
  declineAssignment as declineAssignmentRpc,
  getMyArcOrgId,
  listPendingAssignments,
  materializeAcceptedAssignments,
  type PendingAssignment,
} from './arc-assignments';
import { clearArcNameCache } from './arc-roster';
import { useNutrition } from '../store/nutrition';
import '../product'; // build-config guard

/*
 * Cloud sync, native edition.
 *
 * The protocol is identical to the web app's and deliberately so: two devices
 * must be able to schedule and log between syncs without either losing work.
 * That is why a pull MERGES by record rather than overwriting a push merges
 * against whatever the remote already holds.
 *
 * All of those rules live in @hybrid/engine and are tested there. This file is
 * only the network and the React wiring. What differs from the web file is
 * strictly the three things a phone does not share with a browser:
 *
 *  1. There is no localStorage, so Supabase is handed the MMKV-backed storage
 *     port explicitly. Without it gotrue falls back to memory and the athlete
 *     is signed out by every cold start.
 *  2. There is no address bar, so `detectSessionInUrl` must be off — on native
 *     it would parse a URL that never exists and can throw during init.
 *  3. There is no `document.visibilitychange` and no `window`; AppState and the
 *     bare timer globals stand in.
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
  /** Coach-assigned programs waiting for this athlete's answer. Empty for
   *  every account with no coaching relationship, which is most of them. */
  pendingAssignments: readonly PendingAssignment[];
  acceptAssignment: (assignmentId: string) => Promise<void>;
  declineAssignment: (assignmentId: string) => Promise<void>;
}

const Ctx = createContext<SyncCtx | null>(null);

const client: SupabaseClient | null = (() => {
  try {
    if (!SUPABASE.url || !SUPABASE.anonKey) return null;
    return createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: {
        /*
         * THE line that decides whether a sign-in survives an app restart.
         *
         * On the web gotrue defaults to window.localStorage. React Native has
         * no such global, and gotrue's silent fallback is an in-memory store —
         * so persistSession: true alone is a lie: the session is "persisted"
         * into a Map that dies with the JS context. The storage port here is
         * MMKV (see ../store/storage), which is synchronous and survives a
         * cold start; on a build without the native module it degrades to the
         * same in-memory shim the rest of the app uses, and sign-in then
         * simply does not stick — which is the honest behaviour.
         */
        storage,
        persistSession: true,
        autoRefreshToken: true,
        // No URL fragment to read on native. Leaving this on makes gotrue reach
        // for `window.location` during construction.
        detectSessionInUrl: false,
      },
    });
  } catch {
    return null;
  }
})();

/**
 * The one Supabase client this app has.
 *
 * Exported so the food catalogue can be read through it rather than through a
 * second `createClient`: two clients on one MMKV store means two gotrue
 * instances refreshing the same session, which race each other into signing the
 * athlete out. It is null when the build has no Supabase config, and every
 * caller must treat that as "offline", not as an error.
 */
export const supabaseClient: SupabaseClient | null = client;

/* One writer identity for every domain this app owns. */
const ECOSYSTEM_WRITER = 'hybrid:mobile';

/* A slice nobody has written to yet. Phase 0 ships no nutrition UI, so this is
   every athlete's slice — pushing it would create a nutrition row for all of
   them and revision-churn it for nothing. Once either side holds a partition
   the push is unconditional, so a slice that legitimately becomes empty again
   still reaches the server. */
const EMPTY_NUTRITION_FP = JSON.stringify(emptyNutritionDB());

const nutritionFp = (n: NutritionDB): string => JSON.stringify(n);

/* The server's revision guard refused the snapshot: another writer is ahead of
   this device. Benign and self-healing — the next reconcile pushes with a
   refreshed base — but it is NOT a completed sync, and saying "Last synced
   <now>" for it hid a nutrition partition that had stopped being written at
   all. */
const REFUSED_PUSH = 'Another device is ahead — your latest changes have not been sent yet. They will go up on the next sync.';

/* `mergeNutrition` refused the two slices because their schema versions differ.
   The training sync around it is unaffected and still runs; nutrition is what
   this build cannot safely touch, in EITHER direction. */
const NUTRITION_SCHEMA_MISMATCH =
  "This app version can't read a newer nutrition update — update the app to sync nutrition again.";

export function SyncProvider({ children }: { children: ReactNode }) {
  const { db, update } = useDb();
  const { nutrition, replace: replaceNutrition } = useNutrition();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncedAt, setSyncedAt] = useState(0);
  const [pendingAssignments, setPendingAssignments] = useState<readonly PendingAssignment[]>([]);
  /* The org the accept/decline RPCs are addressed to. A ref, not state:
     `reconcile` learns it and the accept handler needs the current value
     without either re-rendering the tree or re-creating the callback. */
  const arcOrgRef = useRef<string | null>(null);

  // The DB changes on every logged set; reading it through a ref keeps the
  // reconcile callback stable so the AppState listener isn't torn down and
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
  /* What the server is known to hold: the only carrier of the nutrition
     revision, since the EngineDB deliberately does not retain that partition.
     A cold start before the first pull pushes revision 1, the RPC ignores it,
     and the next reconcile re-pushes with the right revision — see the
     needs-push comparison below, which is what makes that self-healing.

     Written by the pull AND by a successful nutrition push. It used to be the
     pull alone, which meant the base for every nutrition write after the first
     one in a foreground session was a revision the server had already moved
     past. */
  const remoteNamespace = useRef<EcosystemSyncNamespace | null>(null);
  const inFlight = useRef(false);
  /* A reconcile asked for while one is already running. `reconcile` drops such
     a call, which is right for a foreground tick (the running one is already
     fetching the same thing) and WRONG for an athlete's accept: the tap is a
     specific new server state this device has not seen, and dropping it means
     the coach's session appears at some unrelated later foreground. Set by
     that caller, honoured once in `reconcile`'s finally. */
  const rerunRequested = useRef(false);
  /*
   * Every push, in the order it was asked for.
   *
   * `reconcile` has always had its own in-flight guard; `pushNow` had none, and
   * the 900ms debounce calls it directly. A meal logged just before a
   * foreground/`Sync now` therefore had a push in flight carrying a PRE-merge
   * snapshot while the reconcile pulled another device's entries, merged them,
   * and pushed the union — and whichever landed last won on the server's
   * equal-revision `client_updated_at` tiebreak. Landing last was the debounced
   * one often enough to drop the entries that had just been merged in.
   *
   * A chained promise rather than a "drop it if one is running" flag, because
   * dropping is the wrong answer for BOTH callers: the debounced push carries
   * an athlete's write that nothing else will re-arm, and the reconcile's push
   * is the one that must reach the server. Chaining keeps both, in order, and
   * the later one re-reads `dbRef`/`nutritionRef` when its turn comes — so the
   * loser of the old race now simply pushes the merged result.
   */
  const pushQueue = useRef<Promise<void>>(Promise.resolve());
  /* `mergeNutrition` refused this athlete's two slices on a schema-version
     mismatch. Merging is not the only thing that must then stop: the push arms
     off a fingerprint and a carry-forward flag of its own, so without this the
     OLDER local slice was pushed over the NEWER remote one, on the remote's own
     revision. Set by the reconcile that caught the throw, cleared by the first
     one that merges cleanly again. */
  const nutritionSchemaBlocked = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Fold a reconciled snapshot back into the store WITHOUT overwriting it.
   *
   * `draft` is always the store's true current state — store/db.tsx's `update`
   * builds it from a plain synchronous ref that every `update()` call mutates
   * immediately, so it is never stale across an await. `next`, by contrast, is
   * a snapshot computed BEFORE `pushNow` was awaited: a set logged on this
   * device while that push was in flight has already landed in the store
   * through its own `update()` call, and `pushNow` itself ends by writing
   * fresher `core`/`ecosystem` bookkeeping the same way when ecosystem sync is
   * on. Assigning `next` over `draft` discarded both. Merging `next` INTO
   * `draft` — with the same engine primitives the rest of the sync path
   * trusts — cannot.
   *
   * HISTORY: until the apps merged (Aug 2026), single-product builds narrowed
   * this fold with restrictToProduct, and an other-product record authored
   * during the push's await window could be pruned before reaching the server
   * — a documented, bounded residual. The merged app never narrows, so that
   * residual is structurally gone; see git history and the merge spec if you
   * need the full account.
   *
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
      // `dbRef.current = next` used to live here and is deliberately gone:
      // `next` is the unfolded snapshot, so pinning the ref to it would put
      // back the staleness this merge exists to remove. `dbRef.current = db`
      // in the component body runs on the render `update()` always schedules,
      // and nothing between here and that render reads the ref.
    },
    [update],
  );

  /**
   * One push, assumed to be alone on the wire — `pushNow` below is what
   * guarantees that. Returns false when the server REFUSED part of the
   * snapshot on its revision guard: that is not a completed sync, and nothing
   * may record it as one.
   *
   * Every read of local state happens HERE rather than in `pushNow`, so a push
   * that waited its turn in the queue sends what the app holds when it runs —
   * including whatever a reconcile merged in while it waited.
   */
  const runPush = useCallback(
    async (force: boolean, knownRemote?: Record<string, unknown>): Promise<boolean> => {
      if (!client || !user) return true;
      const fp = cloudFp(dbRef.current);
      const nfp = nutritionFp(nutritionRef.current);
      if (!force && fp === lastFp.current && nfp === lastNutritionFp.current) return true;

      // Read the current row first so unrelated keys in this user's state
      // survive, and so the merge is against what is actually up there rather
      // than against what we last saw.
      let existing = knownRemote;
      if (!existing) {
        // A swallowed read error was indistinguishable from an empty row, so a
        // network blip / 500 / RLS refusal turned the next push into a
        // truncating overwrite of another device's records and unrelated state
        // keys. Treat a read failure as fatal for this push, like reconcile
        // (:198) already does.
        const { data, error: e } = await client
          .from('app_state').select('state').eq('user_id', user.id).maybeSingle();
        if (e) throw e;
        existing = (data?.state ?? {}) as Record<string, unknown>;
      }

      let source = dbRef.current;
      if (ECOSYSTEM_SYNC_ENABLED) {
        const namespace = buildMergedSyncNamespace(source, ECOSYSTEM_WRITER);
        source = { ...source, core: namespace.core, ecosystem: namespace };
        dbRef.current = source;
      }
      const state = buildPushState(source, existing);
      const { error: e } = await client.from('app_state').upsert({ user_id: user.id, state }, { onConflict: 'user_id' });
      if (e) throw e;
      if (ECOSYSTEM_SYNC_ENABLED) {
        /* A caught schema mismatch blocks the WRITE as well as the merge. The
           local slice is the older one, and pushing it would overwrite the
           newer remote partition using that partition's own revision as the
           base — a real divergence discarded with nothing said. */
        const carryNutrition = !nutritionSchemaBlocked.current
          && (nfp !== EMPTY_NUTRITION_FP || !!remoteNamespace.current?.partitions.nutrition);
        const { namespace: pushed, stale, nutrition: pushedNutrition } = await pushEcosystem(
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
        /*
         * Advance the locally-tracked nutrition base to what was just WRITTEN.
         *
         * The training partitions get this for free: they live in
         * `EngineDB.ecosystem`, which the `update` above refreshes from the
         * push's own namespace. Nutrition deliberately does not live there, and
         * `remoteNamespace` — its only carrier — used to be written in exactly
         * one place, the pull. So the base stayed at the last PULLED revision
         * for the rest of the foreground session and every further meal was
         * pushed on a revision the server already held.
         *
         * Recorded on the ref only, never into the EngineDB, for the reason on
         * `EcosystemPushResult.nutrition`. Skipped when the server refused this
         * very partition: a write that did not happen advances nothing.
         */
        if (pushedNutrition && !stale.includes('nutrition')) {
          const base = remoteNamespace.current ?? pushed;
          remoteNamespace.current = {
            ...base,
            partitions: { ...base.partitions, nutrition: pushedNutrition },
          };
        }
        if (stale.length) {
          // The server refused a snapshot on its revision guard. Leaving the
          // fingerprints unrecorded is what makes the next push retry with a
          // refreshed base instead of treating this one as clean and going
          // quiet until unrelated content changes.
          //
          // And NOT stamping `syncedAt`: the screen renders that as "Last
          // synced <time>" with no error beside it, which is the app claiming
          // a sync the server declined.
          setError(REFUSED_PUSH);
          return false;
        }
      }
      lastFp.current = cloudFp(source);
      lastNutritionFp.current = nfp;
      setSyncedAt(Date.now());
      return true;
    },
    [user, update],
  );

  /**
   * The only way a push is started. Serialises against every other push — see
   * `pushQueue` — and reports whether the server accepted the whole snapshot.
   */
  const pushNow = useCallback(
    async (force: boolean, knownRemote?: Record<string, unknown>): Promise<boolean> => {
      const run = pushQueue.current.then(() => runPush(force, knownRemote));
      // The queue itself must never hold a rejection: the next push awaits it
      // for ORDER only, and the failure belongs to the caller that asked for
      // this push — which still receives it through `run`.
      pushQueue.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [runPush],
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
      if (!remoteSlice) {
        nutritionSchemaBlocked.current = false;
        return nutritionFp(local) !== EMPTY_NUTRITION_FP;
      }
      let merged: NutritionDB;
      try {
        merged = mergeNutrition(local, remoteSlice);
      } catch {
        // `mergeNutrition` throws by design when the two schema versions differ
        // — silent corruption is worse. Contained here so a newer build's
        // nutrition schema cannot abort the TRAINING sync running around it;
        // the local slice is left alone until a build that understands both.
        //
        // "No push owed" was never enough on its own: the push arms off its own
        // fingerprint and carry-forward flag, so it fired anyway and sent the
        // older local slice on the newer remote's revision. The flag closes
        // that path, and the athlete is told, rather than a real divergence
        // being resolved by overwriting the side this build cannot read.
        nutritionSchemaBlocked.current = true;
        setError(NUTRITION_SCHEMA_MISMATCH);
        return false;
      }
      nutritionSchemaBlocked.current = false;
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

      const previousLocal = dbRef.current;
      const { db: mergedDb, needsPush: legacyNeedsPush } = applyPull(previousLocal, remote);
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

      // The merge above is deliberately unfiltered — it must never lose a
      // record that exists only locally or only in an un-split legacy remote
      // blob. Push runs against that full, unfiltered `merged` data BEFORE
      // any product filtering happens, so a wrong-kind record authored on
      // this device (nothing gates authoring by product — see the design
      // spec's Non-goals) reaches the server first. Only after that is the
      // device's own on-disk storage narrowed to its own product — pruning a
      // record locally here can never mean losing it IF it was part of that
      // pushed snapshot, because by that point it is already durable on the
      // server. Exception: an OTHER-product record authored during the push's
      // await window never made it into that snapshot, so it can still be
      // pruned before reaching the server.
      // `merged` descends from a `dbRef.current` read taken BEFORE the pull's
      // await. A set confirmed during that await has already updated the ref on
      // its own render, so assigning `merged` straight into the ref put the
      // pre-await snapshot back — and `pushNow` below reads the ref, so that
      // set was left out of the pushed blob until some later unrelated write.
      // Folding against the ref's CURRENT value keeps both sides; `mergeEngines`
      // is additive, so this can only add.
      const local = merged === previousLocal && merged === dbRef.current
        ? previousLocal
        : sanitizeDB(mergeEngines(dbRef.current, merged));
      dbRef.current = local;
      const accepted = needsPush ? await pushNow(true, remoteState) : true;

      // The app hosts both worlds — nothing is narrowed.
      if (cloudFp(local) !== cloudFp(previousLocal)) applyMerged(local);

      /*
       * The COACH -> ATHLETE half of the ARC loop, best-effort and
       * deliberately isolated in its own try/catch: an athlete with no coach —
       * the common case — has no organisation membership, every call below
       * refuses, and that refusal must never become an error banner on the
       * training sync it rides alongside.
       *
       * Runs AFTER the pull and the push above, so a materialised workout is
       * added on top of this device's freshest known state and is carried up
       * by the next push rather than racing the one that just ran.
       *
       * Not gated on ECOSYSTEM_SYNC_ENABLED: `program_assignments` is not one
       * of the three ecosystem snapshot tables that flag guards, and the
       * assignment tables are already live.
       */
      try {
        const orgId = await getMyArcOrgId(client, user.id);
        arcOrgRef.current = orgId;
        if (orgId) {
          setPendingAssignments(await listPendingAssignments(client, user.id));

          const existingWorkoutIds = new Set(dbRef.current.workouts.map((w) => w.id));
          const newWorkouts = await materializeAcceptedAssignments(client, user.id, existingWorkoutIds);
          if (newWorkouts.length > 0) {
            // Written through `update` — the store is the only owner of the
            // athlete's workouts. NOT mirrored onto `dbRef` by hand: this block
            // runs after the push above, so there is no later push in this
            // reconcile for a mirror to serve, and `dbRef.current = db` in the
            // component body already runs on the render `update()` schedules.
            // Writing the ref here is the exact pattern `applyMerged` above
            // deleted on purpose, and its comment says why.
            update((draft) => {
              for (const w of newWorkouts) {
                if (!draft.workouts.some((existing) => existing.id === w.id)) draft.workouts.push(w);
              }
            });
          }
        } else {
          setPendingAssignments([]);
        }
      } catch {
        /* Best-effort — see above. Nothing here may fail the training sync. */
      }

      // A refused push has already said so through `error`. Stamping the clock
      // on top of it would put "Last synced <now>" beside the message and make
      // the refusal read as a completed sync.
      if (accepted) setSyncedAt(Date.now());
    } catch (e) {
      setError(humanizeError(e, 'sync'));
    } finally {
      inFlight.current = false;
      setBusy(false);
      /* Honour a rerun asked for while this one was running. The flag is
         cleared BEFORE the call, so a rerun that is itself interrupted arms a
         fresh flag rather than looping on a stale one. Only `acceptAssignment`
         sets it, so this is one extra pass, not a pump. */
      if (rerunRequested.current) {
        rerunRequested.current = false;
        void reconcileRef.current?.();
      }
    }
  }, [user, applyMerged, pushNow, reconcileNutrition, update]);

  /* `reconcile` cannot name itself inside its own useCallback, and the rerun
     above must run the CURRENT one, not the closure that armed it. */
  const reconcileRef = useRef<(() => Promise<void>) | null>(null);
  reconcileRef.current = reconcile;

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

  /*
   * gotrue's refresh loop is a JS timer, and JS timers do not run while the app
   * is backgrounded — so left alone it wakes up holding an expired token and
   * the first query after a long background fails with a 401. Driving it off
   * AppState is the documented React Native handling.
   */
  useEffect(() => {
    if (!client) return;
    const c = client;
    if (AppState.currentState === 'active') c.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') c.auth.startAutoRefresh();
      else c.auth.stopAutoRefresh();
    });
    return () => {
      sub.remove();
      c.auth.stopAutoRefresh();
    };
  }, []);

  // Reconcile on sign-in, and whenever the app comes back to the foreground —
  // this is what pulls in whatever another device pushed while this one was
  // backgrounded. On the web this hangs off document.visibilitychange; native
  // has no document, and AppState 'active' is the equivalent edge.
  useEffect(() => {
    if (!user) return;
    void reconcile();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void reconcile();
    });
    return () => sub.remove();
  }, [user, reconcile]);

  // Debounced push on local change. 900ms because a set confirm writes several
  // times in quick succession and each one must not become a round trip. No
  // `window` on native — the timer globals are used directly, and the handle is
  // typed off setTimeout itself because RN's is not the DOM's number.
  useEffect(() => {
    if (!user) return;
    /* The fingerprint check used to run HERE, which meant a full
       JSON.stringify of every workout and session on every keystroke of a set
       field, purely to decide whether to arm a timer. pushNow already computes
       the same fingerprint and no-ops when it is unchanged, so the work now
       happens once per quiet period instead of once per character. */
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void pushNow(false).catch((e) => setError(humanizeError(e, 'sync')));
    }, 900);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
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
        nutritionSchemaBlocked.current = false;
        // The next account on this device is not the same athlete: a cached
        // org id or a pending card left standing would be the previous one's.
        arcOrgRef.current = null;
        clearArcOrgCache();
        // Same reason, one table over: the display name is the previous
        // athlete's, and Settings would show it to whoever signs in next.
        clearArcNameCache();
        setPendingAssignments([]);
      },
      syncNow: reconcile,
      pendingAssignments,
      /*
       * Accept/decline are the only calls in this file the athlete asked for
       * directly, so unlike the best-effort reads they THROW: the card is
       * showing a button and must be able to say the tap did not land.
       *
       * The row is dropped from `pendingAssignments` on success. Nothing is
       * materialised here — the assignment becomes real training on the next
       * reconcile, through `materializeAcceptedAssignments`, so the local
       * workout only ever appears for a state the server actually recorded.
       */
      acceptAssignment: async (assignmentId: string) => {
        /* THROWS rather than returning quietly. A silent `return` here would
           be a tapped button that does nothing and says nothing — the card
           would keep showing the assignment with no explanation, which is the
           one outcome the card's error line exists to prevent. */
        if (!client || !arcOrgRef.current) throw new Error('No coaching relationship is available right now.');
        await acceptAssignmentRpc(client, arcOrgRef.current, assignmentId);
        setPendingAssignments((current) => current.filter((a) => a.id !== assignmentId));
        /* Materialise now rather than at the next foreground. A phone is not a
           browser tab left open — the athlete taps Accept and may not
           background the app for days, and "it will appear eventually" is a
           coach's session silently missing from today.
           `reconcile` DROPS a call made while one is already running, so a tap
           landing mid-sync would be exactly that silent wait. `rerunRequested`
           makes the running one come back round instead. Not awaited: the tap
           has already succeeded and `reconcile` reports its own failures. */
        if (inFlight.current) rerunRequested.current = true;
        else void reconcile();
      },
      declineAssignment: async (assignmentId: string) => {
        if (!client || !arcOrgRef.current) throw new Error('No coaching relationship is available right now.');
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
