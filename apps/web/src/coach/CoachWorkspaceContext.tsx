import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ClientSummary, CoachWorkspaceRepository } from './contracts';
import { coachWorkspaceRepository } from './mock-repository';

const SELECTED_CLIENT_KEY = 'hybrid-arc-selected-client-v1';

interface CoachWorkspaceContextValue {
  clients: readonly ClientSummary[];
  selectedClient: ClientSummary | null;
  selectClient: (clientId: string) => void;
  repository: CoachWorkspaceRepository;
  loading: boolean;
  error: string | null;
}

const Context = createContext<CoachWorkspaceContextValue | null>(null);

export function CoachWorkspaceProvider({ children, repository = coachWorkspaceRepository }: { children: ReactNode; repository?: CoachWorkspaceRepository }) {
  const [clients, setClients] = useState<readonly ClientSummary[]>([]);
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem(SELECTED_CLIENT_KEY) ?? 'engine-local'; } catch { return 'engine-local'; }
  });
  const [error, setError] = useState<string | null>(null);
  /*
   * Whether `listClients()` has ANSWERED — not whether it returned anything.
   *
   * `loading` used to be derived as `clients.length === 0 && !error`, which
   * makes "still asking" and "asked, and this coach has no athletes"
   * indistinguishable. In production that was invisible, because
   * `listClients()` always returns at least the signed-in coach's own
   * `engine-local` entry, so a zero-length list never happened.
   *
   * It stopped being invisible when the pillar screens started BRANCHING on
   * the answer (13 August 2026): a screen that treats "no answer yet" as
   * "local client" renders the signed-in coach's own training for the first
   * frames after mount, under whichever athlete is selected. Tracking the
   * settle explicitly is the only way to tell those two states apart.
   */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let active = true;
    setSettled(false);
    repository.listClients()
      .then((value) => { if (active) setClients(value); })
      .catch(() => { if (active) setError('Client summaries could not be loaded.'); })
      .finally(() => { if (active) setSettled(true); });
    return () => { active = false; };
  }, [repository]);

  const selectClient = (clientId: string) => {
    setSelectedId(clientId);
    try { localStorage.setItem(SELECTED_CLIENT_KEY, clientId); } catch { /* Selection still works for this session. */ }
  };
  const selectedClient = clients.find((client) => client.id === selectedId) ?? clients[0] ?? null;
  const value = useMemo(() => ({ clients, selectedClient, selectClient, repository, loading: !settled && !error, error }), [clients, selectedClient, repository, error, settled]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCoachWorkspace(): CoachWorkspaceContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('useCoachWorkspace outside CoachWorkspaceProvider');
  return value;
}

/*
 * `SelectedAthleteWeek`, `resolveAthleteWeek` and `useSelectedAthleteWeek`
 * lived here until 14 August 2026 — "the seam layer 3 turns on", mapping one
 * `getAthleteWeek` fetch onto one of five sentences so a screen could tell
 * `not-readable` from `denied` from `failed` instead of rendering all three
 * as one blank panel.
 *
 * Their only consumer was `WeekReview`, deleted with the Coordinator. The
 * five-way distinction was the good idea in them, and it is not lost: the
 * roster reads that survive (`getAthleteWeekSummary`, `getCoachWeek`) are
 * consumed by `CoachCommandCenter` and `CoachWeekBuilder`, which make the
 * same distinction at their own call sites.
 */
