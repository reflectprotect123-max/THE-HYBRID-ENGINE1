// supabase/functions/embed-coaching-note/deno.d.ts
//
// Minimal ambient globals for the Deno-specific surface index.ts uses
// (`Deno.serve`, `Deno.env.get`). Real Deno ships its own full lib types;
// this stub exists only so `tsc` — which never runs under Deno — can
// typecheck this file's own logic against the handful of Deno APIs it
// actually calls. Not a general-purpose Deno type shim.
declare namespace Deno {
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
  const env: { get(key: string): string | undefined };
}
