import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { DbProvider } from './store/db';
import { NutritionProvider } from './store/nutrition';
import { RestProvider } from './store/rest';
import { SetTimerProvider } from './store/setTimer';
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
import { Logger } from './screens/Logger';
import { Library } from './screens/Library';
import { Planner } from './screens/Planner';
import { Conditioning } from './screens/Conditioning';
import { History } from './screens/History';
import { Progress } from './screens/Progress';
import { Exercise } from './screens/Exercise';
import { GuidedBuilder } from './screens/guided/GuidedBuilder';
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

/* The coach bench is its own chunk: athletes never download it, and a failure
   inside it can never take down an athlete route. */
const Coach = lazy(() => import('./coach'));

/*
 * The router replaces the vanilla `go(id)` screen system, where every screen
 * was a <section id="s-*"> toggled with a class and `renderScreen(id)`
 * dispatched by hand. Routes give back the browser's own back button, which
 * that system had to fake.
 *
 * The Logger and the plan editor are full-screen by design — they sit OUTSIDE
 * the shell so nothing competes with the work in front of you, which is why
 * they are not nested under the chrome route.
 *
 * Provider order matters: Sync and WHOOP both read the DB, and Sync writes to
 * it on a pull, so DbProvider has to be outermost.
 */
export function App() {
  const Router = import.meta.env.VITE_SINGLE_HTML === 'true' ? HashRouter : BrowserRouter;
  const world = useDiscipline();
  return (
    <DbProvider>
      {/* Above the router: a failed write has to reach the logger and the plan
          editor too, and both sit outside the shell. */}
      <SaveAlert />
      {/* A SIBLING store, not a branch of the engine one: it holds no
          EngineDB and DbProvider holds no NutritionDB. It sits above
          SyncProvider only because SyncProvider reads both. */}
      <NutritionProvider>
      <SyncProvider>
        <WhoopProvider>
          <Concept2Provider>
          <RestProvider>
          <SetTimerProvider>
            <Router>
              {/* The route tree forks by discipline world, not by product
                  build: `world` is a runtime view preference (`discipline.ts`),
                  so both blocks ship in every build and only one is mounted at
                  a time. Each fork owns its own <Routes> — they are never both
                  live, so there is no path collision between them. */}
              {world === 'training' && (
                <Routes>
                  <Route path="/log/:bi/:ei" element={<Logger />} />
                  <Route
                    path="/coach/*"
                    element={
                      <Suspense fallback={null}>
                        <Coach />
                      </Suspense>
                    }
                  />
                  <Route path="/planner/:id" element={<Planner />} />
                  <Route path="/build/:id" element={<GuidedBuilder />} />
                  <Route element={<Shell />}>
                    {/* The bare address is the ATHLETE's. It used to redirect
                        to the coach bench, which made the front page of the
                        product the surface most of its users never open — and
                        meant an athlete typing the domain landed in someone
                        else's workspace.

                        A redirect to `ATHLETE_HOME` rather than rendering Home
                        here, so the athlete app keeps ONE canonical address and
                        the Home tab highlights when you arrive. It cannot loop:
                        this branch only runs on the unscoped build, where
                        `ATHLETE_HOME` is `/home`; the scoped builds render Home
                        at `/` directly, exactly as before. The coach keeps
                        `/coach` and every address under it. */}
                    <Route path="/" element={IS_SCOPED_BUILD ? <Home /> : <Navigate to={ATHLETE_HOME} replace />} />
                    {/* Home's own path, identical on all three builds, and now
                        also where `/` lands on the unscoped one. */}
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
                    {/* Home, NOT `/`. This mattered enormously when `/` was the
                        bench — every unmatched athlete path chained through it
                        and ejected the athlete into the coach workspace, most
                        visibly on the way back from the nutrition world. `/` is
                        the athlete's now, so the two agree, but naming
                        `ATHLETE_HOME` directly is still right: it is the single
                        source of truth for "send the athlete home" and does not
                        depend on what `/` happens to mean on this build. */}
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
            </Router>
          </SetTimerProvider>
          </RestProvider>
          </Concept2Provider>
        </WhoopProvider>
      </SyncProvider>
      </NutritionProvider>
    </DbProvider>
  );
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
