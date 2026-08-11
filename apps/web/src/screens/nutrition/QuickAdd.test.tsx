// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NutritionProvider } from '../../store/nutrition';
import { QuickAdd } from './QuickAdd';

describe('QuickAdd', () => {
  it('calls onDone after submitting a valid entry', () => {
    const onDone = vi.fn();
    render(
      <NutritionProvider>
        <QuickAdd onDone={onDone} onCancel={vi.fn()} />
      </NutritionProvider>,
    );
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Protein shake' } });
    fireEvent.change(screen.getByLabelText(/calories/i), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: /save|add/i }));
    expect(onDone).toHaveBeenCalled();
  });

  it('calls onCancel without writing an entry', () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(
      <NutritionProvider>
        <QuickAdd onDone={onDone} onCancel={onCancel} />
      </NutritionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
