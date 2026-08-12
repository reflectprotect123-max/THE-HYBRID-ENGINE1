import { fireEvent, render, screen } from '@testing-library/react-native';
import { CalendarMonth } from './CalendarMonth';

describe('CalendarMonth', () => {
  it('renders the month heading from calendarMonthLabel', () => {
    render(
      <CalendarMonth
        days={[]}
        year={2026}
        month={8}
        onMonthChange={() => {}}
        onCreate={() => {}}
        onAddFromLibrary={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('August 2026')).toBeTruthy();
  });

  it('steps to the next month via shiftMonth, rolling the year when needed', () => {
    const onMonthChange = jest.fn();
    render(
      <CalendarMonth
        days={[]}
        year={2026}
        month={12}
        onMonthChange={onMonthChange}
        onCreate={() => {}}
        onAddFromLibrary={() => {}}
        onOpen={() => {}}
      />,
    );
    fireEvent.press(screen.getByLabelText('Next month'));
    expect(onMonthChange).toHaveBeenCalledWith(2027, 1);
  });

  it('steps to the previous month via shiftMonth, rolling the year when needed', () => {
    const onMonthChange = jest.fn();
    render(
      <CalendarMonth
        days={[]}
        year={2026}
        month={1}
        onMonthChange={onMonthChange}
        onCreate={() => {}}
        onAddFromLibrary={() => {}}
        onOpen={() => {}}
      />,
    );
    fireEvent.press(screen.getByLabelText('Previous month'));
    expect(onMonthChange).toHaveBeenCalledWith(2025, 12);
  });

  it('shows a day with sessions by its title, item count and published state read from the data', () => {
    render(
      <CalendarMonth
        days={[{ date: '2026-08-12', title: 'Squat Day', published: true, items: 3 }]}
        year={2026}
        month={8}
        onMonthChange={() => {}}
        onCreate={() => {}}
        onAddFromLibrary={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('Squat Day')).toBeTruthy();
    expect(screen.getByText('Published · 3 items')).toBeTruthy();
  });

  it('reads unpublished state from the data rather than assuming it', () => {
    render(
      <CalendarMonth
        days={[{ date: '2026-08-12', title: 'Draft Day', published: false, items: 1 }]}
        year={2026}
        month={8}
        onMonthChange={() => {}}
        onCreate={() => {}}
        onAddFromLibrary={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('Unpublished · 1 item')).toBeTruthy();
  });

  it('tapping a day with a session calls onOpen with its date', () => {
    const onOpen = jest.fn();
    render(
      <CalendarMonth
        days={[{ date: '2026-08-12', title: 'Squat Day', published: true, items: 3 }]}
        year={2026}
        month={8}
        onMonthChange={() => {}}
        onCreate={() => {}}
        onAddFromLibrary={() => {}}
        onOpen={onOpen}
      />,
    );
    fireEvent.press(screen.getByLabelText('Open Squat Day on 12 August 2026'));
    expect(onOpen).toHaveBeenCalledWith('2026-08-12');
  });

  it('tapping an empty day offers create and add-from-library, with no hover involved', () => {
    const onCreate = jest.fn();
    const onAddFromLibrary = jest.fn();
    render(
      <CalendarMonth
        days={[]}
        year={2026}
        month={8}
        onMonthChange={() => {}}
        onCreate={onCreate}
        onAddFromLibrary={onAddFromLibrary}
        onOpen={() => {}}
      />,
    );

    // The two actions do not exist until the empty day is tapped — this IS the
    // tap path, not a hover fallback layered on top of one.
    expect(screen.queryByText('Create session')).toBeNull();
    expect(screen.queryByText('Add from library')).toBeNull();

    fireEvent.press(screen.getByLabelText('13 August 2026'));

    fireEvent.press(screen.getByText('Create session'));
    expect(onCreate).toHaveBeenCalledWith('2026-08-13');

    fireEvent.press(screen.getByText('Add from library'));
    expect(onAddFromLibrary).toHaveBeenCalledWith('2026-08-13');
  });
});
