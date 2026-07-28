import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
import { sanitizeDB, type EngineDB } from '@hybrid/engine';
import { assertPublishable, type CoachSession } from './model';

/*
 * The coach's cloud side.
 *
 * Publishing writes a row to `assignments` carrying a SNAPSHOT of the session,
 * not a reference to the coach's library. That is deliberate: the athlete must
 * keep the session they were actually given even if the coach later reworks the
 * programme, and a snapshot is the only way that holds.
 *
 * Everything crosses the boundary through @hybrid/engine's emit contract, which
 * throws if a set carries a logger-owned field. That check is what stands
 * between a publish and an athlete's logged work being overwritten by a plan.
 */

interface CoachCloud {
  enabled: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Returns null on success, or a message to show. */
  publish: (sess: CoachSession, athleteId: string, date: string) => Promise<string | null>;
  athletes: { id: string; label: string }[];
  refreshAthletes: () => Promise<void>;
  /** Pending invites this coach has created but nobody has claimed yet. */
  invites: { id: string; token: string; label: string | null }[];
  createInvite: (label: string) => Promise<string | null>;
  /** Returns null on success, or a message to show. */
  revokeInvite: (id: string) => Promise<string | null>;
  /** Why the athlete/invite lists are empty, when it is not simply "they are". */
  loadError: string | null;
  /**
   * The signed-in user's OWN training, read back from app_state.
   *
   * The coach has only ever pushed work out — it could assign a session and
   * never see whether anyone did it, which is why it read as an empty shell.
   * This is the other direction.
   *
   * It reads the row for `auth.uid()`, which the existing "select own state"
   * policy already allows. So it works when you coach yourself and shows
   * nothing when you coach somebody else — reading ANOTHER athlete's training
   * would need a new RLS policy, and that is a privacy decision to make on
   * purpose rather than inherit from a convenient query.
   */
  mine: EngineDB | null;
  mineLoading: boolean;
}

const Ctx = createContext<CoachCloud | null>(null);

const client: SupabaseClient | null = (() => {
  try {
    return createClient(SUPABASE.url, SUPABASE.anonKey, { auth: { persistSession: true } });
  } catch {
    return null;
  }
})();

export function CoachCloudProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [mine, setMine] = useState<EngineDB | null>(null);
  const [mineLoading, setMineLoading] = useState(false);
  const [athletes, setAthletes] = useState<{ id: string; label: string }[]>([]);
  const [invites, setInvites] = useState<{ id: string; token: string; label: string | null }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = client.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  /* Signed out means no data, not stale data from the last account. */
  useEffect(() => {
    if (!client || !user) {
      setMine(null);
      return;
    }
    let live = true;
    setMineLoading(true);
    void client
      .from('app_state')
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        /* The engine lives UNDER `hybridEngine`, not at the top of the row —
           buildPushState nests it so unrelated keys in a user's state survive a
           push. Reading data.state directly returns an empty database and a
           dashboard that says "nothing logged yet" forever. */
        const raw = (data?.state as { hybridEngine?: unknown } | null)?.hybridEngine;
        // sanitizeDB is the same trust boundary the athlete app uses: a
        // half-written row must degrade, not crash.
        setMine(raw ? sanitizeDB(raw) : null);
        setMineLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user]);

  const refreshAthletes = useCallback(async () => {
    if (!client || !user) return;

    // Two independent reads. They used to be chained, so a failure on the first
    // returned early and the invite list was never set at all — a coach whose
    // athlete query was refused saw "No pending invites" and lost the code their
    // athlete needs, with nothing on screen to say a read had failed.
    //
    // Pending invites come back on the same policy (ca_coach_select covers all
    // of this coach's rows), so one extra read keeps the codes visible until
    // they are claimed.
    const [act, pend] = await Promise.all([
      client.from('coach_athletes').select('athlete_id,label').eq('coach_id', user.id).eq('status', 'active'),
      client.from('coach_athletes').select('id,invite_token,label').eq('coach_id', user.id).eq('status', 'pending'),
    ]);

    if (!pend.error) {
      setInvites(
        (pend.data || []).map((r) => ({
          id: r.id as string,
          token: r.invite_token as string,
          label: (r.label as string) ?? null,
        })),
      );
    }

    // A coach can always assign to themselves — it is how you try a session
    // before giving it to anyone, and it needs no invitation to exist. That
    // entry stands even when the read fails, so publishing still works.
    const rows = act.error
      ? []
      : (act.data || [])
          .filter((r) => r.athlete_id)
          .map((r) => ({ id: r.athlete_id as string, label: (r.label as string) || 'Athlete' }));
    setAthletes([{ id: user.id, label: 'Myself' }, ...rows]);

    const err = act.error || pend.error;
    setLoadError(err ? 'Could not read your athletes: ' + err.message : null);
  }, [user]);

  useEffect(() => {
    void refreshAthletes();
  }, [refreshAthletes]);

  const publish = useCallback<CoachCloud['publish']>(
    async (sess, athleteId, date) => {
      if (!client) return 'Cloud is not configured.';
      if (!user) return 'Sign in first — assignments are tied to your account.';

      let snapshot;
      try {
        snapshot = assertPublishable(sess);
      } catch (e) {
        return 'Could not convert session: ' + (e as Error).message;
      }

      try {
        // Idempotent for that athlete/date: clear any prior ad-hoc row before
        // inserting, so publishing twice does not give someone the same session
        // twice on one day. A refused delete has to stop the publish — carrying
        // on would insert a SECOND row for the day and the athlete would open
        // their calendar to two copies of the session.
        const clear = await client
          .from('assignments')
          .delete()
          .eq('coach_id', user.id)
          .eq('athlete_id', athleteId)
          .eq('scheduled_date', date)
          .is('program_id', null);
        if (clear.error) return 'Could not replace the existing assignment: ' + clear.error.message;

        const { error } = await client.from('assignments').insert({
          coach_id: user.id,
          athlete_id: athleteId,
          program_id: null,
          week_index: null,
          day_index: null,
          scheduled_date: date,
          session_snapshot: snapshot,
          status: 'assigned',
        });
        if (error) return error.message;
        return null;
      } catch (e) {
        return String((e as Error)?.message || e);
      }
    },
    [user],
  );

  const value = useMemo<CoachCloud>(
    () => ({
      enabled: !!client,
      user,
      athletes,
      invites,
      loadError,
      mine,
      mineLoading,
      refreshAthletes,
      publish,
      /*
       * An invite is a PENDING row with no athlete on it. RLS enforces exactly
       * that (`ca_coach_insert` requires athlete_id null and status pending) —
       * a coach cannot attach themselves to an athlete, only offer a code the
       * athlete chooses to claim.
       */
      createInvite: async (label) => {
        if (!client || !user) return 'Sign in first.';
        let token: string;
        try {
          token = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
        } catch {
          token = String(Date.now()).slice(-10);
        }
        const { error } = await client.from('coach_athletes').insert({
          coach_id: user.id,
          athlete_id: null,
          status: 'pending',
          invite_token: token,
          label: label.trim() || null,
        });
        if (error) return error.message;
        await refreshAthletes();
        return null;
      },
      /*
       * A revoke that the server refuses used to look identical to one that
       * worked: the code stayed on screen and nothing was said, so the coach
       * believed a live invite had been withdrawn when it had not.
       */
      revokeInvite: async (id) => {
        if (!client || !user) return 'Sign in first.';
        const { error } = await client.from('coach_athletes').delete().eq('id', id).eq('coach_id', user.id);
        await refreshAthletes();
        return error ? 'Could not revoke that invite: ' + error.message : null;
      },
      signIn: async (email, password) => {
        if (!client) return 'Cloud is not configured.';
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        return error ? error.message : null;
      },
      signUp: async (email, password) => {
        if (!client) return 'Cloud is not configured.';
        const { data, error } = await client.auth.signUp({ email: email.trim(), password });
        if (error) return error.message;
        return data.session ? null : 'Account created. Check your email to confirm, then sign in.';
      },
      signOut: async () => {
        if (!client) return;
        await client.auth.signOut();
        setUser(null);
      },
    }),
    [user, athletes, invites, loadError, mine, mineLoading, refreshAthletes, publish],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCoachCloud(): CoachCloud {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCoachCloud outside CoachCloudProvider');
  return c;
}
