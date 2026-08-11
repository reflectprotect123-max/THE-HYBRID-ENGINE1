import { Navigate, Route, Routes } from 'react-router-dom';
import { CoachAccess, CoachShell } from './CoachShell';
import { CoachAuthoring } from './CoachAuthoring';
import { Readiness } from './pillars/Readiness';
import { Strength } from './pillars/Strength';
import { Conditioning } from './pillars/Conditioning';
import { Nutrition } from './pillars/Nutrition';
import { DayBuilderRoute } from './library/DayBuilderRoute';
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
              author / progression / review have a real layer-3 backend now
              (docs/ARC_LAYER3_DESIGN.md) and each screen branches internally
              on selectedClient.source to render its own roster view —
              `layer3Ready` lets a roster client through the gate for exactly
              these.

              Stage-1 coach redesign (11 August 2026): `nutrition` now points
              at the Nutrition pillar, which reads local stores only
              (`useNutrition()`), so it drops `layer3Ready` and joins
              legacy / build / planner below — a roster client is BLOCKED
              here rather than shown a summary. Accepted, owner-approved
              capability loss for Stage 1 (task-6 brief); restoring roster
              nutrition through the pillar is future work, not a defect to
              silently fix.

              legacy / build / planner still only ever read and write the
              SIGNED-IN account's own local stores (useDb / EngineDB) — there
              is no backend behind them for a roster client, so
              ClientDetailGate keeps blocking rather than merely disclosing.
              See ClientDetailGate.tsx.
            */}
            <Route path="author" element={<ClientDetailGate tool="Authoring" layer3Ready><CoachAuthoring /></ClientDetailGate>} />
            {/*
              Stage-1 coach redesign (11 August 2026, Task 7): the four pillar
              screens read the SIGNED-IN athlete's own stores (useDb() /
              useNutrition()), exactly like legacy / build / planner below —
              there is no layer-3 backend behind any of them yet, so each
              drops `layer3Ready` and a roster client is BLOCKED, not shown a
              summary. See ClientDetailGate.tsx for why a block, not a
              disclosure banner.
            */}
            <Route path="readiness" element={<ClientDetailGate tool="Readiness"><Readiness /></ClientDetailGate>} />
            <Route path="strength" element={<ClientDetailGate tool="Strength"><Strength /></ClientDetailGate>} />
            <Route path="conditioning" element={<ClientDetailGate tool="Conditioning"><Conditioning /></ClientDetailGate>} />
            <Route path="nutrition" element={<ClientDetailGate tool="Nutrition"><Nutrition /></ClientDetailGate>} />
            {/*
              The day builder reads the signed-in athlete's own stores to build
              its exercise catalogue, so it is gated WITHOUT layer3Ready, like
              the pillars above and for the same reason.
            */}
            <Route path="day/:date" element={<ClientDetailGate tool="Session builder"><DayBuilderRoute mode="dated" /></ClientDetailGate>} />
            {/*
              /coach/progression survives Stage 1 rather than retiring: it is
              the roster-only decision surface. The pillars above are gated
              WITHOUT layer3Ready and refuse a roster client by design (they
              read local stores only), so a roster athlete's progression
              proposal has no pillar queue to move into — this route, and
              RosterProgressionActions in progression-actions.tsx, is the only
              place a coach can approve or decline one. Self-coach decisions
              now live in the Strength/Conditioning pillar queues instead; see
              CoachProgression.tsx's own header comment.
            */}
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
