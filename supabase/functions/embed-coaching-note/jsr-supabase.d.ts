// supabase/functions/embed-coaching-note/jsr-supabase.d.ts
//
// `jsr:@supabase/supabase-js@2` is a Deno-registry specifier — tsc has no
// resolution scheme for `jsr:` at all, with or without a real npm dependency
// installed, so this file's import is otherwise "Cannot find module" no
// matter what compiler options are set. This ambient module declaration
// gives tsc just enough of the shape index.ts actually calls
// (`createClient(url, key).from(table).update(values).eq(column, value)`)
// so the REST of index.ts's own logic — the part actually worth
// typechecking here — is checked. It intentionally does not attempt to
// mirror @supabase/supabase-js's real, much larger API surface.
declare module 'jsr:@supabase/supabase-js@2' {
  export interface SupabaseQueryBuilder {
    update(values: Record<string, unknown>): { eq(column: string, value: unknown): Promise<{ error: unknown }> };
  }
  export interface SupabaseClientLike {
    from(table: string): SupabaseQueryBuilder;
  }
  export function createClient(url: string, key: string): SupabaseClientLike;
}
