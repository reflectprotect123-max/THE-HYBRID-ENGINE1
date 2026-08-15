import type { ClientSummary, CoachWorkspaceSettings, ProgramTemplate } from '../data/contracts';

export const COACH_CLIENT_FIXTURES: readonly ClientSummary[] = [
  {
    id: 'engine-local', name: 'Alex Morgan', initials: 'AM', source: 'engine-local',
    assignment: { programName: 'Hybrid foundation', currentWeek: 4, totalWeeks: 8, status: 'active' },
    completion: { strength: { completed: 3, planned: 3 }, conditioning: { completed: 2, planned: 3 }, nutritionDays: 5, checkInDays: 6 },
    conditioningMinutes: { easy: 82, moderate: 24, hard: 12 },
    attention: { level: 'reconcile', label: 'One conditioning session needs reconciliation' },
  },
  {
    id: 'fixture-jordan', name: 'Jordan Lee', initials: 'JL', source: 'synthetic-fixture',
    assignment: { programName: 'Return to training', currentWeek: 2, totalWeeks: 6, status: 'active' },
    completion: { strength: { completed: 2, planned: 2 }, conditioning: { completed: 2, planned: 2 }, nutritionDays: 7, checkInDays: 7 },
    conditioningMinutes: { easy: 64, moderate: 12, hard: 0 }, attention: null,
  },
  {
    id: 'fixture-maya', name: 'Maya Chen', initials: 'MC', source: 'synthetic-fixture',
    assignment: { programName: 'Strength development', currentWeek: 7, totalWeeks: 8, status: 'review-required' },
    completion: { strength: { completed: 3, planned: 4 }, conditioning: { completed: 2, planned: 2 }, nutritionDays: 4, checkInDays: 5 },
    conditioningMinutes: { easy: 54, moderate: 31, hard: 16 },
    attention: { level: 'decision', label: 'Progression proposal awaits approval' },
  },
  {
    id: 'fixture-samira', name: 'Samira Khan', initials: 'SK', source: 'synthetic-fixture',
    assignment: { programName: 'Aerobic base', currentWeek: 3, totalWeeks: 10, status: 'active' },
    completion: { strength: { completed: 2, planned: 2 }, conditioning: { completed: 3, planned: 3 }, nutritionDays: 6, checkInDays: 7 },
    conditioningMinutes: { easy: 118, moderate: 18, hard: 8 }, attention: null,
  },
];

export const PROGRAM_TEMPLATE_FIXTURES: readonly ProgramTemplate[] = [
  { id: 'strength-foundation-2', domain: 'strength', name: 'Foundation · Full Body', category: 'Full body', level: 'beginner', sessionsPerWeek: 2, weeks: 6, summary: 'Two repeatable exposures with generous recovery and protected movement patterns.', progression: { kind: 'strength', stages: ['Technique', 'Repeatable volume', 'Small load proposal'], increaseAuthority: 'coach-approval-only' }, sessions: [], status: 'published', source: 'coach-template' },
  { id: 'strength-build-3', domain: 'strength', name: 'Build · Full Body', category: 'Full body', level: 'developing', sessionsPerWeek: 3, weeks: 8, summary: 'Three balanced sessions with protected primary patterns.', progression: { kind: 'strength', stages: ['Volume base', 'Rep quality', 'Coach-approved load'], increaseAuthority: 'coach-approval-only' }, sessions: [], status: 'published', source: 'coach-template' },
  { id: 'strength-upper-lower-4', domain: 'strength', name: 'Upper / Lower Development', category: 'Upper / lower', level: 'experienced', sessionsPerWeek: 4, weeks: 8, summary: 'Higher-frequency upper and lower exposures with explicit fatigue boundaries.', progression: { kind: 'strength', stages: ['Accumulation', 'Intensification', 'Review'], increaseAuthority: 'coach-approval-only' }, sessions: [], status: 'draft', source: 'coach-template' },
  { id: 'conditioning-run-steady-2', domain: 'conditioning', name: 'Run · Steady Foundation', category: 'Run · steady', level: 'beginner', sessionsPerWeek: 2, weeks: 6, summary: 'The engine steady progression starts at 20 minutes and adds time only after accepted work.', progression: { kind: 'conditioning', format: 'steady', modality: 'run', stages: ['20-minute easy base', '+2-minute accepted steps', '40-minute ceiling'], increaseAuthority: 'coach-approval-only' }, sessions: [], status: 'published', source: 'engine-derived' },
  { id: 'conditioning-mixed-3', domain: 'conditioning', name: 'Mixed Engine Development', category: 'Mixed modality', level: 'developing', sessionsPerWeek: 3, weeks: 8, summary: 'Easy volume plus controlled intervals, using the engine overload rotation.', progression: { kind: 'conditioning', format: 'intervals', modality: 'mixed', stages: ['Add one round', 'Add five seconds work', 'Remove five seconds rest'], increaseAuthority: 'coach-approval-only' }, sessions: [], status: 'published', source: 'engine-derived' },
  { id: 'conditioning-bike-tempo-3', domain: 'conditioning', name: 'Bike · Tempo Build', category: 'Bike · tempo', level: 'experienced', sessionsPerWeek: 3, weeks: 10, summary: 'Modality-specific aerobic durability with bounded tempo progression.', progression: { kind: 'conditioning', format: 'tempo', modality: 'bike', stages: ['Establish repeatability', 'Rotate one overload lever', 'Review accumulated response'], increaseAuthority: 'coach-approval-only' }, sessions: [], status: 'published', source: 'engine-derived' },
];

export const DEFAULT_COACH_SETTINGS: CoachWorkspaceSettings = {
  weekStartsOn: 'monday', defaultLoadUnit: 'kg', priorityNotifications: true,
  visibleLibraries: { strength: true, conditioning: true, beginnerFoundations: true },
};

