import type {
  ClientSummary,
  CoachWorkspaceRepository,
  CoachWorkspaceSettings,
  ProgramAssignmentDraft,
  ProgramTemplate,
} from '../coach/contracts';
import { validateProgramAssignmentDraft } from '../coach/contracts';
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
 * Reads: real. Clients come from `coach_athlete_assignments`, templates from
 * `program_templates` joined to their published versions, settings from the
 * coach's own row.
 *
 * Writes: through `create_program_assignment` ONLY. No client role holds INSERT
 * on any coach table, by design — the command derives the actor from the
 * session, checks the coach↔athlete relationship, and writes the assignment,
 * decision and receipt in one transaction. A direct table write from here would
 * be trusting a client-supplied organisation id, which the handoff forbids.
 *
 * THE TRUTH BOUNDARY, KEPT
 *
 * Detailed training data for a client is NOT readable yet — that is layer 3,
 * the seventeen files still reading the signed-in user's own stores. So every
 * client fetched from the database is returned with `source: 'synthetic-fixture'`,
 * which is the flag the bench already uses to disable detail links and print
 * "Detailed records await the backend adapter".
 *
 * A roster client is returned as `roster-summary` — a real person whose
 * summary is authorised and whose detail is not readable yet. That is a
 * distinct state from `synthetic-fixture`, which is an invented client, and
 * conflating them made the UI call a real athlete a fixture. Zeroes below are
 * "not readable", never "did nothing", and nothing here fabricates a number to
 * fill a shape.
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
    const rows = (data ?? []) as AssignmentRow[];

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

    return [...ENGINE_LOCAL, ...rows.map((row, i) => {
      const s = summaries[i];
      return {
        id: row.athlete_user_id,
        /* No profile table is readable cross-athlete yet, so the id's first
           segment stands in. A placeholder that looks like an id reads as
           missing data; a placeholder that looks like a name would be a
           fabricated person. */
        name: `Athlete ${row.athlete_user_id.slice(0, 8)}`,
        initials: initialsOf(row.athlete_user_id.slice(0, 2)),
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
