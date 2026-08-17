// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlockEditor, newCondValue, type BlockValue } from './BlockEditor';

/*
 * The coach asked for two things on 12 August 2026: a real conditioning block,
 * and a mixed-modal one — "just a free run of heart rate start to finish, so
 * rest optional rest timer". Both are conditioning categories, and neither
 * holds exercises and sets.
 */

function renderBlock(block: BlockValue, onChange = vi.fn()) {
  render(<BlockEditor block={block} index={0} onChange={onChange} onRemove={vi.fn()} />);
  return onChange;
}

const conditioning = (category: string): BlockValue => ({
  id: 'b0',
  category,
  conditioning: newCondValue(category),
});

describe('a conditioning block', () => {
  it('prescribes format, modality, effort and duration — not exercises and sets', () => {
    renderBlock(conditioning('Conditioning'));
    expect(screen.getByLabelText('Conditioning format')).toBeInTheDocument();
    expect(screen.getByLabelText('Modality')).toBeInTheDocument();
    expect(screen.getByLabelText('Effort')).toBeInTheDocument();
    expect(screen.getByLabelText('Minutes')).toBeInTheDocument();
    expect(screen.queryByText('+ Add exercise from library')).not.toBeInTheDocument();
  });

  it('reports the heart-rate zone rather than offering it, because the effort decides it', () => {
    renderBlock(conditioning('Conditioning'));
    // Default effort is easy → the low zone, per CON_EFFORTS.
    expect(screen.getByText(/heart-rate zone low/i)).toBeInTheDocument();
  });

  it('moves the zone when the effort moves', () => {
    const onChange = renderBlock(conditioning('Conditioning'));
    act(() => {
      fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'hard' } });
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      conditioning: expect.objectContaining({ effort: 'hard' }),
    }));
  });
});

describe('a mixed-modal block', () => {
  it('is free format with no single modality, and says so instead of asking', () => {
    renderBlock(conditioning('Mixed modal'));
    expect(screen.queryByLabelText('Conditioning format')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Modality')).not.toBeInTheDocument();
    expect(screen.getByText(/heart rate recorded start to finish/i)).toBeInTheDocument();
  });

  it('prescribes no rest, and says the rest timer is the athlete’s to use', () => {
    renderBlock(conditioning('Mixed modal'));
    expect(screen.getByText(/no prescribed\s+rest/i)).toBeInTheDocument();
    expect(screen.getByText(/rest timer is there if the athlete wants it/i)).toBeInTheDocument();
  });

  it('takes a target duration from the coach', () => {
    const onChange = renderBlock(conditioning('Mixed modal'));
    const minutes = screen.getByLabelText('Target minutes');
    expect(minutes).toHaveValue(30);
    act(() => {
      fireEvent.change(minutes, { target: { value: '45' } });
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      conditioning: expect.objectContaining({ minutes: '45' }),
    }));
  });

  it('defaults to free format, which is what mixed modal means', () => {
    expect(newCondValue('Mixed modal')).toEqual({
      fmt: 'free', modality: '', effort: 'medium', minutes: '30', targetDistanceM: '',
    });
  });
});

describe('switching a block’s category', () => {
  it('seeds the prescription when a note block becomes conditioning', () => {
    const onChange = renderBlock({ id: 'b0', category: 'Warm-up' });
    act(() => {
      fireEvent.change(screen.getByLabelText('Block kind'), { target: { value: 'Conditioning' } });
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      category: 'Conditioning',
      conditioning: newCondValue('Conditioning'),
    }));
  });

  it('drops the prescription when a conditioning block becomes a note block, rather than hiding it', () => {
    // A stale prescription on a note block would round-trip a block the
    // coach can no longer see or edit.
    const onChange = renderBlock(conditioning('Conditioning'));
    act(() => {
      fireEvent.change(screen.getByLabelText('Block kind'), { target: { value: 'Warm-up' } });
    });
    const next = onChange.mock.calls[0][0] as BlockValue;
    expect(next.category).toBe('Warm-up');
    expect(next.conditioning).toBeUndefined();
  });
});
