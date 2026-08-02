import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useDb } from '../store/db';
import { Button, Card, Chip, cx, Empty, Kicker, ScreenTitle, SectionHead, Tabs } from '../ui';

/*
 * Two letters, in a fixed seven-column grid.
 *
 * Three-letter chips in a wrapping flex row do not fit a phone: SAT dropped to
 * a line of its own, so a week rendered as 6 + 1 and every session card carried
 * an extra row of height to say nothing. It reads as a layout bug rather than
 * as a week. A grid cannot wrap, so the row survives whatever the label width
 * and the coarse-pointer 44px rule do to the chips.
 *
 * Two letters rather than one because Sunday and Saturday are both S, and
 * unlike the Home week strip there is no date underneath to disambiguate them.
 */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/*
 * The Library is everything you can train: every session you have written.
 */
export function Library() {
  const nav = useNavigate();
  const { db, update } = useDb();
  const [open, setOpen] = useState<string | null>(null);
  const [armDel, setArmDel] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  // An armed delete disarms itself after 5s untouched.
  useEffect(() => {
    if (!armDel) return;
    const t = setTimeout(() => setArmDel(null), 5000);
    return () => clearTimeout(t);
  }, [armDel]);
  /*
   * Three slices of one library, not three destinations. Sessions are things
   * you START; exercises and mobility are things you LOOK UP. Mixing them in
   * one list meant 448 movements buried the six sessions you actually run.
   */
  const [tab, setTab] = useState<'sessions' | 'exercises' | 'mobility'>('sessions');
  const [q, setQ] = useState('');

  const mine = db.workouts;
  const folders = db.settings.folders || [];
  const ungrouped = useMemo(() => ungroupedWorkouts(mine, folders), [mine, folders]);
  const movements = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);
  const mobility = useMemo(
    () => (Array.isArray(db.settings.mobility) ? db.settings.mobility : []),
    [db.settings.mobility],
  );
  const match = (list: string[]) => {
    const k = q.trim().toLowerCase();
    return k ? list.filter((m) => m.toLowerCase().includes(k)) : list;
  };

  function addWorkout() {
    const w: Workout = { id: uid(), name: 'New session', blocks: [], updatedAt: Date.now() };
    update((draft) => {
      draft.workouts.push(w);
    });
    nav(`/build/${w.id}`);
  }

  function duplicate(w: Workout) {
    // The library's own names, so the copy lands on one that is not already in
    // the list it is about to join — see `duplicateWorkout`.
    const copy = duplicateWorkout(w, db.workouts.map((x) => x.name || ''));
    update((draft) => {
      draft.workouts.push(copy);
    });
    nav(`/planner/${copy.id}`);
  }

  function toggleDay(id: string, d: number) {
    update((draft) => {
      const w = draft.workouts.find((x) => x.id === id);
      if (!w) return false;
      const days = new Set(w.days || []);
      if (days.has(d)) days.delete(d);
      else days.add(d);
      w.days = Array.from(days).sort((a, b) => a - b);
      w.updatedAt = Date.now();
    });
  }

  function removeWorkout(id: string) {
    update((draft) => {
      draft.workouts = draft.workouts.filter((x) => x.id !== id);
      // A tombstone, not just a local delete: without one the next sync sees a
      // workout the remote still has and cheerfully restores it.
      draft.settings.deletedIds = { ...(draft.settings.deletedIds || {}), [id]: Date.now() };
    });
  }

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

  return (
    <>
      <Kicker>Library</Kicker>
      <ScreenTitle>Your library</ScreenTitle>

      <Tabs
        label="Library sections"
        value={tab}
        onChange={(k) => {
          setTab(k);
          setQ('');
        }}
        tabs={[
          { key: 'sessions', label: 'Sessions', count: db.workouts.length },
          { key: 'exercises', label: 'Exercises', count: movements.length },
          { key: 'mobility', label: 'Mobility', count: mobility.length },
        ]}
      />

      {tab === 'exercises' ? (
        <NameList
          names={match(movements)}
          total={movements.length}
          q={q}
          setQ={setQ}
          onPick={(m) => nav(`/exercise/${encodeURIComponent(m)}`)}
          noun="movements"
          empty="Nothing logged yet. Movements appear here as you train them."
        />
      ) : null}

      {tab === 'mobility' ? (
        <NameList
          names={match(mobility)}
          total={mobility.length}
          q={q}
          setQ={setQ}
          noun="mobility & prep"
          empty="No mobility work saved. These are the stretches, breathing and prep you do around training — they carry no load to track, so this is a reference list."
        />
      ) : null}

      {tab !== 'sessions' ? null : (
      <>
      <Button variant="brass" className="mt-2 w-full" onClick={addWorkout}>
        ＋ New session
      </Button>

      <SectionHead title="Yours" />
      <Button size="sm" className="mb-1" onClick={addFolder}>
        + New folder
      </Button>
      {folders.map((f) => {
        const inFolder = workoutsInFolder(mine, f.id);
        const isOpen = !!openFolders[f.id];
        return (
          <div key={f.id} className="mb-1">
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
                    <WorkoutRow w={w} open={open} setOpen={setOpen} armDel={armDel} setArmDel={setArmDel} duplicate={duplicate} removeWorkout={removeWorkout} nav={nav} toggleDay={toggleDay} folderId={f.id} folderName={f.name} removeFromFolder={removeFromFolder} />
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
      </>
      )}
    </>
  );
}

/*
 * What this session actually means to you, on the card.
 *
 * The Library is the screen you open to DECIDE what to train, and until now it
 * answered with a name and a block count. These two lines are the two things
 * that bear on the decision: when you last did it, and what you would be
 * lifting if you started it now.
 *
 * Both are suppressed when empty rather than rendered blank — a session you
 * have never trained should say nothing, not "last trained never · opens at".
 */
function Signal({ w }: { w: Workout }) {
  const { db, whoop } = useDb();
  const stats = useMemo(() => workoutStats(w, db.sessions), [w, db.sessions]);
  // Through sessionOpeners, so this figure and the one the logger prefills come
  // from the same function — including the red-morning easing.
  const opens = useMemo(() => sessionOpeners(w, db.settings, whoop), [w, db.settings, whoop]);

  if (!stats.count && !opens.length) return null;

  return (
    <div className="mt-0.5">
      {stats.count ? (
        <p className="num text-3 text-dim">
          {agoLabel(stats.lastDate)} · {stats.count} {stats.count === 1 ? 'time' : 'times'}
        </p>
      ) : null}
      {opens.length ? (
        <p className="num truncate text-3 text-muted">
          opens at {opens.map((o) => `${o.name} ${o.kg}`).join(' · ')}
          {opens.some((o) => o.eased) ? ' (eased today)' : ''}
        </p>
      ) : null}
    </div>
  );
}

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

/** Exported so Day (the read-only per-date preview) can reuse this listing
 *  rather than building a second one — see docs/superpowers/specs/2026-08-02-calendar-day-jump-design.md. */
export function WorkoutDetail({ w }: { w: Workout }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 border-t border-line pt-1.5">
      {w.blocks.map((b, bi) => (
        <div key={b.id ?? bi}>
          <div className="text-3 font-[750] uppercase tracking-[.12em] text-dim">{b.heading || 'Block'}</div>
          {isCond(b) ? (
            <p className="mt-0.5 text-4 text-muted">
              {CON_FORMATS[b.condFmt]?.name ?? b.condFmt} · {b.effort || b.targetZone}
            </p>
          ) : (
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => (
                <li key={ex.id ?? ei} className="text-4">
                  <span className="font-[650]">{ex.name || 'Exercise'}</span>
                  <span className="num ml-1 text-dim">{rxLine(ex)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A searchable list of names.
 *
 * Shared by Exercises and Mobility because they are the same object at
 * different weights: one links into a history the app can draw, the other does
 * not because there is nothing numeric to draw. Rendering them from one
 * component keeps them from drifting apart on padding and phrasing.
 */
function NameList({
  names,
  total,
  q,
  setQ,
  onPick,
  noun,
  empty,
}: {
  names: string[];
  total: number;
  q: string;
  setQ: (s: string) => void;
  onPick?: (m: string) => void;
  noun: string;
  empty: string;
}) {
  if (!total) return <div className="mt-2"><Empty title="Nothing here yet" body={empty} /></div>;
  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${total} ${noun}`}
        aria-label={`Search ${noun}`}
        className="mt-2 h-5 w-full rounded-md border border-line bg-well px-1.5 text-4 text-text outline-none placeholder:text-dim focus:border-gold-line"
      />
      <ul className="mt-1 flex flex-col gap-0.5">
        {names.map((m) =>
          onPick ? (
            <li key={m}>
              <button
                onClick={() => onPick(m)}
                className="flex w-full items-center gap-1 rounded-md border border-line bg-panel3 p-1.5 text-left text-4 font-[650] hover:border-gold-line"
              >
                <span className="min-w-0 flex-1 truncate">{m}</span>
                <span aria-hidden className="text-3 text-dim">&rsaquo;</span>
              </button>
            </li>
          ) : (
            /* No link: mobility work has no numbers, so there is no history to
               open and a tappable row would promise one. */
            <li key={m} className="rounded-md border border-line bg-panel3 p-1.5 text-4 text-muted">
              {m}
            </li>
          ),
        )}
        {!names.length ? <li className="p-1.5 text-4 text-dim">Nothing matches &ldquo;{q}&rdquo;.</li> : null}
      </ul>
    </>
  );
}
