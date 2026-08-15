-- ============================================================================
-- ARC — a security-definer function must be able to SEE pgcrypto
--
-- THE FAILURE, in production, on the first invite ever attempted:
--
--     function gen_random_bytes(integer) does not exist (42883)
--
-- `create_coach_invite` mints its code with `gen_random_bytes(16)` and is
-- declared `security definer set search_path = public`. Pinning search_path on
-- a definer function is correct and deliberate — it is what stops a caller
-- shadowing a table or function the body relies on — but `public` alone is too
-- narrow here, because pgcrypto does not live there on Supabase.
--
-- WHY EVERY CHECK PASSED WHILE PRODUCTION FAILED. This is the part worth
-- reading, because it will happen again with a different extension.
--
-- `20260813` already runs `create extension if not exists pgcrypto`. On a bare
-- local Postgres — which is exactly what `checks/migrations-apply.mjs` spins
-- up — that installs pgcrypto into `public`, so `search_path = public` finds
-- `gen_random_bytes` and every assertion passes. On Supabase the extension is
-- ALREADY installed, into the `extensions` schema, so `if not exists` silently
-- does nothing and the function cannot see it. Same migration, same SQL, two
-- outcomes decided by where somebody else installed an extension.
--
-- So the check was not decorative and was not wrong. It faithfully tested an
-- environment that differs from production in one detail nobody had written
-- down. It is written down now.
--
-- THE FIX: widen the pinned path to `public, extensions` rather than
-- schema-qualifying the call.
--
--   * `extensions.gen_random_bytes(...)` would break the local Postgres the
--     check runs against, where there is no `extensions` schema — trading a
--     production failure for a CI one.
--   * Dropping `set search_path` entirely would fix it and remove the
--     protection the pin exists for. Never do that to a definer function.
--
-- `public, extensions` resolves in both: local finds it in public, Supabase
-- finds it in extensions, and the pin still excludes anything a caller might
-- put in front.
--
-- Only `create_coach_invite` is altered. It is the one function in this schema
-- that calls into pgcrypto — every other definer function here touches tables
-- in `public` alone, and widening their paths without cause would spend the
-- protection for nothing.
-- ============================================================================

alter function public.create_coach_invite(uuid, integer)
  set search_path = public, extensions;

comment on function public.create_coach_invite(uuid, integer) is
  'Mint an invite code for an organisation the caller owns or coaches. '
  'search_path is public, extensions — NOT public alone: gen_random_bytes '
  'comes from pgcrypto, which Supabase installs into the extensions schema '
  'while a bare local Postgres installs it into public. Narrowing this back '
  'to public passes every local check and fails on the first real invite.';

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   alter function public.create_coach_invite(uuid, integer)
--     set search_path = public;
--
-- Which restores the production failure above. There is no reason to run it.
-- ---------------------------------------------------------------------------
