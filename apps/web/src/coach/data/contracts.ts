import type { Session, Workout } from '@hybrid/engine';

/**
 * Where a client's data comes from, and therefore what may be shown.
 *
 * Three states, because two conflated a fact with a limitation:
 *
 * - `engine-local` — the signed-in athlete. Their detailed records are the
 *   local stores this app already reads, so every detail screen works.
 * - `roster-summary` — a REAL athlete, from the database, whose summary is
 *   authorised and whose DETAIL is not readable yet. Counts are true; the
 *   detail screens still read local stores and would show the coach their own
 *   training under this person's name.
 * - `synthetic-fixture` — an invented client, for demonstration.
 *
 * The middle one used to be labelled `synthetic-fixture` too, which made the
 * UI call a real athlete a fixture. The guard was right and the word was not.
 * Anything gated on `=== 'engine-local'` is asking "can I show detail?" and
 * still gets the right answer for all three.
 */
export type CoachDataSource = 'engine-local' | 'roster-summary' | 'synthetic-fixture';
export type TrainingDomain = 'strength' | 'conditioning';
export type ExperienceLevel = 'beginner' | 'developing' | 'experienced';
export type IntensityBand = 'easy' | 'moderate' | 'hard';

export interface ClientSummary {
  id: string;
  name: string;
  initials: string;
  source: CoachDataSource;
  assignment: {
    programName: string;
    currentWeek: number;
    totalWeeks: number;
    status: 'active' | 'paused' | 'review-required';
  } | null;
  completion: {
    strength: { completed: number; planned: number };
    conditioning: { completed: number; planned: number };
    nutritionDays: number;
    checkInDays: number;
  };
  conditioningMinutes: Record<IntensityBand, number>;
  attention: { level: 'safety' | 'decision' | 'reconcile'; label: string } | null;
  /**
   * The coaching relationship the signed-in coach holds WITH THEMSELVES, when
   * they have redeemed their own invite (`20260814_arc_self_coaching.sql`).
   *
   * Present ONLY on the folded `engine-local` entry, and null everywhere else.
   * A self-assignment used to be impossible — a `check` constraint refused it —
   * and the comment on that constraint named exactly what would break without
   * it: "the bench's 'own data' mode and its 'client' mode become the same
   * query". They do not become the same query, because `listClients` folds the
   * self roster row INTO this entry rather than appending a second one. This
   * field is what the row contributes on the way in.
   *
   * `athleteUserId` is the load-bearing half. The entry's `id` stays the
   * literal `engine-local` — it is a selection key the whole bench and
   * `localStorage` are written against — so it is NOT a user id and cannot be
   * sent to a command. Every coach command is keyed on the real one.
   *
   * `organizationId` records WHICH relationship this is. It is deliberately
   * NOT sent to `publish_coach_week` or any other command: the repository's
   * preamble forbids a client-supplied organisation id, and every RPC derives
   * it server-side from the same assignment row. It is here so the entry can
   * name the relationship it is asserting rather than assert one with no
   * evidence attached.
   */
  selfCoaching?: { organizationId: string; athleteUserId: string } | null;
}

/**
 * The athlete a coach COMMAND should be addressed to, or null when this entry
 * has no coaching relationship behind it and no command may be sent at all.
 *
 * One function rather than a `source === 'roster-summary'` test repeated per
 * screen, because since 14 August 2026 that test has two right answers: a
 * roster client, and the coach themselves once they are on their own roster.
 * A screen that keeps asking the old question refuses the owner access to
 * their own week and calls it "not on your roster", which is now false.
 */
export function coachingTargetOf(client: ClientSummary | null): { athleteUserId: string } | null {
  if (!client) return null;
  if (client.selfCoaching) return { athleteUserId: client.selfCoaching.athleteUserId };
  if (client.source === 'roster-summary') return { athleteUserId: client.id };
  return null;
}

export type ProgressionModel =
  | { kind: 'strength'; stages: readonly string[]; increaseAuthority: 'coach-approval-only' }
  | {
      kind: 'conditioning';
      format: 'steady' | 'intervals' | 'tempo' | 'custom' | 'free';
      modality: 'run' | 'row' | 'ski' | 'bike' | 'air_bike' | 'mixed';
      stages: readonly string[];
      increaseAuthority: 'coach-approval-only';
    };

export interface ProgramTemplate {
  id: string;
  domain: TrainingDomain;
  name: string;
  category: string;
  level: ExperienceLevel;
  sessionsPerWeek: 2 | 3 | 4;
  weeks: number;
  summary: string;
  progression: ProgressionModel;
  /**
   * The program's own sessions, read from its latest version body by
   * `sessionsFromBody`.
   *
   * Empty until phase 2 gives a program a way to hold more than one editable
   * draft — `coach_workout_drafts` carries `unique (template_id)` today, so a
   * published body can only ever hold the one session its single draft held.
   * An empty list is an honest "not recorded", never a rendering failure.
   */
  sessions: readonly Workout[];
  status: 'draft' | 'published';
  source: 'coach-template' | 'engine-derived';
}

/**
 * This is an input to the Coordinator, never a resolved calendar write.
 * Preferred weekdays express intent; the Coordinator owns final placement.
 */
export interface ProgramAssignmentDraft {
  id: string;
  clientId: string;
  programTemplateId: string;
  preferredStartDate: string;
  preferredWeekdays: number[];
  baseProgramVersion: string;
  state: 'draft' | 'ready-for-coordinator';
  createdAt: string;
}

export interface CoachWorkspaceSettings {
  weekStartsOn: 'monday' | 'sunday';
  defaultLoadUnit: 'kg' | 'lb';
  priorityNotifications: boolean;
  visibleLibraries: {
    strength: boolean;
    conditioning: boolean;
    beginnerFoundations: boolean;
  };
}

/*
 * `AthleteWeekProjection` was here until 14 August 2026. It carried a
 * `WeeklyPlan` plus the sessions in the window, for `buildWeekReview` to
 * reconcile into a planned-versus-actual ledger. The Coordinator, that
 * ledger and the screen that rendered it are all deleted, and nothing else
 * ever referenced this type.
 */

/*
 * Layer 3 read/write surfaces — deliberately SEPARATE types from the local,
 * self-coach shapes (`ProgressionProposal`, `Session`,
 * `TrendSeries`) rather than a forced fit into them.
 *
 * The backend was built to return LESS than the local demo data does, on
 * purpose — no free-text reason/evidence on a progression proposal (just a
 * sanitised `hard` boolean), no block/set detail on a session (just a
 * summary), no raw macro values without a consent grant. Reusing the local
 * types would mean either fabricating the missing fields (a lie: an empty
 * `evidence: []` reads as "no evidence recorded", not "this tier doesn't
 * carry evidence") or loosening those types for everyone, including the
 * genuinely richer engine-local screens. Separate types keep both honest.
 */

export interface AthleteProgressionProposal {
  id: string;
  domain: TrainingDomain;
  subject: string;
  clientKey: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  confidence: 'low' | 'medium' | 'high';
  /** The sanitised safety signal — never the athlete's own words. */
  hard: boolean;
  direction: 'increase' | 'hold' | 'decrease' | 'review';
  createdAt: string;
}

export interface AthleteTrendSnapshot {
  kind: 'lift_trend' | 'erg_trend' | 'hard_budget' | 'readiness_trend';
  points: readonly Record<string, unknown>[];
  generatedAt: string;
}

/**
 * What `@hybrid/auto-coach`'s autonomy policy did to one session, before the
 * athlete ever saw it — a read-only mirror of `LedgerEntry`
 * (autocoach/ledger.ts), never a write path back into training. Carries no
 * block/set detail: `LedgerEntry.beforeBlocks` and `forkedWorkoutId` are
 * stripped at the source, the same boundary every other roster tier draws.
 */
export interface AthleteAutocoachReceipt {
  clientEntryId: string;
  occurredAt: string;
  sessionDate: string;
  workoutId: string;
  /* `'held'` is NOT auto-coach modifying a session — it is the safety layer
     stopping one, added by supabase/migrations/20260814_arc_held_session_receipt.sql
     so a coach can tell a held session from an ignored one. A held receipt
     carries an EMPTY `operations` (nothing was modified) and the flag that
     stopped it in `reasonCodes` (`pain_hold_active` / `illness_flag_active`).
     Widened here rather than given its own type because it is the same row,
     through the same sanitiser, read back through the same coach-gated RPC. */
  action: 'applied' | 'undone' | 'held';
  wasForked: boolean;
  /* No `before`/`after` — auto-coach's resolver interpolates the raw
     exercise NAME into those two fields for some operation types (see
     packages/auto-coach/src/resolve.ts's `cap_intensity` branch), which is
     block/set-level content this roster tier must never carry. Stripped at
     the source (arc-athlete-sync.ts `sanitizeReceiptOperations`) and
     re-validated server-side (supabase/migrations/20260808_arc_receipts_autocoach.sql
     `push_autocoach_receipt`), since the raw RPC is reachable by more than
     the sanctioned client path. */
  operations: readonly { type: string; targetPath: string; reasonCode: string; materiality: string }[];
  reasonCodes: readonly string[];
}

/** Counts and already-computed signals only — no raw macro or weight value. */
export interface AthleteNutritionSummary {
  loggedDays: number;
  windowDays: number;
  trendDirection: 'gaining' | 'losing' | 'stable' | null;
  estimateConfidence: 'holding' | 'low' | 'medium' | 'high' | null;
}

/** The raw-detail tier. Requesting this is a privileged read, logged and
 *  gated by the athlete's own revocable consent grant. */
export interface AthleteNutritionWindow {
  dailyStatus: readonly { date: string; status: string; note: string | null }[];
  weightEntries: readonly { measuredAt: string; weightKg: number }[];
  macroTargets: readonly { date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[];
  latestCheckIn: {
    status: string;
    explanation: string;
    proposedCalories: number | null;
    proposedProteinG: number | null;
    proposedCarbsG: number | null;
    proposedFatG: number | null;
  } | null;
}

/** A coach-authored workout for one real athlete, live-tuned before it is
 *  published into an assignment. */
export interface AthleteWorkoutDraft {
  workoutId: string;
  kind: TrainingDomain;
  body: Workout;
  baseVersion: number;
  updatedAt: string;
}

/**
 * Entries, decisions and session SUMMARIES for one athlete's week — never
 * block/set detail. `sessions[].name` may be absent; nothing here is a
 * reconciled ledger the way the deleted `buildWeekReview` produced for the
 * self-coach screen, because that reconciliation needed richer session identity
 * (`workoutId`, full block data) than this tier is willing to return.
 */
export interface AthleteWeekSummary {
  entries: readonly { proposalId: string; domain: TrainingDomain; date: string; status: string; title: string }[];
  /* Self-defined since 14 August 2026. This was `WeeklyPlan['decisions']`,
     borrowed from `@hybrid/coordinator`. That package is deleted, but the
     SERVER still returns a decisions array from `get_athlete_week_plan` — the
     database was not changed — so the shape has to keep existing here. It is
     written out rather than re-pointed at another package's type, because
     nothing computes these any more: this describes what a row may still
     CONTAIN, not what anything now produces. */
  decisions: readonly {
    proposalId: string;
    action: 'scheduled' | 'dropped';
    reasonCode: string;
    explanation: string;
  }[];
  sessions: readonly { id: string; kind: TrainingDomain; date: string; status: string; name: string | null }[];
}

/**
 * One day of a coach-authored week: a date and zero or more sessions.
 *
 * The sessions are engine `Workout`s — the same records the day builder
 * already writes (`library/day-workout.ts`), so nothing downstream needs a
 * second idea of what a session is. A day holds a LIST because it genuinely
 * can: a mixed day is stored as a strength record and its conditioning
 * sibling.
 */
export interface CoachWeekDay {
  /** YYYY-MM-DD. */
  date: string;
  sessions: readonly Workout[];
}

/**
 * The week a coach publishes — `publish_coach_week`'s `p_body`, exactly.
 *
 * The migration constrains it to a JSON object and nothing further, so the
 * shape is defined here and in `coach-week.ts`, which owns every rule about
 * it. `schema` and `weekStart` are carried inside the body rather than left
 * to context because this body is written into TWO rows — the immutable
 * version, and `athlete_weekly_plans.plan`, which the athlete's own device
 * reads — and the second one is read a long way from here.
 *
 * `days` is always seven entries, Monday first, empty ones included: a rest
 * day that is present and empty is a coaching decision, and a missing one is
 * indistinguishable from data lost in transit.
 */
export interface CoachWeekBody {
  schema: 'coach-week/1';
  weekStart: string;
  days: readonly CoachWeekDay[];
}

/**
 * A coach week plan and its latest version, as the server holds them.
 *
 * `version` is the OPTIMISTIC LOCK, not decoration — it goes straight back
 * into `publish_coach_week`'s `p_base_version`, which is what makes a second
 * coach publishing the same week fail loudly instead of silently overwriting.
 * Zero means "no version yet", which is also the first publish's `null`.
 */
export interface CoachWeekPlan {
  weekStart: string;
  status: 'draft' | 'published';
  version: number;
  /** The latest published body, or null when nothing has been published. */
  body: CoachWeekBody | null;
  publishedAt: string | null;
}

/**
 * An organisation the SIGNED-IN coach may mint invites into — that is, one
 * where they hold an active `owner` or `coach` membership.
 *
 * The list exists because `create_coach_invite` takes an organisation and the
 * bench cannot guess one. A coach in exactly one organisation never sees this
 * choice; a coach in two must make it, because picking for them would put an
 * athlete in the wrong tenant and nothing downstream would notice.
 */
export interface CoachOrganization {
  id: string;
  name: string;
  role: 'owner' | 'coach';
}

/**
 * A code a coach offers and an athlete redeems.
 *
 * `status` is DERIVED from the row's timestamps rather than stored — the
 * migration keeps no status column, on the same reasoning every other table
 * in that schema states: a status and a timestamp that can disagree
 * eventually do, and the audit trail is what loses.
 *
 * An invite links NOBODY. It is an offer; the athlete's own redemption is
 * what writes the roster row, so `accepted` is the only status that
 * corresponds to a real coaching relationship.
 */
export interface CoachInvite {
  id: string;
  organizationId: string;
  /** The bearer secret. Shown to the coach so they can pass it on, and
   *  readable by nobody but them, the athlete who spent it, and the owner. */
  code: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  status: 'open' | 'accepted' | 'revoked' | 'expired';
}

export interface CoachWorkspaceRepository {
  listClients(): Promise<readonly ClientSummary[]>;
  /**
   * The selected athlete's week, or null when this client's detail is not
   * readable. Null is a FACT, not a failure — a `roster-summary` client has an
   * authorised summary and no readable detail yet.
   */
  /* `getAthleteWeek` was removed on 14 August 2026 with
     `AthleteWeekProjection` and the week-review screen it fed.
     `getAthleteWeekSummary` below is the roster week read that survives —
     the Command Center and the week builder both use it. */
  listProgramTemplates(): Promise<readonly ProgramTemplate[]>;
  saveAssignmentDraft(draft: ProgramAssignmentDraft): Promise<ProgramAssignmentDraft>;
  getSettings(): Promise<CoachWorkspaceSettings>;
  saveSettings(settings: CoachWorkspaceSettings): Promise<CoachWorkspaceSettings>;

  /** Pending progression proposals for a real roster client. */
  listProgressionProposals?(clientId: string): Promise<readonly AthleteProgressionProposal[]>;
  /** Approve or decline. The athlete's OWN device applies the prescription
   *  change on its next sync — this never mutates anything directly. */
  decideProgressionProposal?(clientId: string, proposalId: string, decision: 'approved' | 'declined'): Promise<void>;

  getTrendSnapshot?(clientId: string, kind: AthleteTrendSnapshot['kind']): Promise<AthleteTrendSnapshot | null>;

  /** Most recent auto-coach receipts, newest first. Empty means either "none
   *  yet" or "not readable" — both refuse identically, same as every other
   *  roster tier. */
  listAutocoachReceipts?(clientId: string): Promise<readonly AthleteAutocoachReceipt[]>;

  getNutritionSummary?(clientId: string, weekStart: string): Promise<AthleteNutritionSummary | null>;
  /** Null means either "not readable" or "no consent grant" — both refuse
   *  identically, so this cannot be used to probe which one it was. */
  getNutritionWindow?(clientId: string, weekStart: string): Promise<AthleteNutritionWindow | null>;
  /** Whether the SIGNED-IN coach currently holds a live consent grant for
   *  this client's raw nutrition detail. */
  hasNutritionGrant?(clientId: string): Promise<boolean>;
  /** Whether the SIGNED-IN coach currently holds a live consent grant for
   *  this client's raw readiness trend detail (HRV, resting heart rate,
   *  sleep performance, strain — the raw series whole-athlete-state itself
   *  never exposes; this is a separate, athlete-consented read path). */
  hasReadinessGrant?(clientId: string): Promise<boolean>;

  listWorkoutDrafts?(clientId: string): Promise<readonly AthleteWorkoutDraft[]>;
  saveWorkoutDraft?(clientId: string, workoutId: string, kind: TrainingDomain, body: Workout, baseVersion: number | null): Promise<AthleteWorkoutDraft>;
  /** Snapshots the draft into an immutable, assignable version and creates
   *  the program_assignment in one step — the same Coordinator-placement
   *  path as assigning a shared template. */
  publishWorkoutDraft?(clientId: string, workoutId: string, baseVersion: number, preferredStartDate: string, preferredWeekdays: number[]): Promise<void>;

  getAthleteWeekSummary?(clientId: string, weekStart: string): Promise<AthleteWeekSummary | null>;

  /* --- The coach's own authored week ------------------------------------- */

  /**
   * The coach-authored week for (athlete, weekStart) and its LATEST version,
   * or null when this coach has never published one.
   *
   * Null is a fact, not a failure — it is what a week nobody has written looks
   * like, and it is the state every new week starts in.
   */
  getCoachWeek?(clientId: string, weekStart: string): Promise<CoachWeekPlan | null>;
  /**
   * Publish, through `publish_coach_week` and nothing else.
   *
   * THIS IS THE ONE CROSS-USER WRITE on the bench: it replaces the athlete's
   * own `athlete_weekly_plans` row with `writer = 'coach'`. Everything that
   * makes that safe is server-side — the coach↔athlete check, the row lock,
   * the revision step, the receipt — and this method exists to make sure there
   * is exactly one way to reach it.
   *
   * `baseVersion` is the version this edit started from; null opts out of the
   * optimistic lock, which is correct for a first publish and a deliberate
   * choice for anything else. A stale value REFUSES rather than overwriting,
   * and that refusal must reach the coach — see `publishFailureMessage`.
   */
  publishCoachWeek?(
    clientId: string,
    weekStart: string,
    body: CoachWeekBody,
    baseVersion: number | null,
    idempotencyKey: string,
  ): Promise<CoachWeekPlan>;

  /* --- Getting an athlete ONTO the roster -------------------------------- */

  /** Organisations the signed-in coach can mint invites into. Empty means
   *  "you are not a coach anywhere yet", which is a fact and not a failure. */
  listCoachOrganizations?(): Promise<readonly CoachOrganization[]>;
  /**
   * Create an organisation owned by the caller.
   *
   * The bootstrap. Until 15 August 2026 nothing could make one — the table has
   * no INSERT policy for any role — so a new coach was permanently stuck with
   * "you are not an owner or coach of any organisation" and no cure. Every
   * roster, invite and published week hangs off the row this creates.
   */
  createOrganization?(name: string): Promise<CoachOrganization>;
  /** Every invite this coach has minted, newest first — spent, expired and
   *  revoked ones included, because a coach chasing an athlete who says "it
   *  didn't work" needs to see WHICH of those happened. */
  listCoachInvites?(): Promise<readonly CoachInvite[]>;
  /** Mints a code. Creates no relationship and grants no read — the athlete's
   *  own redemption does that. */
  createCoachInvite?(organizationId: string): Promise<CoachInvite>;
  /** Kills an unredeemed code. Never unlinks an athlete who already spent
   *  one; ending a relationship is a different act — see below, which is that
   *  act and did not exist until 14 August 2026. */
  revokeCoachInvite?(inviteId: string): Promise<CoachInvite>;
  /**
   * Ends an active coaching relationship.
   *
   * Callable by EITHER party server-side — the coach, because a roster has to
   * be manageable, and the athlete, because otherwise leaving requires the
   * permission of the person you are leaving. This bench only ever calls it as
   * the coach; the athlete's half is theirs to invoke from their own session.
   *
   * It does NOT delete the week already published. A coach owns the week they
   * published, there is no Coordinator left to recompute a replacement, and
   * the athlete can clear their own row. No NEW week can arrive, because
   * `publish_coach_week` re-checks the relationship on every call.
   */
  endCoachRelationship?(organizationId: string, athleteUserId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function validateProgramAssignmentDraft(value: unknown): ProgramAssignmentDraft {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.programTemplateId !== 'string'
    || typeof value.preferredStartDate !== 'string'
    || !Array.isArray(value.preferredWeekdays)
    || !value.preferredWeekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    || typeof value.baseProgramVersion !== 'string'
    || (value.state !== 'draft' && value.state !== 'ready-for-coordinator')
    || typeof value.createdAt !== 'string') {
    throw new Error('Invalid program assignment draft');
  }
  return value as unknown as ProgramAssignmentDraft;
}

