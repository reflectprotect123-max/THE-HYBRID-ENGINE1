/* THE Hybrid System — shared Supabase config.
 *
 * ONE source of truth for the project URL + anon key, read by BOTH entities:
 *   - the athlete app  (index.html loads ./config.js before app.js)
 *   - the coach site   (coach/index.html loads ../config.js before js/config.js)
 * Previously each app carried its own copy, so a key rotation had to touch two
 * files and nothing enforced it.
 *
 * The anon key is public by design — it ships in the browser either way. Row
 * Level Security is the actual boundary; see supabase-schema.sql.
 *
 * Classic script (CSP-safe, no modules) and precached by the service worker, so
 * an offline cold start still finds it.
 */
window.HYBRID_SUPABASE = {
  url: 'https://orysjncrksmdfabpuftd.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yeXNqbmNya3NtZGZhYnB1ZnRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MTE4NzksImV4cCI6MjA5OTk4Nzg3OX0.GTMBfFtH5O6SikzHo75sXGIZoEhmuJ7TvXiACd7T078'
};
