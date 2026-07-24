/* Coach Supabase client.
 * URL + anon key come from the shared ../config.js (same values the athlete app
 * uses — one source, so a key rotation touches one file). RLS is the real
 * boundary; the anon key is public by design. Classic script, CSP-safe. */
(function () {
  'use strict';
  var cfg = window.HYBRID_SUPABASE || {};
  window.COACH_SB = (window.supabase && cfg.url && cfg.anonKey)
    ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;
})();
