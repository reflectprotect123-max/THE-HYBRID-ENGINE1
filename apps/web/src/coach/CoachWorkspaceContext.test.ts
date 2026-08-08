import { describe, expect, it } from 'vitest';
import { resolveAthleteWeek } from './CoachWorkspaceContext';
import type { AthleteWeekProjection, CoachWorkspaceRepository } from './contracts';

/*
 * The seam layer 3 turns on.
 *
 * Every case here is one where collapsing two states would show a coach the
 * wrong thing: "this athlete has no training" is a different sentence from "you
 * are not allowed to see it" and from "the request failed", and a blank panel
 * says all three at once. `data` staying null in the last two is what stops a
 * screen passing an empty week to buildWeekReview and calling it a week.
 */

const WEEK: AthleteWeekProjection = {
  weeklyPlan: {
    schemaVersion: 1, id: 'p', weekStart: '2026-08-10', generatedAt: 0,
    writer: 'coordinator', entries: [], decisions: [],
  },
  sessions: [],
  nutrition: { loggedDays: 5, windowDays: 7 },
};

const repo = (getAthleteWeek?: CoachWorkspaceRepository['getAthleteWeek']) => ({ getAthleteWeek });

describe('resolveAthleteWeek', () => {
  it('reports `local` and fetches nothing for the signed-in athlete', async () => {
    // Their week already comes from the local stores the screen reads; a second
    // copy here would be two sources of truth for one athlete.
    let called = false;
    const got = await resolveAthleteWeek(
      repo(async () => { called = true; return WEEK; }), 'engine-local', 'engine-local', '2026-08-10');
    expect(got.reason).toBe('local');
    expect(called).toBe(false);
  });

  it('reports `not-readable` when the repository cannot serve a week at all', async () => {
    // The mock, or an older build. A fact about the client, not a failure.
    const got = await resolveAthleteWeek(repo(undefined), 'c1', 'roster-summary', '2026-08-10');
    expect(got).toEqual({ data: null, loading: false, reason: 'not-readable' });
  });

  it('returns the week when the server serves it', async () => {
    const got = await resolveAthleteWeek(repo(async () => WEEK), 'c1', 'roster-summary', '2026-08-10');
    expect(got.reason).toBe('ok');
    expect(got.data).toBe(WEEK);
  });

  it('reports `not-readable`, not `ok`, for an authorised call that returned nothing', async () => {
    const got = await resolveAthleteWeek(repo(async () => null), 'c1', 'roster-summary', '2026-08-10');
    expect(got).toEqual({ data: null, loading: false, reason: 'not-readable' });
  });

  it('distinguishes DENIED from failed, because they are different sentences', async () => {
    const got = await resolveAthleteWeek(
      repo(async () => { throw new Error('not permitted'); }), 'c1', 'roster-summary', '2026-08-10');
    expect(got.reason).toBe('denied');
    expect(got.data).toBeNull();
  });

  it('reports `failed` for a network error rather than "no training"', async () => {
    const got = await resolveAthleteWeek(
      repo(async () => { throw new Error('Failed to fetch'); }), 'c1', 'roster-summary', '2026-08-10');
    expect(got.reason).toBe('failed');
    expect(got.data).toBeNull();
  });

  it('passes the requested week through unchanged', async () => {
    // A silently substituted week would show last week's counts under this
    // week's heading, which reads as an athlete who stopped training.
    let seen = '';
    await resolveAthleteWeek(
      repo(async (_id, w) => { seen = w; return WEEK; }), 'c1', 'roster-summary', '2026-08-17');
    expect(seen).toBe('2026-08-17');
  });
});
