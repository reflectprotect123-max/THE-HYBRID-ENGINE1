import { describe, expect, it } from 'vitest';
import { resolveSession } from '../src/index';
import { fixtures } from './fixtures/index';

describe('golden fixtures', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const result = resolveSession(fixture.input);

      expect(result.state).toBe(fixture.expected.state);
      expect(result.confidence).toBe(fixture.expected.confidence);
      expect(result.autoApplyAllowed).toBe(fixture.expected.autoApplyAllowed);

      expect([...result.reasonCodes].sort()).toEqual([...fixture.expected.reasonCodes].sort());
      expect([...result.operations.map((o) => o.type)].sort()).toEqual(
        [...fixture.expected.operationTypes].sort(),
      );

      if (fixture.expected.abstentionReason !== undefined) {
        expect(result.abstentionReason).toBe(fixture.expected.abstentionReason);
      }
    });
  }
});
