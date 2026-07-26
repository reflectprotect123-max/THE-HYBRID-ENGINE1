/*
 * ONE source of truth for the Supabase project, read by the athlete app, the
 * coach app and the native app.
 *
 * This mirrors the role the repo-root `config.js` plays for the vanilla apps.
 * Each app used to carry its own copy, so a key rotation had to touch several
 * files and nothing enforced it — that is the mistake this package exists to
 * prevent, and adding a fourth copy would reintroduce it.
 *
 * The anon key is PUBLIC by design: it ships in the browser bundle either way.
 * Row Level Security is the actual boundary — see supabase-schema.sql. An
 * environment variable can still override it (per-environment projects, a
 * rotation, a local stack) without a code change.
 */
const env = (k: string): string | undefined => {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env?.[k];
  } catch {
    return undefined;
  }
};

export const SUPABASE = {
  url: env('VITE_SUPABASE_URL') || 'https://orysjncrksmdfabpuftd.supabase.co',
  anonKey:
    env('VITE_SUPABASE_ANON_KEY') ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yeXNqbmNya3NtZGZhYnB1ZnRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MTE4NzksImV4cCI6MjA5OTk4Nzg3OX0.GTMBfFtH5O6SikzHo75sXGIZoEhmuJ7TvXiACd7T078',
} as const;

/** Netlify functions that broker WHOOP's OAuth — same origin, no key needed. */
export const FN = {
  whoopConnect: '/.netlify/functions/whoop-connect',
  whoopSync: '/.netlify/functions/whoop-sync',
  integrationsStatus: '/.netlify/functions/integrations-status',
  integrationsDisconnect: '/.netlify/functions/integrations-disconnect',
} as const;
