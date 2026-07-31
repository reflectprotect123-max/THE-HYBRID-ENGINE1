import { describe, expect, test } from 'vitest';
import {
  applyConcept2Import,
  concept2RecordId,
  concept2ToCondResult,
  importedConcept2Ids,
  matchConcept2Result,
  planConcept2Import,
} from '../src/concept2';
import { CON_RETENTION } from '../src/constants';
import type { Concept2Result, CondResult, EngineDB, Session, CondBlock } from '../src/types';

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

  test('does not match a conditioning block of an unrelated modality, even when it is the only candidate in the time window', () => {
    const s = session({
      startedAt: Date.parse('2026-07-31T12:01:00.000Z'),
      blocks: [condBlock({ id: 'run-block', modality: 'run' })],
    });
    // a Concept2 rower result must never be pinned onto a same-day run block
    // purely on time proximity
    expect(matchConcept2Result(makeResult({ modality: 'rower' }), [s])).toBeNull();
  });

  test('matches only the block whose modality corresponds to the Concept2 result type when several candidates are equally close', () => {
    const s = session({
      startedAt: Date.parse('2026-07-31T12:01:00.000Z'),
      blocks: [
        condBlock({ id: 'run-block', modality: 'run' }),
        condBlock({ id: 'row-block', modality: 'row' }),
        condBlock({ id: 'bike-block', modality: 'bike' }),
      ],
    });
    const match = matchConcept2Result(makeResult({ modality: 'rower' }), [s]);
    expect(match).not.toBeNull();
    expect(match!.block.id).toBe('row-block');
  });

  test('matches nothing when the Concept2 result type has no known modality mapping', () => {
    const s = session({ startedAt: Date.parse('2026-07-31T12:01:00.000Z'), blocks: [condBlock({ modality: 'row' })] });
    expect(matchConcept2Result(makeResult({ modality: 'paddle' }), [s])).toBeNull();
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

  test('converts startedAt to epoch ms, converts durationRaw from tenths-of-a-second to seconds, and carries distance as deviceDistanceM (not distanceM)', () => {
    // Concept2's own documented example: time: 152350 (tenths of a second) ==
    // time_formatted "4:13:55.0" == 15235.0 seconds. distanceRaw is already meters.
    const out = concept2ToCondResult(makeResult({ startedAt: '2026-07-31T12:00:00.000Z', durationRaw: 152350, distanceRaw: 23000 }));
    expect(out.startedAt).toBe(Date.parse('2026-07-31T12:00:00.000Z'));
    expect(out.dur).toBe(15235);
    expect(out.deviceDistanceM).toBe(23000);
  });

  test('leaves startedAt/dur/deviceDistanceM unset when the source has none', () => {
    const out = concept2ToCondResult(makeResult({ startedAt: null, durationRaw: null, distanceRaw: null }));
    expect(out.startedAt).toBeUndefined();
    expect(out.dur).toBeUndefined();
    expect(out.deviceDistanceM).toBeUndefined();
  });

  // I2: distanceM is documented as GPS-only ("absent means not GPS-tracked")
  // and is summed into Progress's distance trend — an erg result is not a
  // GPS-tracked distance, so it must never land there, regardless of what
  // distanceRaw carries (Task 8 made the identical call for FTMS distance).
  test('never sets distanceM, no matter what distanceRaw carries', () => {
    expect(concept2ToCondResult(makeResult({ distanceRaw: 23000 })).distanceM).toBeUndefined();
    expect(concept2ToCondResult(makeResult({ distanceRaw: 0 })).distanceM).toBeUndefined();
    expect(concept2ToCondResult(makeResult({ distanceRaw: null })).distanceM).toBeUndefined();
  });
});

function makeDb(overrides: Partial<EngineDB> = {}): EngineDB {
  return { workouts: [], sessions: [], settings: {}, ...overrides };
}

describe('importedConcept2Ids', () => {
  test('collects externalIds from both the standalone history and session blocks', () => {
    const db = makeDb({
      sessions: [session({ blocks: [condBlock({ condResult: { externalId: 'from-block' } })] })],
      settings: { conditioning: [{ id: 'c2-x', externalId: 'from-history' }] },
    });
    const ids = importedConcept2Ids(db);
    expect(ids.has('from-block')).toBe(true);
    expect(ids.has('from-history')).toBe(true);
    expect(ids.size).toBe(2);
  });

  test('is empty on a fresh database, including one whose conditioning is not an array', () => {
    expect(importedConcept2Ids(makeDb()).size).toBe(0);
    expect(importedConcept2Ids(makeDb({ settings: { conditioning: 'junk' as never } })).size).toBe(0);
  });
});

describe('planConcept2Import', () => {
  test('attaches to a matched, unlogged conditioning block, carrying the block prescription as fmt', () => {
    const db = makeDb({
      sessions: [session({ startedAt: Date.parse('2026-07-31T12:05:00.000Z'), blocks: [condBlock({ condFmt: 'intervals' })] })],
    });
    const plan = planConcept2Import([makeResult()], db);
    expect(plan.standalone).toHaveLength(0);
    expect(plan.skipped).toBe(0);
    expect(plan.merges).toEqual([
      expect.objectContaining({ sessionId: 's1', blockId: 'b1', mode: 'attach' }),
    ]);
    expect(plan.merges[0].patch.fmt).toBe('intervals');
    expect(plan.merges[0].patch.externalId).toBe('r1');
    expect(plan.merges[0].patch.id).toBe(concept2RecordId('r1'));
    expect(plan.merges[0].patch.dur).toBe(120);
  });

  test('enriches an already-logged block with erg-only fields, never nominating overwrites', () => {
    const logged: CondResult = { dur: 1300, felt: '7', startedAt: Date.parse('2026-07-31T12:02:00.000Z') };
    const db = makeDb({ sessions: [session({ blocks: [condBlock({ condResult: logged })] })] });
    const plan = planConcept2Import([makeResult({ workout: { splits: [{ time: 3000 }] } })], db);
    expect(plan.merges).toHaveLength(1);
    const m = plan.merges[0];
    expect(m.mode).toBe('enrich');
    // only what the erg alone knows — dur/felt/startedAt stay the athlete's
    expect(Object.keys(m.patch).sort()).toEqual(['device', 'deviceDistanceM', 'externalId', 'splits']);
  });

  test('an enrich patch adds nothing the logged result already has', () => {
    const logged: CondResult = {
      startedAt: Date.parse('2026-07-31T12:02:00.000Z'),
      splits: [{ mine: true }],
      deviceDistanceM: 4990,
      device: { manufacturer: 'Rogue' },
    };
    const db = makeDb({ sessions: [session({ blocks: [condBlock({ condResult: logged })] })] });
    const plan = planConcept2Import([makeResult()], db);
    expect(plan.merges[0].mode).toBe('enrich');
    expect(Object.keys(plan.merges[0].patch)).toEqual(['externalId']);
  });

  test('files an unmatched result into the standalone history as a free-format record', () => {
    const plan = planConcept2Import([makeResult()], makeDb());
    expect(plan.merges).toHaveLength(0);
    expect(plan.standalone).toHaveLength(1);
    const rec = plan.standalone[0];
    expect(rec.id).toBe(concept2RecordId('r1'));
    expect(rec.externalId).toBe('r1');
    expect(rec.fmt).toBe('free');
    expect(rec.modality).toBe('row');
  });

  test('skips results already imported, with no externalId, no usable start time, or an unmapped machine type', () => {
    const db = makeDb({ settings: { conditioning: [{ id: 'c2-old', externalId: 'old' }] } });
    const plan = planConcept2Import(
      [
        makeResult({ externalId: 'old' }),
        makeResult({ externalId: null }),
        makeResult({ externalId: 'no-time', startedAt: null }),
        makeResult({ externalId: 'paddle', modality: 'paddle' }),
      ],
      db,
    );
    expect(plan.merges).toHaveLength(0);
    expect(plan.standalone).toHaveLength(0);
    expect(plan.skipped).toBe(4);
  });

  test('the same externalId repeated within one batch imports once', () => {
    const plan = planConcept2Import([makeResult(), makeResult()], makeDb());
    expect(plan.standalone).toHaveLength(1);
    expect(plan.skipped).toBe(1);
  });

  test('a block absorbs at most one result — the second nearby result falls through to standalone', () => {
    const db = makeDb({
      sessions: [session({ startedAt: Date.parse('2026-07-31T12:00:00.000Z'), blocks: [condBlock()] })],
    });
    const plan = planConcept2Import(
      [makeResult({ externalId: 'first' }), makeResult({ externalId: 'second', startedAt: '2026-07-31T12:30:00.000Z' })],
      db,
    );
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].patch.externalId).toBe('first');
    expect(plan.standalone).toHaveLength(1);
    expect(plan.standalone[0].externalId).toBe('second');
  });

  test('a block whose logged result already carries an externalId is not enriched again', () => {
    const db = makeDb({
      sessions: [
        session({ blocks: [condBlock({ condResult: { startedAt: Date.parse('2026-07-31T12:02:00.000Z'), externalId: 'earlier' } })] }),
      ],
    });
    const plan = planConcept2Import([makeResult({ externalId: 'later' })], db);
    expect(plan.merges).toHaveLength(0);
    expect(plan.standalone).toHaveLength(1);
  });
});

describe('applyConcept2Import', () => {
  const NOW = Date.parse('2026-07-31T15:00:00.000Z');

  test('lands an attach on the block, stamps the session, and reports counts', () => {
    const db = makeDb({
      sessions: [session({ startedAt: Date.parse('2026-07-31T12:05:00.000Z'), blocks: [condBlock()] })],
    });
    const counts = applyConcept2Import(db, planConcept2Import([makeResult()], db), NOW);
    expect(counts).toEqual({ attached: 1, enriched: 0, standalone: 0 });
    const block = db.sessions[0].blocks[0] as CondBlock;
    expect(block.condResult?.externalId).toBe('r1');
    expect(block.condResult?.dur).toBe(120);
    expect(db.sessions[0].updatedAt).toBe(NOW);
    // block-attached results do not also duplicate into the standalone history
    expect(db.settings.conditioning).toBeUndefined();
    expect(db.settings.updatedAt).toBeUndefined();
  });

  test('lands an enrich without touching what the athlete recorded', () => {
    const logged: CondResult = { dur: 1300, felt: '7', startedAt: Date.parse('2026-07-31T12:02:00.000Z') };
    const db = makeDb({ sessions: [session({ blocks: [condBlock({ condResult: logged })] })] });
    const counts = applyConcept2Import(db, planConcept2Import([makeResult({ workout: { splits: [1] } })], db), NOW);
    expect(counts).toEqual({ attached: 0, enriched: 1, standalone: 0 });
    const rec = (db.sessions[0].blocks[0] as CondBlock).condResult!;
    expect(rec.dur).toBe(1300);
    expect(rec.felt).toBe('7');
    expect(rec.externalId).toBe('r1');
    expect(rec.splits).toEqual([1]);
  });

  test('files standalone records through the retained history (sorted, trimmed) and stamps settings', () => {
    const old: CondResult[] = Array.from({ length: CON_RETENTION }, (_, i) => ({
      id: 'run-' + i,
      startedAt: Date.parse('2026-01-01T00:00:00.000Z') + i * 60_000,
    }));
    const db = makeDb({ settings: { conditioning: old } });
    const counts = applyConcept2Import(db, planConcept2Import([makeResult()], db), NOW);
    expect(counts).toEqual({ attached: 0, enriched: 0, standalone: 1 });
    const list = db.settings.conditioning!;
    expect(list).toHaveLength(CON_RETENTION);
    expect(list[list.length - 1].externalId).toBe('r1');
    expect(list[0].id).toBe('run-1'); // oldest trimmed first
    expect(db.settings.updatedAt).toBe(NOW);
  });

  test('a stale attach degrades to a skip when the block gained a result since planning', () => {
    const db = makeDb({
      sessions: [session({ startedAt: Date.parse('2026-07-31T12:05:00.000Z'), blocks: [condBlock()] })],
    });
    const plan = planConcept2Import([makeResult()], db);
    (db.sessions[0].blocks[0] as CondBlock).condResult = { felt: '6' };
    const counts = applyConcept2Import(db, plan, NOW);
    expect(counts).toEqual({ attached: 0, enriched: 0, standalone: 0 });
    expect((db.sessions[0].blocks[0] as CondBlock).condResult).toEqual({ felt: '6' });
    expect(db.sessions[0].updatedAt).toBeUndefined();
  });

  test('re-planning after an apply finds nothing left to import — the dedupe loop closes', () => {
    const db = makeDb({
      sessions: [session({ startedAt: Date.parse('2026-07-31T12:05:00.000Z'), blocks: [condBlock()] })],
    });
    const results = [makeResult(), makeResult({ externalId: 'r2', startedAt: '2026-07-30T12:00:00.000Z' })];
    applyConcept2Import(db, planConcept2Import(results, db), NOW);
    const again = planConcept2Import(results, db);
    expect(again.merges).toHaveLength(0);
    expect(again.standalone).toHaveLength(0);
    expect(again.skipped).toBe(2);
  });

  test('two devices importing the same unmatched result produce the same record id, so the cloud merge collapses them', () => {
    const a = makeDb();
    const b = makeDb();
    applyConcept2Import(a, planConcept2Import([makeResult()], a), NOW);
    applyConcept2Import(b, planConcept2Import([makeResult()], b), NOW);
    expect(a.settings.conditioning![0].id).toBe(b.settings.conditioning![0].id);
  });
});
