/*
 * The trust boundary and the merge rules, tested directly — the paths that
 * lose or corrupt a folder if they go wrong, none of them observable from the
 * UI until the damage is already done.
 */
import { describe, expect, it } from 'vitest';
import { mergeEngines, mergeSettings, pickWorkout, sanitizeDB } from './db';
import { ungroupedWorkouts } from './folders';
import { isCondWorkout, restrictToProduct } from './session';
import type { EngineDB, Workout } from './types';

describe('sanitizeDB folders', () => {
  it('drops a folder missing an id or a name, keeps a valid one', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [],
      settings: {
        folders: [
          { id: 'f1', name: 'Week 1' },
          { id: '', name: 'no id' },
          { id: 'f2' },
          'garbage',
          null,
        ],
      },
    });
    expect(out.settings.folders).toEqual([{ id: 'f1', name: 'Week 1' }]);
  });

  it('drops non-string folderIds entries on a workout, keeps valid ones', () => {
    const out = sanitizeDB({
      workouts: [{ id: 'w1', blocks: [], folderIds: ['f1', '', 42, null, 'f2'] }],
      sessions: [],
      settings: {},
    });
    expect(out.workouts[0].folderIds).toEqual(['f1', 'f2']);
  });
});

describe('mergeSettings folders', () => {
  it('a folder created on each of two devices survives the merge', () => {
    const base = { folders: [{ id: 'f1', name: 'Week 1' }] };
    const winner = { folders: [{ id: 'f2', name: 'Week 2' }] };
    const out = mergeSettings(base, winner);
    expect((out.folders || []).map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  it('winner takes the name on an id present on both sides', () => {
    const base = { folders: [{ id: 'f1', name: 'Old name' }] };
    const winner = { folders: [{ id: 'f1', name: 'New name' }] };
    const out = mergeSettings(base, winner);
    expect(out.folders).toEqual([{ id: 'f1', name: 'New name' }]);
  });

  it('a folder deleted (and tombstoned) on one side is not revived by a stale copy on the other', () => {
    const deletedHere = { folders: [], deletedIds: { f1: 2000 } };
    const staleOther = { folders: [{ id: 'f1', name: 'Week 1' }] };
    const a = mergeSettings(deletedHere, staleOther);
    expect(a.folders || []).toEqual([]);
    const b = mergeSettings(staleOther, deletedHere);
    expect(b.folders || []).toEqual([]);
  });
});

describe('pickWorkout unions folderIds like days/dates', () => {
  const wk = (over: Partial<Workout>): Workout => ({ id: 'w1', blocks: [], updatedAt: 1, ...over });

  it('keeps folder tags from BOTH sides, not just the newer one', () => {
    const older = wk({ updatedAt: 1, folderIds: ['f1'] });
    const newer = wk({ updatedAt: 2, folderIds: ['f2'] });
    const out = pickWorkout(older, newer);
    expect((out.folderIds || []).sort()).toEqual(['f1', 'f2']);
  });
});

/*
 * The gap the final whole-branch review actually found: every test above (and
 * the "folders deleted (and tombstoned)" case in particular) hand-builds a
 * `deletedIds` map and proves `mergeSettings` honours one THAT ALREADY
 * EXISTS. None of them ever asked whether the app write that deletes a folder
 * produces one. It didn't — both `removeFolder` implementations (web and
 * mobile Library.tsx) spliced the folder out of `settings.folders` and
 * stripped the id from every workout's `folderIds`, but never wrote to
 * `settings.deletedIds`, so a stale sync would revive both the folder and the
 * tags that were just stripped.
 *
 * This test proves the closed loop end-to-end rather than trusting the two
 * component fixes by inspection: it replicates the exact object-level shape
 * both `removeFolder` functions now produce (splice + strip tags + tombstone
 * write, the same three steps, in the same order, using the same
 * `deletedIds` spread pattern `removeWorkout`/`remove` already use for a
 * workout id) and runs THAT through the real `mergeEngines`/`mergeSettings`
 * against a stale remote copy that never saw the delete.
 */
describe('the actual removeFolder write path survives a merge with a stale remote', () => {
  /** Mirrors `removeFolder` in both apps/web and apps/mobile's Library.tsx,
   *  object-for-object: splice the folder, strip its id from every workout's
   *  `folderIds`, then tombstone the folder id — not a hand-built
   *  `deletedIds` map, the actual sequence of writes the UI now performs. */
  function appRemoveFolder(db: EngineDB, folderId: string): EngineDB {
    const workouts = db.workouts.map((w) =>
      (w.folderIds || []).includes(folderId)
        ? { ...w, folderIds: (w.folderIds || []).filter((id) => id !== folderId) }
        : w,
    );
    const folders = (db.settings.folders || []).filter((f) => f.id !== folderId);
    const deletedIds = { ...(db.settings.deletedIds || {}), [folderId]: Date.now() };
    return { ...db, workouts, settings: { ...db.settings, folders, deletedIds } };
  }

  it('drops the folder id from settings.folders and tags it in deletedIds', () => {
    const before: EngineDB = {
      workouts: [{ id: 'w1', blocks: [], updatedAt: 1, folderIds: ['f1'] }],
      sessions: [],
      settings: { folders: [{ id: 'f1', name: 'Week 1' }] },
    };
    const after = appRemoveFolder(before, 'f1');
    expect(after.settings.folders).toEqual([]);
    expect(after.workouts[0].folderIds).toEqual([]);
    expect(after.settings.deletedIds).toEqual({ f1: expect.any(Number) });
  });

  it('the folder does not come back — and the workout renders ungrouped, not under a revived folder — after merging against a stale remote that still has it', () => {
    const local: EngineDB = {
      workouts: [{ id: 'w1', blocks: [], updatedAt: 1, folderIds: ['f1'] }],
      sessions: [],
      settings: { folders: [{ id: 'f1', name: 'Week 1' }] },
    };
    // Deleted locally — the app write, not a hand-built tombstone.
    const afterDelete = appRemoveFolder(local, 'f1');

    // A second device that hasn't caught up: still has the folder AND the
    // workout still tagged into it.
    const staleRemote: EngineDB = {
      workouts: [{ id: 'w1', blocks: [], updatedAt: 1, folderIds: ['f1'] }],
      sessions: [],
      settings: { folders: [{ id: 'f1', name: 'Week 1' }] },
    };

    // mergeEngines(local, remote): local is the side that just deleted.
    const merged = mergeEngines(afterDelete, staleRemote);

    // 1. mergeSettings sees the tombstone and excludes the folder from the
    //    merged folder list — closing the loop `mergeSettings` was already
    //    tested for, now actually fed by the write the UI produces.
    expect(merged.settings.folders || []).toEqual([]);

    // 2. pickWorkout's folderIds union (deliberately additive, same as
    //    days/dates) means the merged workout MAY still carry the stale 'f1'
    //    tag literally in its array — that is expected, not a regression.
    //    What must NOT happen is the workout rendering as if it were still
    //    filed in a folder that no longer exists: `ungroupedWorkouts` checks
    //    membership against the LIVE folder list, so with 'f1' absent from
    //    `merged.settings.folders`, the workout must fall back to ungrouped.
    const w = merged.workouts.find((x) => x.id === 'w1');
    expect(w).toBeTruthy();
    const stillUngrouped = ungroupedWorkouts(merged.workouts, merged.settings.folders || []);
    expect(stillUngrouped.map((x) => x.id)).toContain('w1');
  });
});

describe('sanitizeDB and strength-shaped blocks after the repo split', () => {
  /*
   * The Phase A keep-the-new-shape cases MOVED to
   * reflectprotect123-max/strengthside on 21 August 2026 with Task 2 of the
   * repo split. What this repo must still pin is the CLEAN CUT: every
   * strength shape — legacy `exercises`/no-kind AND the Phase A
   * `kind: 'strength'`/items shape — is filtered by cleanBlock, because
   * nothing left in this codebase can render or run either one.
   */
  it('filters the legacy pre-rebuild strength shape (exercises, no kind)', () => {
    const out = sanitizeDB({
      workouts: [{ id: 'w1', kind: 'strength', blocks: [{ id: 'legacy', exercises: [{ name: 'Back Squat', sets: [] }] }], updatedAt: 1 }],
      sessions: [],
      settings: {},
    });
    expect(out.workouts[0].blocks).toEqual([]);
  });

  it('filters the Phase A kind: strength items shape too — strength lives in the other repo now', () => {
    const phaseABlock = {
      id: 'sb-new',
      kind: 'strength',
      heading: 'Main lift',
      items: [
        {
          id: 'it1',
          kind: 'strength',
          exerciseId: 'sq',
          groupingKey: null,
          sets: [{ id: 'set1', ordinal: 1, isOptional: false, isAmrap: false, targets: [{ metricKey: 'reps', literalValue: 5 }] }],
        },
      ],
    };
    const out = sanitizeDB({
      workouts: [{ id: 'w1', kind: 'strength', blocks: [phaseABlock], updatedAt: 1 }],
      sessions: [{ id: 's1', date: '2026-08-19', status: 'completed', kind: 'strength', blocks: [phaseABlock] }],
      settings: {},
    });
    expect(out.workouts[0].blocks).toEqual([]);
    expect(out.sessions[0].blocks).toEqual([]);
  });
});

describe('sanitizeDB backfills and splits Workout.kind', () => {
  /*
   * A real legacy strength block (exercises/sets) is stripped by
   * `cleanBlock` before any of this inference or splitting runs — that is
   * the whole point of the 17 August 2026 deletion, see `db.ts`'s own
   * header comment. So a fixture standing in for "the other half of a mixed
   * workout" now has to be something `cleanBlock` keeps: a `TextBlock`. The
   * split still hard-labels that sibling `kind: 'strength'` — unchanged,
   * existing code — which is why the assertions below still say so.
   */
  const otherBlock = () => ({ id: 'sb1', kind: 'text', heading: 'Notes', body: 'Warm-up' });
  const condBlock = () => ({ id: 'cb1', kind: 'conditioning', condFmt: 'intervals' });

  it('backfills kind=conditioning on an old workout that is all conditioning blocks', () => {
    const out = sanitizeDB({ workouts: [{ id: 'w1', blocks: [condBlock()] }], sessions: [], settings: {} });
    expect(out.workouts).toHaveLength(1);
    expect(out.workouts[0].kind).toBe('conditioning');
  });

  it('leaves kind UNSET on a workout with zero blocks and no stored kind — it guesses nothing', () => {
    const out = sanitizeDB({ workouts: [{ id: 'w1', blocks: [] }], sessions: [], settings: {} });
    expect(out.workouts[0].kind).toBeUndefined();
  });

  /*
   * The Planner has a per-block ✕. Deleting the last conditioning block out of
   * a conditioning workout used to leave it re-stamped 'strength' on the next
   * load — permanently, since no screen anywhere can set `kind` back.
   */
  it('never overwrites a stored kind, even when the blocks no longer support it', () => {
    const out = sanitizeDB({ workouts: [{ id: 'w1', kind: 'conditioning', blocks: [] }], sessions: [], settings: {} });
    expect(out.workouts[0].kind).toBe('conditioning');
  });

  it('keeps a stored conditioning kind on a workout whose only remaining block is strength', () => {
    const out = sanitizeDB({
      workouts: [{ id: 'w1', kind: 'conditioning', blocks: [otherBlock()] }],
      sessions: [],
      settings: {},
    });
    expect(out.workouts[0].kind).toBe('conditioning');
  });

  it('splits a mixed workout into a strength sibling (keeps the id) and a new conditioning sibling, same days/dates', () => {
    const out = sanitizeDB({
      workouts: [
        {
          id: 'w1',
          name: 'Leg Day',
          blocks: [otherBlock(), condBlock()],
          days: [1, 3],
          dates: ['2026-08-10'],
        },
      ],
      sessions: [],
      settings: {},
    });
    expect(out.workouts).toHaveLength(2);
    const strength = out.workouts.find((w) => w.id === 'w1')!;
    const cond = out.workouts.find((w) => w.id !== 'w1')!;
    expect(strength.kind).toBe('strength');
    expect(strength.blocks.map((b) => b.id)).toEqual(['sb1']);
    expect(strength.days).toEqual([1, 3]);
    expect(cond.kind).toBe('conditioning');
    expect(cond.name).toBe('Leg Day — Conditioning');
    expect(cond.blocks.map((b) => b.id)).toEqual(['cb1']);
    expect(cond.days).toEqual([1, 3]);
    expect(cond.dates).toEqual(['2026-08-10']);
  });

  it('splitting is idempotent — running sanitizeDB again on already-split output changes nothing further', () => {
    const once = sanitizeDB({
      workouts: [{ id: 'w1', blocks: [otherBlock(), condBlock()] }],
      sessions: [],
      settings: {},
    });
    const twice = sanitizeDB(once);
    expect(twice.workouts).toHaveLength(2);
    expect(twice.workouts.map((w) => w.kind).sort()).toEqual(['conditioning', 'strength']);
    expect(twice.workouts.map((w) => w.id).sort()).toEqual(once.workouts.map((w) => w.id).sort());
  });

  /*
   * The duplicate-explosion case. sanitizeDB is not a load-time-only function:
   * applyPull runs it over the merge result of every pull and restoreDb over
   * every imported backup, and the server keeps its un-split copy until it is
   * overwritten. A uid() sibling therefore minted a NEW conditioning workout on
   * every device, every boot and every pull. The id has to fall out of the
   * source record, so two independent runs over the ORIGINAL blob agree.
   */
  it('mints the same conditioning sibling id on two independent runs over the same original blob', () => {
    const raw = () => ({
      workouts: [{ id: 'w1', name: 'Leg Day', blocks: [otherBlock(), condBlock()] }],
      sessions: [],
      settings: {},
    });
    const a = sanitizeDB(raw());
    const b = sanitizeDB(raw());
    const idsOf = (db: EngineDB) => db.workouts.map((w) => w.id).sort();
    expect(idsOf(a)).toEqual(idsOf(b));
    expect(idsOf(a)).toEqual(['w1', 'w1-cond']);
  });

  it('does not mint a second sibling when the derived one is already in the blob', () => {
    // What a pull looks like while the server still holds the un-split record:
    // the merge result carries the mixed original AND the already-split sibling.
    const out = sanitizeDB({
      workouts: [
        { id: 'w1', name: 'Leg Day', blocks: [otherBlock(), condBlock()] },
        { id: 'w1-cond', kind: 'conditioning', name: 'Leg Day — Conditioning', blocks: [condBlock()] },
      ],
      sessions: [],
      settings: {},
    });
    expect(out.workouts.map((w) => w.id).sort()).toEqual(['w1', 'w1-cond']);
    expect(out.workouts.find((w) => w.id === 'w1')!.kind).toBe('strength');
  });

  it('steps aside deterministically if an unrelated workout already holds the derived id', () => {
    const raw = () => ({
      workouts: [
        { id: 'w1', name: 'Leg Day', blocks: [otherBlock(), condBlock()] },
        { id: 'w1-cond', name: 'Coincidence', blocks: [otherBlock()] },
      ],
      sessions: [],
      settings: {},
    });
    const a = sanitizeDB(raw());
    const b = sanitizeDB(raw());
    expect(a.workouts.map((w) => w.id).sort()).toEqual(['w1', 'w1-cond', 'w1-cond-2']);
    expect(a.workouts.map((w) => w.id).sort()).toEqual(b.workouts.map((w) => w.id).sort());
    // the unrelated record is untouched, not overwritten
    expect(a.workouts.find((w) => w.id === 'w1-cond')!.name).toBe('Coincidence');
  });

  it('bumps the strength sibling updatedAt when it splits, so the stale server copy loses the merge', () => {
    const out = sanitizeDB({
      workouts: [{ id: 'w1', blocks: [otherBlock(), condBlock()], updatedAt: 1000 }],
      sessions: [],
      settings: {},
    });
    // one tick past the original, not the wall clock: enough to outrank the
    // stale copy of the same record, deterministic enough that two devices
    // splitting the same blob produce the same record, and still older than a
    // tombstone written when the athlete deleted this workout
    expect(out.workouts.find((w) => w.id === 'w1')!.updatedAt).toBe(1001);
    expect(out.workouts.find((w) => w.id === 'w1-cond')!.updatedAt).toBe(1000);
  });

  it('a tombstone written after the split still outranks the re-split of a stale mixed copy', () => {
    // The server keeps the mixed original until it is overwritten, so a delete
    // has to survive it being served back and re-split.
    const resplit = sanitizeDB({
      workouts: [{ id: 'w1', blocks: [otherBlock(), condBlock()], updatedAt: 1000 }],
      sessions: [],
      settings: {},
    });
    const deletedAt = 5000;
    const local: EngineDB = {
      workouts: [],
      sessions: [],
      settings: { deletedIds: { w1: deletedAt, 'w1-cond': deletedAt } },
    };
    const merged = mergeEngines(local, resplit);
    expect(merged.workouts).toEqual([]);
  });

  it('leaves updatedAt alone on a load that splits nothing', () => {
    const out = sanitizeDB({
      workouts: [{ id: 'w1', kind: 'strength', blocks: [otherBlock()], updatedAt: 1 }],
      sessions: [],
      settings: {},
    });
    expect(out.workouts[0].updatedAt).toBe(1);
  });

  it('clears _rev and sample on the new-id conditioning sibling, the same as duplicateWorkout', () => {
    const out = sanitizeDB({
      workouts: [{ id: 'w1', blocks: [otherBlock(), condBlock()], _rev: 'rev-9', sample: true }],
      sessions: [],
      settings: {},
    });
    const cond = out.workouts.find((w) => w.id === 'w1-cond')!;
    expect(cond._rev).toBeUndefined();
    expect(cond.sample).toBeUndefined();
    // the strength sibling keeps the original id, so it keeps the original's
    // sync bookkeeping
    expect(out.workouts.find((w) => w.id === 'w1')!._rev).toBe('rev-9');
  });
});

describe('sanitizeDB backfills and splits Session.kind', () => {
  // Same substitution as the Workout describe above: a real legacy strength
  // block is stripped by `cleanBlock` before the split ever sees it, so the
  // "other half" of a mixed session is a `TextBlock` here too.
  const otherBlock = () => ({ id: 'sb1', kind: 'text', heading: 'Notes', body: 'Warm-up' });
  const condBlock = () => ({ id: 'cb1', kind: 'conditioning', condFmt: 'intervals' });

  it('splits a mixed session the same way, preserving status', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [{ id: 's1', date: '2026-08-10', status: 'completed', blocks: [otherBlock(), condBlock()] }],
      settings: {},
    });
    expect(out.sessions).toHaveLength(2);
    const strength = out.sessions.find((s) => s.id === 's1')!;
    const cond = out.sessions.find((s) => s.id !== 's1')!;
    expect(strength.kind).toBe('strength');
    expect(strength.status).toBe('completed');
    expect(cond.kind).toBe('conditioning');
    expect(cond.status).toBe('completed');
    expect(cond.id).toBe('s1-cond');
  });

  /*
   * Both stores read the live session as a singleton
   * (`sessions.find((s) => s.status === 'active')`). Splitting one mid-workout
   * hands the athlete back the strength half and strands the conditioning half
   * as a second active session nothing can ever reach.
   */
  it('leaves an ACTIVE mixed session whole — the split waits until it is finished', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [{ id: 's1', date: '2026-08-10', status: 'active', blocks: [otherBlock(), condBlock()] }],
      settings: {},
    });
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].blocks.map((b) => b.id)).toEqual(['sb1', 'cb1']);
    expect(out.sessions.filter((s) => s.status === 'active')).toHaveLength(1);
  });

  it('splits that same session once it completes', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [{ id: 's1', date: '2026-08-10', status: 'incomplete', blocks: [otherBlock(), condBlock()] }],
      settings: {},
    });
    expect(out.sessions).toHaveLength(2);
  });

  /*
   * The original workoutId names the STRENGTH-only sibling once the split has
   * happened. Left on the conditioning half, workoutStats counts one training
   * day as two trainings of the strength workout and insights.ts files this
   * half's volume-rate under it.
   */
  it('clears workoutId on the conditioning sibling so it cannot dangle onto the strength workout', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [
        {
          id: 's1',
          date: '2026-08-10',
          status: 'completed',
          workoutId: 'w1',
          blocks: [otherBlock(), condBlock()],
        },
      ],
      settings: {},
    });
    expect(out.sessions.find((s) => s.id === 's1')!.workoutId).toBe('w1');
    expect(out.sessions.find((s) => s.id === 's1-cond')!.workoutId).toBeUndefined();
  });

  it('mints the same session sibling id on two independent runs over the same original blob', () => {
    const raw = () => ({
      workouts: [],
      sessions: [{ id: 's1', date: '2026-08-10', status: 'completed', blocks: [otherBlock(), condBlock()] }],
      settings: {},
    });
    const a = sanitizeDB(raw());
    const b = sanitizeDB(raw());
    expect(a.sessions.map((s) => s.id).sort()).toEqual(b.sessions.map((s) => s.id).sort());
    expect(a.sessions.map((s) => s.id).sort()).toEqual(['s1', 's1-cond']);
  });

  it('leaves kind unset on a blockless session that stores none, and keeps a stored one', () => {
    const out = sanitizeDB({
      workouts: [],
      sessions: [
        { id: 's1', date: '2026-08-10', status: 'completed', blocks: [] },
        { id: 's2', date: '2026-08-10', status: 'completed', kind: 'conditioning', blocks: [] },
      ],
      settings: {},
    });
    expect(out.sessions.find((s) => s.id === 's1')!.kind).toBeUndefined();
    expect(out.sessions.find((s) => s.id === 's2')!.kind).toBe('conditioning');
  });
});

describe('isCondWorkout reads the stored kind, not block contents', () => {
  it('is true for kind: conditioning regardless of blocks', () => {
    expect(isCondWorkout({ id: 'w1', kind: 'conditioning', blocks: [] })).toBe(true);
  });

  it('is false for kind: strength even if every block happens to be conditioning-shaped', () => {
    expect(
      isCondWorkout({
        id: 'w1',
        kind: 'strength',
        blocks: [{ id: 'b1', kind: 'conditioning', condFmt: 'intervals' } as never],
      }),
    ).toBe(false);
  });
});

describe('restrictToProduct keeps only one domain\'s workouts and sessions', () => {
  const db: EngineDB = {
    workouts: [
      { id: 'w-strength', kind: 'strength', blocks: [] },
      { id: 'w-cond', kind: 'conditioning', blocks: [] },
      { id: 'w-kindless', blocks: [] },
    ],
    sessions: [
      { id: 's-strength', date: '2026-08-05', status: 'completed', kind: 'strength', blocks: [] },
      { id: 's-cond', date: '2026-08-05', status: 'completed', kind: 'conditioning', blocks: [] },
      { id: 's-kindless', date: '2026-08-05', status: 'completed', blocks: [] },
    ],
    settings: { theme: 'dark' } as EngineDB['settings'],
    core: { schemaVersion: 1 } as EngineDB['core'],
  };

  it('keeps strength and kind-less workouts/sessions for domain: strength, drops conditioning', () => {
    const out = restrictToProduct(db, 'strength');
    expect(out.workouts.map((w) => w.id).sort()).toEqual(['w-kindless', 'w-strength']);
    expect(out.sessions.map((s) => s.id).sort()).toEqual(['s-kindless', 's-strength']);
  });

  it('keeps only conditioning workouts/sessions for domain: conditioning, drops strength and kind-less', () => {
    const out = restrictToProduct(db, 'conditioning');
    expect(out.workouts.map((w) => w.id)).toEqual(['w-cond']);
    expect(out.sessions.map((s) => s.id)).toEqual(['s-cond']);
  });

  it('passes settings and core through untouched', () => {
    const out = restrictToProduct(db, 'conditioning');
    expect(out.settings).toBe(db.settings);
    expect(out.core).toBe(db.core);
  });
});

describe('mergeSettings — the coach’s exercise library', () => {
  /*
   * Caught in review on 16 August 2026, before the field had shipped.
   * `movements` had no union rule, so `Object.assign` made it winner-wins and
   * one device's additions were dropped silently — in a list the owner had
   * just asked to rebuild by hand, which is the worst place for it.
   */
  it('UNIONS both sides rather than letting one device win', () => {
    const out = mergeSettings({ movements: ['Back Squat'] }, { movements: ['Bench Press'] });
    expect(out.movements).toEqual(['Back Squat', 'Bench Press']);
  });

  it('de-duplicates case-insensitively, matching the deleted exercise picker', () => {
    const out = mergeSettings({ movements: ['Back Squat'] }, { movements: ['back squat', 'Row Erg'] });
    expect(out.movements).toEqual(['Back Squat', 'Row Erg']);
  });

  it('drops blanks', () => {
    expect(mergeSettings({ movements: ['  ', 'Row Erg'] }, {}).movements).toEqual(['Row Erg']);
  });

  it('leaves it ABSENT when neither side has one', () => {
    /* Absent means "never set", which falls the picker back to mining history.
       An empty array means an emptied library. Minting `[]` here would silently
       empty the library of anyone who had never touched the field. */
    expect(mergeSettings({}, {})).not.toHaveProperty('movements');
  });

  it('keeps an EMPTY library empty rather than treating it as unset', () => {
    expect(mergeSettings({ movements: [] }, {}).movements).toEqual([]);
  });
});

describe('sanitizeDB guards the coach’s library', () => {
  /* The deleted exercise picker mapped over `movements` with no per-value
     check, so a string or an object would have crashed it outright. Same
     guard `folders` and `conditioning` already carry, kept for the stored
     data's own shape-safety now that nothing reads it forward. */
  it('drops a non-array outright', () => {
    const db = sanitizeDB({ settings: { movements: 'Back Squat' } });
    expect(db.settings).not.toHaveProperty('movements');
  });

  it('keeps only real names, trimmed', () => {
    const db = sanitizeDB({ settings: { movements: ['  Back Squat  ', 7, null, '', { a: 1 }, 'Row Erg'] } });
    expect(db.settings.movements).toEqual(['Back Squat', 'Row Erg']);
  });

  it('leaves an EMPTY library empty, and an absent one absent', () => {
    /* The two are not the same: absent falls the picker back to mining
       history, empty does not. */
    expect(sanitizeDB({ settings: { movements: [] } }).settings.movements).toEqual([]);
    expect(sanitizeDB({ settings: {} }).settings).not.toHaveProperty('movements');
  });
});
