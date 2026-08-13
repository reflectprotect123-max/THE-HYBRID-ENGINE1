import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { CoachWorkspaceProvider } from './CoachWorkspaceContext';
import { DEFAULT_COACH_SETTINGS } from './mock-fixtures';
import type {
  AthleteAutocoachReceipt,
  AthleteNutritionSummary,
  AthleteNutritionWindow,
  AthleteProgressionProposal,
  AthleteTrendSnapshot,
  AthleteWeekProjection,
  AthleteWeekSummary,
  AthleteWorkoutDraft,
  ClientSummary,
  CoachInvite,
  CoachOrganization,
  CoachWorkspaceRepository,
  CoachWorkspaceSettings,
  ProgramAssignmentDraft,
  ProgramTemplate,
  TrainingDomain,
} from './contracts';

/*
 * Shared render infrastructure for coach-bench components — added to close
 * docs/RISK_REGISTER.md R8 ("Coach bench has no render tests" — ~2,700 lines
 * of UI covered only by checks/react-smoke.mjs, which drives ONLY
 * /coach/legacy in a real browser; every ARC layer-3 screen built this
 * session had never been rendered by a test at all).
 *
 * `apps/web` had no `@testing-library/react` before this file — the one
 * prior render test (ClientDetailGate.test.tsx) deliberately used
 * `renderToStaticMarkup` specifically to AVOID needing it, by testing a pure
 * presentational sub-component instead of the hook-wired screen. That
 * pattern doesn't reach the real screens: they call `useCoachWorkspace()`,
 * `useEffect`, `useState` directly, so a static, effect-free render finds
 * every list stuck at `null` forever. Standard, dev-only, zero production
 * impact: `@testing-library/react` + `jsdom` (see the `// @vitest-environment
 * jsdom` directive each consuming test file carries — vitest.config.ts's
 * global `environment: 'node'` is untouched, so every existing fast
 * Node-environment test is unaffected).
 */

/**
 * A `roster-summary` fixture client — the ARC layer-3, real-backend case
 * every screen this harness renders actually branches on.
 * `mock-fixtures.ts`'s `COACH_CLIENT_FIXTURES` covers `engine-local` and
 * `synthetic-fixture` already; neither is this one, because nothing needed
 * it until layer 3 existed.
 */
export function rosterClient(over: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: 'roster-1',
    name: 'Riley Roster',
    initials: 'RR',
    source: 'roster-summary',
    assignment: null,
    completion: {
      strength: { completed: 0, planned: 0 },
      conditioning: { completed: 0, planned: 0 },
      nutritionDays: 0,
      checkInDays: 0,
    },
    conditioningMinutes: { easy: 0, moderate: 0, hard: 0 },
    attention: null,
    ...over,
  };
}

/**
 * Every method — required AND optional — implemented, each independently
 * settable per test via the plain instance fields below. Defaults are the
 * "nothing yet" shape every roster screen must already handle for a
 * brand-new coaching relationship: empty lists, null projections, no grant.
 * A test that wants real data sets the field before rendering; nothing here
 * hits `localStorage` or a network — every read is synchronous in-memory
 * data behind an `async` signature.
 */
export class FakeCoachWorkspaceRepository implements CoachWorkspaceRepository {
  clients: readonly ClientSummary[] = [];
  templates: readonly ProgramTemplate[] = [];
  templatesError = false;
  settings: CoachWorkspaceSettings = DEFAULT_COACH_SETTINGS;
  athleteWeek: AthleteWeekProjection | null = null;
  progressionProposals: readonly AthleteProgressionProposal[] = [];
  decidedProposals: { clientId: string; proposalId: string; decision: 'approved' | 'declined' }[] = [];
  trendSnapshots: Partial<Record<AthleteTrendSnapshot['kind'], AthleteTrendSnapshot | null>> = {};
  autocoachReceipts: readonly AthleteAutocoachReceipt[] = [];
  nutritionSummary: AthleteNutritionSummary | null = null;
  nutritionWindow: AthleteNutritionWindow | null = null;
  nutritionGrant = false;
  readinessGrant = false;
  workoutDrafts: readonly AthleteWorkoutDraft[] = [];
  savedDrafts: { clientId: string; workoutId: string; kind: TrainingDomain; body: unknown; baseVersion: number | null }[] = [];
  publishedDrafts: { clientId: string; workoutId: string; baseVersion: number; preferredStartDate: string; preferredWeekdays: number[] }[] = [];
  weekSummary: AthleteWeekSummary | null = null;
  assignmentDrafts: readonly ProgramAssignmentDraft[] = [];

  async listClients(): Promise<readonly ClientSummary[]> {
    return this.clients;
  }

  async getAthleteWeek(): Promise<AthleteWeekProjection | null> {
    return this.athleteWeek;
  }

  async listProgramTemplates(): Promise<readonly ProgramTemplate[]> {
    if (this.templatesError) throw new Error('simulated listProgramTemplates failure');
    return this.templates;
  }

  /** Recorded, not just echoed: `saveAssignmentDraft` is the app's only
   *  program-assignment path, and a test that cannot see what it wrote cannot
   *  tell an assignment from a no-op that returned its own argument. */
  async saveAssignmentDraft(draft: ProgramAssignmentDraft): Promise<ProgramAssignmentDraft> {
    this.assignmentDrafts = [...this.assignmentDrafts, draft];
    return draft;
  }

  async getSettings(): Promise<CoachWorkspaceSettings> {
    return this.settings;
  }

  async saveSettings(settings: CoachWorkspaceSettings): Promise<CoachWorkspaceSettings> {
    this.settings = settings;
    return settings;
  }

  async listProgressionProposals(): Promise<readonly AthleteProgressionProposal[]> {
    return this.progressionProposals;
  }

  async decideProgressionProposal(clientId: string, proposalId: string, decision: 'approved' | 'declined'): Promise<void> {
    this.decidedProposals.push({ clientId, proposalId, decision });
  }

  async getTrendSnapshot(_clientId: string, kind: AthleteTrendSnapshot['kind']): Promise<AthleteTrendSnapshot | null> {
    return this.trendSnapshots[kind] ?? null;
  }

  async listAutocoachReceipts(): Promise<readonly AthleteAutocoachReceipt[]> {
    return this.autocoachReceipts;
  }

  async getNutritionSummary(): Promise<AthleteNutritionSummary | null> {
    return this.nutritionSummary;
  }

  async getNutritionWindow(): Promise<AthleteNutritionWindow | null> {
    return this.nutritionWindow;
  }

  async hasNutritionGrant(): Promise<boolean> {
    return this.nutritionGrant;
  }

  async hasReadinessGrant(): Promise<boolean> {
    return this.readinessGrant;
  }

  async listWorkoutDrafts(): Promise<readonly AthleteWorkoutDraft[]> {
    return this.workoutDrafts;
  }

  async saveWorkoutDraft(clientId: string, workoutId: string, kind: TrainingDomain, body: unknown, baseVersion: number | null): Promise<AthleteWorkoutDraft> {
    this.savedDrafts.push({ clientId, workoutId, kind, body, baseVersion });
    const draft: AthleteWorkoutDraft = {
      workoutId,
      kind,
      body: body as AthleteWorkoutDraft['body'],
      baseVersion: (baseVersion ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.workoutDrafts = [...this.workoutDrafts.filter((d) => d.workoutId !== workoutId), draft];
    return draft;
  }

  async publishWorkoutDraft(clientId: string, workoutId: string, baseVersion: number, preferredStartDate: string, preferredWeekdays: number[]): Promise<void> {
    this.publishedDrafts.push({ clientId, workoutId, baseVersion, preferredStartDate, preferredWeekdays });
  }

  async getAthleteWeekSummary(): Promise<AthleteWeekSummary | null> {
    return this.weekSummary;
  }

  /* Invites. Defaults are the state a brand-new coach is really in — no
     organisation and no codes — because that is the shape the settings screen
     has to render honestly before it renders anything interesting. */
  organizations: readonly CoachOrganization[] = [];
  invites: readonly CoachInvite[] = [];
  createInviteError: string | null = null;
  mintedFor: string[] = [];
  revokedInvites: string[] = [];

  async listCoachOrganizations(): Promise<readonly CoachOrganization[]> {
    return this.organizations;
  }

  async listCoachInvites(): Promise<readonly CoachInvite[]> {
    return this.invites;
  }

  async createCoachInvite(organizationId: string): Promise<CoachInvite> {
    if (this.createInviteError) throw new Error(this.createInviteError);
    this.mintedFor.push(organizationId);
    const invite: CoachInvite = {
      id: `invite-${this.mintedFor.length}`,
      organizationId,
      code: 'A'.repeat(32),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      acceptedAt: null,
      status: 'open',
    };
    this.invites = [invite, ...this.invites];
    return invite;
  }

  async revokeCoachInvite(inviteId: string): Promise<CoachInvite> {
    this.revokedInvites.push(inviteId);
    const found = this.invites.find((invite) => invite.id === inviteId);
    if (!found) throw new Error('no such invite');
    const revoked: CoachInvite = { ...found, status: 'revoked' };
    this.invites = this.invites.map((invite) => (invite.id === inviteId ? revoked : invite));
    return revoked;
  }
}

/** An `open` invite fixture — the only status the settings screen offers an
 *  action on, and therefore the one every test needs a maker for. */
export function openInvite(over: Partial<CoachInvite> = {}): CoachInvite {
  return {
    id: 'invite-1',
    organizationId: 'org-1',
    code: '0123456789ABCDEF0123456789ABCDEF',
    createdAt: '2026-08-13T00:00:00.000Z',
    /* Three and a half days, not three: the screen FLOORS the remaining days,
       so a boundary-exact fixture reads as 2 or 3 depending on how many
       milliseconds the render took. Half a day of slack removes the flake
       without hiding the flooring. */
    expiresAt: new Date(Date.now() + 3.5 * 86_400_000).toISOString(),
    acceptedAt: null,
    status: 'open',
    ...over,
  };
}

/** Mounts `ui` inside a real `CoachWorkspaceProvider` — no mocked hooks, no
 *  `renderToStaticMarkup` workaround. `repository` defaults to an empty
 *  `FakeCoachWorkspaceRepository`; pass a configured instance to control
 *  what the screen sees. */
export function renderCoachScreen(ui: ReactElement, opts: { repository?: CoachWorkspaceRepository } = {}) {
  const repository = opts.repository ?? new FakeCoachWorkspaceRepository();
  return render(<CoachWorkspaceProvider repository={repository}>{ui}</CoachWorkspaceProvider>);
}
