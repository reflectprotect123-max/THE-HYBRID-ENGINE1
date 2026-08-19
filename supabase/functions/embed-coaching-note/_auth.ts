// supabase/functions/embed-coaching-note/_auth.ts
//
// Pure webhook-authentication logic, split out of index.ts for the same
// reason _requestShape.ts is: index.ts's top-level `jsr:` import and
// `Deno.serve` call make it unimportable under Node/Vitest, and this logic
// is exactly the kind that must be unit-tested (the 401 path especially).
// No `Deno.*` globals, no imports — plain functions over strings.

// Constant-time string comparison. `a === b` short-circuits at the first
// differing character, which leaks how much of a guessed secret matched
// through response timing. This walks the full length of the longer input
// every time and folds every character difference (and the length
// difference) into one accumulator, so the time taken does not depend on
// WHERE the inputs diverge. charCodeAt past the end returns NaN, which
// ToInt32s to 0 in the XOR — the length mismatch is already captured
// separately, so that is safe.
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// The whole auth decision, as data. Returns null when the caller may
// proceed, otherwise the status/body to answer with:
//
//   * secret unset or blank in the environment -> 500, and the body says so
//     WITHOUT echoing anything the caller sent. Fail closed: a deployment
//     that forgot EMBED_WEBHOOK_SECRET must reject every call rather than
//     silently running open, which is exactly the hole this function exists
//     to close.
//   * header missing or wrong -> 401, one fixed message for both, so a
//     probe cannot distinguish "no header" from "wrong secret".
export function webhookAuthFailure(
  providedSecret: string | null,
  expectedSecret: string | undefined,
): { status: number; body: string } | null {
  if (!expectedSecret) {
    return { status: 500, body: 'EMBED_WEBHOOK_SECRET not configured' };
  }
  if (providedSecret === null || !timingSafeEqualStrings(providedSecret, expectedSecret)) {
    return { status: 401, body: 'unauthorized' };
  }
  return null;
}

// Webhook payload validation, pure so the 400 path is testable too. The
// database webhook sends { record: { id, body, ... } }; anything else —
// including a well-formed JSON body with the wrong shape — is a 400, never
// a crash and never a service-role write driven by garbage.
export function parseWebhookRecord(payload: unknown): { id: string; body: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = (payload as { record?: unknown }).record;
  if (typeof record !== 'object' || record === null) return null;
  const { id, body } = record as { id?: unknown; body?: unknown };
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof body !== 'string' || body.length === 0) return null;
  return { id, body };
}
