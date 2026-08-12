import type { Session, Workout } from '@hybrid/engine';
import type { WeeklyPlan } from '@hybrid/coordinator-adapter';

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

/**
 * One athlete's week, as the server is willing to describe it.
 *
 * The week review needs a resolved plan and the sessions inside the window —
 * `buildWeekReview(plan, sessions, interventions)` takes exactly that and is
 * already athlete-agnostic, so nothing in the projection layer changes.
 *
 * `interventions` is deliberately ABSENT. The auto-coach ledger is device-local
 * and never syncs (`AGENTS.md`), so for a remote athlete there is no source for
 * it. Passing the COACH's own ledger would attribute the coach's interventions
 * to the athlete — precisely the bug layer 3 exists to remove. The caller
 * passes an empty list and the screen says so.
 */
export interface AthleteWeekProjection {
  weeklyPlan: WeeklyPlan;
  sessions: Session[];
  /** Nutrition adherence, the only nutrition the week review reads. */
  nutrition: { loggedDays: number; windowDays: number } | null;
}

/*
 * Layer 3 read/write surfaces — deliberately SEPARATE types from the local,
 * self-coach shapes (`ProgressionProposal`, `WeeklyPlan`, `Session`,
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
  action: 'applied' | 'undone';
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
 * reconciled ledger the way `buildWeekReview` produces for the self-coach
 * screen, because that reconciliation needs richer session identity
 * (`workoutId`, full block data) than this tier is willing to return.
 */
export interface AthleteWeekSummary {
  entries: readonly { proposalId: string; domain: TrainingDomain; date: string; status: string; title: string }[];
  decisions: WeeklyPlan['decisions'];
  sessions: readonly { id: string; kind: TrainingDomain; date: string; status: string; name: string | null }[];
}

export interface CoachWorkspaceRepository {
  listClients(): Promise<readonly ClientSummary[]>;
  /**
   * The selected athlete's week, or null when this client's detail is not
   * readable. Null is a FACT, not a failure — a `roster-summary` client has an
   * authorised summary and no readable detail yet.
   */
  getAthleteWeek?(clientId: string, weekStart: string): Promise<AthleteWeekProjection | null>;
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

