import { describe, expect, test } from 'vitest';
import { matchConcept2Result, concept2ToCondResult } from '../src/concept2';
import type { Concept2Result, Session, CondBlock } from '../src/types';

function makeResult(overrides: Partial<Concept2Result> = {}): Concept2Result {
  return {
    provider: 'concept2',
    externalId: 'r1',
    providerUserId: 'u1',
    modality: 'rower',
    startedAt: '2026-07-31T12:00:00.000Z',
    durationRaw: 1200,
    distanceRaw: 5000,
    durationDisplay: '20:00.0',
    workoutType: 'JustRow',
    workout: undefined,
    ...overrides,
  };
}

function condBlock(overrides: Partial<CondBlock> = {}): CondBlock {
  return {
    id: 'b1',
    kind: 'conditioning',
    condFmt: 'steady',
    modality: 'row',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: '2026-07-31',
    status: 'completed',
    blocks: [],
    ...overrides,
  };
}

describe('matchConcept2Result', () => {
  test('returns null when the result has no startedAt', () => {
    const s = session({ startedAt: Date.parse('2026-07-31T12:05:00.000Z'), blocks: [condBlock()] });
    expect(matchConcept2Result(makeResult({ startedAt: null }), [s])).toBeNull();
  });

  test('returns null when nothing is within the time window', () => {
    const s = session({ startedAt: Date.parse('2026-07-31T18:00:00.000Z'), blocks: [condBlock()] });
    expect(matchConcept2Result(makeResult(), [s])).toBeNull();
  });

  test('matches the session whose startedAt is close in time', () => {
    const near = session({ id: 'near', startedAt: Date.parse('2026-07-31T12:10:00.000Z'), blocks: [condBlock({ id: 'nb' })] });
    const far = session({ id: 'far', startedAt: Date.parse('2026-07-31T20:00:00.000Z'), blocks: [condBlock({ id: 'fb' })] });
    const match = matchConcept2Result(makeResult(), [far, near]);
    expect(match).not.toBeNull();
    expect(match!.session.id).toBe('near');
    expect(match!.block.id).toBe('nb');
  });

  test('picks the closest of several candidates within the window', () => {
    const closer = session({ id: 'closer', startedAt: Date.parse('2026-07-31T12:05:00.000Z'), blocks: [condBlock({ id: 'cb' })] });
    const further = session({ id: 'further', startedAt: Date.parse('2026-07-31T13:30:00.000Z'), blocks: [condBlock({ id: 'fb' })] });
    const match = matchConcept2Result(makeResult(), [further, closer]);
    expect(match!.session.id).toBe('closer');
  });

  test('prefers a block-level condResult.startedAt over the session startedAt when both exist', () => {
    const s = session({
      id: 's1',
      // session started way earlier, but the conditioning block itself (its
      // condResult) began right around the Concept2 result's time — the block
      // timestamp is the more precise signal.
      startedAt: Date.parse('2026-07-31T09:00:00.000Z'),
      blocks: [condBlock({ id: 'b1', condResult: { startedAt: Date.parse('2026-07-31T12:01:00.000Z') } })],
    });
    const match = matchConcept2Result(makeResult(), [s]);
    expect(match).not.toBeNull();
    expect(match!.block.id).toBe('b1');
  });

  test('ignores non-conditioning blocks', () => {
    const s = session({
      startedAt: Date.parse('2026-07-31T12:01:00.000Z'),
      blocks: [{ id: 'strength', exercises: [] } as never],
    });
    expect(matchConcept2Result(makeResult(), [s])).toBeNull();
  });

  test('respects a custom window', () => {
    const s = session({ startedAt: Date.parse('2026-07-31T13:00:00.000Z'), blocks: [condBlock()] });
    // one hour away — outside a 30-minute window, inside the default 2-hour one
    expect(matchConcept2Result(makeResult(), [s], 30 * 60 * 1000)).toBeNull();
    expect(matchConcept2Result(makeResult(), [s])).not.toBeNull();
  });
});

describe('concept2ToCondResult', () => {
  test('maps rower to row', () => {
    expect(concept2ToCondResult(makeResult({ modality: 'rower' })).modality).toBe('row');
  });

  test('maps skierg to ski', () => {
    expect(concept2ToCondResult(makeResult({ modality: 'skierg' })).modality).toBe('ski');
  });

  test('maps bike to bike', () => {
    expect(concept2ToCondResult(makeResult({ modality: 'bike' })).modality).toBe('bike');
  });

  test('leaves modality unset for anything else rather than guessing', () => {
    expect(concept2ToCondResult(makeResult({ modality: 'paddle' })).modality).toBeUndefined();
    expect(concept2ToCondResult(makeResult({ modality: null })).modality).toBeUndefined();
  });

  test('stamps a Concept2 device with consoleMetric pace and a type-inferred model', () => {
    expect(concept2ToCondResult(makeResult({ modality: 'rower' })).device).toEqual({
      manufacturer: 'Concept2',
      model: 'RowErg',
      consoleMetric: 'pace',
    });
    expect(concept2ToCondResult(makeResult({ modality: 'skierg' })).device!.model).toBe('SkiErg');
    expect(concept2ToCondResult(makeResult({ modality: 'bike' })).device!.model).toBe('BikeErg');
  });

  test('carries the raw splits array through untouched', () => {
    const splits = [{ distance: 741, time: 3000 }];
    const out = concept2ToCondResult(makeResult({ workout: { splits } }));
    expect(out.splits).toEqual(splits);
  });

  test('omits splits when the workout has none', () => {
    const out = concept2ToCondResult(makeResult({ workout: undefined }));
    expect(out.splits).toBeUndefined();
  });

  test('converts startedAt to epoch ms and passes duration/distance through', () => {
    const out = concept2ToCondResult(makeResult({ startedAt: '2026-07-31T12:00:00.000Z', durationRaw: 1200, distanceRaw: 5000 }));
    expect(out.startedAt).toBe(Date.parse('2026-07-31T12:00:00.000Z'));
    expect(out.dur).toBe(1200);
    expect(out.distanceM).toBe(5000);
  });

  test('leaves startedAt/dur/distanceM unset when the source has none', () => {
    const out = concept2ToCondResult(makeResult({ startedAt: null, durationRaw: null, distanceRaw: null }));
    expect(out.startedAt).toBeUndefined();
    expect(out.dur).toBeUndefined();
    expect(out.distanceM).toBeUndefined();
  });
});
