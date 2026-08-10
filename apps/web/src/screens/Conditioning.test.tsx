// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { LS_KEY, type EngineDB } from '@hybrid/engine';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DbProvider } from '../store/db';
import { Conditioning } from './Conditioning';

/*
 * connectStrap used to fail silently on every branch — no support, a
 * cancelled/empty device picker, or a gatt.connect() failure all looked
 * identical to the athlete: the run just banked no zone time. This covers
 * the no-support branch, the one reachable deterministically in jsdom
 * (Web Bluetooth's own picker UI cannot be driven from a test).
 */

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
