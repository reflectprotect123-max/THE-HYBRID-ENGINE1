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
import { RosterPlanner } from './RosterPlanner';
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
              author / nutrition / progression / review have a real layer-3
              backend now (docs/ARC_LAYER3_DESIGN.md) and each screen branches
              internally on selectedClient.source to render its own roster
              view — `layer3Ready` lets a roster client through the gate for
              exactly these four.

              legacy / build / planner still only ever read and write the
              SIGNED-IN account's own local stores (useDb / EngineDB) — there
              is no backend behind them for a roster client, so
              ClientDetailGate keeps blocking rather than merely disclosing.
              See ClientDetailGate.tsx.
            */}
            <Route path="author" element={<ClientDetailGate tool="Authoring" layer3Ready><CoachAuthoring /></ClientDetailGate>} />
            <Route path="nutrition" element={<ClientDetailGate tool="Nutrition" layer3Ready><CoachNutrition /></ClientDetailGate>} />
            <Route path="progression" element={<ClientDetailGate tool="Decisions" layer3Ready><CoachProgression /></ClientDetailGate>} />
            <Route path="review/:weekStart" element={<ClientDetailGate tool="Week review" layer3Ready><WeekReview /></ClientDetailGate>} />
            <Route path="legacy" element={<ClientDetailGate tool="Program bench"><CoachShell /></ClientDetailGate>} />
            <Route path="build/:id" element={<ClientDetailGate tool="Workout builder"><GuidedBuilder /></ClientDetailGate>} />
            <Route path="planner/:id" element={<ClientDetailGate tool="Planner"><Planner /></ClientDetailGate>} />
            {/*
              A roster client's draft has a real backend
              (save_workout_draft/publish_workout_draft) so this one gets
              layer3Ready — unlike build/:id and planner/:id above, which
              stay local-only. RosterPlanner reads/writes the draft through
              the same repository, never local `EngineDB`.
            */}
            <Route path="roster-plan/:workoutId" element={<ClientDetailGate tool="Workout builder" layer3Ready><RosterPlanner /></ClientDetailGate>} />
          </Route>
          <Route path="*" element={<Navigate to="/coach" replace />} />
        </Routes>
      </CoachWorkspaceProvider>
    </CoachAccess>
  );
}
