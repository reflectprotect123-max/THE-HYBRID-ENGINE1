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
                THE ATHLETE WEB APP IS PARKED ON THE DASHBOARD BUILD, AND LIVE
                ON A BRANDED ONE (15 August 2026).

                On 13 August the owner asked for the athlete app to stop being
                reachable in a browser, without deleting it: "hide it
                somewhere, and if we ever need it again we can pull it out."
                Every athlete route came out of this tree and every address
                that was not `/coach` landed on the bench.

                It has been pulled out — for ONE build, not for the site the
                owner was talking about. The unscoped dashboard build is what
                deploys to the coach domain, and it still parks everything:
                that half of the branch below is unchanged, ToCoach and all.
                What changed is that a BRANDED build (`VITE_HYBRID_PRODUCT=
                conditioning`, deployed to its own site) mounts the athlete app
                again, because the owner asked for a conditioning product a
                phone can open. The gate is `IS_SCOPED_BUILD` rather than a new
                flag on purpose — the branded/unscoped split already existed,
                already scopes the nav (`navTabs`), already sends `/coach` back
                to `/` (`CoachAccess`), and already namespaces sync
                (`PRODUCT_ID`). A second flag would have been a second answer
                to the same question.

                "STRENGTH IS LEFT ALONE, NOTHING TOUCHES THAT AT ALL" is the
                owner's instruction and it is enforced by the product scope
                rather than by this file: on a conditioning build `navTabs`
                yields Home / Cond / Library / Progress / Settings, with no
                Train tab, and `/training` is reachable only by typing it. The
                strength LOGGER is not restored — it was deleted on 13 August
                (`8c4a505`) and Android has since grown a newer round-major
                one, so bringing the old one back would ship two diverging
                logging surfaces. A conditioning session has its own runner
                (`screens/Conditioning.tsx`) and never needed it.

                This route tree is `8950284^`'s, restored verbatim rather than
                retyped. Retyping a known-good block from memory has introduced
                a real defect twice in this repository already.
              */}
              {IS_SCOPED_BUILD ? (
                <>
                  {/* Both worlds ship in every build and only one mounts at a
                      time — `world` is a runtime view preference
                      (`discipline.ts`), not a build profile. Each fork owns its
                      own <Routes>, so they can never collide on a path. */}
                  {world === 'training' && (
                    <Routes>
                      <Route
                        path="/coach/*"
                        element={
                          <Suspense fallback={null}>
                            <Coach />
                          </Suspense>
                        }
                      />
                      <Route element={<Shell />}>
                        {/* The bare address is the ATHLETE's on a branded
                            build, and `ATHLETE_HOME` is `/` here, so Home
                            renders directly rather than redirecting. */}
                        <Route path="/" element={<Home />} />
                        {/* Home's own path, identical on all three builds. */}
                        <Route path="/home" element={<Home />} />
                        <Route path="/training" element={<Training />} />
                        <Route path="/library" element={<Library />} />
                        <Route path="/conditioning" element={<Conditioning />} />
                        <Route path="/history" element={<History />} />
                        <Route path="/progress" element={<Progress />} />
                        <Route path="/exercise" element={<Exercise />} />
                        <Route path="/exercise/:name" element={<Exercise />} />
                        <Route path="/calendar" element={<Calendar />} />
                        <Route path="/day/:date" element={<Day />} />
                        <Route path="/recap/:id" element={<Recap />} />
                        <Route path="/nutrition" element={<FoodLog />} />
                        <Route path="/settings" element={<Settings />} />
                        {/* `ATHLETE_HOME`, not `/`. They agree on this build,
                            but naming it directly is still right: it is the
                            single source of truth for "send the athlete home"
                            and does not depend on what `/` happens to mean. */}
                        <Route path="*" element={<Navigate to={ATHLETE_HOME} replace />} />
                      </Route>
                    </Routes>
                  )}
                  {world === 'nutrition' && (
                    <Routes>
                      <Route element={<Shell />}>
                        <Route path="/nutrition/log" element={<FoodLog />} />
                        <Route path="/nutrition/food" element={<NutritionFood />} />
                        <Route path="/nutrition/weight" element={<NutritionWeight />} />
                        <Route path="/nutrition/coach" element={<NutritionCoach />} />
                        <Route path="/nutrition/settings" element={<NutritionSettings />} />
                        <Route path="*" element={<Navigate to="/nutrition/log" replace />} />
                      </Route>
                    </Routes>
                  )}
                </>
              ) : (
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
              )}
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
