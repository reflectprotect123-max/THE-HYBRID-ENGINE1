/*
 * Two adversarial-review bugs, both about Settings quietly losing data it had
 * already accepted:
 *
 *  - Backup restore used to write back only `workouts`/`sessions`/`settings`
 *    from a parsed backup, discarding `core` (recovery history, life load,
 *    the pain-hold/illness safety flags) and `ecosystem` even though the
 *    export includes them. `restoreDb` (the same function web's Settings
 *    screen uses) now drives the whole replace, and every field it returns
 *    is written back.
 *  - RecoveryCard seeded its form fields from `db.core` once, in a `useState`
 *    initialiser. Settings is a bottom-tab screen that stays mounted for the
 *    app's lifetime, so a day boundary crossed while it sat mounted left the
 *    form showing yesterday's values — and Save would have written them back
 *    in as TODAY's check-in.
 */
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderScreen, seed } from '../../test/harness';
import { SettingsScreen } from './Settings';
import { SyncProvider } from '../cloud/sync';
import { WhoopProvider } from '../cloud/whoop';
import { Concept2Provider } from '../cloud/concept2';
import { NutritionProvider } from '../store/nutrition';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { storage } from '../store/storage';

const persisted = (): EngineDB => JSON.parse(storage.getItem(LS_KEY) || '{}');

// Settings mounts CloudCard/WhoopCard/Concept2Card, which read useSync/
// useWhoop/useConcept2 — and SyncProvider itself reads useNutrition. All
// throw outside their provider. renderScreen's stack (test/harness.tsx)
// only covers DbProvider/RestProvider/SetTimerProvider (what every OTHER
// screen needs), so Settings tests supply the rest, in App.tsx's real order.
const renderSettings = () =>
  renderScreen(
    <NutritionProvider>
      <SyncProvider>
        <WhoopProvider>
          <Concept2Provider>
            <SettingsScreen />
          </Concept2Provider>
        </WhoopProvider>
      </SyncProvider>
    </NutritionProvider>,
  );

describe('Backup restore', () => {
  it('keeps core safety flags (pain hold, illness) after a full restore, not just workouts/sessions/settings', () => {
    seed({});
    renderSettings();

    const backup = {
      workouts: [],
      sessions: [],
      settings: {},
      core: {
        safety: {
          painHold: { active: true, areas: ['lower back'], updatedAt: 111 },
          illness: { status: 'active', updatedAt: 111 },
        },
      },
    };

    fireEvent.changeText(screen.getByLabelText('backup JSON'), JSON.stringify(backup));
    fireEvent.press(screen.getByText('Restore'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('Replace'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    act(() => buttons.find((b) => b.text === 'Replace')!.onPress!());

    expect(screen.getByText('Restored.')).toBeTruthy();

    // The store debounces its write — flush it before reading persisted().
    act(() => jest.advanceTimersByTime(500));
    const db = persisted();
    expect(db.core?.safety.painHold?.active).toBe(true);
    expect(db.core?.safety.painHold?.areas).toEqual(['lower back']);
    expect(db.core?.safety.illness?.status).toBe('active');
  });

  it('still restores workouts/sessions/settings for a backup with no core at all', () => {
    seed({});
    renderSettings();

    const backup = { workouts: [], sessions: [], settings: { profile: { age: '31' } } };
    fireEvent.changeText(screen.getByLabelText('backup JSON'), JSON.stringify(backup));
    fireEvent.press(screen.getByText('Restore'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('Replace'));
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, AlertButton[]];
    act(() => buttons.find((b) => b.text === 'Replace')!.onPress!());

    act(() => jest.advanceTimersByTime(500));
    const db = persisted();
    expect(db.settings.profile?.age).toBe('31');
  });
});

describe('RecoveryCard resync', () => {
  const label = (l: string) => screen.getByLabelText(l);

  afterEach(() => {
    // Fake timers are global (test/setup.ts) and persist across tests in this
    // file — leaving the clock parked in 2026-08 would silently date every
    // other suite that runs after this one.
    jest.setSystemTime(new Date());
  });

  it('drops a stale sleep-hours value at midnight rather than saving it in as the new day\'s check-in', () => {
    // Day 1: a manual check-in already exists with sleepHours 5.5.
    const day1 = new Date(2026, 7, 9, 20, 0, 0);
    jest.setSystemTime(day1);
    seed({
      core: {
        schemaVersion: 3,
        profile: {},
        goals: {},
        schedule: {},
        bodyMetrics: [],
        lifeLoad: [],
        recovery: [
          { id: 'manual-recovery-2026-08-09', date: '2026-08-09', sleepHours: 5.5, source: 'manual', recordedAt: day1.getTime() },
        ],
        safety: {},
        whoopDaily: [],
        events: [],
        updatedAt: day1.getTime(),
      } as never,
    });

    renderSettings();
    expect(label('Sleep hours').props.value).toBe('5.5');

    // Cross midnight into day 2, with no check-in yet for the new day, and
    // force a re-render (an unrelated store update, same as any other write
    // this screen already makes) — the same thing that happens when Settings
    // has simply been sitting open across the rollover.
    const day2 = new Date(2026, 7, 10, 0, 30, 0);
    act(() => {
      jest.setSystemTime(day2);
    });
    fireEvent.changeText(label('Age'), '31');

    // The form must now show TODAY's (day 2's) empty check-in, not day 1's
    // stale 5.5 — otherwise Save would write 5.5 back in as day 2's reading.
    expect(label('Sleep hours').props.value).toBe('');

    fireEvent.press(screen.getByText('Save today’s context'));
    act(() => jest.advanceTimersByTime(500));

    const db = persisted();
    const savedForDay2 = db.core?.recovery.find((r) => r.date === '2026-08-10' && r.source === 'manual');
    expect(savedForDay2).toBeTruthy();
    expect(savedForDay2?.sleepHours).toBeUndefined();
    // Day 1's real reading must survive untouched.
    const day1Entry = db.core?.recovery.find((r) => r.date === '2026-08-09' && r.source === 'manual');
    expect(day1Entry?.sleepHours).toBe(5.5);
  });
});
