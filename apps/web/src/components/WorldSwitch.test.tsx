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
 * so unlike mobile's three-way chooser this is a single button back to
 * training, the only place it is rendered from.
 */

beforeEach(() => {
  localStorage.clear();
  __resetDisciplineForTest();
});

describe('WorldSwitch', () => {
  it('calls setDiscipline("training") when clicked', () => {
    setDiscipline('nutrition');
    render(<WorldSwitch />);

    fireEvent.click(screen.getByRole('button', { name: /training/i }));

    expect(currentDiscipline()).toBe('training');
  });
});
