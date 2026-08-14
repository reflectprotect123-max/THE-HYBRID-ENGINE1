import { heldEntryId, pushHeldSessions, resetHeldReceiptsForTests, safetyCodesOf } from './arc-held-receipt';

/*
 * The property under test is not "does it call the RPC". It is: a hold that
 * happened reaches the coach exactly once, a hold that did not happen never
 * does, and nothing about the session's content travels with it.
 */

type Call = Record<string, unknown>;

function fakeClient(behaviour: 'ok' | 'error' | 'throw' = 'ok') {
  const calls: Call[] = [];
  return {
    calls,
    rpc: (_name: string, args: Call) => {
      calls.push(args);
      if (behaviour === 'throw') return Promise.reject(new Error('network'));
      return Promise.resolve({ error: behaviour === 'error' ? { message: 'refused' } : null });
    },
  };
}

const report = (over: Partial<{ workoutId: string; sessionDate: string; reasonCodes: string[] }> = {}) => ({
  workoutId: 'arc:w1',
  sessionDate: '2026-08-17',
  reasonCodes: ['pain_hold_active'],
  ...over,
});

beforeEach(() => resetHeldReceiptsForTests());

describe('safetyCodesOf', () => {
  it('keeps only the two codes a hold can be described by', () => {
    expect(safetyCodesOf(['low_readiness', 'pain_hold_active', 'physical_load_high']))
      .toEqual(['pain_hold_active']);
  });

  it('keeps both when both fired, and de-duplicates', () => {
    expect(safetyCodesOf(['illness_flag_active', 'pain_hold_active', 'pain_hold_active']).sort())
      .toEqual(['illness_flag_active', 'pain_hold_active']);
  });

  it('is empty for a stop that was not a safety one', () => {
    expect(safetyCodesOf(['low_readiness', 'recovery_debt_high'])).toEqual([]);
  });
});

describe('pushHeldSessions', () => {
  it('sends a hold with an empty operations array and no session name', async () => {
    const c = fakeClient();
    const sent = await pushHeldSessions(c as never, 'org-1', [report()]);
    expect(sent).toBe(1);
    const args = c.calls[0]!;
    expect(args.p_action).toBe('held');
    expect(args.p_operations).toEqual([]);
    expect(args.p_workout_id).toBe('arc:w1');
    expect(args.p_reason_codes).toEqual(['pain_hold_active']);
    /* The boundary: nothing name-shaped anywhere in the payload. */
    expect(JSON.stringify(args)).not.toMatch(/squat|name|title/i);
  });

  it('strips the non-safety codes rather than forwarding the whole resolution', async () => {
    const c = fakeClient();
    await pushHeldSessions(c as never, 'org-1', [report({ reasonCodes: ['pain_hold_active', 'low_readiness'] })]);
    expect(c.calls[0]!.p_reason_codes).toEqual(['pain_hold_active']);
  });

  it('does NOT send a safety_stop that names no safety flag', async () => {
    /* The bench drops these too. Both layers refusing independently is
       deliberate — neither is relying on the other to be careful. */
    const c = fakeClient();
    const sent = await pushHeldSessions(c as never, 'org-1', [report({ reasonCodes: ['low_readiness'] })]);
    expect(sent).toBe(0);
    expect(c.calls).toHaveLength(0);
  });

  it('files a hold once, however many times the screen re-renders', async () => {
    const c = fakeClient();
    await pushHeldSessions(c as never, 'org-1', [report()]);
    await pushHeldSessions(c as never, 'org-1', [report()]);
    await pushHeldSessions(c as never, 'org-1', [report()]);
    expect(c.calls).toHaveLength(1);
  });

  it('files separately per day and per session — a hold is not one fact forever', async () => {
    const c = fakeClient();
    await pushHeldSessions(c as never, 'org-1', [
      report(),
      report({ sessionDate: '2026-08-18' }),
      report({ workoutId: 'arc:w2' }),
    ]);
    expect(c.calls).toHaveLength(3);
    expect(new Set(c.calls.map((x) => x.p_client_entry_id)).size).toBe(3);
  });

  it('RETRIES after a refusal — a lost hold reads to the coach as "ignored me"', async () => {
    const bad = fakeClient('error');
    expect(await pushHeldSessions(bad as never, 'org-1', [report()])).toBe(0);
    /* Not marked, so a later attempt sends it. Marking optimistically would
       lose the hold permanently on one blip. */
    const good = fakeClient();
    expect(await pushHeldSessions(good as never, 'org-1', [report()])).toBe(1);
  });

  it('survives a thrown network error without propagating it', async () => {
    const c = fakeClient('throw');
    await expect(pushHeldSessions(c as never, 'org-1', [report()])).resolves.toBe(0);
  });

  it('does nothing at all for an athlete with no coach', async () => {
    const c = fakeClient();
    expect(await pushHeldSessions(c as never, '', [report()])).toBe(0);
    expect(c.calls).toHaveLength(0);
  });

  it('keys the entry id by day and session, stably', () => {
    expect(heldEntryId(report())).toBe('held:2026-08-17:arc:w1');
    expect(heldEntryId(report())).toBe(heldEntryId(report()));
  });
});
