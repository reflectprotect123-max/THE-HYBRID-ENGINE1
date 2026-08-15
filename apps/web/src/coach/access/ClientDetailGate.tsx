import type { ReactNode } from 'react';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import type { ClientSummary } from '../data/contracts';

/*
 * The hard version of the banner ArcCoachFrame already shows.
 *
 * ArcCoachFrame discloses, above the route's own content, that detail below
 * the line is not the selected client's — but the content keeps rendering
 * and keeps working underneath. A coach who does not read the banner can
 * still approve a progression proposal, log an intervention, or review a
 * "resolved week" that is silently their own account's, captioned with a
 * roster client's name still showing at the top of the frame. That is
 * exactly the failure `docs/HANDOFF_2026-08-08_ARC_IMPORT.md` names as the
 * risk worth budgeting for: "renders the coach's own records under a
 * client's name" — and a disclosure a coach can act straight past is not a
 * guard against it.
 *
 * Every route this wraps — author, progression, nutrition, review, legacy —
 * reads and writes `useDb()` / `useNutrition()` / the progression and
 * authoring ledgers: the SIGNED-IN account's own local stores. That is
 * correct and intentional while `engine-local` is selected — this bench
 * doubles as a self-coach tool, "Athlete zero: the coach is also the first
 * athlete, in the same account" (OnboardingPanel.tsx). It must not run at
 * all while a roster client is selected, because there is no code path
 * behind this gate that writes to THAT client's record — only ever to the
 * signed-in coach's own, under their name.
 *
 * That sentence became literal on 14 August 2026: a coach may now be their
 * own athlete, and `listClients` folds the resulting roster row into the
 * `engine-local` entry rather than appending a second one. Nothing here
 * changed, and that is the point — the fold leaves `source` alone, so the
 * self-coached entry is allowed through exactly as before, on gated and
 * ungated routes alike. It is the one case where "the local stores are not
 * this client's data" is false, because they are.
 *
 * `tool` names the route in the gate's own copy ("Decisions", "Nutrition",
 * ...) so the message reads as a fact about THIS screen, not a generic
 * refusal copy-pasted five times.
 */
/**
 * The decision alone, with no hook and no JSX — the part worth testing
 * directly. `renderToStaticMarkup` never runs `useEffect`, so a test that
 * went through `useCoachWorkspace()` would find `selectedClient` stuck at
 * null (the provider's fetch never resolves) and would only ever exercise
 * the "allow" branch — the one case that needs no test.
 *
 * `layer3Ready` is per-ROUTE, not global: layer 3's backend covers
 * authoring, progression, week review and the roster workout draft (each
 * screen branches internally on `selectedClient.source` to render its own
 * roster view) but NOT the legacy program bench, the guided workout
 * builder, the planner, nutrition, or the readiness/strength/conditioning
 * pillars — those still only ever read and write the signed-in account's
 * own local `Workout[]`/`EngineDB`/`useNutrition()`, so a roster client
 * must still be blocked there.
 */
export function clientDetailGateVerdict(
  selectedClient: ClientSummary | null,
  layer3Ready: boolean,
): 'allow' | 'roster' | 'fixture' {
  if (!selectedClient || selectedClient.source === 'engine-local') return 'allow';
  if (selectedClient.source === 'roster-summary') return layer3Ready ? 'allow' : 'roster';
  return 'fixture';
}

/** The presentational half, given the verdict explicitly rather than pulling
 *  context — this is what the test above renders with `renderToStaticMarkup`. */
export function ClientDetailGateView({
  tool,
  verdict,
  clientName,
  onSwitchToLocal,
  children,
}: {
  tool: string;
  verdict: 'allow' | 'roster' | 'fixture';
  clientName: string;
  onSwitchToLocal: () => void;
  children: ReactNode;
}) {
  if (verdict === 'allow') return <>{children}</>;

  return (
    <main className="mx-auto max-w-[640px] p-4 text-text">
      <p className="text-[10px] uppercase tracking-[0.18em] text-gold">ARC · {tool}</p>
      <h1 className="mt-1 text-lg font-semibold">
        {clientName}&rsquo;s detail is not readable here yet
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-muted">
        {verdict === 'roster' ? (
          <>
            {clientName}&rsquo;s weekly counts on the command center are real and
            authorised. This tool still only reads and writes the signed-in account&rsquo;s own
            training, so it cannot be used for {clientName} yet — that is layer 3 of
            the ARC backend, not built here.
          </>
        ) : (
          <>
            {clientName} is a synthetic handoff fixture, not a real athlete on your
            roster. There is nothing behind it for this tool to read.
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onSwitchToLocal}
        className="mt-3 rounded-md border border-gold-line bg-gold-wash px-2 py-1.5 text-sm font-medium text-gold2"
      >
        Switch to my own training
      </button>
    </main>
  );
}

/** The wrapper every route in index.tsx actually uses. Pass `layer3Ready` on
 *  the four routes with a real backend (author, progression, review,
 *  roster-plan); leave it unset everywhere else — including nutrition, which
 *  reads local stores only and dropped `layer3Ready` in the Stage-1 coach
 *  redesign, and the three pillar routes added alongside it (readiness,
 *  strength, conditioning), which never had one. */
export function ClientDetailGate({ tool, layer3Ready = false, children }: { tool: string; layer3Ready?: boolean; children: ReactNode }) {
  const { selectedClient, selectClient } = useCoachWorkspace();
  return (
    <ClientDetailGateView
      tool={tool}
      verdict={clientDetailGateVerdict(selectedClient, layer3Ready)}
      clientName={selectedClient?.name ?? ''}
      onSwitchToLocal={() => selectClient('engine-local')}
    >
      {children}
    </ClientDetailGateView>
  );
}
