# Library Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete group workouts in Library's Sessions tab into user-named, collapsible folders — a workout can belong to several folders, folder deletion never deletes a workout, and folders sync correctly across devices.

**Architecture:** A new `Folder` type (`{id, name}`) lives in `Settings.folders`; each `Workout` gains an optional `folderIds?: string[]`. Two small pure helpers in a new `packages/engine/src/folders.ts` compute "workouts in folder X" and "workouts in no CURRENTLY VALID folder" — the second guards against a stale `folderId` (left over from a deleted folder, revived by a sync race) silently stranding a workout invisible in neither the folder view nor the flat list. Web assigns a workout to a folder via native HTML5 drag-and-drop; mobile assigns via a "Folders" checklist picker (no drag-and-drop on touch, per design). Both platforms get folder create/rename/delete with the same collapsed-by-default rendering.

**Tech Stack:** TypeScript, React (web) + React Native (mobile), Vitest (engine unit tests), Playwright (`checks/react-smoke.mjs`), Jest + RNTL (mobile component tests). No new dependencies — web drag-and-drop uses the native HTML5 DnD API already built into the browser; mobile's picker uses React Native's built-in `Modal`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-library-folders-design.md` — read it before starting; every task below implements one section of it.
- A workout can belong to **zero, one, or several** folders (`folderIds?: string[]`, not a single id).
- Deleting a folder **never** deletes a workout — it only strips that folder's id from every workout's `folderIds`.
- Folders render **collapsed by default**. Ungrouped workouts (no valid `folderIds`) list flat below all folders, exactly as the whole list renders today.
- Web: drag-and-drop only, no picker fallback (explicit user call). Mobile: picker only, no drag-and-drop (explicit user call — touch drag-and-drop in a scrolling list is unreliable and this app has no precedent for it).
- `folders` and `folderIds` merge as **unions**, not last-write-wins — see the Data Model section of the spec and Task 1 below. This mirrors the existing `mobility` (Settings-level) and `days`/`dates` (Workout-level) union rules already in `packages/engine/src/db.ts`.
- Every task ends with its own tests passing before commit. Do not move to the next task with a red test.
- Run `pnpm run typecheck` and the relevant `pnpm --filter <pkg> test` after every task, not just at the end.

---

### Task 1: Engine — Folder type, merge rules, and grouping helpers

**Files:**
- Modify: `packages/engine/src/types.ts` (add `Folder` interface, `Settings.folders`, `Workout.folderIds`)
- Modify: `packages/engine/src/db.ts` (`sanitizeDB`, `mergeSettings`, `pickWorkout`)
- Create: `packages/engine/src/folders.ts` (`workoutsInFolder`, `ungroupedWorkouts`)
- Modify: `packages/engine/src/index.ts` (barrel export for the new file)
- Create: `packages/engine/test/db.test.ts`
- Create: `packages/engine/test/folders.test.ts`

**Interfaces:**
- Consumes: `uid()`, `uniqArr()` from `./num` (already imported in `db.ts`); `Workout`, `Settings` from `./types`.
- Produces: `Folder` type (`{id: string; name: string}`), `Settings.folders?: Folder[]`, `Workout.folderIds?: string[]`, `workoutsInFolder(workouts: Workout[], folderId: string): Workout[]`, `ungroupedWorkouts(workouts: Workout[], folders: Folder[]): Workout[]` — all consumed by Tasks 2–5's Library screens.

- [ ] **Step 1: Add the `Folder` type and the two new fields**

Modify `packages/engine/src/types.ts:154-165` (the `Workout` interface) — add `folderIds` after `dates`:

```ts
export interface Workout<S extends AnySet = LoggedSet> {
  id: string;
  name?: string;
  blocks: Block<S>[];
  /** recurring weekday slots, 0=Sunday */
  days?: number[];
  /** one-off YYYY-MM-DD dates */
  dates?: string[];
  /** ids of every Folder (Settings.folders) this workout is filed under —
   *  empty or absent means it renders in Library's ungrouped list. A workout
   *  can be in several folders at once. */
  folderIds?: string[];
  updatedAt?: number;
  _rev?: string;
  sample?: boolean;
}
```

Add the new `Folder` interface right before `export interface Settings {` (around line 286):

```ts
/** A user-named grouping of workouts in Library — organizational only, never
 *  scheduling, never progression state. Deleting one never deletes the
 *  workouts inside it (see `ungroupedWorkouts`). */
export interface Folder {
  id: string;
  name: string;
}
```

Add `folders?: Folder[];` to the `Settings` interface, near `mobility` (around line 307), with a comment distinguishing it from mobility's purpose:

```ts
  /**
   * User-created folders for organizing Library's Sessions list — see
   * `Workout.folderIds`. A flat list, same shape as `mobility`: nothing here
   * is derived, the app never guesses which folders exist.
   */
  folders?: Folder[];
```

- [ ] **Step 2: Sanitize `folderIds` and `folders` on load/import**

`sanitizeDB` is the app's one trust boundary for shape (see its own doc comment in `packages/engine/src/db.ts:23-30`) — anything arriving from `JSON.parse`, a backup restore, or the network goes through it first.

Modify the workouts-mapping block in `sanitizeDB` (`packages/engine/src/db.ts:93-100`) — add a `folderIds` line alongside the existing `days`/`dates` ones:

```ts
    workouts: arr<unknown>(src.workouts).map((w0) => {
      const w = (w0 && typeof w0 === 'object' ? w0 : {}) as Workout;
      w.blocks = cleanBlocks(w.blocks);
      if (!w.id) w.id = uid();
      if ('days' in w) w.days = arr<number>(w.days).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if ('dates' in w) w.dates = arr<string>(w.dates).filter((k) => typeof k === 'string');
      if ('folderIds' in w) w.folderIds = arr<string>(w.folderIds).filter((id) => typeof id === 'string' && id);
      return w;
    }),
```

Modify `cleanSettings` (`packages/engine/src/db.ts:72-90`) — add a `folders` cleaning block right after the existing `conditioning` cleaning block (after line 88, before the closing `return out as Settings;`):

```ts
    // Same shape guard as `conditioning` above: only touch it when it IS an
    // array, and require both fields to actually be strings — a folder with a
    // missing/garbage id can never be targeted by workoutsInFolder/removal,
    // and a missing name would render an empty pill with no way to identify it.
    if (Array.isArray(out.folders)) {
      out.folders = (out.folders as unknown[])
        .filter((f): f is Record<string, unknown> => f != null && typeof f === 'object' && !Array.isArray(f))
        .filter((f) => typeof f.id === 'string' && f.id && typeof f.name === 'string')
        .map((f) => ({ id: f.id as string, name: f.name as string }));
    }
```

- [ ] **Step 3: Write the failing sanitizeDB test**

Create `packages/engine/test/db.test.ts`:

```ts
/*
 * The trust boundary and the merge rules, tested directly — the paths that
 * lose or corrupt a folder if they go wrong, none of them observable from the
 * UI until the damage is already done.
 */
import { describe, expect, it } from 'vitest';
import { mergeSettings, pickWorkout, sanitizeDB } from '../src/db';
import type { Workout } from '../src/types';

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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @hybrid/engine test -- db.test.ts`
Expected: FAIL — `mergeSettings` drops `folders` entirely (`Object.assign` keeps whichever side is `winner` verbatim, with no union), and `pickWorkout` has no `folderIds` line yet so the union assertion fails too.

- [ ] **Step 5: Implement the mergeSettings folder union + pickWorkout folderIds union**

Modify `packages/engine/src/db.ts` — add `Folder` to the type import at the top of the file (line 4-17):

```ts
import type {
  Block,
  CondBlock,
  CondResult,
  EngineDB,
  Exercise,
  Folder,
  LiftState,
  LoggedSet,
  ProgressState,
  Session,
  Settings,
  StrengthBlock,
  Workout,
} from './types';
```

In `mergeSettings`, add a folders block right after the existing `deletedIds` tombstone block (`packages/engine/src/db.ts:265-280`, right after `out.deletedIds = dd;` closes and before the `devices` block starts):

```ts
  // Folders: union by id, same reasoning as mobility above — creating a
  // folder on two devices before either syncs are both real edits. But a
  // folder whose id is tombstoned in the MERGED deletedIds map (just computed
  // above) must not be revived by a stale copy the other side still carries
  // — the same protection workouts and sessions already get via
  // `notTombstoned`, applied here to a Settings-level list instead of an
  // EngineDB-level array.
  const bf = base.folders || [];
  const wf = winner.folders || [];
  if (bf.length || wf.length) {
    const byId = new Map<string, Folder>();
    bf.forEach((f) => f && f.id && byId.set(f.id, f));
    wf.forEach((f) => f && f.id && byId.set(f.id, f)); // winner's copy wins an id present on both sides
    const tomb = out.deletedIds || {};
    out.folders = Array.from(byId.values()).filter((f) => !tomb[f.id]);
  }
```

Modify `pickWorkout` (`packages/engine/src/db.ts:139-145`):

```ts
export function pickWorkout(x: Workout, y: Workout): Workout {
  const newer = (y.updatedAt || 0) >= (x.updatedAt || 0) ? y : x;
  return Object.assign({}, newer, {
    days: uniqArr((x.days || []).concat(y.days || [])).sort((m, n) => m - n),
    dates: uniqArr((x.dates || []).concat(y.dates || [])).sort(),
    folderIds: uniqArr((x.folderIds || []).concat(y.folderIds || [])),
  });
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @hybrid/engine test -- db.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 7: Write the failing folders.ts test**

Create `packages/engine/test/folders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ungroupedWorkouts, workoutsInFolder } from '../src/folders';
import type { Folder, Workout } from '../src/types';

const wk = (id: string, folderIds?: string[]): Workout => ({ id, blocks: [], folderIds });

describe('workoutsInFolder', () => {
  it('returns only workouts tagged with that folder id', () => {
    const workouts = [wk('a', ['f1']), wk('b', ['f2']), wk('c', ['f1', 'f2'])];
    expect(workoutsInFolder(workouts, 'f1').map((w) => w.id).sort()).toEqual(['a', 'c']);
  });

  it('returns nothing for a folder with no members', () => {
    expect(workoutsInFolder([wk('a', ['f1'])], 'f2')).toEqual([]);
  });
});

describe('ungroupedWorkouts', () => {
  const folders: Folder[] = [{ id: 'f1', name: 'Week 1' }];

  it('lists a workout with no folderIds', () => {
    expect(ungroupedWorkouts([wk('a')], folders).map((w) => w.id)).toEqual(['a']);
  });

  it('excludes a workout tagged into a folder that still exists', () => {
    expect(ungroupedWorkouts([wk('a', ['f1'])], folders)).toEqual([]);
  });

  it('a stale folderId left over from a DELETED folder still counts as ungrouped', () => {
    // The exact sync-race edge case the spec calls out: a workout's folderIds
    // union back in a deleted folder's id before that folder's own tombstone
    // catches up. It must not vanish from both the folder view (the folder is
    // gone) and the flat list (folderIds is non-empty).
    expect(ungroupedWorkouts([wk('a', ['deleted-folder'])], folders).map((w) => w.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @hybrid/engine test -- folders.test.ts`
Expected: FAIL with "Cannot find module '../src/folders'".

- [ ] **Step 9: Implement `packages/engine/src/folders.ts`**

```ts
import type { Folder, Workout } from './types';

/**
 * Workouts actually rendered under one folder.
 */
export function workoutsInFolder(workouts: Workout[], folderId: string): Workout[] {
  return workouts.filter((w) => (w.folderIds || []).includes(folderId));
}

/**
 * A workout with no CURRENTLY VALID folder membership.
 *
 * Membership is checked against the live `folders` list, not just whether
 * `folderIds` is non-empty — a folderId left over from a deleted folder
 * (revived by a sync race before its own tombstone catches up, see
 * `mergeSettings`) must not strand a workout invisible in neither the folder
 * view (the folder itself is gone) nor the flat ungrouped list.
 */
export function ungroupedWorkouts(workouts: Workout[], folders: Folder[]): Workout[] {
  const known = new Set(folders.map((f) => f.id));
  return workouts.filter((w) => !(w.folderIds || []).some((id) => known.has(id)));
}
```

- [ ] **Step 10: Run it to verify it passes**

Run: `pnpm --filter @hybrid/engine test -- folders.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 11: Export the new file from the package barrel**

Modify `packages/engine/src/index.ts` — add one line after `export * from './db';` (line 25):

```ts
export * from './folders';
```

- [ ] **Step 12: Run the full engine suite and typecheck**

Run: `pnpm --filter @hybrid/engine test && pnpm --filter @hybrid/engine typecheck`
Expected: all existing engine tests still pass (nothing above changes any existing field's behavior), plus the 11 new tests from this task.

- [ ] **Step 13: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/db.ts packages/engine/src/folders.ts packages/engine/src/index.ts packages/engine/test/db.test.ts packages/engine/test/folders.test.ts
git commit -m "Add Folder data model, merge rules, and grouping helpers"
```

---

### Task 2: Web — folder rendering, create, rename, delete

**Files:**
- Modify: `apps/web/src/screens/Library.tsx`
- Modify: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: `Folder`, `workoutsInFolder`, `ungroupedWorkouts` from `@hybrid/engine` (Task 1).
- Produces: a `WorkoutRow` sub-component (extracted from the existing inline `<Card>` per-workout markup) taking an optional `folderId?: string` prop — Task 3 (this file) adds a remove-from-folder control to it when that prop is set, and it is the only reuse point Task 3 needs.

- [ ] **Step 1: Extract the existing per-workout card into a `WorkoutRow` component**

This is a pure refactor with no behavior change — do it first, alone, so Step 2 (folder rendering) can call one component instead of duplicating the whole `<Card>` block for both the folder view and the ungrouped view.

Modify `apps/web/src/screens/Library.tsx` — replace the `{mine.map((w) => (...))}` block (lines 160-224, the entire `<li key={w.id}><Card>...</Card></li>` per workout) with a call to a new component, and move that JSX into the new component below `Signal`:

```tsx
          {mine.map((w) => (
            <li key={w.id}>
              <WorkoutRow w={w} open={open} setOpen={setOpen} armDel={armDel} setArmDel={setArmDel} duplicate={duplicate} removeWorkout={removeWorkout} nav={nav} toggleDay={toggleDay} />
            </li>
          ))}
```

Add the new component after `Signal` (after line 270, before `WorkoutDetail`):

```tsx
/** One workout's card: expand/Detail, day chips, Edit/Duplicate/Delete.
 *  Extracted so folder groups (Task 3) and the flat ungrouped list can both
 *  render the same row without duplicating this markup. */
function WorkoutRow({
  w,
  open,
  setOpen,
  armDel,
  setArmDel,
  duplicate,
  removeWorkout,
  nav,
  toggleDay,
}: {
  w: Workout;
  open: string | null;
  setOpen: (id: string | null) => void;
  armDel: string | null;
  setArmDel: (id: string | null) => void;
  duplicate: (w: Workout) => void;
  removeWorkout: (id: string) => void;
  nav: ReturnType<typeof useNavigate>;
  toggleDay: (id: string, d: number) => void;
}) {
  return (
    <Card>
      <button
        className="flex w-full items-center gap-1 text-left"
        onClick={() => { setArmDel(null); setOpen(open === w.id ? null : w.id); }}
        aria-expanded={open === w.id}
      >
        <span className="min-w-0 flex-1 truncate text-5 font-[750]">{w.name || 'Session'}</span>
        <span className="text-3 text-dim">
          {isCondWorkout(w) || !w.blocks.length
            ? 'conditioning'
            : `${w.blocks.length} ${w.blocks.length === 1 ? 'block' : 'blocks'}`}
        </span>
      </button>

      <Signal w={w} />

      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {DAYS.map((d, i) => (
          <Chip
            key={d}
            on={(w.days || []).includes(i)}
            onClick={() => toggleDay(w.id, i)}
            aria-label={`${DAY_NAMES[i]} — ${(w.days || []).includes(i) ? 'scheduled' : 'not scheduled'}`}
            className="min-w-0 px-0"
          >
            {d}
          </Chip>
        ))}
      </div>

      {open === w.id ? (
        <>
          <WorkoutDetail w={w} />
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button size="sm" variant="brass" onClick={() => nav(`/planner/${w.id}`)}>
              Edit
            </Button>
            <Button size="sm" onClick={() => duplicate(w)}>
              Duplicate
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (armDel === w.id) {
                  removeWorkout(w.id);
                  setArmDel(null);
                } else setArmDel(w.id);
              }}
              className={armDel === w.id ? 'border-[color:var(--color-bad)]/40 text-bad' : undefined}
            >
              {armDel === w.id ? 'Really delete?' : 'Delete session'}
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Run existing tests to confirm the refactor changed nothing**

Run: `pnpm run typecheck && pnpm run smoke`
Expected: PASS — same behavior, `WorkoutRow`'s JSX is byte-identical to what was inline before, just parameterized.

- [ ] **Step 3: Write the failing folder-rendering smoke test**

Add to `checks/react-smoke.mjs`, right after the existing `'Duplicate clones a workout and lands on Planner with independent content'` test (after line 1611, before `'the browser Back steps back inside the guided builder'`):

```js
await t('a folder groups its workouts, collapsed by default, and ungrouped ones list flat below', async () => {
  // Seeded directly via localStorage — this test is about RENDERING the
  // grouping correctly, not about the drag gesture that assigns a workout to
  // a folder (that is Task 3's own test).
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.settings.folders = [{ id: 'folder-1', name: 'Week 1' }];
    db.workouts.push(
      { id: 'grouped-1', name: 'Grouped Session', updatedAt: 1, blocks: [], folderIds: ['folder-1'] },
      { id: 'loose-1', name: 'Loose Session', updatedAt: 1, blocks: [] },
    );
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });

  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  const txt = await page.textContent('body');
  assert(/Loose Session/.test(txt), 'ungrouped workout should list flat, always visible');
  assert(!/Grouped Session/.test(txt), 'a workout inside a collapsed folder should not be in the DOM text yet');
  assert(/Week 1/.test(txt), 'the folder header itself should always be visible');

  await page.click('button[aria-expanded]:has-text("Week 1")');
  const txt2 = await page.textContent('body');
  assert(/Grouped Session/.test(txt2), 'expanding the folder should reveal its workout');

  await page.click('button[aria-expanded]:has-text("Week 1")');
  const txt3 = await page.textContent('body');
  assert(!/Grouped Session/.test(txt3), 'collapsing again should hide it');
});

await t('creating, renaming, and deleting a folder keeps its workout, ungrouped', async () => {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.workouts.push({ id: 'folder-cru-1', name: 'Folder CRUD Target', updatedAt: 1, blocks: [], folderIds: [] });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/library', { waitUntil: 'networkidle' });

  page.once('dialog', (dialog) => dialog.accept('Test Folder'));
  await page.click('button:has-text("+ New folder")');
  await page.waitForSelector('button[aria-expanded]:has-text("Test Folder")');

  page.once('dialog', (dialog) => dialog.accept('Renamed Folder'));
  await page.click('button[aria-label="Rename Test Folder"]');
  await page.waitForSelector('button[aria-expanded]:has-text("Renamed Folder")');

  page.once('dialog', (dialog) => dialog.accept());
  await page.click('button[aria-label="Delete folder Renamed Folder"]');
  await page.waitForFunction(() => !document.body.textContent.includes('Renamed Folder'));

  const txt = await page.textContent('body');
  assert(/Folder CRUD Target/.test(txt), 'the workout must survive its folder being deleted, listed ungrouped');
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm run smoke`
Expected: FAIL — `button:has-text("+ New folder")` does not exist yet, and no folder grouping renders.

- [ ] **Step 5: Implement folder state, CRUD functions, and grouped rendering**

Modify `apps/web/src/screens/Library.tsx` — add to the imports (line 3-18), add `Folder`, `workoutsInFolder`, `ungroupedWorkouts`:

```ts
import {
  CON_FORMATS,
  agoLabel,
  blockExercises,
  duplicateWorkout,
  isCond,
  isCondWorkout,
  knownMovements,
  rxLine,
  sessionOpeners,
  ungroupedWorkouts,
  uid,
  workoutStats,
  workoutsInFolder,
  type Folder,
  type LoggedSet,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
```

Add state right after the existing `armDel` state (`apps/web/src/screens/Library.tsx:44`):

```ts
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
```

Add CRUD functions right after `removeWorkout` (after line 107, before the `return (`):

```ts
  function addFolder() {
    const name = window.prompt('Folder name?');
    if (!name || !name.trim()) return;
    update((draft) => {
      draft.settings.folders = [...(draft.settings.folders || []), { id: uid(), name: name.trim() }];
    });
  }

  function renameFolder(f: Folder) {
    const name = window.prompt('Rename folder', f.name);
    if (!name || !name.trim() || name.trim() === f.name) return;
    update((draft) => {
      draft.settings.folders = (draft.settings.folders || []).map((x) =>
        x.id === f.id ? { ...x, name: name.trim() } : x,
      );
    });
  }

  function removeFolder(f: Folder) {
    if (!window.confirm(`Delete folder "${f.name}"? Workouts inside stay in your library.`)) return;
    update((draft) => {
      draft.settings.folders = (draft.settings.folders || []).filter((x) => x.id !== f.id);
      draft.workouts = draft.workouts.map((w) =>
        (w.folderIds || []).includes(f.id) ? { ...w, folderIds: (w.folderIds || []).filter((id) => id !== f.id) } : w,
      );
    });
  }
```

Add derived data right after `const mine = db.workouts;` (line 59):

```ts
  const folders = db.settings.folders || [];
  const ungrouped = useMemo(() => ungroupedWorkouts(mine, folders), [mine, folders]);
```

Replace the `{mine.length ? (...) : (<Empty .../>)}` block (lines 158-228, now referencing `WorkoutRow` from Step 1) with folder groups above the ungrouped list:

```tsx
      <SectionHead title="Yours" />
      <Button size="sm" className="mb-1" onClick={addFolder}>
        + New folder
      </Button>
      {folders.map((f) => {
        const inFolder = workoutsInFolder(mine, f.id);
        const isOpen = !!openFolders[f.id];
        return (
          <div key={f.id} className="mb-1">
            <div className="flex items-center gap-1 rounded-md border border-line bg-panel3 p-1.5">
              <button
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                onClick={() => setOpenFolders((o) => ({ ...o, [f.id]: !o[f.id] }))}
                aria-expanded={isOpen}
              >
                <span aria-hidden>{isOpen ? '▾' : '▸'}</span>
                <span className="min-w-0 flex-1 truncate text-5 font-[750]">{f.name}</span>
                <span className="text-3 text-dim">{inFolder.length}</span>
              </button>
              <Button size="sm" aria-label={`Rename ${f.name}`} onClick={() => renameFolder(f)}>
                Rename
              </Button>
              <Button size="sm" aria-label={`Delete folder ${f.name}`} onClick={() => removeFolder(f)}>
                ✕
              </Button>
            </div>
            {isOpen ? (
              <ul className="mt-0.5 flex flex-col gap-1 pl-2">
                {inFolder.map((w) => (
                  <li key={w.id}>
                    <WorkoutRow w={w} open={open} setOpen={setOpen} armDel={armDel} setArmDel={setArmDel} duplicate={duplicate} removeWorkout={removeWorkout} nav={nav} toggleDay={toggleDay} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {ungrouped.length ? (
        <ul className="flex flex-col gap-1">
          {ungrouped.map((w) => (
            <li key={w.id}>
              <WorkoutRow w={w} open={open} setOpen={setOpen} armDel={armDel} setArmDel={setArmDel} duplicate={duplicate} removeWorkout={removeWorkout} nav={nav} toggleDay={toggleDay} />
            </li>
          ))}
        </ul>
      ) : !folders.length ? (
        <Empty title="Nothing here yet" body="Use “＋ New session” above to build your first one." />
      ) : null}
```

Note: the very first `{mine.map(...)}` block from Step 1 (the plain flat list) is being REPLACED by this whole block, not kept alongside it — Step 1's extraction and Step 5's grouped rendering together fully replace lines 158-228 of the original file.

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm run typecheck && pnpm run smoke`
Expected: PASS — both new smoke tests, plus every pre-existing smoke test (the extraction preserved `WorkoutRow`'s markup exactly, so `Duplicate clones a workout...`, `the plan editor edits a target...`, etc. all still pass unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/screens/Library.tsx checks/react-smoke.mjs
git commit -m "Add folder create/rename/delete and grouped rendering to web Library"
```

---

### Task 3: Web — drag-and-drop assign, remove-from-folder

**Files:**
- Modify: `apps/web/src/screens/Library.tsx`
- Modify: `checks/react-smoke.mjs`

**Interfaces:**
- Consumes: `WorkoutRow` and the folder-rendering block from Task 2 (same file).
- Produces: nothing new consumed by later tasks — this is the last web task.

- [ ] **Step 1: Write the failing drag-and-drop smoke test**

Add to `checks/react-smoke.mjs`, right after the two tests added in Task 2:

```js
await t('dragging a workout onto a folder header adds it, without removing it from another folder it is already in', async () => {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.settings.folders = [
      { id: 'drag-folder-a', name: 'Folder A' },
      { id: 'drag-folder-b', name: 'Folder B' },
    ];
    db.workouts.push({ id: 'drag-target-1', name: 'Drag Target', updatedAt: 1, blocks: [], folderIds: ['drag-folder-a'] });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/library', { waitUntil: 'networkidle' });

  // Folder A is already open (this test only needs the row present in the
  // DOM to drag it — Task 2's own test already covers expand/collapse).
  await page.click('button[aria-expanded]:has-text("Folder A")');
  await page.waitForSelector('text=Drag Target');

  // Native HTML5 DnD does not fire from a real OS mouse gesture under
  // Playwright's synthetic input, so the drag/drop events are dispatched
  // directly — the same escape hatch this suite already uses elsewhere for
  // interactions its click/fill helpers cannot reach.
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('[draggable="true"]')).find((el) =>
      el.textContent?.includes('Drag Target'),
    );
    const header = Array.from(document.querySelectorAll('button[aria-expanded]')).find((el) =>
      el.textContent?.includes('Folder B'),
    )?.parentElement;
    if (!row || !header) throw new Error('drag source or drop target not found');
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    header.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    header.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });

  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.find((w) => w.id === 'drag-target-1'));
  assert(db.folderIds.includes('drag-folder-b'), 'dropping onto Folder B should add it');
  assert(db.folderIds.includes('drag-folder-a'), 'dropping onto Folder B should not remove it from Folder A');
});

await t('the ✕ on a workout shown inside a folder removes only that tag, not the workout', async () => {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hybrid-engine-v1'));
    db.settings.folders = [{ id: 'remove-folder-1', name: 'Remove Test Folder' }];
    db.workouts.push({ id: 'remove-target-1', name: 'Remove Target', updatedAt: 1, blocks: [], folderIds: ['remove-folder-1'] });
    localStorage.setItem('hybrid-engine-v1', JSON.stringify(db));
  });
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.click('button[aria-expanded]:has-text("Remove Test Folder")');
  await page.waitForSelector('text=Remove Target');

  await page.click('button[aria-label="Remove Remove Target from Remove Test Folder"]');
  await page.waitForFunction(() => !document.body.textContent.includes('Remove Target'));

  await page.reload({ waitUntil: 'networkidle' });
  const txt = await page.textContent('body');
  assert(/Remove Target/.test(txt), 'the workout itself must still exist, now ungrouped');
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('hybrid-engine-v1')).workouts.find((w) => w.id === 'remove-target-1'));
  assert(!db.folderIds.includes('remove-folder-1'), 'the folder tag must actually be gone, not just visually hidden');
});
```

(Fix the stray `expect:` label left in the first test above before running — it is a copy artifact, not real syntax; the line should read only `assert(db.folderIds.includes('drag-folder-b'), ...)`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run smoke`
Expected: FAIL — no `draggable` attribute exists yet, folder headers have no drop handlers, and no per-row "Remove ... from ..." button exists.

- [ ] **Step 3: Implement drag-and-drop assign and remove-from-folder**

Modify `apps/web/src/screens/Library.tsx` — add a helper right after `removeFolder` (Task 2):

```ts
  function addToFolder(workoutId: string, folderId: string) {
    update((draft) => {
      const w = draft.workouts.find((x) => x.id === workoutId);
      if (!w) return false;
      const set = new Set(w.folderIds || []);
      set.add(folderId);
      w.folderIds = Array.from(set);
    });
  }

  function removeFromFolder(workoutId: string, folderId: string) {
    update((draft) => {
      const w = draft.workouts.find((x) => x.id === workoutId);
      if (!w) return false;
      w.folderIds = (w.folderIds || []).filter((id) => id !== folderId);
    });
  }
```

Add drag-over visual state right after `openFolders` (Task 2):

```ts
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
```

Modify the folder header `<div>` from Task 2 to become a drop target — replace:

```tsx
            <div className="flex items-center gap-1 rounded-md border border-line bg-panel3 p-1.5">
```

with:

```tsx
            <div
              className={cx(
                'flex items-center gap-1 rounded-md border p-1.5',
                dragOverFolder === f.id ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel3',
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverFolder(f.id);
              }}
              onDragLeave={() => setDragOverFolder((cur) => (cur === f.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverFolder(null);
                const workoutId = e.dataTransfer.getData('text/plain');
                if (workoutId) addToFolder(workoutId, f.id);
              }}
            >
```

(`cx` is already imported from `../ui` at the top of this file.)

Modify `WorkoutRow` (Task 2) to accept an optional `folderId`/`folderName` pair and become draggable — change its props type and outer element:

```tsx
function WorkoutRow({
  w,
  open,
  setOpen,
  armDel,
  setArmDel,
  duplicate,
  removeWorkout,
  nav,
  toggleDay,
  folderId,
  folderName,
  removeFromFolder,
}: {
  w: Workout;
  open: string | null;
  setOpen: (id: string | null) => void;
  armDel: string | null;
  setArmDel: (id: string | null) => void;
  duplicate: (w: Workout) => void;
  removeWorkout: (id: string) => void;
  nav: ReturnType<typeof useNavigate>;
  toggleDay: (id: string, d: number) => void;
  /** Set only when this row renders INSIDE a folder — adds a small ✕ that
   *  removes just that one tag, distinct from the whole-workout delete.
   *  `folderName` is carried separately from `folderId` purely for the
   *  spoken label — the id alone is what removeFromFolder acts on. */
  folderId?: string;
  folderName?: string;
  removeFromFolder?: (workoutId: string, folderId: string) => void;
}) {
  return (
    <Card
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', w.id)}
    >
      {folderId && removeFromFolder ? (
        <button
          onClick={() => removeFromFolder(w.id, folderId)}
          aria-label={`Remove ${w.name || 'session'} from ${folderName || 'folder'}`}
          className="float-right text-3 text-dim hover:text-bad"
        >
          ✕
        </button>
      ) : null}
      <button
```

The rest of `WorkoutRow`'s body is unchanged from Task 2.

Update the call site that renders `WorkoutRow` inside a folder (Task 2's `{inFolder.map((w) => (...))}`) to pass `folderId`, `folderName`, and `removeFromFolder`:

```tsx
                {inFolder.map((w) => (
                  <li key={w.id}>
                    <WorkoutRow w={w} open={open} setOpen={setOpen} armDel={armDel} setArmDel={setArmDel} duplicate={duplicate} removeWorkout={removeWorkout} nav={nav} toggleDay={toggleDay} folderId={f.id} folderName={f.name} removeFromFolder={removeFromFolder} />
                  </li>
                ))}
```

The ungrouped list's call site is unchanged (no `folderId`/`folderName` — no ✕-from-folder button renders there), matching the test's expected `aria-label="Remove Remove Target from Remove Test Folder"`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm run typecheck && pnpm run smoke`
Expected: PASS — all smoke tests from Task 2 and Task 3, plus every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/Library.tsx checks/react-smoke.mjs
git commit -m "Add drag-and-drop folder assignment and per-folder removal to web Library"
```

---

### Task 4: Mobile — folder rendering, create, rename, delete

**Files:**
- Modify: `apps/mobile/src/screens/Library.tsx`
- Modify: `apps/mobile/test/screens.test.tsx`

**Interfaces:**
- Consumes: `Folder`, `workoutsInFolder`, `ungroupedWorkouts` from `@hybrid/engine` (Task 1).
- Produces: a `WorkoutRow` sub-component (extracted from the existing inline `<Card>` per-workout markup), same reasoning as web Task 2 — Task 5 (this file) adds a "Folders" button to it.

- [ ] **Step 1: Extract the existing per-workout card into a `WorkoutRow` component**

Modify `apps/mobile/src/screens/Library.tsx` — replace the `mine.map((w) => (...))` block (lines 157-224) with a call to a new component, moving that JSX into the new component below `Signal`:

```tsx
        mine.map((w) => (
          <WorkoutRow
            key={w.id}
            w={w}
            open={open}
            setOpen={setOpen}
            duplicate={duplicate}
            confirmRemove={confirmRemove}
            nav={nav}
            toggleDay={toggleDay}
          />
        ))
```

Add the new component after `Signal` (after line 334, before `Detail`):

```tsx
/** One workout's card: expand/Detail, day chips, Edit/Duplicate, the
 *  row-level delete ✕. Extracted so folder groups (Task 5) and the flat
 *  ungrouped list can both render the same row without duplicating this
 *  markup. */
function WorkoutRow({
  w,
  open,
  setOpen,
  duplicate,
  confirmRemove,
  nav,
  toggleDay,
}: {
  w: Workout;
  open: string | null;
  setOpen: (id: string | null) => void;
  duplicate: (w: Workout) => void;
  confirmRemove: (w: Workout) => void;
  nav: NativeStackNavigationProp<RootStackParams>;
  toggleDay: (id: string, i: number) => void;
}) {
  return (
    <Card className="mb-1">
      <View className="flex-row items-center">
        <Tap
          className="min-w-0 flex-1 flex-row items-center"
          onPress={() => setOpen(open === w.id ? null : w.id)}
          label={`${open === w.id ? 'collapse' : 'expand'} ${w.name || 'session'}`}
        >
          <T w="semi" className="min-w-0 flex-1 text-5 text-text" numberOfLines={1}>
            {w.name || 'Session'}
          </T>
          <T num className="ml-1 text-3 text-dim">
            {isCondWorkout(w) || !w.blocks.length
              ? 'conditioning'
              : `${w.blocks.length} ${w.blocks.length === 1 ? 'block' : 'blocks'}`}
          </T>
        </Tap>
        <Tap
          onPress={() => confirmRemove(w)}
          box={32}
          label={`delete ${w.name || 'session'}`}
          className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
        >
          <T w="med" className="text-4 text-muted">
            ✕
          </T>
        </Tap>
      </View>

      <Signal w={w} />

      <View className="mt-1 flex-row gap-0.5">
        {DAYS.map((d, i) => (
          <View key={d} className="flex-1">
            <Chip
              on={(w.days || []).includes(i)}
              onPress={() => toggleDay(w.id, i)}
              label={`${DAY_NAMES[i]} — ${(w.days || []).includes(i) ? 'scheduled' : 'not scheduled'}`}
            >
              {d}
            </Chip>
          </View>
        ))}
      </View>

      {open === w.id ? (
        <>
          <Detail w={w} />
          <Btn variant="brass" className="mt-1.5" onPress={() => nav.navigate('Planner', { id: w.id })}>
            Edit
          </Btn>
          <Btn
            variant="ghost"
            className="mt-1.5"
            label={`duplicate ${w.name || 'session'}`}
            onPress={() => duplicate(w)}
          >
            Duplicate
          </Btn>
        </>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Run existing tests to confirm the refactor changed nothing**

Run: `pnpm --filter @hybrid/mobile test -- screens.test.tsx`
Expected: PASS — every existing Library test (`opens on Sessions...`, `duplicates a session onto Planner...`, etc.) still passes unchanged.

- [ ] **Step 3: Write the failing folder-rendering test**

Add to `apps/mobile/test/screens.test.tsx`, in a new `describe` block right after the existing `describe('Library tabs', ...)` block (which ends around line 219 pre-refactor — locate it by its content, not a fixed line number, since Tasks 2's web changes do not touch this file):

```tsx
describe('Library folders', () => {
  it('groups a workout under its folder, collapsed by default, and lists an ungrouped one flat', () => {
    seed({
      settings: { folders: [{ id: 'folder-1', name: 'Week 1' }] },
      workouts: [
        { id: 'grouped-1', name: 'Grouped Session', updatedAt: 1, blocks: [], folderIds: ['folder-1'] },
        { id: 'loose-1', name: 'Loose Session', updatedAt: 1, blocks: [] },
      ],
    });
    renderScreen(<LibraryScreen />);

    expect(screen.getByText('Loose Session')).toBeTruthy();
    expect(screen.queryByText('Grouped Session')).toBeNull();
    expect(screen.getByText('Week 1')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('expand Week 1 folder'));
    expect(screen.getByText('Grouped Session')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('collapse Week 1 folder'));
    expect(screen.queryByText('Grouped Session')).toBeNull();
  });

  it('creates, renames, and deletes a folder — the workout survives, ungrouped', () => {
    seed({ workouts: [{ id: 'cru-1', name: 'Folder CRUD Target', updatedAt: 1, blocks: [], folderIds: [] }] });
    renderScreen(<LibraryScreen />);

    fireEvent.press(screen.getByText('+ New folder'));
    fireEvent.changeText(screen.getByLabelText('New folder name'), 'Test Folder');
    fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('Test Folder')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('rename Test Folder'));
    fireEvent.changeText(screen.getByLabelText('New folder name'), 'Renamed Folder');
    fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('Renamed Folder')).toBeTruthy();

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByLabelText('delete folder Renamed Folder'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    act(() => buttons.find((b) => b.text === 'Delete')!.onPress!());

    expect(screen.queryByText('Renamed Folder')).toBeNull();
    expect(screen.getByText('Folder CRUD Target')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- screens.test.tsx`
Expected: FAIL — `screen.getByText('+ New folder')` throws, no folder rendering exists yet.

- [ ] **Step 5: Implement folder state, CRUD functions, and grouped rendering**

Modify `apps/mobile/src/screens/Library.tsx` — add to imports (lines 5-20):

```ts
import {
  CON_FORMATS,
  agoLabel,
  blockExercises,
  duplicateWorkout,
  isCond,
  isCondWorkout,
  knownMovements,
  rxLine,
  sessionOpeners,
  ungroupedWorkouts,
  uid,
  workoutStats,
  workoutsInFolder,
  type Folder,
  type LoggedSet,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
```

Add state right after `const [open, setOpen] = useState<string | null>(null);` (line 44):

```ts
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  // 'NEW' while creating a folder, a folder id while renaming one, else null.
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
```

Add CRUD functions right after `confirmRemove` (after line 113, before `return (`):

```ts
  const startNewFolder = () => {
    setEditingFolder('NEW');
    setFolderName('');
  };

  const startRenameFolder = (f: Folder) => {
    setEditingFolder(f.id);
    setFolderName(f.name);
  };

  const commitFolderEdit = () => {
    const name = folderName.trim();
    if (!name) {
      setEditingFolder(null);
      return;
    }
    if (editingFolder === 'NEW') {
      update((d) => {
        d.settings.folders = [...(d.settings.folders || []), { id: uid(), name }];
      });
    } else if (editingFolder) {
      const id = editingFolder;
      update((d) => {
        d.settings.folders = (d.settings.folders || []).map((x) => (x.id === id ? { ...x, name } : x));
      });
    }
    setEditingFolder(null);
  };

  const removeFolder = (f: Folder) =>
    Alert.alert(`Delete folder "${f.name}"?`, 'Workouts inside stay in your library.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          update((d) => {
            d.settings.folders = (d.settings.folders || []).filter((x) => x.id !== f.id);
            d.workouts.forEach((w) => {
              if ((w.folderIds || []).includes(f.id)) w.folderIds = (w.folderIds || []).filter((id) => id !== f.id);
            });
          }),
      },
    ]);
```

Add derived data right after `const mine = db.workouts;` (line 52):

```ts
  const folders = db.settings.folders || [];
  const ungrouped = useMemo(() => ungroupedWorkouts(mine, folders), [mine, folders]);
```

Replace the `{mine.length ? (mine.map(...)) : (<Empty .../>)}` block (lines 156-227, now referencing `WorkoutRow` from Step 1) with folder groups above the ungrouped list:

```tsx
      <SectionHead title="Yours" />
      <Btn variant="ghost" className="mb-1" onPress={startNewFolder}>
        + New folder
      </Btn>
      {editingFolder === 'NEW' ? (
        <View className="mb-1 flex-row items-center gap-1">
          <Input
            value={folderName}
            onChangeText={setFolderName}
            placeholder="Folder name"
            accessibilityLabel="New folder name"
            className="h-5 flex-1 rounded-md border border-line bg-well px-1.5 text-4 text-text"
          />
          <Btn variant="brass" onPress={commitFolderEdit}>
            Add
          </Btn>
        </View>
      ) : null}
      {folders.map((f) => {
        const inFolder = workoutsInFolder(mine, f.id);
        const isOpen = !!openFolders[f.id];
        return (
          <View key={f.id} className="mb-1">
            {editingFolder === f.id ? (
              <View className="flex-row items-center gap-1">
                <Input
                  value={folderName}
                  onChangeText={setFolderName}
                  placeholder="Folder name"
                  accessibilityLabel="New folder name"
                  className="h-5 flex-1 rounded-md border border-line bg-well px-1.5 text-4 text-text"
                />
                <Btn variant="brass" onPress={commitFolderEdit}>
                  Add
                </Btn>
              </View>
            ) : (
              <Card className="flex-row items-center">
                <Tap
                  className="min-w-0 flex-1 flex-row items-center"
                  onPress={() => setOpenFolders((o) => ({ ...o, [f.id]: !o[f.id] }))}
                  label={`${isOpen ? 'collapse' : 'expand'} ${f.name} folder`}
                >
                  <T className="text-4 text-dim">{isOpen ? '▾' : '▸'}</T>
                  <T w="semi" className="ml-1 min-w-0 flex-1 text-5 text-text" numberOfLines={1}>
                    {f.name}
                  </T>
                  <T num className="text-3 text-dim">
                    {inFolder.length}
                  </T>
                </Tap>
                <Tap
                  onPress={() => startRenameFolder(f)}
                  box={32}
                  label={`rename ${f.name}`}
                  className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
                >
                  <T w="med" className="text-3 text-muted">
                    ✎
                  </T>
                </Tap>
                <Tap
                  onPress={() => removeFolder(f)}
                  box={32}
                  label={`delete folder ${f.name}`}
                  className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
                >
                  <T w="med" className="text-4 text-muted">
                    ✕
                  </T>
                </Tap>
              </Card>
            )}
            {isOpen ? (
              <View className="mt-0.5 pl-2">
                {inFolder.map((w) => (
                  <WorkoutRow key={w.id} w={w} open={open} setOpen={setOpen} duplicate={duplicate} confirmRemove={confirmRemove} nav={nav} toggleDay={toggleDay} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {ungrouped.length ? (
        ungrouped.map((w) => (
          <WorkoutRow key={w.id} w={w} open={open} setOpen={setOpen} duplicate={duplicate} confirmRemove={confirmRemove} nav={nav} toggleDay={toggleDay} />
        ))
      ) : !folders.length ? (
        <Empty title="Nothing here yet" body="Tap “＋ New session” to build your first one." />
      ) : null}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @hybrid/mobile test -- screens.test.tsx`
Expected: PASS — both new tests, plus every pre-existing Library test unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/Library.tsx apps/mobile/test/screens.test.tsx
git commit -m "Add folder create/rename/delete and grouped rendering to mobile Library"
```

---

### Task 5: Mobile — "Folders" picker (assign/remove)

**Files:**
- Modify: `apps/mobile/src/screens/Library.tsx`
- Modify: `apps/mobile/test/screens.test.tsx`

**Interfaces:**
- Consumes: `WorkoutRow` and the folder-rendering block from Task 4 (same file).
- Produces: nothing new consumed by later tasks — this is the last mobile task before final verification.

- [ ] **Step 1: Write the failing picker test**

Add to `apps/mobile/test/screens.test.tsx`, right after Task 4's `describe('Library folders', ...)` block:

```tsx
describe('Library folders picker', () => {
  it('checking a folder in the picker adds the workout, unchecking removes it — without touching other folders', () => {
    seed({
      settings: {
        folders: [
          { id: 'pick-a', name: 'Folder A' },
          { id: 'pick-b', name: 'Folder B' },
        ],
      },
      workouts: [{ id: 'pick-target', name: 'Pick Target', updatedAt: 1, blocks: [], folderIds: ['pick-a'] }],
    });
    renderScreen(<LibraryScreen />);

    fireEvent.press(screen.getByLabelText('folders for Pick Target'));
    expect(screen.getByText('Folder A')).toBeTruthy();
    expect(screen.getByText('Folder B')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Folder B, not in folder'));
    fireEvent.press(screen.getByText('Done'));

    const db = persisted();
    const w = db.workouts.find((x) => x.id === 'pick-target');
    expect((w?.folderIds || []).sort()).toEqual(['pick-a', 'pick-b']);
  });

  it('lets you create a new folder from inside the picker', () => {
    seed({ workouts: [{ id: 'pick-target-2', name: 'Pick Target Two', updatedAt: 1, blocks: [] }] });
    renderScreen(<LibraryScreen />);

    fireEvent.press(screen.getByLabelText('folders for Pick Target Two'));
    fireEvent.press(screen.getByText('+ New folder'));
    fireEvent.changeText(screen.getByLabelText('New folder name'), 'Made In Picker');
    fireEvent.press(screen.getByText('Add'));
    fireEvent.press(screen.getByLabelText('Made In Picker, not in folder'));
    fireEvent.press(screen.getByText('Done'));

    const db = persisted();
    const folder = (db.settings.folders || []).find((f) => f.name === 'Made In Picker');
    const w = db.workouts.find((x) => x.id === 'pick-target-2');
    expect(folder).toBeTruthy();
    expect(w?.folderIds).toEqual([folder!.id]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @hybrid/mobile test -- screens.test.tsx`
Expected: FAIL — `screen.getByLabelText('folders for Pick Target')` throws, no picker exists yet.

- [ ] **Step 3: Implement the "Folders" picker**

Modify `apps/mobile/src/screens/Library.tsx` — add `Modal` to the `react-native` import (line 2):

```ts
import { Alert, Modal, View } from 'react-native';
```

Add picker state right after `folderName` (Task 4):

```ts
  const [pickerFor, setPickerFor] = useState<string | null>(null);
```

Add the toggle function right after `removeFolder` (Task 4):

```ts
  const toggleFolderForWorkout = (workoutId: string, folderId: string) =>
    update((d) => {
      const w = d.workouts.find((x) => x.id === workoutId);
      if (!w) return false;
      const set = new Set(w.folderIds || []);
      if (set.has(folderId)) set.delete(folderId);
      else set.add(folderId);
      w.folderIds = Array.from(set);
    });
```

Modify `WorkoutRow` (Task 4) to accept an `onOpenFolders` callback and render a "Folders" button alongside Edit/Duplicate:

```tsx
function WorkoutRow({
  w,
  open,
  setOpen,
  duplicate,
  confirmRemove,
  nav,
  toggleDay,
  onOpenFolders,
}: {
  w: Workout;
  open: string | null;
  setOpen: (id: string | null) => void;
  duplicate: (w: Workout) => void;
  confirmRemove: (w: Workout) => void;
  nav: NativeStackNavigationProp<RootStackParams>;
  toggleDay: (id: string, i: number) => void;
  onOpenFolders: (workoutId: string) => void;
}) {
```

and, inside the `{open === w.id ? (...) : null}` block, add one more button after Duplicate:

```tsx
          <Btn
            variant="ghost"
            className="mt-1.5"
            label={`folders for ${w.name || 'session'}`}
            onPress={() => onOpenFolders(w.id)}
          >
            Folders
          </Btn>
```

Update both `WorkoutRow` call sites (inside a folder, and in the ungrouped list) to pass `onOpenFolders={setPickerFor}`.

Add the Modal right before the screen's closing `</Screen>` tag:

```tsx
      <Modal visible={pickerFor != null} transparent animationType="fade" onRequestClose={() => setPickerFor(null)}>
        <View className="flex-1 items-center justify-center bg-black/50 p-2">
          <Card className="w-full">
            <T w="semi" className="text-6 text-text">
              Folders
            </T>
            {folders.map((f) => {
              const w = mine.find((x) => x.id === pickerFor);
              const on = pickerFor ? (w?.folderIds || []).includes(f.id) : false;
              return (
                <View key={f.id} className="mt-1">
                  <Chip
                    on={on}
                    onPress={() => pickerFor && toggleFolderForWorkout(pickerFor, f.id)}
                    label={`${f.name}, ${on ? 'in folder' : 'not in folder'}`}
                  >
                    {f.name}
                  </Chip>
                </View>
              );
            })}
            {!folders.length ? (
              <T className="mt-1 text-4 text-dim">No folders yet.</T>
            ) : null}
            {editingFolder === 'NEW' ? (
              <View className="mt-1 flex-row items-center gap-1">
                <Input
                  value={folderName}
                  onChangeText={setFolderName}
                  placeholder="Folder name"
                  accessibilityLabel="New folder name"
                  className="h-5 flex-1 rounded-md border border-line bg-well px-1.5 text-4 text-text"
                />
                <Btn variant="brass" onPress={commitFolderEdit}>
                  Add
                </Btn>
              </View>
            ) : (
              <Btn variant="ghost" className="mt-1" onPress={startNewFolder}>
                + New folder
              </Btn>
            )}
            <Btn variant="brass" className="mt-1.5" onPress={() => setPickerFor(null)}>
              Done
            </Btn>
          </Card>
        </View>
      </Modal>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @hybrid/mobile test -- screens.test.tsx`
Expected: PASS — both new tests, plus every pre-existing Library and folder test from Task 4 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/Library.tsx apps/mobile/test/screens.test.tsx
git commit -m "Add Folders picker for assigning/removing a workout on mobile"
```

---

### Task 6: Full verification and push

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the whole verify pipeline**

Run: `pnpm run verify`
Expected: PASS — `typecheck`, `test` (engine + web + mobile, including every test added in Tasks 1–5), `build:site`, `check:csp`, `smoke` (including every scenario added in Tasks 2–3), `smoke:deploy`.

- [ ] **Step 2: Fix any failure found**

If anything fails, read the actual error output (not the test name) before changing code — likely candidates given this plan's shape: an `aria-label`/`accessibilityLabel` string mismatch between a test's selector and the implementation's exact wording (both were written by hand in different tasks and must match verbatim), or the stray `expect:` label flagged in Task 3 Step 1 if it was not removed before that test ran.

- [ ] **Step 3: Push**

```bash
git push -u origin main
```
