// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Food } from './Food';

describe('Food composer screen', () => {
  it('defaults to the search sub-view', () => {
    render(<Food />);
    expect(screen.getByRole('tab', { name: /search/i, selected: true })).toBeInTheDocument();
  });

  it('switches to the custom-food sub-view on tap', () => {
    render(<Food />);
    fireEvent.click(screen.getByRole('tab', { name: /custom food/i }));
    expect(screen.getByRole('tab', { name: /custom food/i, selected: true })).toBeInTheDocument();
  });

  it('lists every pane mobile\'s Food composer switches between', () => {
    render(<Food />);
    for (const name of [/search/i, /quick add/i, /custom food/i, /recipe/i, /scan barcode/i, /read label/i]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });
});
