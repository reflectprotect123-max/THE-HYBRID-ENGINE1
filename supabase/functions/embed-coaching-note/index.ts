// supabase/functions/embed-coaching-note/index.ts
//
// Phase F, Slice 36: computes an embedding for a coaching_note row and
// writes it back. This is the first Edge Function in this repo — there was
// no existing supabase/functions/* convention to match, so this follows
// Supabase's standard Deno Edge Function shape.
//
// AUTH MODEL (19 August 2026): verify_jwt=false + shared webhook secret.
// This function is called by a DATABASE WEBHOOK, and a webhook cannot carry
// a user's JWT — so JWT verification is deliberately not the gate (there is
// no supabase/config.toml in this repo to declare it in; deploy with
// --no-verify-jwt and set the EMBED_WEBHOOK_SECRET function secret, sending
// the same value as an `x-webhook-secret` header from the webhook
// definition). The gate is the shared-secret check below, which runs BEFORE
// the request body is even read: this function holds the service role key,
// and before this check existed ANY caller who found the URL could drive
// service-role writes into coaching_note with a caller-supplied id.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { voyageRequestBody } from './_requestShape.ts';
import { parseWebhookRecord, webhookAuthFailure } from './_auth.ts';

// Voyage AI's voyage-3 embedding model — Anthropic's own recommended
// embedding provider, since Claude's API does not serve embeddings itself.
// Async by design: a coach's note is saved and usable in the UI immediately
// (Slice 35, a later build); the embedding — and therefore retrievability —
// lands a few seconds later via this function.
//
// The pure logic (request shaping, webhook auth, payload validation) lives
// in ./_requestShape.ts and ./_auth.ts, not here, so it can be unit-tested
// without a live Deno runtime or network call — this file's own top-level
// `jsr:` import and `Deno.serve` call make it unimportable outside Deno.

async function embedText(body: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(voyageRequestBody(body)),
  });
  if (!res.ok) throw new Error(`Voyage embed failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data[0].embedding;
}

Deno.serve(async (req) => {
  // Auth first, before any body parsing or any work at all. The comparison
  // inside is constant-time (see _auth.ts), and the failure answers are
  // fixed strings that echo nothing the caller sent.
  const denied = webhookAuthFailure(
    req.headers.get('x-webhook-secret'),
    Deno.env.get('EMBED_WEBHOOK_SECRET'),
  );
  if (denied) return new Response(denied.body, { status: denied.status });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }
  const record = parseWebhookRecord(payload); // { record: { id, body } } — webhook payload shape
  if (!record) return new Response('expected { record: { id, body } }', { status: 400 });

  const voyageKey = Deno.env.get('VOYAGE_API_KEY');
  if (!voyageKey) return new Response('VOYAGE_API_KEY not configured', { status: 500 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const embedding = await embedText(record.body, voyageKey);

  const { error } = await supabase
    .from('coaching_note')
    .update({ embedding })
    .eq('id', record.id);

  if (error) return new Response(JSON.stringify(error), { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
