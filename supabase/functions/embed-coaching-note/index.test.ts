// supabase/functions/embed-coaching-note/index.test.ts
//
// Unit test for the pure request-shaping logic only — the live Voyage HTTP
// call is intentionally NOT exercised here (no live network calls in
// pnpm run verify / CI, per repo convention).
//
// NOT YET COLLECTED BY `pnpm run test`: see this task's report
// (.superpowers/sdd/2026-08-18-strength-phase-f-knowledge-base/task-2-report.md)
// for why, and Task 6 for the fix.
//
// Imports from ./_requestShape, not ./index: index.ts has a top-level
// `jsr:@supabase/supabase-js@2` import and calls `Deno.serve(...)` at
// module load time, so it cannot be imported under Node/Vitest at all —
// confirmed by actually running this test against `./index` and watching
// it fail with "Cannot find package 'jsr:@supabase/supabase-js@2'" before
// splitting the pure function out.
import { describe, it, expect } from 'vitest';
import { voyageRequestBody } from './_requestShape';

describe('voyageRequestBody', () => {
  it('wraps the text in a single-element input array with the voyage-3 model', () => {
    expect(voyageRequestBody('deload when RPE climbs 3 sessions running')).toEqual({
      input: ['deload when RPE climbs 3 sessions running'],
      model: 'voyage-3',
    });
  });
});
