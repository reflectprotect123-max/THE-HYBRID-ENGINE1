import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { DbProvider } from './store/db';
import { RestProvider } from './store/rest';
import { SyncProvider } from './cloud/sync';
import { WhoopProvider } from './cloud/whoop';
import { BottomNav } from './components/BottomNav';
import { RestChip } from './components/RestChip';
import { SaveAlert } from './components/SaveAlert';
import { Home } from './screens/Home';
import { Training } from './screens/Training';
import { Logger } from './screens/Logger';
import { Library } from './screens/Library';
import { Planner } from './screens/Planner';
import { Conditioning } from './screens/Conditioning';
import { History } from './screens/History';
import { Progress } from './screens/Progress';
import { Exercise } from './screens/Exercise';
import { Calendar } from './screens/Calendar';
import { Recap } from './screens/Recap';
import { Settings } from './screens/Settings';

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
  return (
    <DbProvider>
      {/* Above the router: a failed write has to reach the logger and the plan
          editor too, and both sit outside the shell. */}
      <SaveAlert />
      <SyncProvider>
        <WhoopProvider>
          <RestProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/log/:bi/:ei" element={<Logger />} />
                <Route path="/planner/:id" element={<Planner />} />
                <Route element={<Shell />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/training" element={<Training />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="/conditioning" element={<Conditioning />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/progress" element={<Progress />} />
                  <Route path="/exercise" element={<Exercise />} />
                  <Route path="/exercise/:name" element={<Exercise />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/recap/:id" element={<Recap />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </RestProvider>
        </WhoopProvider>
      </SyncProvider>
    </DbProvider>
  );
}

function Shell() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col">
      <main className="flex-1 px-2 pt-2 pb-[calc(72px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <RestChip />
      <BottomNav />
    </div>
  );
}
