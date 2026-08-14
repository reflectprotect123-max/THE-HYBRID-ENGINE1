/*
 * Opening the coach bench in a real browser.
 *
 * `CoachAccess` fails closed in a production build: with no
 * `VITE_COACH_USER_IDS` and `import.meta.env.DEV` false, `coachAllowed` denies
 * everyone, so the shipped `apps/web/dist` cannot show `/coach` at all. Every
 * browser check that wants the bench therefore needs the same two things — a
 * SECOND bundle whose allowlist names one throwaway id, and a stored Supabase
 * session for that id handed to the page before its first navigation.
 *
 * That recipe lived twice (checks/react-smoke.mjs invented it for
 * `/coach/legacy`, checks/screens.mjs copied it for the shots) and was about to
 * live a third time when `checks/web-touch.mjs` was repointed at the bench on
 * 14 August 2026. It lives here instead. Two copies of a login recipe drift;
 * the third one is where the drift becomes a check that silently measures a
 * sign-in screen — which is exactly the rot this repair was cleaning up.
 *
 * `dist-coach` is gitignored, never deployed, and `COACH_UID` is a made-up
 * UUID no real Supabase account can hold.
 */
import { execFileSync } from 'node:child_process';

export const COACH_UID = '00000000-0000-4000-8000-000000000002';
export const COACH_DIR = 'apps/web/dist-coach';

/** Build the coach-enabled bundle into `apps/web/dist-coach`. Synchronous and
 *  loud (`stdio: 'inherit'`) — a silent two-minute pause reads as a hang. */
export function buildCoachBundle(root, uid = COACH_UID) {
  execFileSync(
    'pnpm',
    ['--filter', '@hybrid/web', 'exec', 'vite', 'build', '--outDir', 'dist-coach', '--emptyOutDir'],
    { cwd: root, env: { ...process.env, VITE_COACH_USER_IDS: uid }, stdio: 'inherit' },
  );
}

/**
 * Make one page a signed-in, allowlisted coach with a populated local store.
 *
 * Call before the first `goto`. Does two things:
 *
 * 1. Intercepts every Supabase request. The bench must render from local state
 *    alone, but a blanket `{}` for everything breaks it: `listClients()` awaits
 *    `auth.getUser()` then queries `coach_athlete_assignments` expecting a JSON
 *    ARRAY back, and a plain `{}` makes `rows.map` throw — which rejects the
 *    call, leaves `selectedClient` null forever, and parks
 *    `CoachCommandCenter` on "Loading coach workspace…". Two shapes fixes it:
 *    the auth check gets a user object, and every REST query gets `[]`, which
 *    is a true answer anyway (this throwaway id really has no roster) and
 *    resolves to just `ENGINE_LOCAL`, the signed-in coach's own entry
 *    (`cloud/coach-repository.ts`) — exactly like a fresh account.
 *
 * 2. Seeds the Supabase session token and the two local stores. The stage-1
 *    pillars are gated `ClientDetailGate` WITHOUT `layer3Ready`, so they only
 *    ever read the SIGNED-IN account's own `hybrid-engine-v1` /
 *    `hybrid-nutrition-v1` — seeding them is what gives the bench real numbers
 *    to draw instead of empty states.
 *
 *    `addInitScript` runs before EVERY document load, not just the first, so
 *    both stores are written only if absent: seeding unconditionally would
 *    reset them on every navigation, which is what a lost session looks like.
 *    The two are guarded independently because they are separate stores — one
 *    guard would make a nutrition-only reset look like a training reset.
 */
export async function signInCoach(page, seed, uid = COACH_UID) {
  await page.route('**/*.supabase.co/**', (r) => {
    const url = r.request().url();
    if (url.includes('/auth/v1/user')) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: uid, aud: 'authenticated', role: 'authenticated', email: 'coach@example.com',
          app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
        }),
      });
    }
    if (url.includes('/rest/v1/')) {
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.addInitScript(
    (s) => {
      const expires = Math.floor(Date.now() / 1000) + 86400;
      localStorage.setItem(
        'sb-orysjncrksmdfabpuftd-auth-token',
        JSON.stringify({
          access_token: 'fake.' + btoa(JSON.stringify({ sub: s.uid, exp: expires })) + '.sig',
          token_type: 'bearer',
          expires_in: 86400,
          expires_at: expires,
          refresh_token: 'fake-refresh',
          user: {
            id: s.uid, aud: 'authenticated', role: 'authenticated', email: 'coach@example.com',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
          },
        }),
      );
      if (!localStorage.getItem('hybrid-engine-v1')) {
        localStorage.setItem('hybrid-engine-v1', JSON.stringify(s.db));
      }
      if (!localStorage.getItem('hybrid-nutrition-v1')) {
        localStorage.setItem('hybrid-nutrition-v1', JSON.stringify(s.nutrition));
      }
    },
    { uid, db: seed.db, nutrition: seed.nutrition },
  );
}
