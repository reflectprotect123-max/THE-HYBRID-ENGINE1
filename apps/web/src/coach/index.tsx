import { Navigate, Route, Routes } from 'react-router-dom';
import { CoachAccess } from './access/CoachAccess';
import { Readiness } from './pillars/Readiness';
import { Conditioning } from './pillars/Conditioning';
import { Nutrition } from './pillars/Nutrition';
import { DayBuilderRoute } from './library/DayBuilderRoute';
import { CoachProgression } from './screens/CoachProgression';
import { CoachCommandCenter } from './screens/CoachCommandCenter';
import { ArcCoachFrame } from './frame/ArcCoachFrame';
import { CoachLibrary } from './screens/CoachLibrary';
import { CoachSettings } from './screens/CoachSettings';
import { CoachWeekBuilder } from './screens/CoachWeekBuilder';
import { ClientDetailGate } from './access/ClientDetailGate';
import { CoachWorkspaceProvider } from './data/CoachWorkspaceContext';
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
              progression has a real layer-3 backend now
              (docs/ARC_LAYER3_DESIGN.md) and each screen branches internally
              on selectedClient.source to render its own roster view —
              `layer3Ready` lets a roster client through the gate for exactly
              these.

              Stage-1 coach redesign (11 August 2026): `nutrition` now points
              at the Nutrition pillar, which reads local stores only
              (`useNutrition()`), so it drops `layer3Ready` and joins `legacy`
              below — a roster client is BLOCKED here rather than shown a
              summary. Accepted, owner-approved capability loss for Stage 1
              (task-6 brief); restoring roster nutrition through the pillar is
              future work, not a defect to silently fix.

              `legacy` still only ever reads and writes the SIGNED-IN account's
              own local stores (useDb / EngineDB) — there is no backend behind
              it for a roster client, so ClientDetailGate keeps blocking rather
              than merely disclosing. See ClientDetailGate.tsx.

              THE OLD AUTHORING CHAIN IS GONE (14 August 2026). `author`,
              `build/:id`, `planner/:id` and `roster-plan/:workoutId` were
              deleted with the screens behind them — `CoachAuthoring`,
              `GuidedBuilder`, `Planner` and `RosterPlanner`. `DayBuilder`
              under `library/` is the one authoring surface now, reached from
              the Library calendar (`day/:date`) and from the week builder.
              Do not re-add a second one without deciding which is canonical.
            */}
            {/*
              PILLAR GAP CLOSED, 13 August 2026.

              This read, from stage 1 (11 August): "there is no layer-3
              backend behind any of them yet, so each drops `layer3Ready` and
              a roster client is BLOCKED". The first half stopped being true
              almost immediately — `readiness_trend`, `lift_trend`,
              `hard_budget` and `erg_trend` snapshots, plus the nutrition
              summary/window pair and their two consent grants, were all built
              and pushed by the athlete's own device. The screens simply never
              read them, so selecting any athlete other than yourself made the
              four main tiles of the dashboard dead ends.

              Each pillar now branches on `selectedClient.source`, exactly as
              `CoachProgression` already did. The roster view is deliberately SMALLER than the self view
              — it shows the aggregated series the athlete shared and never
              the raw sessions, HR traces or safety flags behind them, which
              the roster tier does not carry. Each screen says so on itself
              rather than letting an absence read as a zero.
            */}
            <Route path="readiness" element={<ClientDetailGate tool="Readiness" layer3Ready><Readiness /></ClientDetailGate>} />
            {/* `strength` and its pillar MOVED to
                reflectprotect123-max/strengthside on 21 August 2026 with
                Task 2 of the repo split — strength has its own coach app
                there. The address now falls to the catch-all redirect. */}
            <Route path="conditioning" element={<ClientDetailGate tool="Conditioning" layer3Ready><Conditioning /></ClientDetailGate>} />
            <Route path="nutrition" element={<ClientDetailGate tool="Nutrition" layer3Ready><Nutrition /></ClientDetailGate>} />
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
              now live in the Conditioning pillar queue instead (the Strength
              pillar MOVED to reflectprotect123-max/strengthside, 21 August
              2026); see CoachProgression.tsx's own header comment.
            */}
            <Route path="progression" element={<ClientDetailGate tool="Decisions" layer3Ready><CoachProgression /></ClientDetailGate>} />
            {/*
              `review/:weekStart` and `WeekReview` were deleted with the
              Coordinator on 14 August 2026. The ledger it rendered was
              planned-versus-actual against a `WeeklyPlan`'s entries and
              decisions — a comparison with nothing on the "planned" side once
              nothing resolves a week. A coach-week equivalent, read against
              `CoachWeekBody`, would be new work rather than a restoration.
            */}
            {/*
              The week builder — step 3 of the coach-publishes-the-week design.
              `layer3Ready`, and not as a formality: a ROSTER athlete is the
              entire point of this screen. `publish_coach_week` writes into a
              real athlete's own weekly-plan row through a coach↔athlete
              relationship the server checks, so there is nothing here for the
              signed-in account's own local training — the screen says so and
              turns Publish off rather than pretending.
            */}
            <Route path="week/:athleteId/:weekStart" element={<ClientDetailGate tool="Week builder" layer3Ready><CoachWeekBuilder /></ClientDetailGate>} />
            {/* `legacy` (the old `CoachShell` program bench) was declared here
                until 14 August 2026. Nothing in the redesigned bench linked to
                it — you had to type the address — and its panels are covered
                by the Library, the Nutrition pillar and the Readiness pillar.
                Deleted with the screen rather than left as a typed-address
                back door into a surface nobody maintains. */}
          </Route>
          <Route path="*" element={<Navigate to="/coach" replace />} />
        </Routes>
      </CoachWorkspaceProvider>
    </CoachAccess>
  );
}
