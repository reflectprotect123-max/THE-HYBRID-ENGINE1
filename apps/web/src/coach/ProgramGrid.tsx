import { useCallback, useMemo, useState } from 'react';
import { useDb } from '../store/db';
import { cx } from '../ui';
import { gridDates, projectGrid, sameWeekday, type CellItem, type DayCell } from './projection';
import { SessionDrawer } from './SessionDrawer';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** grid column order is Mon..Sun; Workout.days is 0=Sunday */
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

function Cell({
  cell,
  isToday,
  isPast,
  selected,
  onSelect,
  onOpen,
}: {
  cell: DayCell;
  isToday: boolean;
  isPast: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: (item: CellItem) => void;
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
        onDoubleClick={() => cell.items[0] && onOpen(cell.items[0])}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && cell.items[0]) {
            e.preventDefault();
            onOpen(cell.items[0]);
          }
        }}
        className={cx(
          'flex h-full min-h-[52px] flex-col gap-0.5 p-0.5 outline-none',
          selected && 'outline outline-2 -outline-offset-2 outline-gold-line',
        )}
      >
        {empty ? (
          // An empty day is a state, not a void: rest for the past, an
          // affordance slot for the future (the actions land in phase 2).
          <span className={cx('px-0.5 text-[10px]', isPast ? 'text-dim' : 'text-dim/70')}>
            {isPast ? 'rest' : '—'}
          </span>
        ) : (
          cell.items.map((item) => (
            <button
              key={`${item.source}:${item.id}:${cell.date}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(item);
              }}
              className={cx(
                'group w-full rounded-sm px-0.5 py-0.5 text-left transition-colors hover:bg-panel2',
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
          ))
        )}
      </div>
    </td>
  );
}

export function ProgramGrid({ horizon }: { horizon: 4 | 8 | 12 }) {
  const { workouts, sessions } = useDb();
  const today = isoToday();
  const [open, setOpen] = useState<{ item: CellItem; date: string } | null>(null);
  const [selected, setSelected] = useState<string>(today);
  const [dayFocus, setDayFocus] = useState<number | null>(null);

  // Show mostly history (the coach's evidence) plus the near future.
  const weeksBack = horizon - 2;
  const rows = useMemo(() => gridDates(today, weeksBack, 2), [today, weeksBack]);
  const grid = useMemo(
    () => projectGrid(rows, workouts, sessions, today),
    [rows, workouts, sessions, today],
  );

  const shown = dayFocus === null ? grid : sameWeekday(grid, dayFocus).map((c) => [c]);

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
            return (
              <tr key={monday}>
                <th
                  scope="row"
                  className={cx(
                    'sticky left-0 z-10 border-b border-r border-line bg-panel3 px-1 py-0.5 text-left text-[10px] font-normal tabular-nums',
                    rowIsCurrent ? 'text-gold2' : 'text-dim',
                  )}
                >
                  {weekLabel(dayFocus === null ? monday : (week[0]?.date ?? monday))}
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
            automatically — this bench reads the same database.
          </p>
        </div>
      )}

      {open && (
        <SessionDrawer item={open.item} date={open.date} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
