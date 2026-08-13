import type { CoachInvite, CoachOrganization, CoachWorkspaceRepository, CoachWorkspaceSettings, ProgramAssignmentDraft } from './contracts';
import { validateProgramAssignmentDraft } from './contracts';
import { COACH_CLIENT_FIXTURES, DEFAULT_COACH_SETTINGS, PROGRAM_TEMPLATE_FIXTURES } from './mock-fixtures';

const SETTINGS_KEY = 'hybrid-arc-settings-v1';
const ASSIGNMENTS_KEY = 'hybrid-arc-assignment-drafts-v1';

function readJson(key: string): unknown {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : null; } catch { return null; }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Demo persistence is best effort. */ }
}

export class MockCoachWorkspaceRepository implements CoachWorkspaceRepository {
  async listClients() { return structuredClone(COACH_CLIENT_FIXTURES); }
  async listProgramTemplates() { return structuredClone(PROGRAM_TEMPLATE_FIXTURES); }

  async saveAssignmentDraft(input: ProgramAssignmentDraft) {
    const draft = validateProgramAssignmentDraft(input);
    const stored = readJson(ASSIGNMENTS_KEY);
    const current = Array.isArray(stored) ? stored : [];
    writeJson(ASSIGNMENTS_KEY, [...current.filter((item) => typeof item !== 'object' || item === null || !('id' in item) || item.id !== draft.id), draft]);
    return structuredClone(draft);
  }

  /*
   * INVITES ARE NOT MOCKED, AND THAT IS THE HONEST ANSWER.
   *
   * Everything else in this class is a demo of a shape — a draft assignment in
   * localStorage stands in for one in Postgres perfectly well, because nothing
   * outside this browser has to agree with it. An invite code is different in
   * kind: it is a bearer secret that only means something if the server minted
   * it. A locally invented one would print a code a coach could send to a real
   * athlete, who would type it into a real app and be told it does not exist —
   * a fabricated credential dressed as a working one, which is exactly the
   * class of lie this repository's comments keep warning about.
   *
   * So: no organisations to invite into, no invites, and an attempt to mint
   * one says why. The bench renders that state correctly and nobody is misled.
   */
  async listCoachOrganizations(): Promise<readonly CoachOrganization[]> { return []; }
  async listCoachInvites(): Promise<readonly CoachInvite[]> { return []; }
  async createCoachInvite(): Promise<CoachInvite> {
    throw new Error('Invite codes are minted by the server. This demo repository has no connection to one.');
  }
  async revokeCoachInvite(): Promise<CoachInvite> {
    throw new Error('Invite codes are minted by the server. This demo repository has no connection to one.');
  }

  async getSettings() {
    const stored = readJson(SETTINGS_KEY);
    if (!stored || typeof stored !== 'object') return structuredClone(DEFAULT_COACH_SETTINGS);
    return { ...structuredClone(DEFAULT_COACH_SETTINGS), ...(stored as Partial<CoachWorkspaceSettings>) };
  }

  async saveSettings(settings: CoachWorkspaceSettings) {
    writeJson(SETTINGS_KEY, settings);
    return structuredClone(settings);
  }
}

export const coachWorkspaceRepository: CoachWorkspaceRepository = new MockCoachWorkspaceRepository();

