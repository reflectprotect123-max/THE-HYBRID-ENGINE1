import type { CoachWorkspaceRepository, CoachWorkspaceSettings, ProgramAssignmentDraft } from './contracts';
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

