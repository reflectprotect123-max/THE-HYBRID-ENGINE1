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

export interface CoachWorkspaceRepository {
  listClients(): Promise<readonly ClientSummary[]>;
  listProgramTemplates(): Promise<readonly ProgramTemplate[]>;
  saveAssignmentDraft(draft: ProgramAssignmentDraft): Promise<ProgramAssignmentDraft>;
  getSettings(): Promise<CoachWorkspaceSettings>;
  saveSettings(settings: CoachWorkspaceSettings): Promise<CoachWorkspaceSettings>;
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

