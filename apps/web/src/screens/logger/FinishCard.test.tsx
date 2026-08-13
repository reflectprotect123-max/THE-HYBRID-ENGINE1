// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FinishCard } from './FinishCard';

describe('FinishCard — numbers come from the view, not recomputed', () => {
  it('renders exactly the blocks and sets-logged counts it was given', () => {
    render(<FinishCard blocks={4} setsLogged={17} bestE1rm={null} />);
    expect(document.querySelector('[data-parity="fstat-blocks"]')).toHaveTextContent('4');
    expect(document.querySelector('[data-parity="fstat-sets"]')).toHaveTextContent('17');
  });

  it('rounds a given best e1RM rather than deriving one itself', () => {
    render(<FinishCard blocks={1} setsLogged={1} bestE1rm={132.6667} />);
    expect(document.querySelector('[data-parity="fstat-e1rm"]')).toHaveTextContent('133 kg');
  });

  it('falls back to — when no e1RM was handed down', () => {
    render(<FinishCard blocks={1} setsLogged={1} bestE1rm={null} />);
    expect(document.querySelector('[data-parity="fstat-e1rm"]')).toHaveTextContent('—');
  });
});

describe('FinishCard — the comment box', () => {
  it('is local state, not wired to any dispatch', () => {
    render(<FinishCard blocks={1} setsLogged={1} bestE1rm={null} />);
    const box = screen.getByLabelText('Session comments');
    fireEvent.change(box, { target: { value: 'felt strong today' } });
    expect(box).toHaveValue('felt strong today');
  });
});
