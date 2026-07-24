# Coach website — go-live checklist

The coach website (Entity 2) is built and works **fully offline right now**
(open `coach/index.html`, author programs, everything saves to the browser).
Three one-time steps turn on cloud sync + publishing sessions to your phone.

## 1. Run the schema (2 min)
Supabase Dashboard → **SQL Editor → New query** → paste the whole of
`supabase-schema.sql` → **Run**. It's additive and safe to re-run — your existing
`app_state` table is untouched. This creates `coach_library`, `programs`,
`assignments`, the coach↔athlete link, and the RLS policies.

## 2. Open the coach site (0 min — it's already deployed)
The coach site is served right off your existing site at **`/coach/`** — no second
Netlify site needed. Once `main` deploys, open:

    https://thehybridengine1.netlify.app/coach/

(The service worker bypasses `/coach`, and the coach files are real files that win
over the app's SPA fallback, so the athlete shell never intercepts it.)

## 3. Sign in on both ends
Open the coach site → account button (top-right) → **sign in with the same email +
password as your phone app**. Your library now syncs to the cloud.

## Then: author → assign → phone
1. Build a session in the coach editor.
2. **Assign to phone** → pick a date → **Publish**.
3. Open the phone app (or bring it to the foreground) → the session appears on that
   date's calendar, ready to start and log. Logged results stay yours and sync back
   through your normal cloud sync.

## What's deliberately not here yet (post-v1)
- Coaching **other** athletes through the UI (the schema + invite RPC ship, the
  multi-athlete UI does not) — today it's built for self-coaching.
- Realtime push (the phone pulls on sync + when it comes to the foreground).
- The rail sections other than Library (Coach Home / Athletes / Teams / Analytics /
  Gym Tools) are placeholders.
