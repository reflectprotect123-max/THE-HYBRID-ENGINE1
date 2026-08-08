import { useSyncExternalStore } from 'react';
import type { ProposalInput, ProposalInputMap } from './authoring';

const KEY = 'hybrid-coach-authoring-v1';

interface AuthoringState {
  version: 1;
  inputs: ProposalInputMap;
}

const empty = (): AuthoringState => ({ version: 1, inputs: {} });
let state = load();
const listeners = new Set<() => void>();

function load(): AuthoringState {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AuthoringState | null;
    return parsed?.version === 1 && parsed.inputs ? parsed : empty();
  } catch {
    return empty();
  }
}

function persist(next: AuthoringState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode degrades to this tab; the UI discloses that these inputs are local-only.
  }
  listeners.forEach((listener) => listener());
}

export function useAuthoringInputs(): ProposalInputMap {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state.inputs,
  );
}

export function setProposalInput(id: string, input: ProposalInput): void {
  persist({ version: 1, inputs: { ...state.inputs, [id]: input } });
}
