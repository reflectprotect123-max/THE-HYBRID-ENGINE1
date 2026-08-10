// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CoachSection } from './CoachSection';

describe('CoachSection', () => {
  it('renders collapsed by default, hiding its content', () => {
    render(
      <CoachSection title="Resolved week">
        <p>Week detail</p>
      </CoachSection>,
    );
    expect(screen.getByText('Resolved week')).toBeInTheDocument();
    expect(screen.getByText('Week detail')).not.toBeVisible();
  });

  it('expands its content when the summary row is clicked', () => {
    render(
      <CoachSection title="Resolved week">
        <p>Week detail</p>
      </CoachSection>,
    );
    fireEvent.click(screen.getByText('Resolved week'));
    expect(screen.getByText('Week detail')).toBeVisible();
  });

  it('renders open by default when defaultOpen is true', () => {
    render(
      <CoachSection title="Resolved week" defaultOpen>
        <p>Week detail</p>
      </CoachSection>,
    );
    expect(screen.getByText('Week detail')).toBeVisible();
  });

  it('shows the count badge when provided', () => {
    render(
      <CoachSection title="Coach queue" count={3}>
        <p>Items</p>
      </CoachSection>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
