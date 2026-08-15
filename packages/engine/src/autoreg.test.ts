import { loadPctOf, repFloorOf, repTopOf } from './autoreg';


describe('loadPctOf — a load authored as a percentage of e1RM', () => {
  it('reads a percentage written behind an @, with or without a rep target', () => {
    expect(loadPctOf('5 @80%')).toBe(80);
    expect(loadPctOf('@80%')).toBe(80);
    expect(loadPctOf('8-10 @72.5%')).toBe(72.5);
    expect(loadPctOf('5 @ 80 %')).toBe(80);
  });

  it('requires the @, so a bare number with a percent sign is not a load', () => {
    // THE guard. `repFloorOf` takes the first number it finds, so if "80%"
    // counted as a load target the same string would ALSO read as a rep floor
    // of eighty — every set scored a miss, and the weight walked into the floor.
    expect(loadPctOf('80%')).toBeNull();
    expect(loadPctOf('5')).toBeNull();
    expect(loadPctOf('')).toBeNull();
    expect(loadPctOf(undefined)).toBeNull();
  });

  it('refuses a percentage that can only be a typo', () => {
    expect(loadPctOf('@1000%')).toBeNull();
    expect(loadPctOf('@0%')).toBeNull();
  });

  it('keeps the load chunk out of the rep parsers', () => {
    // The reps are still the reps, and a target that is ONLY a load has no rep
    // floor at all — rather than a floor of eighty.
    expect(repFloorOf('5 @80%')).toBe(5);
    expect(repFloorOf('@80%')).toBe(0);
    expect(repTopOf('8-10 @80%')).toBe('10');
    expect(repTopOf('@80%')).toBe('');
    // Unchanged for everything that carries no load target.
    expect(repFloorOf('8-10')).toBe(8);
    expect(repTopOf('8-10')).toBe('10');
  });
});
