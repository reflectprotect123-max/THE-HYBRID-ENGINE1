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

