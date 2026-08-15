import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { DbProvider } from './store/db';
import { NutritionProvider } from './store/nutrition';
import { SyncProvider } from './cloud/sync';
import { WhoopProvider } from './cloud/whoop';
import { Concept2Provider } from './cloud/concept2';
import { SaveAlert } from './components/SaveAlert';
import { UpdateBanner } from './UpdateBanner';
import { ManifestLink } from './manifestLink';
import { startServiceWorker } from './serviceWorker';

/*
 * Registered at module scope, above every route fork.
 *
 * It used to happen inside `UpdateBanner`, which lived in the athlete `Shell`
 * — so the coach workspace ran with NO service worker. An installable PWA
 * needs one, so the coach bench could not be installed at all from the surface
 * a coach actually uses.
 */
startServiceWorker();

/* The coach bench is its own chunk. That mattered when athletes downloaded
   this bundle too; it is kept because a failure inside the bench should not be
   able to take the document down before it renders. */
const Coach = lazy(() => import('./coach'));

/*
 * THIS APP IS THE COACH WORKSPACE. NOTHING ELSE. (15 August 2026)
 *
 * The athlete web surface is DELETED, not parked. It was parked on 13 August —
 * routes removed, `src/screens/` left on disk so it could be pulled back — and
 * it was pulled back for one day on 15 August as a branded conditioning
 * product. Then the owner cut scope to two products, the Android APK and this
 * bench, and everything outside those two went.
 *
 * WHAT WENT WITH IT, so nobody hunts for it: `src/screens/` entire (the
 * athlete app and the whole nutrition world), `src/native/` (BLE heart rate,
 * GPS, wake lock, camera, barcode, label OCR — every one of them used only by
 * those screens), `discipline.ts`, and the athlete chrome
 * (`BottomNav`, `NutritionBottomNav`, `RestChip`, `WorldSwitch`).
 *
 * NONE OF IT IS LOST. `apps/mobile` carries its own copy of every one of those
 * surfaces, and that is the athlete product. Git history carries the web
 * versions if a browser athlete app is ever wanted again — the same way it
 * carried `apps/mobile` between commit `8628060` and its return.
 *
 * `NutritionProvider` STAYS, and is the one thing here that looks athlete-
 * shaped but is not: the coach bench's Nutrition pillar reads the athlete's
 * nutrition slice through it (six call sites under `coach/`). `RestProvider`
 * did NOT stay — nothing under `coach/` referenced it and it existed for a rest
 * timer on a screen that no longer exists.
 *
 * `UpdateBanner` was deleted with them and RESTORED hours later. Nothing under
 * `coach/` imports it either, and that was the mistake: it does not subscribe
 * to a SCREEN, it subscribes to the service worker. Without it a downloaded
 * update waits forever and no deploy reaches an installed bench — the exact
 * bug it was written for, reintroduced by removing it.
 *
 * Provider order matters: Sync and WHOOP both read the DB, and Sync writes to
 * it on a pull, so DbProvider has to be outermost.
 */
export function App() {
  const Router = import.meta.env.VITE_SINGLE_HTML === 'true' ? HashRouter : BrowserRouter;
  return (
    <DbProvider>
      {/* Above the router: a failed write has to reach every screen, including
          the coach bench, which sits outside any shell. */}
      <SaveAlert />
      {/* Also above the router. The PWA is `registerType: 'prompt'`, so a
          downloaded worker waits to be activated — and with nothing subscribed
          to `serviceWorker.ts`'s waiting-worker event, no deploy ever reaches
          an installed bench. That is not theoretical: deleting this component
          with the athlete surface reintroduced exactly that bug for a few
          hours on 15 August 2026. `checks/pwa-update.mjs` proves the loop. */}
      <UpdateBanner />
      {/* A SIBLING store, not a branch of the engine one: it holds no
          EngineDB and DbProvider holds no NutritionDB. It sits above
          SyncProvider only because SyncProvider reads both. */}
      <NutritionProvider>
        <SyncProvider>
          <WhoopProvider>
            <Concept2Provider>
              <Router>
                {/* Points the document at the coach manifest. Renders nothing. */}
                <ManifestLink />
                <Routes>
                  <Route
                    path="/coach/*"
                    element={
                      <Suspense fallback={null}>
                        <Coach />
                      </Suspense>
                    }
                  />
                  {/* Every other address, including `/` and the old athlete
                      paths. This app should not 404 a bookmarked `/training` —
                      it belongs to someone who will now be shown the surface
                      that does exist. */}
                  <Route path="*" element={<ToCoach />} />
                </Routes>
              </Router>
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
