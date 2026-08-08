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
import { ClientDetailGate } from './ClientDetailGate';
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
            {/*
              Everything below reads and writes the SIGNED-IN account's own
              local stores (useDb / useNutrition / the progression and
              authoring ledgers) — correct while `engine-local` is selected,
              and the self-coach bench nothing here writes a roster client's
              record. ClientDetailGate blocks it instead of merely disclosing
              it, for any other selection. See ClientDetailGate.tsx.
            */}
            <Route path="author" element={<ClientDetailGate tool="Authoring"><CoachAuthoring /></ClientDetailGate>} />
            <Route path="nutrition" element={<ClientDetailGate tool="Nutrition"><CoachNutrition /></ClientDetailGate>} />
            <Route path="progression" element={<ClientDetailGate tool="Decisions"><CoachProgression /></ClientDetailGate>} />
            <Route path="review/:weekStart" element={<ClientDetailGate tool="Week review"><WeekReview /></ClientDetailGate>} />
            <Route path="legacy" element={<ClientDetailGate tool="Program bench"><CoachShell /></ClientDetailGate>} />
            <Route path="build/:id" element={<ClientDetailGate tool="Workout builder"><GuidedBuilder /></ClientDetailGate>} />
            <Route path="planner/:id" element={<ClientDetailGate tool="Planner"><Planner /></ClientDetailGate>} />
          </Route>
          <Route path="*" element={<Navigate to="/coach" replace />} />
        </Routes>
      </CoachWorkspaceProvider>
    </CoachAccess>
  );
}
