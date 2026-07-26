import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE } from '@hybrid/config';
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
  revokeInvite: (id: string) => Promise<void>;
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
  const [athletes, setAthletes] = useState<{ id: string; label: string }[]>([]);
  const [invites, setInvites] = useState<{ id: string; token: string; label: string | null }[]>([]);

  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = client.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshAthletes = useCallback(async () => {
    if (!client || !user) return;
    const { data, error } = await client
      .from('coach_athletes')
      .select('athlete_id,label')
      .eq('coach_id', user.id)
      .eq('status', 'active');
    if (error) return;

    // Pending invites come back on the same policy (ca_coach_select covers all
    // of this coach's rows), so one extra read keeps the codes visible until
    // they are claimed.
    const { data: pend } = await client
      .from('coach_athletes')
      .select('id,invite_token,label')
      .eq('coach_id', user.id)
      .eq('status', 'pending');
    setInvites((pend || []).map((r) => ({ id: r.id as string, token: r.invite_token as string, label: (r.label as string) ?? null })));
    const rows = (data || [])
      .filter((r) => r.athlete_id)
      .map((r) => ({ id: r.athlete_id as string, label: (r.label as string) || 'Athlete' }));
    // A coach can always assign to themselves — it is how you try a session
    // before giving it to anyone, and it needs no invitation to exist.
    setAthletes([{ id: user.id, label: 'Myself' }, ...rows]);
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
        // twice on one day.
        await client
          .from('assignments')
          .delete()
          .eq('coach_id', user.id)
          .eq('athlete_id', athleteId)
          .eq('scheduled_date', date)
          .is('program_id', null);

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
      revokeInvite: async (id) => {
        if (!client || !user) return;
        await client.from('coach_athletes').delete().eq('id', id).eq('coach_id', user.id);
        await refreshAthletes();
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
    [user, athletes, invites, refreshAthletes, publish],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCoachCloud(): CoachCloud {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCoachCloud outside CoachCloudProvider');
  return c;
}
