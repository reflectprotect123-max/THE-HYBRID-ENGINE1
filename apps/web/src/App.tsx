import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DbProvider } from './store/db';
import { RestProvider } from './store/rest';
import { BottomNav } from './components/BottomNav';
import { RestChip } from './components/RestChip';
import { Home } from './screens/Home';
import { Training } from './screens/Training';
import { Logger } from './screens/Logger';
import { Library } from './screens/Library';
import { Conditioning } from './screens/Conditioning';
import { History } from './screens/History';
import { Settings } from './screens/Settings';

/*
 * The router replaces the vanilla `go(id)` screen system, where every screen
 * was a <section id="s-*"> toggled with a class and `renderScreen(id)`
 * dispatched by hand. Routes give back the browser's own back button, which
 * that system had to fake.
 *
 * The Logger and the plan editor are full-screen by design — they sit OUTSIDE
 * the shell so nothing competes with the set in front of you. That is why they
 * are not nested under the chrome route.
 */
export function App() {
  return (
    <DbProvider>
      <RestProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/log/:bi/:ei" element={<Logger />} />
            <Route element={<Shell />}>
              <Route path="/" element={<Home />} />
              <Route path="/training" element={<Training />} />
              <Route path="/library" element={<Library />} />
              <Route path="/conditioning" element={<Conditioning />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </RestProvider>
    </DbProvider>
  );
}

import { Outlet } from 'react-router-dom';

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
