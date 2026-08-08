import { Navigate, Route, Routes } from 'react-router-dom';
import { CoachAccess, CoachShell } from './CoachShell';
import { CoachAuthoring } from './CoachAuthoring';
import { CoachNutrition } from './CoachNutrition';
import { WeekReview } from './WeekReview';
import { CoachProgression } from './CoachProgression';
import { CoachCommandCenter } from './CoachCommandCenter';
import { ArcCoachFrame } from './ArcCoachFrame';
import { CoachLibrary } from './CoachLibrary';
import { CoachSettings } from './CoachSettings';
import { Planner } from '../screens/Planner';
import { GuidedBuilder } from '../screens/guided/GuidedBuilder';
import { CoachWorkspaceProvider } from './CoachWorkspaceContext';
/* The live repository. Imported, not constructed here — this file is under
   coach/, which coach-contract rule 1 forbids from touching Supabase, and the
   implementation lives in cloud/ for exactly that reason. */
import { supabaseCoachWorkspaceRepository } from '../cloud/coach-repository';

/**
 * Default export so App.tsx can `React.lazy(() => import('./coach'))` — the
 * entire bench is one chunk that athlete navigation never fetches.
 */
export default function Coach() {
  return (
    <CoachAccess>
      <CoachWorkspaceProvider repository={supabaseCoachWorkspaceRepository}>
        <Routes>
          <Route element={<ArcCoachFrame />}>
            <Route index element={<CoachCommandCenter />} />
            <Route path="library" element={<CoachLibrary />} />
            <Route path="settings" element={<CoachSettings />} />
            <Route path="author" element={<CoachAuthoring />} />
            <Route path="nutrition" element={<CoachNutrition />} />
            <Route path="progression" element={<CoachProgression />} />
            <Route path="review/:weekStart" element={<WeekReview />} />
            <Route path="legacy" element={<CoachShell />} />
            <Route path="build/:id" element={<GuidedBuilder />} />
            <Route path="planner/:id" element={<Planner />} />
          </Route>
          <Route path="*" element={<Navigate to="/coach" replace />} />
        </Routes>
      </CoachWorkspaceProvider>
    </CoachAccess>
  );
}
