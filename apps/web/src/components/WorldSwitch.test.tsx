// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('WorldSwitch', () => {
  it('calls setDiscipline("training") when the current world is nutrition', () => {
    setDiscipline('nutrition');
    render(<WorldSwitch />);

    fireEvent.click(screen.getByRole('button', { name: /training/i }));

    expect(currentDiscipline()).toBe('training');
  });

  it('calls setDiscipline("nutrition") when the current world is training', () => {
    setDiscipline('training');
    render(<WorldSwitch />);

    fireEvent.click(screen.getByRole('button', { name: /nutrition/i }));

    expect(currentDiscipline()).toBe('nutrition');
  });
});
