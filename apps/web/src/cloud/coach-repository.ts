import type { Workout } from '@hybrid/engine';
import type {
  AthleteAutocoachReceipt,
  AthleteNutritionSummary,
  AthleteNutritionWindow,
  AthleteProgressionProposal,
  AthleteTrendSnapshot,
  AthleteWeekSummary,
  AthleteWorkoutDraft,
  ClientSummary,
  CoachInvite,
  CoachOrganization,
  CoachWeekBody,
  CoachWeekPlan,
  CoachWorkspaceRepository,
  CoachWorkspaceSettings,
  ProgramAssignmentDraft,
  ProgramTemplate,
  TrainingDomain,
} from '../coach/contracts';
import { validateProgramAssignmentDraft } from '../coach/contracts';
import { coachWeekBodyFrom } from '../coach/coach-week';
import { sessionsFromBody } from '../coach/program-body';
import { COACH_CLIENT_FIXTURES } from '../coach/mock-fixtures';
import { supabaseClient } from './sync';

/*
 * The Supabase-backed CoachWorkspaceRepository — layer 1 of the ARC wiring.
 *
 * WHY IT LIVES IN cloud/ AND NOT coach/
 *
 * `checks/coach-contract.mjs` rule 1 forbids anything under `apps/web/src/coach/`
 * from calling Supabase. That is not tidiness: the coach screens must not be
 * able to grow an ad-hoc per-athlete query, because RLS FILTERS rather than
 * raising and such a query fails as a blank screen rather than an error. The
 * repository is the one seam, so the one seam is the one place that talks to
 * the backend.
 *
 * WHAT IT CAN AND CANNOT DO TODAY
 *
 * Reads: real. Clients come from `coach_athlete_assignments`, their names from
 * `athlete_profiles`, templates from `program_templates` joined to their
 * published versions, settings from the coach's own device.
 *
 * Layer 3 is IMPLEMENTED, not pending. `getAthleteWeekSummary`,
 * `listWorkoutDrafts`, `listProgressionProposals`, `getTrendSnapshot`,
 * `listAutocoachReceipts` and `getNutritionSummary` all read one authorised,
 * tenant-scoped projection each, and `saveWorkoutDraft`,
 * `publishWorkoutDraft` and `decideProgressionProposal` write through their
 * own commands.
 *
 * Writes: through SECURITY DEFINER commands ONLY — `create_program_assignment`,
 * `save_workout_draft`, `publish_workout_draft`, `decide_progression_proposal`,
 * `create_coach_invite`, `revoke_coach_invite`. No client role holds INSERT on
 * any coach table, by design: each command derives the actor from the session,
 * checks the coach↔athlete relationship, and commits its record and its receipt
 * in one transaction. A direct table write from here would be trusting a
 * client-supplied organisation id, which the handoff forbids.
 *
 * THE TRUTH BOUNDARY, KEPT — AND WHAT THIS PREAMBLE USED TO SAY
 *
 * It used to read: "Detailed training data for a client is NOT readable yet —
 * that is layer 3, the seventeen files still reading the signed-in user's own
 * stores. So every client fetched from the database is returned with
 * `source: 'synthetic-fixture'`." Both halves were true when written and both
 * stopped being true as layer 3 landed; the sentence is kept here rather than
 * deleted because a reader who remembers the old rule needs to know it moved
 * rather than wonder whether they misread it.
 *
 * What replaced it: a roster client is returned as `roster-summary` — a real
 * person whose summary and layer-3 projections are authorised, and who is
 * still not `engine-local`, because the local-store detail screens would show
 * the coach their OWN training under this person's name. That is a distinct
 * state from `synthetic-fixture`, which is an invented client, and conflating
 * them made the UI call a real athlete a fixture. Zeroes below are "not
 * readable", never "did nothing", and nothing here fabricates a number — or a
 * name — to fill a shape.
 *
 * GETTING AN ATHLETE ONTO THE ROSTER IS A TWO-SIDED ACT
 *
 * `createCoachInvite` mints a code and links nobody. The roster row is written
 * by `redeem_coach_invite`, called from the ATHLETE's session with their own
 * `auth.uid()`. This file holds only the coach's half; there is deliberately
 * no method here that attaches an athlete by id.
 *
 * A COACH MAY NOW BE THEIR OWN ATHLETE (14 August 2026)
 *
 * `20260814_arc_self_coaching.sql` dropped `coach_athlete_distinct` so the
 * owner can publish a week to themselves. That constraint's comment named the
 * cost precisely: without it "the bench's 'own data' mode and its 'client'
 * mode become the same query and the truth boundary the handoff protects
 * disappears" — because `listClients` returned `[...ENGINE_LOCAL, ...rows]`,
 * and a self-row would put the signed-in user in that list TWICE, once read
 * from local stores and once from the server, with nothing on screen saying
 * which was which.
 *
 * It is paid for HERE, in `listClients`, and this is the file the migration
 * points at: a self-row is FOLDED INTO the `engine-local` entry rather than
 * appended as a second one. See `foldSelfRow` below for what it does and does
 * not carry across.
 */

const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';

/** Never a fabricated figure. Zero here means "not readable yet". */
const NO_COMPLETION: ClientSummary['completion'] = {
  strength: { completed: 0, planned: 0 },
  conditioning: { completed: 0, planned: 0 },
  nutritionDays: 0,
  checkInDays: 0,
};

const NO_MINUTES: ClientSummary['conditioningMinutes'] = { easy: 0, moderate: 0, hard: 0 };

/*
 * The signed-in athlete's own entry, kept from the fixtures.
 *
 * This is the ONE client whose detailed data genuinely exists — it is the local
 * stores the bench already reads. Dropping it when the roster went live would
 * have removed the only working view in the workspace and replaced it with a
 * list of athletes whose detail cannot be fetched yet, which is a downgrade
 * dressed as progress.
 *
 * The repository may import the fixtures; the SCREENS may not, and do not.
 */
const ENGINE_LOCAL = COACH_CLIENT_FIXTURES.filter((c) => c.source === 'engine-local');

/**
 * Fold the signed-in coach's OWN roster row into their `engine-local` entry.
 *
 * WHY THE FOLDED ENTRY STAYS `engine-local`, WHICH IS THE WHOLE DECISION.
 *
 * `source` is not a label, it is the answer to "where does this person's
 * detail come from" — `contracts.ts` says so, and every gate in the bench is
 * written against it. For yourself, the honest answer is still LOCAL: the
 * detail screens read the stores on this device, that is your real training,
 * and it works offline. Promoting yourself to `roster-summary` would make
 * every one of those screens refuse or degrade to a server projection of data
 * you are sitting on top of — your own bench, made worse, to satisfy a label.
 *
 * The reverse reading fails for a reason worth stating: `roster-summary`
 * exists because "the detail screens read local stores and would show the
 * coach their OWN training under this person's name". When the person IS the
 * coach that sentence stops being a warning and becomes a description of
 * correct behaviour. The hazard the state guards against cannot occur here.
 *
 * WHAT THE ROW CONTRIBUTES: the relationship, and only the relationship.
 *
 * Not the server's completion counts, and not its safety flag. Those describe
 * the same person the local stores already describe, and taking both would put
 * two answers to one question on one card — which is the exact confusion the
 * dropped constraint existed to prevent, rebuilt inside a single entry instead
 * of across two of them. The local stores win for an `engine-local` entry
 * because that is what `engine-local` MEANS.
 *
 * MORE THAN ONE SELF-ROW is possible — a coach who owns two organisations can
 * redeem their own invite in each. The FIRST is taken, deterministically,
 * because the alternative is either a second duplicate entry (the bug this
 * function exists to prevent) or a refusal to self-coach at all. It is a real
 * limit: `orgIdFor` resolves the organisation server-side with `maybeSingle()`
 * and would raise on two matching rows, so publishing from a two-organisation
 * self-assignment fails loudly rather than silently picking one. Loudly is the
 * right failure and nothing here pretends otherwise.
 */
function foldSelfRow(entry: ClientSummary, row: AssignmentRow): ClientSummary {
  return {
    ...entry,
    /* `id` is UNCHANGED and must stay `engine-local`: it is the selection key
       the bench, `localStorage` and `selectClient('engine-local')` are written
       against, not an identifier of a person. The real user id travels in
       `selfCoaching`, which is where a command reads it from. */
    selfCoaching: { organizationId: row.organization_id, athleteUserId: row.athlete_user_id },
  };
}

const SETTINGS_DEFAULTS: CoachWorkspaceSettings = {
  weekStartsOn: 'monday',
  defaultLoadUnit: 'kg',
  priorityNotifications: true,
  visibleLibraries: { strength: true, conditioning: true, beginnerFoundations: true },
};

interface AssignmentRow {
  athlete_user_id: string;
  organization_id: string;
}

interface MembershipRow {
  organization_id: string;
  role: 'owner' | 'coach';
  /* PostgREST returns an embedded to-one relationship as an object, and some
     versions as a one-element array. Both are handled rather than guessed at. */
  organizations: { name: string } | { name: string }[] | null;
}

interface InviteRow {
  id: string;
  organization_id: string;
  code: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

/**
 * The invite's status, DERIVED here because the table stores none.
 *
 * Order matters and is not arbitrary. A redeemed invite reads `accepted` even
 * after its expiry passes, because it was spent while valid and the roster row
 * it created is real; showing it as `expired` would suggest the link had
 * lapsed. Revoked outranks expired for the same reason in reverse — the coach
 * killed it, and that is the more informative fact.
 */
function inviteFromRow(row: InviteRow): CoachInvite {
  const status: CoachInvite['status'] = row.accepted_at
    ? 'accepted'
    : row.revoked_at
      ? 'revoked'
      : Date.parse(row.expires_at) <= Date.now()
        ? 'expired'
        : 'open';
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    status,
  };
}

interface SummaryRow {
  strength_completed: number;
  strength_planned: number;
  conditioning_completed: number;
  conditioning_planned: number;
  nutrition_days: number;
  has_safety_flag: boolean;
}

/** The Monday on or before `d`, matching the Coordinator's week. */
function weekStart(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`;
}

interface TemplateRow {
  id: string;
  domain: 'strength' | 'conditioning';
  name: string;
  category: string;
  level: 'beginner' | 'developing' | 'experienced';
  status: 'draft' | 'published' | 'archived';
  program_template_versions: { version: number; body: Record<string, unknown> }[] | null;
}

export class SupabaseCoachWorkspaceRepository implements CoachWorkspaceRepository {
  constructor(private readonly client = supabaseClient) {}

  /**
   * The coach's roster.
   *
   * An empty array is returned for an unauthenticated or unconfigured build —
   * NOT an error, because the bench is usable signed-out against the athlete's
   * own local data, and a thrown error there would blank a working screen.
   *
   * A query error IS thrown. The provider catches it and shows "Client
   * summaries could not be loaded", which is the honest message; swallowing it
   * into an empty roster would say "you coach nobody", and those are different
   * facts.
   */
  async listClients(): Promise<readonly ClientSummary[]> {
    if (!this.client) return [];
    const { data: session } = await this.client.auth.getUser();
    if (!session?.user) return [];

    const { data, error } = await this.client
      .from('coach_athlete_assignments')
      .select('athlete_user_id, organization_id')
      .eq('coach_user_id', session.user.id)
      .eq('status', 'active');
    if (error) throw error;

    const monday = weekStart(new Date());
    const all = (data ?? []) as AssignmentRow[];

    /* The signed-in coach's own row is separated BEFORE anything else touches
       the list, so it cannot become a client of its own further down: no name
       lookup, no summary call, and no second entry in the returned array. It
       is folded into `engine-local` instead. */
    const selfRow = all.find((row) => row.athlete_user_id === session.user.id) ?? null;
    const rows = all.filter((row) => row.athlete_user_id !== session.user.id);
    const own = selfRow
      ? ENGINE_LOCAL.map((entry) => foldSelfRow(entry, selfRow))
      : ENGINE_LOCAL;

    const names = await this.displayNames(rows.map((row) => row.athlete_user_id));

    /* One projection call per client, in parallel. Each is authorised
       server-side; a refusal for one client must not blank the whole roster,
       so a failed summary degrades that ONE row to "not readable" rather than
       rejecting the list. */
    const summaries = await Promise.all(rows.map(async (row) => {
      try {
        const { data: s, error: e } = await this.client!.rpc('get_athlete_training_summary', {
          p_organization_id: row.organization_id,
          p_athlete_user_id: row.athlete_user_id,
          p_week_start: monday,
        });
        if (e) return null;
        return (Array.isArray(s) ? s[0] : s) as SummaryRow | null;
      } catch {
        return null;
      }
    }));

    return [...own, ...rows.map((row, i) => {
      const s = summaries[i];
      /* The athlete's OWN name, if they published one. `athlete_profiles` is
         set by the athlete and read through the coaching relationship; a row
         that is not there means they have not published one, and the id's
         first segment stands in exactly as it always did. A placeholder that
         looks like an id reads as missing data; a placeholder that looks like
         a name would be a fabricated person, so nothing here derives one from
         an email address or a uuid. */
      const name = names.get(row.athlete_user_id) ?? null;
      return {
        id: row.athlete_user_id,
        name: name ?? `Athlete ${row.athlete_user_id.slice(0, 8)}`,
        initials: name ? initialsOf(name) : initialsOf(row.athlete_user_id.slice(0, 2)),
        /* A REAL athlete whose summary is authorised and whose detail is not
           readable yet — which is a different thing from an invented one, and
           now says so. Still not `engine-local`: the detail screens read local
           stores and would show the coach their own training under this
           person's name. That is layer 3. */
        source: 'roster-summary' as const,
        assignment: null,
        completion: s
          ? {
              strength: { completed: s.strength_completed, planned: s.strength_planned },
              conditioning: { completed: s.conditioning_completed, planned: s.conditioning_planned },
              nutritionDays: s.nutrition_days,
              checkInDays: 0,
            }
          : NO_COMPLETION,
        conditioningMinutes: NO_MINUTES,
        /* A safety flag outranks everything, so it is the one thing that
           reaches the roster. `safety`, not `decision`: a coach who sees "3 of
           4 done" without knowing the fourth was dropped for pain has been
           told the opposite of what happened. */
        attention: s?.has_safety_flag
          ? { level: 'safety' as const, label: 'Pain or illness flag is active' }
          : null,
      };
    })];
  }

  /**
   * The athletes' own published display names, keyed by user id.
   *
   * A missing entry is the normal case, not an error: `athlete_profiles` only
   * has a row once the athlete sets one, and RLS FILTERS rather than raising,
   * so a name the coach is not entitled to read simply is not in the answer.
   * Both come back as "no name", which is the truth the caller needs.
   *
   * A FAILURE degrades to the same place rather than propagating. This is the
   * one read in `listClients` whose absence costs nothing but a nicer label —
   * blanking a whole roster because a cosmetic lookup failed would trade a
   * real answer for a missing one.
   */
  private async displayNames(ids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.client || ids.length === 0) return out;
    try {
      const { data, error } = await this.client
        .from('athlete_profiles')
        .select('user_id, display_name')
        .in('user_id', [...ids]);
      if (error) return out;
      for (const row of (data ?? []) as { user_id: string; display_name: string | null }[]) {
        const name = (row.display_name ?? '').trim();
        if (name) out.set(row.user_id, name);
      }
    } catch {
      /* No name is a supported state. See above. */
    }
    return out;
  }

  /**
   * Organisations the signed-in coach may mint invites into.
   *
   * `organization_memberships` is readable for one's OWN rows, so this needs
   * no command — and it must be filtered to `owner`/`coach`, because a coach
   * who is also somebody else's athlete has an `athlete` membership too and
   * `create_coach_invite` would refuse it server-side. Offering a choice the
   * server will reject is a worse screen than not offering it.
   */
  async listCoachOrganizations(): Promise<readonly CoachOrganization[]> {
    if (!this.client) return [];
    const { data: session } = await this.client.auth.getUser();
    if (!session?.user) return [];
    const { data, error } = await this.client
      .from('organization_memberships')
      .select('organization_id, role, organizations(name)')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .in('role', ['owner', 'coach']);
    if (error) throw error;
    return ((data ?? []) as MembershipRow[]).map((row) => ({
      id: row.organization_id,
      /* An organisation whose name did not come back is named by its id.
         Same rule as an athlete without a profile: an id-shaped label reads
         as missing data, an invented one reads as a fact. */
      name: (Array.isArray(row.organizations) ? row.organizations[0]?.name : row.organizations?.name)
        ?? `Organisation ${row.organization_id.slice(0, 8)}`,
      role: row.role,
    }));
  }

  async listCoachInvites(): Promise<readonly CoachInvite[]> {
    if (!this.client) return [];
    const { data: session } = await this.client.auth.getUser();
    if (!session?.user) return [];
    const { data, error } = await this.client
      .from('coach_athlete_invites')
      .select('id, organization_id, code, created_at, expires_at, accepted_at, revoked_at')
      .eq('coach_user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as InviteRow[]).map(inviteFromRow);
  }

  /**
   * Mints a code. This creates NO coaching relationship — the athlete's own
   * `redeem_coach_invite` call does that, from their session, with their own
   * id. Nothing in this class can attach an athlete by id, deliberately.
   */
  async createCoachInvite(organizationId: string): Promise<CoachInvite> {
    if (!this.client) throw new Error('Inviting an athlete needs a connection.');
    const { data, error } = await this.client.rpc('create_coach_invite', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as InviteRow | null;
    /* A command that came back empty wrote nothing. Reporting a code the
       coach could then send to an athlete — one that exists nowhere — is the
       failure they could not detect from the screen. */
    if (!row) throw new Error('The invite was not created. Nothing has changed — try again.');
    return inviteFromRow(row);
  }

  async revokeCoachInvite(inviteId: string): Promise<CoachInvite> {
    if (!this.client) throw new Error('Revoking an invite needs a connection.');
    const { data, error } = await this.client.rpc('revoke_coach_invite', { p_invite_id: inviteId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as InviteRow | null;
    if (!row) throw new Error('The invite was not revoked. It may still be usable — try again.');
    return inviteFromRow(row);
  }

  /**
   * End a coaching relationship. See the interface for who may call it and
   * what it deliberately leaves alone.
   *
   * The server refuses with ONE message whether the relationship does not
   * exist or is not the caller's to end, so this cannot be used to probe who
   * is on whose roster — and this method does not try to improve on that
   * wording, for the same reason.
   */
  async endCoachRelationship(organizationId: string, athleteUserId: string): Promise<void> {
    if (!this.client) throw new Error('Ending a coaching relationship needs a connection.');
    const { data, error } = await this.client.rpc('end_coach_relationship', {
      p_organization_id: organizationId,
      p_athlete_user_id: athleteUserId,
    });
    if (error) throw error;
    /* Same rule as the invite commands: a command that came back empty wrote
       nothing, and reporting success for a relationship that is still live is
       the failure a coach cannot see from the screen. */
    if (!(Array.isArray(data) ? data[0] : data)) {
      throw new Error('The relationship was not ended. Nothing has changed — try again.');
    }
  }

  async listProgramTemplates(): Promise<readonly ProgramTemplate[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('program_templates')
      .select('id, domain, name, category, level, status, program_template_versions(version, body)')
      .eq('status', 'published');
    if (error) throw error;

    return ((data ?? []) as TemplateRow[]).map((row) => {
      const latest = (row.program_template_versions ?? []).reduce<{ version: number; body: Record<string, unknown> } | null>(
        (best, v) => (best === null || v.version > best.version ? v : best),
        null,
      );
      const body = latest?.body ?? {};
      const sessions = Number(body.sessionsPerWeek);
      return {
        id: row.id,
        domain: row.domain,
        name: row.name,
        category: row.category,
        level: row.level,
        // The union is 2 | 3 | 4; anything else is a template we cannot honour,
        // and 3 is the middle rather than a guess dressed as data.
        sessionsPerWeek: sessions === 2 || sessions === 3 || sessions === 4 ? sessions : 3,
        weeks: Number.isFinite(Number(body.weeks)) ? Number(body.weeks) : 0,
        summary: typeof body.summary === 'string' ? body.summary : '',
        // The body was already fetched and reduced above; this reads the one
        // field the contract previously had nowhere to put.
        sessions: sessionsFromBody(body),
        progression: (body.progression as ProgramTemplate['progression']) ?? {
          kind: 'strength',
          stages: [],
          increaseAuthority: 'coach-approval-only',
        },
        status: 'published',
        source: 'coach-template',
      } satisfies ProgramTemplate;
    });
  }

  /**
   * Persist an assignment through the sanctioned command.
   *
   * `preferredWeekdays` is INTENT. Nothing here places a session on a date, and
   * the command takes no parameter that could — the Coordinator resolves the
   * week from the proposals this assignment becomes.
   *
   * The draft id doubles as the idempotency key, so a retry after a dropped
   * connection returns the original write rather than making a second one.
   */
  async saveAssignmentDraft(input: ProgramAssignmentDraft): Promise<ProgramAssignmentDraft> {
    const draft = validateProgramAssignmentDraft(input);
    if (!this.client) throw new Error('Assignments need a connection. Approval and publication are online-only in v1.');

    const { data: session } = await this.client.auth.getUser();
    if (!session?.user) throw new Error('Sign in to assign a program.');

    /* The organisation is derived from the coach↔athlete row rather than taken
       from the client. The command re-checks it server-side regardless — this
       is only about not sending a guess. */
    const { data: link, error: linkError } = await this.client
      .from('coach_athlete_assignments')
      .select('organization_id')
      .eq('coach_user_id', session.user.id)
      .eq('athlete_user_id', draft.clientId)
      .eq('status', 'active')
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) throw new Error('That athlete is not on your roster.');

    const { data: written, error } = await this.client.rpc('create_program_assignment', {
      p_organization_id: (link as { organization_id: string }).organization_id,
      p_athlete_user_id: draft.clientId,
      p_template_version_id: draft.programTemplateId,
      p_preferred_start_date: draft.preferredStartDate,
      p_preferred_weekdays: draft.preferredWeekdays,
      p_idempotency_key: draft.id,
      p_base_version: draft.baseProgramVersion,
    });
    if (error) throw error;
    /* A command that returns no row wrote nothing, and `error` alone does not
       say so. Reporting "assigned" for a call that came back empty is the one
       failure the coach cannot detect from the screen — they would close the
       tab believing an athlete has a program. The server raises rather than
       returning null now; this is the second lock on the same door, because
       the first one was added after it was found open. */
    const row = Array.isArray(written) ? written[0] : written;
    if (!row) throw new Error('The assignment was not written. Nothing has changed — try again.');

    return { ...draft, state: 'ready-for-coordinator' };
  }

  /** Every layer-3 RPC takes (organisation, athlete), and the UI only knows
   *  the athlete. Resolved once, from the coach's own active assignment row
   *  — the RPCs re-check it server-side regardless, same as
   *  saveAssignmentDraft above; this is only about not sending a guess.
   *
   *  A SELF-COACHED coach resolves through here unchanged, and that is why
   *  `ClientSummary.selfCoaching.organizationId` is never sent from a screen:
   *  the organisation is derived from the same row the fold read it from,
   *  server-side, on every call. `clientId` must be the real user id — the
   *  folded entry keeps `id: 'engine-local'`, which is a selection key and
   *  matches no `athlete_user_id`, so a caller that passes it gets the honest
   *  "not on your roster" rather than a wrong organisation. */
  private async orgIdFor(clientId: string): Promise<string> {
    if (!this.client) throw new Error('This needs a connection.');
    const { data: session } = await this.client.auth.getUser();
    if (!session?.user) throw new Error('Sign in to continue.');
    const { data: link, error } = await this.client
      .from('coach_athlete_assignments')
      .select('organization_id')
      .eq('coach_user_id', session.user.id)
      .eq('athlete_user_id', clientId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    if (!link) throw new Error('That athlete is not on your roster.');
    return (link as { organization_id: string }).organization_id;
  }

  async listProgressionProposals(clientId: string): Promise<readonly AthleteProgressionProposal[]> {
    if (!this.client) return [];
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('get_athlete_progression_proposals', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
    });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      domain: row.domain as TrainingDomain,
      subject: row.subject as string,
      clientKey: row.client_key as string,
      before: row.before as Record<string, unknown> | null,
      after: row.after as Record<string, unknown>,
      confidence: row.confidence as AthleteProgressionProposal['confidence'],
      hard: row.hard as boolean,
      direction: row.direction as AthleteProgressionProposal['direction'],
      createdAt: row.created_at as string,
    }));
  }

  /** Never mutates a prescription directly — that command doesn't exist. The
   *  athlete's own device reads the resulting receipt on its next sync and
   *  applies the change itself, through the unmodified engine path. */
  async decideProgressionProposal(clientId: string, proposalId: string, decision: 'approved' | 'declined'): Promise<void> {
    if (!this.client) throw new Error('This needs a connection.');
    const organizationId = await this.orgIdFor(clientId);
    const { error } = await this.client.rpc('decide_progression_proposal', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_proposal_id: proposalId,
      p_decision: decision,
      p_idempotency_key: `${proposalId}:${decision}`,
    });
    if (error) throw error;
  }

  async getTrendSnapshot(clientId: string, kind: AthleteTrendSnapshot['kind']): Promise<AthleteTrendSnapshot | null> {
    if (!this.client) return null;
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('get_athlete_trend_series', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_kind: kind,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row || row.id == null) return null;
    return { kind, points: (row.points ?? []) as Record<string, unknown>[], generatedAt: row.generated_at as string };
  }

  async listAutocoachReceipts(clientId: string): Promise<readonly AthleteAutocoachReceipt[]> {
    if (!this.client) return [];
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('get_athlete_autocoach_receipts', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
    });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      clientEntryId: row.client_entry_id as string,
      occurredAt: row.occurred_at as string,
      sessionDate: row.session_date as string,
      workoutId: row.workout_id as string,
      action: row.action as AthleteAutocoachReceipt['action'],
      wasForked: row.was_forked as boolean,
      operations: (row.operations ?? []) as AthleteAutocoachReceipt['operations'],
      reasonCodes: (row.reason_codes ?? []) as string[],
    }));
  }

  async getNutritionSummary(clientId: string, weekStart: string): Promise<AthleteNutritionSummary | null> {
    if (!this.client) return null;
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('get_athlete_nutrition_summary', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_week_start: weekStart,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      loggedDays: row.logged_days as number,
      windowDays: row.window_days as number,
      trendDirection: (row.trend_direction ?? null) as AthleteNutritionSummary['trendDirection'],
      estimateConfidence: (row.estimate_confidence ?? null) as AthleteNutritionSummary['estimateConfidence'],
    };
  }

  /** Null covers BOTH "not readable" and "no consent grant" — the RPC
   *  refuses identically either way, so a caller cannot use this to probe
   *  which one it was. Use `hasNutritionGrant` to show the coach their own
   *  grant state, which is a different, non-privileged question. */
  async getNutritionWindow(clientId: string, weekStart: string): Promise<AthleteNutritionWindow | null> {
    if (!this.client) return null;
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('get_athlete_nutrition_window', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_week_start: weekStart,
    });
    if (error) return null;
    return data as AthleteNutritionWindow | null;
  }

  async hasNutritionGrant(clientId: string): Promise<boolean> {
    if (!this.client) return false;
    const { data: session } = await this.client.auth.getUser();
    if (!session?.user) return false;
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client
      .from('nutrition_read_grants')
      .select('revoked_at')
      .eq('organization_id', organizationId)
      .eq('athlete_user_id', clientId)
      .eq('granted_to', session.user.id)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) return false;
    return data != null;
  }

  async hasReadinessGrant(clientId: string): Promise<boolean> {
    if (!this.client) return false;
    const { data: session } = await this.client.auth.getUser();
    if (!session?.user) return false;
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client
      .from('readiness_read_grants')
      .select('revoked_at')
      .eq('organization_id', organizationId)
      .eq('athlete_user_id', clientId)
      .eq('granted_to', session.user.id)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) return false;
    return data != null;
  }

  async listWorkoutDrafts(clientId: string): Promise<readonly AthleteWorkoutDraft[]> {
    if (!this.client) return [];
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('get_athlete_workout_library', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
    });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      workoutId: row.workout_id as string,
      kind: row.kind as TrainingDomain,
      body: row.body as Workout,
      baseVersion: row.base_version as number,
      updatedAt: row.updated_at as string,
    }));
  }

  async saveWorkoutDraft(clientId: string, workoutId: string, kind: TrainingDomain, body: Workout, baseVersion: number | null): Promise<AthleteWorkoutDraft> {
    if (!this.client) throw new Error('Live-tuning a client workout needs a connection.');
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('save_workout_draft', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_workout_id: workoutId,
      p_kind: kind,
      p_body: body,
      p_base_version: baseVersion,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) throw new Error('The draft was not saved. Nothing has changed — try again.');
    return {
      workoutId: row.workout_id as string,
      kind: row.kind as TrainingDomain,
      body: row.body as Workout,
      baseVersion: row.base_version as number,
      updatedAt: row.updated_at as string,
    };
  }

  /** Snapshots the draft into an immutable version and assigns it in one
   *  step, through the same Coordinator-placement path every other
   *  assignment uses. Nothing here places a session on a date. */
  async publishWorkoutDraft(clientId: string, workoutId: string, baseVersion: number, preferredStartDate: string, preferredWeekdays: number[]): Promise<void> {
    if (!this.client) throw new Error('Publishing needs a connection.');
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('publish_workout_draft', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_workout_id: workoutId,
      p_base_version: baseVersion,
      p_preferred_start_date: preferredStartDate,
      p_preferred_weekdays: preferredWeekdays,
      p_idempotency_key: `${workoutId}:${baseVersion}`,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('The workout was not published. Nothing has changed — try again.');
  }

  /**
   * Entries, decisions and session SUMMARIES only.
   *
   * This comment used to contrast it with `getAthleteWeek`, which promised a
   * full `AthleteWeekProjection` with real `Session[]` block/set detail; the
   * point was that this tier does not return that, and fabricating empty
   * blocks to satisfy the richer type would misrepresent what is known.
   * `getAthleteWeek` was deleted on 14 August 2026 with the Coordinator, so
   * this is now the ONLY athlete-week read — the caution stands on its own
   * rather than as a contrast: what comes back here is summaries.
   */
  async getAthleteWeekSummary(clientId: string, weekStart: string): Promise<AthleteWeekSummary | null> {
    if (!this.client) return null;
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('get_athlete_week_plan', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_week_start: weekStart,
    });
    if (error) return null;
    if (!data) return null;
    const result = data as { plan?: { entries?: unknown[]; decisions?: unknown[] }; sessions?: unknown[] };
    return {
      entries: (result.plan?.entries ?? []) as AthleteWeekSummary['entries'],
      decisions: (result.plan?.decisions ?? []) as AthleteWeekSummary['decisions'],
      sessions: (result.sessions ?? []) as AthleteWeekSummary['sessions'],
    };
  }

  /**
   * The coach's authored week for one athlete, with its latest version.
   *
   * A plain SELECT rather than an RPC, because the migration grants exactly
   * that and nothing more: `coach_week_plans_read` and
   * `coach_week_versions_read` let the two parties in the relationship read,
   * and every client role is revoked INSERT, UPDATE and DELETE. A read needs
   * no command; a WRITE has no path except `publish_coach_week`.
   *
   * Null means no week has been authored. RLS FILTERS rather than raising, so
   * a week this coach may not read comes back as no row — the same answer, and
   * the right one: there is nothing here for them.
   */
  async getCoachWeek(clientId: string, weekStart: string): Promise<CoachWeekPlan | null> {
    if (!this.client) return null;
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client
      .from('coach_week_plans')
      .select('status, week_start, coach_week_plan_versions(version, body, published_at)')
      .eq('organization_id', organizationId)
      .eq('athlete_user_id', clientId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as {
      status: 'draft' | 'published';
      coach_week_plan_versions: { version: number; body: unknown; published_at: string }[] | null;
    };
    /* The HIGHEST version, chosen here rather than trusted from the order the
       embed happened to return. `publish_coach_week` numbers them and the
       unique constraint keeps them distinct, so max is unambiguous. */
    const latest = (row.coach_week_plan_versions ?? []).reduce<{ version: number; body: unknown; published_at: string } | null>(
      (best, v) => (best === null || v.version > best.version ? v : best),
      null,
    );
    return {
      weekStart,
      status: row.status,
      version: latest?.version ?? 0,
      body: latest ? coachWeekBodyFrom(latest.body, weekStart) : null,
      publishedAt: latest?.published_at ?? null,
    };
  }

  /**
   * The publish. One RPC, one transaction, and the only cross-user write in
   * this file.
   *
   * Nothing is validated here that the server does not validate again — the
   * Monday, the relationship, the base version and the idempotency key are all
   * re-checked inside `publish_coach_week`, which is where they have to be
   * checked, because this class is not an authorisation boundary.
   *
   * An empty response is treated as a FAILURE, like every other command here.
   * The function raises rather than returning null, so this is the second lock
   * on the same door — and the door it guards is a coach closing the tab
   * believing an athlete has a week.
   */
  async publishCoachWeek(
    clientId: string,
    weekStart: string,
    body: CoachWeekBody,
    baseVersion: number | null,
    idempotencyKey: string,
  ): Promise<CoachWeekPlan> {
    if (!this.client) throw new Error('Publishing a week needs a connection.');
    const organizationId = await this.orgIdFor(clientId);
    const { data, error } = await this.client.rpc('publish_coach_week', {
      p_organization_id: organizationId,
      p_athlete_user_id: clientId,
      p_week_start: weekStart,
      p_body: body,
      p_idempotency_key: idempotencyKey,
      p_base_version: baseVersion,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { version: number; body: unknown; published_at: string }
      | null;
    if (!row) throw new Error('The week was not published. Nothing has changed — try again.');
    return {
      weekStart,
      status: 'published',
      version: row.version,
      body: coachWeekBodyFrom(row.body, weekStart),
      publishedAt: row.published_at,
    };
  }

  /* Workspace preferences are the coach's own display settings — not athlete
     data, and deliberately still local. Moving them server-side needs a table
     nobody has specified, and inventing one to look complete would be the
     wrong kind of finished. */
  async getSettings(): Promise<CoachWorkspaceSettings> {
    try {
      const raw = localStorage.getItem('hybrid-arc-settings-v1');
      if (!raw) return { ...SETTINGS_DEFAULTS };
      return { ...SETTINGS_DEFAULTS, ...(JSON.parse(raw) as Partial<CoachWorkspaceSettings>) };
    } catch {
      return { ...SETTINGS_DEFAULTS };
    }
  }

  async saveSettings(settings: CoachWorkspaceSettings): Promise<CoachWorkspaceSettings> {
    try {
      localStorage.setItem('hybrid-arc-settings-v1', JSON.stringify(settings));
    } catch {
      /* A full or blocked store must not lose the coach's screen. */
    }
    return settings;
  }
}

export const supabaseCoachWorkspaceRepository = new SupabaseCoachWorkspaceRepository();
