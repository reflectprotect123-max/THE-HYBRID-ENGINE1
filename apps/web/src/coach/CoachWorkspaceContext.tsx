import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AthleteWeekProjection, ClientSummary, CoachWorkspaceRepository } from './contracts';
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

  useEffect(() => {
    let active = true;
    repository.listClients().then((value) => { if (active) setClients(value); }).catch(() => { if (active) setError('Client summaries could not be loaded.'); });
    return () => { active = false; };
  }, [repository]);

  const selectClient = (clientId: string) => {
    setSelectedId(clientId);
    try { localStorage.setItem(SELECTED_CLIENT_KEY, clientId); } catch { /* Selection still works for this session. */ }
  };
  const selectedClient = clients.find((client) => client.id === selectedId) ?? clients[0] ?? null;
  const value = useMemo(() => ({ clients, selectedClient, selectClient, repository, loading: clients.length === 0 && !error, error }), [clients, selectedClient, repository, error]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCoachWorkspace(): CoachWorkspaceContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('useCoachWorkspace outside CoachWorkspaceProvider');
  return value;
}

export interface SelectedAthleteWeek {
  /** The athlete's own data, or null when it is not readable. */
  data: AthleteWeekProjection | null;
  loading: boolean;
  /**
   * Why there is no data. `not-readable` is a FACT about this client, not a
   * failure — a roster client has an authorised summary and no readable
   * detail. `denied` and `failed` are different, and a screen must not render
   * all three as one blank panel.
   */
  reason: 'ok' | 'local' | 'not-readable' | 'denied' | 'failed';
}

/**
 * The selected athlete's week — the seam layer 3 turns on.
 *
 * `engine-local` returns `reason: 'local'` and NO data: that client's week
 * already comes from the local stores the screen reads today, and returning a
 * second copy here would give the screen two sources of truth for one athlete.
 *
 * Everyone else goes through the repository, which is the only thing allowed
 * to reach the backend. A repository without `getAthleteWeek` — the mock, or
 * an older build — reports `not-readable` rather than throwing.
 */
/*
 * The decision, lifted out of the effect so it can be tested as what it is: a
 * pure mapping from one fetch to one of five sentences. Inside a `useEffect` it
 * would need a DOM, a renderer and a settle-the-microtasks dance to assert, and
 * none of that has anything to do with the rule being checked.
 */
export async function resolveAthleteWeek(
  repository: Pick<CoachWorkspaceRepository, 'getAthleteWeek'>,
  clientId: string | null,
  source: ClientSummary['source'] | null,
  weekStart: string,
): Promise<SelectedAthleteWeek> {
  if (!clientId || source === 'engine-local') return { data: null, loading: false, reason: 'local' };
  if (!repository.getAthleteWeek) return { data: null, loading: false, reason: 'not-readable' };
  try {
    const data = await repository.getAthleteWeek(clientId, weekStart);
    return { data, loading: false, reason: data ? 'ok' : 'not-readable' };
  } catch (e: unknown) {
    /* An authorization refusal and a network failure are different facts and
       the screen says different things about them. Everything else is
       `failed`; nothing is silently rendered as "no training". */
    const message = e instanceof Error ? e.message : String(e);
    return { data: null, loading: false, reason: /not permitted|insufficient/i.test(message) ? 'denied' : 'failed' };
  }
}

export function useSelectedAthleteWeek(weekStart: string): SelectedAthleteWeek {
  const { selectedClient, repository } = useCoachWorkspace();
  const [state, setState] = useState<SelectedAthleteWeek>({ data: null, loading: true, reason: 'ok' });
  const clientId = selectedClient?.id ?? null;
  const source = selectedClient?.source ?? null;

  useEffect(() => {
    let active = true;
    setState({ data: null, loading: true, reason: 'ok' });
    void resolveAthleteWeek(repository, clientId, source, weekStart).then((next) => {
      if (active) setState(next);
    });
    return () => { active = false; };
  }, [clientId, source, repository, weekStart]);

  return state;
}

