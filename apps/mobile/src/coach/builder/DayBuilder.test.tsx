import { fireEvent, render, screen } from '@testing-library/react-native';
import { DayBuilder } from './DayBuilder';
import type { DayBuilderValue } from './types';

const entries: never[] = [];

describe('DayBuilder', () => {
  it('shows the empty state with no blocks', () => {
    render(
      <DayBuilder mode="library" published={false} entries={entries} onPublish={() => {}} onSave={() => {}} onBack={() => {}} />,
    );
    expect(screen.getByText('Nothing on this day yet — add a block to start.')).toBeTruthy();
  });

  it('adds a block via + Add block, clearing the empty state', () => {
    render(
      <DayBuilder mode="library" published={false} entries={entries} onPublish={() => {}} onSave={() => {}} onBack={() => {}} />,
    );
    fireEvent.press(screen.getByText('+ Add block'));
    expect(screen.queryByText('Nothing on this day yet — add a block to start.')).toBeNull();
  });

  it('dated mode shows the date, the preferred-day honesty note, and Publish — no Save to library', () => {
    render(
      <DayBuilder
        mode="dated"
        date="2026-08-11"
        published={false}
        entries={entries}
        onPublish={() => {}}
        onSave={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('Tuesday, August 11')).toBeTruthy();
    expect(screen.getByText('2026-08-11')).toBeTruthy();
    expect(
      screen.getByText(/This is a/i, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText('preferred day')).toBeTruthy();
    expect(screen.getByText('Publish session')).toBeTruthy();
    expect(screen.queryByText('Save to library')).toBeNull();
  });

  it('library mode shows Save to library and no date', () => {
    render(
      <DayBuilder mode="library" published={false} entries={entries} onPublish={() => {}} onSave={() => {}} onBack={() => {}} />,
    );
    expect(screen.getByText('Save to library')).toBeTruthy();
    expect(screen.queryByText('Publish session')).toBeNull();
    expect(screen.queryByText('preferred day')).toBeNull();
  });

  it('carries typed instructions into the value passed to onPublish', () => {
    const onPublish = jest.fn();
    render(
      <DayBuilder
        mode="dated"
        date="2026-08-11"
        published={false}
        entries={entries}
        onPublish={onPublish}
        onSave={() => {}}
        onBack={() => {}}
      />,
    );
    fireEvent.changeText(screen.getByLabelText('Coach instructions'), 'Keep it easy today');
    fireEvent.press(screen.getByText('Publish session'));
    expect(onPublish).toHaveBeenCalledTimes(1);
    const value: DayBuilderValue = onPublish.mock.calls[0][0];
    expect(value.instructions).toBe('Keep it easy today');
    expect(value.blocks).toEqual([]);
  });

  it('carries typed instructions into the value passed to onSave, in library mode', () => {
    const onSave = jest.fn();
    render(
      <DayBuilder mode="library" published={false} entries={entries} onPublish={() => {}} onSave={onSave} onBack={() => {}} />,
    );
    fireEvent.changeText(screen.getByLabelText('Coach instructions'), 'Focus on form');
    fireEvent.press(screen.getByText('Save to library'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const value: DayBuilderValue = onSave.mock.calls[0][0];
    expect(value.instructions).toBe('Focus on form');
  });

  it('seeds the editor once from initialValue, on mount', () => {
    const initialValue: DayBuilderValue = {
      instructions: 'Seeded note',
      blocks: [{ id: 'seed-1', category: 'Strength/Power', exercises: [] }],
    };
    render(
      <DayBuilder
        mode="library"
        published={false}
        entries={entries}
        initialValue={initialValue}
        onPublish={() => {}}
        onSave={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('Seeded note')).toBeTruthy();
    // The seeded block replaces the empty state.
    expect(screen.queryByText('Nothing on this day yet — add a block to start.')).toBeNull();
  });
});
