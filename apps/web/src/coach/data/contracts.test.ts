import { describe, expect, it } from 'vitest';
import { coachingTargetOf, validateProgramAssignmentDraft } from './contracts';
import { PROGRAM_TEMPLATE_FIXTURES } from '../testing/mock-fixtures';

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


/*
 * Which athlete a coach COMMAND is addressed to.
 *
 * Since 14 August 2026 that question has two right answers — a roster client,
 * and the coach themselves once they are on their own roster — and exactly one
 * wrong one that looks right: `client.id`. For the folded self entry the id is
 * the literal `engine-local`, a selection key that matches no
 * `athlete_user_id`, so sending it fails every command with "not on your
 * roster" while the relationship really exists.
 */
describe('coachingTargetOf', () => {
  const base = {
    name: 'X', initials: 'X', assignment: null,
    completion: { strength: { completed: 0, planned: 0 }, conditioning: { completed: 0, planned: 0 }, nutritionDays: 0, checkInDays: 0 },
    conditioningMinutes: { easy: 0, moderate: 0, hard: 0 },
    attention: null,
  } as const;

  it('addresses a roster client by their own id', () => {
    expect(coachingTargetOf({ ...base, id: 'athlete-1', source: 'roster-summary' }))
      .toEqual({ athleteUserId: 'athlete-1' });
  });

  it('addresses a self-coached entry by the REAL user id, never the selection key', () => {
    const target = coachingTargetOf({
      ...base, id: 'engine-local', source: 'engine-local',
      selfCoaching: { organizationId: 'org-9', athleteUserId: 'user-9' },
    });
    expect(target).toEqual({ athleteUserId: 'user-9' });
  });

  it('refuses an entry with no coaching relationship behind it', () => {
    // Both of these have nothing on the server to command. A plain
    // engine-local entry is the DEFAULT — self-coaching is redeemed
    // deliberately, never assumed.
    expect(coachingTargetOf({ ...base, id: 'engine-local', source: 'engine-local' })).toBeNull();
    expect(coachingTargetOf({ ...base, id: 'fixture-jordan', source: 'synthetic-fixture' })).toBeNull();
    expect(coachingTargetOf(null)).toBeNull();
  });
});
