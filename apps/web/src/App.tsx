import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { DbProvider } from './store/db';
import { NutritionProvider } from './store/nutrition';
import { RestProvider } from './store/rest';
import { SyncProvider } from './cloud/sync';
import { WhoopProvider } from './cloud/whoop';
import { Concept2Provider } from './cloud/concept2';
import { BottomNav } from './components/BottomNav';
import { NutritionBottomNav } from './components/NutritionBottomNav';
import { RestChip } from './components/RestChip';
import { SaveAlert } from './components/SaveAlert';
import { useDiscipline } from './discipline';
import { Home } from './screens/Home';
import { Training } from './screens/Training';
import { Library } from './screens/Library';
import { Conditioning } from './screens/Conditioning';
import { History } from './screens/History';
import { Progress } from './screens/Progress';
import { Exercise } from './screens/Exercise';
import { UpdateBanner } from './UpdateBanner';
import { Calendar } from './screens/Calendar';
import { Day } from './screens/Day';
import { Recap } from './screens/Recap';
import { Settings } from './screens/Settings';
import { FoodLog } from './screens/nutrition/FoodLog';
import { Food as NutritionFood } from './screens/nutrition/Food';
import { Weight as NutritionWeight } from './screens/nutrition/Weight';
import { Coach as NutritionCoach } from './screens/nutrition/Coach';
import { NutritionSettings } from './screens/nutrition/NutritionSettings';
import { ATHLETE_HOME, IS_SCOPED_BUILD, PRODUCT, PRODUCT_ID } from './product';
import { ManifestLink } from './manifestLink';
import { startServiceWorker } from './serviceWorker';

/*
 * Registered at module scope, above every route fork.
 *
 * It used to happen inside `UpdateBanner`, which lives in the athlete `Shell`
 * — so the coach workspace, the logger, the planner and the guided builder ran
 * with NO service worker. An installable PWA needs one, so the coach bench
 * could not be installed at all from the surface a coach actually uses.
 */
startServiceWorker();

/* The coach bench is its own chunk: athletes never download it, and a failure
   inside it can never take down an athlete route. */
const Coach = lazy(() => import('./coach'));

/*
 * The router replaces the vanilla `go(id)` screen system, where every screen
 * was a <section id="s-*"> toggled with a class and `renderScreen(id)`
 * dispatched by hand. Routes give back the browser's own back button, which
 * that system had to fake.
 *
 * The athlete web app no longer authors or logs sessions at all — that work
 * moved into the coach bench (see CLAUDE.md, "The athlete and the coach never
 * face each other"). The coach bench (`/coach/*`) stays outside the athlete
 * `Shell` because it is its own workspace, not athlete chrome.
 *
 * Provider order matters: Sync and WHOOP both read the DB, and Sync writes to
 * it on a pull, so DbProvider has to be outermost.
 */
export function App() {
  const Router = import.meta.env.VITE_SINGLE_HTML === 'true' ? HashRouter : BrowserRouter;
  const world = useDiscipline();
  return (
    <DbProvider>
      {/* Above the router: a failed write has to reach every screen, including
          the coach bench, which sits outside the shell. */}
      <SaveAlert />
      {/* A SIBLING store, not a branch of the engine one: it holds no
          EngineDB and DbProvider holds no NutritionDB. It sits above
          SyncProvider only because SyncProvider reads both. */}
      <NutritionProvider>
      <SyncProvider>
        <WhoopProvider>
          <Concept2Provider>
          <RestProvider>
            <Router>
              {/* Points the document at the athlete's manifest or the coach's,
                  by route, so the two can be installed as separate apps from
                  one origin. Renders nothing. */}
              <ManifestLink />
              {/*
                THE ATHLETE WEB APP IS PARKED (13 August 2026).

                The owner asked for it to stop being reachable in a browser,
                without deleting it: "hide it somewhere, and if we ever need
                it again we can pull it out." So every athlete route is gone
                from this tree and every address that is not `/coach` lands on
                the bench. Web is the coach workspace now; the athlete is the
                Android app.

                NOTHING WAS DELETED. `src/screens/` is untouched on disk and
                its colocated tests still run — that is deliberate, and it is
                what makes "pull it out" a real option rather than a hope: the
                screens are still proven to work, so restoring them is
                re-adding routes here, not repairing a year of drift.

                The honest cost, stated because it is the whole downside of
                parking rather than deleting: those screens are now dead code.
                Nothing imports them, `tsc` still checks them, and they will
                drift out of step with the packages beneath them. If the
                answer is ever "we are not bringing it back", delete them —
                git history keeps them either way, exactly as it kept
                `apps/mobile` between commit 8628060 and its return.

                `useDiscipline()`'s nutrition fork went with it. That world was
                athlete-facing too, and a `/nutrition/*` address that renders
                nothing is worse than one that goes somewhere.
              */}
              <Routes>
                <Route
                  path="/coach/*"
                  element={
                    <Suspense fallback={null}>
                      <Coach />
                    </Suspense>
                  }
                />
                {/* Every other address, including `/`, the old athlete paths
                    and the nutrition world. A parked app should not 404 — a
                    bookmarked `/training` belongs to someone who will now be
                    shown the surface that does exist. */}
                <Route path="*" element={<ToCoach />} />
              </Routes>
            </Router>
          </RestProvider>
          </Concept2Provider>
        </WhoopProvider>
      </SyncProvider>
      </NutritionProvider>
    </DbProvider>
  );
}

/**
 * The catch-all redirect, CARRYING THE QUERY STRING.
 *
 * `<Navigate to="/coach" replace />` drops the search params, and that is not
 * cosmetic here: both OAuth callbacks hand the browser back to
 * `/?integration=whoop&status=connected` (see `netlify/functions/
 * whoop-callback.mjs` and `concept2-callback.mjs`), and `Concept2Provider`
 * reads that outcome from `window.location.search` in a mount effect.
 *
 * The ordering is what makes it a real break rather than a theoretical one.
 * The provider sits ABOVE the router, so the router's redirect — its child —
 * runs its effect first. A plain `Navigate` therefore wipes the params before
 * the provider ever looks, and a cancelled or failed authorization becomes
 * indistinguishable from "never connected" — precisely the failure that
 * effect's own comment says it exists to prevent.
 *
 * Fixed here rather than in the two Netlify functions because those also
 * serve the NATIVE return URL, and the app's deep link must not change.
 */
function ToCoach() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: '/coach', search, hash }} replace />;
}

function Shell() {
  const world = useDiscipline();
  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-[560px] flex-col"
      data-product={PRODUCT_ID}
      aria-label={PRODUCT.name}
    >
      <main className="flex-1 px-2 pt-2 pb-[calc(72px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <RestChip />
      {/* Above the nav, below the rest chip: a running timer outranks a
          version notice. */}
      <UpdateBanner />
      {world === 'training' ? <BottomNav /> : <NutritionBottomNav />}
    </div>
  );
}
