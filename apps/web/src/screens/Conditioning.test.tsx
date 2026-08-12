// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DbProvider } from '../store/db';
import { Conditioning } from './Conditioning';

/*
 * connectStrap used to fail silently on every branch — no support, a
 * cancelled/empty device picker, or a gatt.connect() failure all looked
 * identical to the athlete: the run just banked no zone time. This covers
 * the no-support branch, the one reachable deterministically in jsdom
 * (Web Bluetooth's own picker UI cannot be driven from a test).
 */

/*
 * The run lives at module scope on purpose — it outlives the screen so a
 * mid-run hop to Home cannot throw it away. It therefore also outlives a TEST,
 * and the next one opens on a live run with no Start button. Finishing it is
 * what the athlete does; under MIN_LOGGABLE_SEC it discards rather than banks,
 * which is exactly what is wanted between cases.
 */
afterEach(() => {
  const [finish] = screen.queryAllByRole('button', { name: 'Finish' });
  if (finish) fireEvent.click(finish);
  cleanup();
});

function renderConditioning() {
  localStorage.setItem(LS_KEY, JSON.stringify({ workouts: [], sessions: [], settings: {} } as EngineDB));
  return render(
    <DbProvider>
      <MemoryRouter initialEntries={['/conditioning']}>
        <Conditioning />
      </MemoryRouter>
    </DbProvider>,
  );
}

describe('Conditioning strap connection state', () => {
  const originalBluetooth = (navigator as unknown as { bluetooth?: unknown }).bluetooth;

  beforeEach(() => {
    localStorage.clear();
    delete (navigator as unknown as { bluetooth?: unknown }).bluetooth;
  });

  afterEach(() => {
    (navigator as unknown as { bluetooth?: unknown }).bluetooth = originalBluetooth;
  });

  it('shows an error state when the browser has no Bluetooth support', async () => {
    renderConditioning();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(screen.getByText('This browser does not support Bluetooth.')).toBeInTheDocument();
    });
  });
});

/*
 * GPS reached the athlete only after `createGeoTracker` had sat unimported for
 * a week — built, unit-tested, and called by nothing, which is precisely what a
 * green suite cannot tell you. These assert the WIRING: that starting a run
 * opens a watch, and that the fixes it yields arrive in the banked record.
 */
describe('Conditioning GPS tracking', () => {
  const originalGeo = navigator.geolocation;

  const fakeGeolocation = (fixes: { lat: number; lon: number }[]) => {
    let watching = false;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (onOk: (p: GeolocationPosition) => void) => {
          watching = true;
          fixes.forEach((f, i) =>
            onOk({
              coords: { latitude: f.lat, longitude: f.lon } as GeolocationCoordinates,
              // one fix a second, so the drift filter sees a plausible speed
              timestamp: Date.now() + i * 1000,
            } as GeolocationPosition),
          );
          return 1;
        },
        clearWatch: () => {
          watching = false;
        },
      },
    });
    return { isWatching: () => watching };
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: originalGeo });
  });

  it('opens a GPS watch when a run starts', () => {
    const geo = fakeGeolocation([{ lat: 51.5, lon: -0.12 }]);
    renderConditioning();
    expect(geo.isWatching()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(geo.isWatching()).toBe(true);
  });

  it('shows the moving distance, and says the screen has to stay on', async () => {
    /* Ten fixes, ~5.5m and a second apart — about 5.5 m/s, a real running
       pace. Getting this wrong is instructive: an earlier version of this test
       jumped 111m per second and banked nothing at all, because
       MAX_PLAUSIBLE_MPS threw every hop away as drift. The filter was right. */
    fakeGeolocation(
      Array.from({ length: 10 }, (_, i) => ({ lat: 51.5 + i * 0.00005, lon: -0.12 })),
    );
    renderConditioning();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(screen.getByText(/km gps/)).toBeInTheDocument();
    });
    expect(screen.getByText(/GPS stops when it sleeps/)).toBeInTheDocument();
  });

  it('tells the athlete when the fix cannot be had, rather than banking silence', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    renderConditioning();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(screen.getByText('This browser does not support location tracking.')).toBeInTheDocument();
    });
  });
});
