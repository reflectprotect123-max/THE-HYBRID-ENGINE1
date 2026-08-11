// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CalendarMonth, type CalendarDay } from './CalendarMonth';

const days: CalendarDay[] = [
  { date: '2026-08-11', title: 'Hinge/Press', published: false, items: 3 },
  { date: '2026-08-13', title: 'Squat/Vertical Pull', published: true, items: 1 },
];

function renderCal(over: Partial<Parameters<typeof CalendarMonth>[0]> = {}) {
  const props = {
    days,
    year: 2026,
    month: 8,
    onMonthChange: vi.fn(),
    onCreate: vi.fn(),
    onAddFromLibrary: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  render(<CalendarMonth {...props} />);
  return props;
}

describe('CalendarMonth', () => {
  it('names the month and lays out Monday first', () => {
    renderCal();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
    const dows = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    expect(dows[0]).toHaveTextContent('Mon');
    expect(dows).toHaveLength(7);
  });

  it('moves months in both directions', () => {
    const props = renderCal();
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(props.onMonthChange).toHaveBeenCalledWith(2026, 9);
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    expect(props.onMonthChange).toHaveBeenCalledWith(2026, 7);
  });

  it('shows what is on a filled day, and opens it', () => {
    const props = renderCal();
    expect(screen.getByText('Hinge/Press')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Hinge/Press'));
    expect(props.onOpen).toHaveBeenCalledWith('2026-08-11');
  });

  it('says whether a day is published, and how much is on it', () => {
    renderCal();
    expect(screen.getByText(/Unpublished · 3 items/)).toBeInTheDocument();
    expect(screen.getByText(/Published · 1 item$/)).toBeInTheDocument();
  });

  /*
   * The mockup reveals these on :hover. A phone has no hover, and /coach is a
   * supported phone surface as of Stage 1 — so this asserts the CLICK path,
   * which is the one a desktop reviewer never exercises.
   */
  it('reveals Create session and Add from library on an empty day by TAP', () => {
    const props = renderCal();
    fireEvent.click(screen.getByRole('button', { name: '12 August 2026' }));
    fireEvent.click(screen.getByRole('button', { name: /create session/i }));
    expect(props.onCreate).toHaveBeenCalledWith('2026-08-12');
  });

  it('offers Add from library on an empty day', () => {
    const props = renderCal();
    fireEvent.click(screen.getByRole('button', { name: '12 August 2026' }));
    fireEvent.click(screen.getByRole('button', { name: /add from library/i }));
    expect(props.onAddFromLibrary).toHaveBeenCalledWith('2026-08-12');
  });

  it('keeps the empty-day actions closed until the day is tapped', () => {
    renderCal();
    expect(screen.queryByRole('button', { name: /create session/i })).not.toBeInTheDocument();
  });

  it('dims days from the neighbouring months', () => {
    renderCal();
    // 1 August 2026 is a Saturday, so 27 July leads the grid.
    const tap = screen.getByRole('button', { name: '27 July 2026' });
    expect(tap.closest('.cal-cell')).toHaveClass('dim');
  });

  /*
   * The two action buttons must not be nested inside the day's own button:
   * that is invalid HTML, and browsers resolve nested interactive elements
   * inconsistently — the inner clicks are the ones that break, which is the
   * phone path this whole structure exists to serve.
   */
  it('does not nest the action buttons inside the day button', () => {
    renderCal();
    fireEvent.click(screen.getByRole('button', { name: '12 August 2026' }));
    const create = screen.getByRole('button', { name: /create session/i });
    expect(create.closest('button')).toBe(create);
  });

  it('does not offer the toolbar actions the spec cut', () => {
    renderCal();
    expect(screen.queryByRole('button', { name: /message team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish all/i })).not.toBeInTheDocument();
  });
});
