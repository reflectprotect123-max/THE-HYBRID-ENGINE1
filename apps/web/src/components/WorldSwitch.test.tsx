// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { __resetDisciplineForTest, currentDiscipline, setDiscipline } from '../discipline';
import { WorldSwitch } from './WorldSwitch';

/*
 * Web's only cross-world door, ported from mobile's `WorldSwitch`
 * (`apps/mobile/src/ui/WorldSwitch.tsx`) — but web's `WorldId` collapses to
 * two values (`training` | `nutrition`, see `apps/web/src/discipline.ts`),
 * so unlike mobile's three-way chooser this is a single button. It is still
 * the SAME component in both directions: it reads the current world and
 * targets whichever one it isn't, which is why it is rendered from both
 * `Settings` (training) and `NutritionSettings` (nutrition).
 */

beforeEach(() => {
  localStorage.clear();
  __resetDisciplineForTest();
});

/* The switch navigates as well as flipping the world, so it needs a router and
   a way to read where it ended up. `at` is the address after the click. */
function mount(from: string) {
  const seen = { at: from };
  function Probe() {
    seen.at = useLocation().pathname;
    return <WorldSwitch />;
  }
  render(
    <MemoryRouter initialEntries={[from]}>
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  return seen;
}

describe('WorldSwitch', () => {
  it('calls setDiscipline("training") when the current world is nutrition', () => {
    setDiscipline('nutrition');
    mount('/nutrition/settings');

    fireEvent.click(screen.getByRole('button', { name: /training/i }));

    expect(currentDiscipline()).toBe('training');
  });

  it('calls setDiscipline("nutrition") when the current world is training', () => {
    setDiscipline('training');
    mount('/settings');

    fireEvent.click(screen.getByRole('button', { name: /nutrition/i }));

    expect(currentDiscipline()).toBe('nutrition');
  });

  /*
   * The regression this exists for: flipping the world alone left the athlete on
   * an address the destination tree does not have, so it fell to that tree's
   * catch-all. Going back to training from `/nutrition/settings` therefore
   * landed on `/` — which is the COACH BENCH on the unscoped hybrid build.
   * Asserting the destination, not just the flag, is the whole point.
   */
  it('lands on a real training address when leaving the nutrition world', () => {
    setDiscipline('nutrition');
    const seen = mount('/nutrition/settings');

    fireEvent.click(screen.getByRole('button', { name: /training/i }));

    expect(seen.at).not.toBe('/nutrition/settings');
    // '/home' under test: IS_SCOPED_BUILD is false when VITE_HYBRID_PRODUCT is unset.
    expect(seen.at).toBe('/home');
  });

  it('lands on the nutrition log when entering the nutrition world', () => {
    setDiscipline('training');
    const seen = mount('/settings');

    fireEvent.click(screen.getByRole('button', { name: /nutrition/i }));

    expect(seen.at).toBe('/nutrition/log');
  });
});
