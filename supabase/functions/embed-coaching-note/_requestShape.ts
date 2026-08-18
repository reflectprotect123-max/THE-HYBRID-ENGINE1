// supabase/functions/embed-coaching-note/_requestShape.ts
//
// Pure request-shaping logic, split into its own file (no `jsr:` imports,
// no `Deno.*` globals) so it can be unit-tested under a plain Node/Vitest
// runtime without needing a live Deno process. `index.ts` imports this
// rather than duplicating it. See index.test.ts and this task's report for
// why the split exists: `index.ts` itself cannot be imported under Vitest —
// its top-level `jsr:@supabase/supabase-js@2` import and `Deno.serve(...)`
// call both fail immediately outside a Deno runtime.
export function voyageRequestBody(text: string): { input: string[]; model: string } {
  return { input: [text], model: 'voyage-3' };
}
