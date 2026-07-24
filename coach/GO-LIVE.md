# Coach website — go-live checklist

The coach website (Entity 2) is built and works **fully offline right now**
(open `coach/index.html`, author programs, everything saves to the browser).
Three one-time steps turn on cloud sync + publishing sessions to your phone.

## 1. Run the schema (2 min)
Supabase Dashboard → **SQL Editor → New query** → paste the whole of
`supabase-schema.sql` → **Run**. It's additive and safe to re-run — your existing
`app_state` table is untouched. This creates `coach_library`, `programs`,
`assignments`, the coach↔athlete link, and the RLS policies.

## 2. Create the coach Netlify site (5 min)
Netlify → **Add new site → Import an existing project** → pick this same GitHub repo →
set **Base directory = `coach`** → Deploy. (The base directory is what makes Netlify
honour `coach/netlify.toml` and serve only the coach folder.)

Note the URL it gives you (e.g. `https://YOUR-COACH-SITE.netlify.app`), then:
- In **`_redirects`** (repo root) change the `/coach/*` target host to that URL and
  commit — so the athlete site forwards `/coach` to the coach site.
- Supabase → **Authentication → URL Configuration** → add the coach site URL to
  **Site URL** and **Redirect URLs** (so password reset / email links work there too).

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
