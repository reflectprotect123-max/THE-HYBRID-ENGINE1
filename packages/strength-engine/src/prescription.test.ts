import { describe, it, expect } from 'vitest';
import { encodeTempo, decodeTempo } from './prescription';

describe('tempo codec', () => {
  it('encodes 3-0-1-0 tempo to 3010', () => {
    expect(encodeTempo({ eccentric: 3, pauseBottom: 0, concentric: 1, pauseTop: 0 })).toBe(3010);
  });

  it('round-trips through decode', () => {
    const t = { eccentric: 4, pauseBottom: 2, concentric: 1, pauseTop: 3 };
    expect(decodeTempo(encodeTempo(t))).toEqual(t);
  });

  it('decodes 0 as all-zero tempo', () => {
    expect(decodeTempo(0)).toEqual({ eccentric: 0, pauseBottom: 0, concentric: 0, pauseTop: 0 });
  });
});
