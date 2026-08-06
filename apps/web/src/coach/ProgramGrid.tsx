import { useCallback, useMemo, useState } from 'react';
import { newBlock, newCondBlock, uid, type Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { cx } from '../ui';
import { applyWeekClear, applyWeekCopy, planWeekClear, planWeekCopy } from './ops';
import { gridDates, projectGrid, sameWeekday, type CellItem, type DayCell } from './projection';
import { SessionDrawer } from './SessionDrawer';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekLabel(monday: string): string {
  const d = new Date(`${monday}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function DomainDot({ kind }: { kind: CellItem['kind'] }) {
  return (
    <span
      aria-hidden
      className={cx(
        'mt-[5px] inline-block h-1 w-1 shrink-0 rounded-full',
        kind === 'strength' ? 'bg-gold' : 'bg-blue',
      )}
    />
  );
}

interface MenuState {
  kind: 'day' | 'week';
  anchor: { top: number; left: number };
  date?: string;
  monday?: string;
}

interface ConfirmState {
  title: string;
  body: string;
  okLabel: string;
  onOk: () => void;
}

function Cell({
  cell,
  isToday,
  isPast,
  selected,
  onSelect,
  onOpen,
  onAdd,
}: {
  cell: DayCell;
  isToday: boolean;
  isPast: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: (item: CellItem) => void;
  onAdd: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const empty = cell.items.length === 0;
  return (
    <td
      className={cx(
        'h-full min-w-[108px] border-b border-r border-line align-top p-0',
        isToday && 'bg-gold-wash/40',
      )}
    >
      <div
        role="gridcell button"
        tabIndex={selected ? 0 : -1}
        data-cell={cell.date}
        onClick={onSelect}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && cell.items[0]) {
            e.preventDefault();
            onOpen(cell.items[0]);
          }
        }}
        className={cx(
          'group/cell flex h-full min-h-[52px] flex-col gap-0.5 p-0.5 outline-none',
          selected && 'outline outline-2 -outline-offset-2 outline-gold-line',
        )}
      >
        {empty && isPast && <span className="px-0.5 text-[10px] text-dim">rest</span>}
        {cell.items.map((item) => (
          <button
            key={`${item.source}:${item.id}:${cell.date}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(item);
            }}
            className={cx(
              'w-full rounded-sm px-0.5 py-0.5 text-left transition-colors hover:bg-panel2',
              item.source === 'logged' && item.status === 'completed' && 'opacity-90',
              item.source === 'planned' && 'opacity-80',
            )}
            title={item.name}
          >
            <span className="flex items-start gap-0.5">
              <DomainDot kind={item.kind} />
              <span className="min-w-0">
                <span className="block truncate text-xs leading-tight">
                  {item.name}
                  {item.source === 'logged' && item.status === 'incomplete' && (
                    <span className="text-dim"> ·½</span>
                  )}
                </span>
                <span className="block truncate text-[10px] leading-tight text-muted">
                  {item.keyline}
                </span>
              </span>
            </span>
          </button>
        ))}
        {!isPast && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAdd(e);
            }}
            className="self-start rounded px-0.5 text-xs text-dim opacity-0 transition-opacity hover:bg-gold-wash hover:text-gold2 focus-visible:opacity-100 group-hover/cell:opacity-100"
            aria-label={`Add session on ${cell.date}`}
          >
            +
          </button>
        )}
      </div>
    </td>
  );
}

export function ProgramGrid({ horizon }: { horizon: 4 | 8 | 12 }) {
  const { workouts, sessions, update } = useDb();
  const today = isoToday();
  const [open, setOpen] = useState<{ item: CellItem; date: string } | null>(null);
  const [selected, setSelected] = useState<string>(today);
  const [dayFocus, setDayFocus] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const weeksBack = horizon - 2;
  const rows = useMemo(() => gridDates(today, weeksBack, 2), [today, weeksBack]);
  const grid = useMemo(
    () => projectGrid(rows, workouts, sessions, today),
    [rows, workouts, sessions, today],
  );

  const shown = dayFocus === null ? grid : sameWeekday(grid, dayFocus).map((c) => [c]);

  const say = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const anchorFrom = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { top: Math.min(r.bottom + 4, window.innerHeight - 180), left: Math.min(r.left, window.innerWidth - 240) };
  };

  const addSession = (date: string, kind: 'strength' | 'conditioning') => {
    const w: Workout = {
      id: uid(),
      name: kind === 'conditioning' ? 'New conditioning session' : 'New strength session',
      kind,
      blocks: [kind === 'conditioning' ? newCondBlock() : newBlock()],
      dates: [date],
      updatedAt: Date.now(),
    };
    update((draft) => {
      draft.workouts.push(w);
    });
    setMenu(null);
    setOpen({ item: { id: w.id, kind, name: w.name!, keyline: '', source: 'planned' }, date });
  };

  const copyPrevDay = (date: string) => {
    const prevDate = new Date(`${date}T00:00:00Z`);
    prevDate.setUTCDate(prevDate.getUTCDate() - 7);
    const prev = prevDate.toISOString().slice(0, 10);
    const cell = grid.flat().find((c) => c.date === prev);
    const oneOffs = (cell?.items ?? []).filter((i) => i.source === 'planned' || i.source === 'logged');
    if (!oneOffs.length) {
      say('Nothing on that day last week.');
      setMenu(null);
      return;
    }
    update((draft) => {
      for (const it of oneOffs) {
        const src =
          draft.workouts.find((w) => w.id === it.id) ??
          draft.sessions.find((s) => s.id === it.id);
        if (!src) continue;
        draft.workouts.push({
          id: uid(),
          name: it.name,
          kind: it.kind,
          blocks: JSON.parse(JSON.stringify(src.blocks)),
          dates: [date],
          updatedAt: Date.now(),
        });
      }
    });
    setMenu(null);
    say('Copied — independent copies, nothing linked.');
  };

  const runWeekCopy = (monday: string, times: 1 | 2) => {
    const addWeeks = (m: string, n: number) => {
      const d = new Date(`${m}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7 * n);
      return d.toISOString().slice(0, 10);
    };
    const targets = times === 1 ? [addWeeks(monday, 1)] : [addWeeks(monday, 1), addWeeks(monday, 2)];
    const plan = planWeekCopy(workouts, monday, targets, today);
    const go = () => {
      update((draft) => {
        applyWeekCopy(draft, plan, uid, Date.now());
      });
      setConfirm(null);
      setMenu(null);
      const skipped = plan.skippedRecurring.length
        ? ` ${plan.skippedRecurring.length} weekly slot${plan.skippedRecurring.length === 1 ? '' : 's'} not copied — they repeat on their own.`
        : '';
      say(`${plan.creates.length} session${plan.creates.length === 1 ? '' : 's'} copied.${skipped}`);
    };
    if (!plan.creates.length) {
      setMenu(null);
      say(
        plan.skippedRecurring.length
          ? 'Everything that week repeats weekly already — nothing to copy.'
          : 'No one-off sessions in that week to copy.',
      );
      return;
    }
    if (plan.collisions.length) {
      setConfirm({
        title: 'Some target days already have sessions',
        body: `Copies are added alongside what is planned — nothing is overwritten. Affected: ${plan.collisions.join(', ')}.`,
        okLabel: 'Copy anyway',
        onOk: go,
      });
      setMenu(null);
      return;
    }
    go();
  };

  const runWeekClear = (monday: string) => {
    const plan = planWeekClear(workouts, monday, today);
    if (!plan.removals.length) {
      setMenu(null);
      say(
        plan.untouchableRecurring.length
          ? 'That week holds only weekly slots — delete the workout itself to remove those.'
          : 'Nothing planned that week.',
      );
      return;
    }
    setConfirm({
      title: 'Clear planned sessions?',
      body:
        `Removes ${plan.removals.length} one-off placement${plan.removals.length === 1 ? '' : 's'} in the week of ${weekLabel(monday)}. Logged history is untouched.` +
        (plan.untouchableRecurring.length
          ? ` Weekly slots (${plan.untouchableRecurring.join(', ')}) keep repeating.`
          : ''),
      okLabel: 'Clear week',
      onOk: () => {
        update((draft) => {
          applyWeekClear(draft, plan, Date.now());
        });
        setConfirm(null);
        setMenu(null);
        say('Week cleared.');
      },
    });
    setMenu(null);
  };

  const moveSelection = useCallback(
    (dRow: number, dCol: number) => {
      const flatRows = dayFocus === null ? grid : shown;
      let r = flatRows.findIndex((row) => row.some((c) => c.date === selected));
      if (r < 0) r = flatRows.length - 1;
      let c = Math.max(0, flatRows[r]?.findIndex((cell) => cell.date === selected) ?? 0);
      r = Math.min(flatRows.length - 1, Math.max(0, r + dRow));
      c = Math.min((flatRows[r]?.length ?? 1) - 1, Math.max(0, c + dCol));
      const next = flatRows[r]?.[c];
      if (next) {
        setSelected(next.date);
        document.querySelector<HTMLElement>(`[data-cell="${next.date}"]`)?.focus();
      }
    },
    [grid, shown, selected, dayFocus],
  );

  const totalSessions = grid.flat().reduce((n, c) => n + c.items.length, 0);

  return (
    <div
      className="overflow-x-auto"
      onKeyDown={(e) => {
        const map: Record<string, [number, number]> = {
          ArrowUp: [-1, 0],
          ArrowDown: [1, 0],
          ArrowLeft: [0, -1],
          ArrowRight: [0, 1],
        };
        const d = map[e.key];
        if (d) {
          e.preventDefault();
          moveSelection(d[0], d[1]);
        }
      }}
    >
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-line bg-panel3 px-1 py-0.5 text-left text-[10px] font-normal uppercase tracking-wider text-dim">
              Week
            </th>
            {(dayFocus === null ? WEEKDAY_LABELS : [WEEKDAY_LABELS[dayFocus]]).map((label, i) => {
              const col = dayFocus === null ? i : dayFocus;
              return (
                <th
                  key={label}
                  className="border-b border-r border-line bg-panel3 px-1 py-0.5 text-left text-[10px] font-normal uppercase tracking-wider text-muted"
                >
                  <button
                    className={cx(
                      'rounded px-0.5 transition-colors hover:text-text',
                      dayFocus === col && 'bg-gold-wash text-gold2',
                    )}
                    onClick={() => setDayFocus(dayFocus === col ? null : col)}
                    title={
                      dayFocus === col
                        ? 'Back to the full week'
                        : `All ${label} sessions side by side`
                    }
                  >
                    {label}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((week) => {
            const monday = week[0]?.date ?? '';
            const rowIsCurrent = week.some((c) => c.date === today);
            const futureWeek = monday >= gridDates(today, 0, 1)[0]![0]!;
            return (
              <tr key={monday} className="group/row">
                <th
                  scope="row"
                  className={cx(
                    'sticky left-0 z-10 border-b border-r border-line bg-panel3 px-1 py-0.5 text-left text-[10px] font-normal tabular-nums',
                    rowIsCurrent ? 'text-gold2' : 'text-dim',
                  )}
                >
                  {weekLabel(monday)}
                  {futureWeek && dayFocus === null && (
                    <button
                      className="ml-0.5 rounded px-0.5 text-dim opacity-0 transition-opacity hover:bg-panel2 hover:text-text focus-visible:opacity-100 group-hover/row:opacity-100"
                      aria-label={`Week actions for ${weekLabel(monday)}`}
                      onClick={(e) =>
                        setMenu({ kind: 'week', monday, anchor: anchorFrom(e) })
                      }
                    >
                      ⋯
                    </button>
                  )}
                </th>
                {week.map((cell) => (
                  <Cell
                    key={cell.date}
                    cell={cell}
                    isToday={cell.date === today}
                    isPast={cell.date < today}
                    selected={cell.date === selected}
                    onSelect={() => setSelected(cell.date)}
                    onOpen={(item) => setOpen({ item, date: cell.date })}
                    onAdd={(e) => setMenu({ kind: 'day', date: cell.date, anchor: anchorFrom(e) })}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {totalSessions === 0 && (
        <div className="px-2 py-3 text-sm text-muted">
          <p className="font-medium text-text">Nothing planned or logged in this window.</p>
          <p className="mt-0.5">
            Sessions logged in the athlete app and workouts with scheduled days appear here
            automatically — this bench reads the same database. Use the + on any future day to
            start planning.
          </p>
        </div>
      )}

      {menu && (
        <>
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setMenu(null)}
          />
          <div
            className="fixed z-40 min-w-[210px] rounded border border-line2 bg-panel2 p-0.5 shadow-2xl"
            style={{ top: menu.anchor.top, left: menu.anchor.left }}
            role="menu"
          >
            {menu.kind === 'day' ? (
              <>
                <button className="coach-menu-item" onClick={() => addSession(menu.date!, 'strength')}>
                  Add strength session
                </button>
                <button className="coach-menu-item" onClick={() => addSession(menu.date!, 'conditioning')}>
                  Add conditioning session
                </button>
                <div className="my-0.5 border-t border-line" />
                <button className="coach-menu-item" onClick={() => copyPrevDay(menu.date!)}>
                  Copy same day last week
                </button>
                <p className="px-1 py-0.5 text-[10px] text-dim">
                  Empty days are rest by default — adding is a choice.
                </p>
              </>
            ) : (
              <>
                <button className="coach-menu-item" onClick={() => runWeekCopy(menu.monday!, 1)}>
                  Duplicate week → next week
                </button>
                <button className="coach-menu-item" onClick={() => runWeekCopy(menu.monday!, 2)}>
                  Repeat week ×2
                </button>
                <div className="my-0.5 border-t border-line" />
                <button className="coach-menu-item" onClick={() => runWeekClear(menu.monday!)}>
                  Clear planned sessions
                </button>
                <p className="px-1 py-0.5 text-[10px] text-dim">
                  Copies are independent — weekly slots repeat on their own and are not copied.
                </p>
              </>
            )}
          </div>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 z-40 grid place-items-center">
          <button
            aria-label="Cancel"
            className="absolute inset-0 bg-black/40"
            onClick={() => setConfirm(null)}
          />
          <div className="relative w-[min(420px,calc(100vw-32px))] rounded-md border border-line2 bg-panel2 p-2 shadow-2xl">
            <h2 className="text-sm font-semibold">{confirm.title}</h2>
            <p className="mt-0.5 text-xs text-muted">{confirm.body}</p>
            <div className="mt-1 flex justify-end gap-1">
              <button
                className="rounded px-1 py-0.5 text-xs text-muted outline outline-1 outline-line2 hover:text-text"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-gold-wash px-1 py-0.5 text-xs text-gold2 outline outline-1 outline-gold-line"
                onClick={confirm.onOk}
              >
                {confirm.okLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded border border-gold-line bg-panel2 px-2 py-0.5 text-xs text-text shadow-2xl"
        >
          {notice}
        </div>
      )}

      {open && (
        <SessionDrawer item={open.item} date={open.date} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
