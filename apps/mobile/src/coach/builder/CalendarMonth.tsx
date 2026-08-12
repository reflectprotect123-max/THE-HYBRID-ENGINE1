import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { calendarMonthLabel, monthGrid, shiftMonth } from '@hybrid/engine';
import { T, Tap } from '../../ui';

export interface CalendarDay {
  /** `YYYY-MM-DD` */
  date: string;
  title: string;
  published: boolean;
  items: number;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "12 August 2026" — the accessible name of a day cell, ported unchanged from
 * the web version (`apps/web/src/coach/library/CalendarMonth.tsx`), where it
 * is also how a test addresses one. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const CELL_W = `${100 / 7}%` as const;

/**
 * The month grid from the approved mockup, ported to a phone.
 *
 * `monthGrid`, `calendarMonthLabel` and `shiftMonth` are shared date maths
 * from `@hybrid/engine` and are reused rather than reimplemented — the web
 * version leans on the same three functions.
 *
 * The web version reveals an empty day's two actions on `:hover`, with an
 * explicit tap target added underneath because a phone browser has no hover.
 * React Native has no hover concept AT ALL — there is nothing here to layer a
 * tap fallback onto, so the tap path (an open/closed `openDate` cell) is the
 * ONLY path: tapping an empty day toggles its two actions open, exactly like
 * the web tap target already does, with no separate hover state to port.
 *
 * There is no CSS grid in React Native, so the month is laid out the way
 * `screens/Calendar.tsx` already lays out its own month view: seven
 * percentage-width flex cells per row, wrapped.
 */
export function CalendarMonth({
  days,
  year,
  month,
  onMonthChange,
  onCreate,
  onAddFromLibrary,
  onOpen,
}: {
  days: CalendarDay[];
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  onCreate: (date: string) => void;
  onAddFromLibrary: (date: string) => void;
  onOpen: (date: string) => void;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);

  const cells = useMemo(() => monthGrid(year, month), [year, month]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  function step(delta: number) {
    const next = shiftMonth(year, month, delta);
    setOpenDate(null);
    onMonthChange(next.year, next.month);
  }

  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between">
        <Tap
          onPress={() => step(-1)}
          label="Previous month"
          box={44}
          className="h-5 w-5 items-center justify-center rounded-md border border-line2 bg-panel2"
        >
          <T w="bold" className="text-5 text-muted">‹</T>
        </Tap>
        <T w="bold" className="text-6 text-text">
          {calendarMonthLabel(year, month)}
        </T>
        <Tap
          onPress={() => step(1)}
          label="Next month"
          box={44}
          className="h-5 w-5 items-center justify-center rounded-md border border-line2 bg-panel2"
        >
          <T w="bold" className="text-5 text-muted">›</T>
        </Tap>
      </View>

      <View className="flex-row flex-wrap">
        {DOW.map((d) => (
          <View key={d} style={{ width: CELL_W }}>
            <T w="semi" className="text-center text-1 uppercase text-dim" style={{ letterSpacing: 1 }}>
              {d}
            </T>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {cells.map((cell) => {
          const day = byDate.get(cell.date);

          if (day) {
            return (
              <View key={cell.date} style={{ width: CELL_W }} className="p-0.5">
                <Tap
                  onPress={() => onOpen(cell.date)}
                  label={`Open ${day.title} on ${longDate(cell.date)}`}
                  box={44}
                  className={`min-h-[44px] rounded-sm border border-line bg-panel2 p-0.5 ${
                    cell.inMonth ? '' : 'opacity-40'
                  }`}
                >
                  <T num className="text-2 text-muted">
                    {cell.dayOfMonth}
                  </T>
                  <T w="semi" numberOfLines={1} className="text-2 text-text">
                    {day.title}
                  </T>
                  <T className={`text-1 ${day.published ? 'text-dim' : 'text-gold2'}`} numberOfLines={1}>
                    {day.published ? 'Published' : 'Unpublished'} · {day.items} item
                    {day.items === 1 ? '' : 's'}
                  </T>
                </Tap>
              </View>
            );
          }

          const isOpen = openDate === cell.date;
          return (
            <View key={cell.date} style={{ width: CELL_W }} className="p-0.5">
              <Tap
                onPress={() => setOpenDate(isOpen ? null : cell.date)}
                label={longDate(cell.date)}
                selected={isOpen}
                box={44}
                className={`min-h-[44px] items-center justify-center rounded-sm border border-line bg-panel2 py-0.5 ${
                  cell.inMonth ? '' : 'opacity-40'
                }`}
              >
                <T num className="text-2 text-muted">
                  {cell.dayOfMonth}
                </T>
              </Tap>
              {isOpen ? (
                <View className="mt-0.5 gap-0.5">
                  <Tap
                    onPress={() => onCreate(cell.date)}
                    box={44}
                    className="min-h-[44px] items-center justify-center rounded-sm border border-line2 bg-panel3 py-0.5"
                  >
                    <T w="med" className="text-1 text-gold2">
                      Create session
                    </T>
                  </Tap>
                  <Tap
                    onPress={() => onAddFromLibrary(cell.date)}
                    box={44}
                    className="min-h-[44px] items-center justify-center rounded-sm border border-line2 bg-panel3 py-0.5"
                  >
                    <T w="med" className="text-1 text-gold2">
                      Add from library
                    </T>
                  </Tap>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
