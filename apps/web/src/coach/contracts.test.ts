import { describe, expect, it } from 'vitest';
import { validateProgramAssignmentDraft } from './contracts';
import { PROGRAM_TEMPLATE_FIXTURES } from './mock-fixtures';

describe('ARC coach handoff contracts', () => {
  it('accepts a Coordinator input draft without claiming resolved placement', () => {
    const draft = validateProgramAssignmentDraft({
      id: 'assignment:athlete:program', clientId: 'athlete', programTemplateId: 'program',
      preferredStartDate: '2026-08-10', preferredWeekdays: [1, 3], baseProgramVersion: 'program:v1',
      state: 'ready-for-coordinator', createdAt: '2026-08-08T00:00:00.000Z',
    });
    expect(draft.preferredWeekdays).toEqual([1, 3]);
    expect(draft).not.toHaveProperty('resolvedDates');
  });

  it('rejects invalid preferred weekdays at the adapter boundary', () => {
    expect(() => validateProgramAssignmentDraft({
      id: 'bad', clientId: 'athlete', programTemplateId: 'program', preferredStartDate: '2026-08-10',
      preferredWeekdays: [8], baseProgramVersion: 'program:v1', state: 'draft', createdAt: 'now',
    })).toThrow('Invalid program assignment draft');
  });

  it('keeps every progression increase behind coach approval', () => {
    expect(PROGRAM_TEMPLATE_FIXTURES.every((item) => item.progression.increaseAuthority === 'coach-approval-only')).toBe(true);
  });
});

