/*
 * The Library's "New session" entry — the coach's door into the day builder.
 *
 * The owner's placement, verbatim: the day builder "sits at New session,
 * under Library". These pin the two halves of that sentence — the entry
 * exists on the Library's Sessions slice, and pressing it lands on the
 * DayBuilder route in LIBRARY mode, meaning dateless: a `date` in the params
 * would make the builder open as a scheduled day, which is exactly what this
 * entry is not for.
 *
 * The rest of the Library's behaviour is pinned in screens.test.tsx; this
 * file covers only the entry point, alongside the screen it lives on.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import { liftWorkout, renderScreen, seed } from '../../test/harness';
import { LibraryScreen } from './Library';

/* Real navigation by default, a spy where the destination is the assertion —
   the exact arrangement screens.test.tsx uses, for the same reason: seeing
   where `nav.navigate` was told to go without registering a second real
   screen to land on. */
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: jest.fn(),
}));
const realUseNavigation = jest.requireActual('@react-navigation/native').useNavigation;
beforeEach(() => {
  (useNavigation as jest.Mock).mockImplementation(realUseNavigation);
});

describe('Library "New session" entry', () => {
  it('renders on the Sessions slice, alongside the guided "＋ New session"', () => {
    seed({ workouts: [liftWorkout()] });
    renderScreen(<LibraryScreen />);
    // Both doors exist and stay distinguishable: the guided flow keeps its
    // ＋-prefixed name, the day builder entry is the bare "New session".
    expect(screen.getByText('New session')).toBeTruthy();
    expect(screen.getByText('＋ New session')).toBeTruthy();
  });

  it('is there in the empty state too — a first session can be authored in the builder', () => {
    seed({ workouts: [] });
    renderScreen(<LibraryScreen />);
    expect(screen.getByText('New session')).toBeTruthy();
  });

  it('opens the day builder in library mode: no date, no params at all', () => {
    seed({ workouts: [] });
    const navigate = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ navigate });

    renderScreen(<LibraryScreen />);
    fireEvent.press(screen.getByText('New session'));

    expect(navigate).toHaveBeenCalledTimes(1);
    // Dateless IS the mode switch — the builder reads a missing `date` as
    // "author for the library", so nothing else may ride along.
    expect(navigate).toHaveBeenCalledWith('DayBuilder');
  });
});
