import { storage } from './storage';
import type { ProgressionDecisionEvent, ProgressionProposal } from '../lib/progression';

/*
 * The athlete's local progression-proposal ledger, on the phone.
 *
 * DELIBERATELY DUPLICATED from apps/web/src/store/progression.ts, with the
 * two changes a phone forces (same pattern as cloud/arc-assignments.ts):
 * `localStorage` becomes the engine's MMKV-backed Storage port, and there is
 * no `useSyncExternalStore` hook because nothing on this app renders the
 * ledger — the sync provider reads it, pushes what is pending, and that is
 * all. The SHAPE is kept identical (`{version: 1, proposals, decisions}`) so
 * the two clients stay describable as one ledger in two stores.
 *
 * Why this exists at all: `Conditioning.tsx` mints a proposal every time a
 * run banks (the phone is the athlete device the ARC loop's PUSH half was
 * written for), and sync.tsx pushes the pending ones best-effort on every
 * reconcile. `push_progression_proposal` is idempotent on
 * (org, athlete, domain, client_key, source_at), so re-pushing the same
 * pending proposal every sync is a no-op server-side — which is why nothing
 * here needs a "pushed" flag that could disagree with the server.
 */

const KEY = 'hybrid-arc-progression-ledger-v1';

export interface ProgressionLedger {
  version: 1;
  proposals: ProgressionProposal[];
  decisions: ProgressionDecisionEvent[];
}

const empty = (): ProgressionLedger => ({ version: 1, proposals: [], decisions: [] });
let state = load();

function load(): ProgressionLedger {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? 'null') as ProgressionLedger | null;
    return value?.version === 1 && Array.isArray(value.proposals) && Array.isArray(value.decisions) ? value : empty();
  } catch {
    return empty();
  }
}

function persist(next: ProgressionLedger): void {
  state = next;
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* MMKV writes do not fail in practice; the in-memory shim never throws.
       Worst case the ledger lives only until the next cold start, and the
       proposals re-mint from the next banked session. */
  }
}

export function progressionLedger(): ProgressionLedger {
  return state;
}

export function recordProgressionProposals(proposals: ProgressionProposal[]): void {
  if (!proposals.length) return;
  const known = new Set(state.proposals.map((proposal) => proposal.id));
  const fresh = proposals.filter((proposal) => !known.has(proposal.id));
  if (!fresh.length) return;
  /* Capped like every other MMKV list in this app (arc-assignments,
     arc-progression receipts): unbounded growth over a long-lived account is
     a real risk, and 200 pending-or-old proposals is far more than a coach
     will ever page through. Oldest fall off the tail. */
  persist({ ...state, proposals: [...fresh, ...state.proposals].slice(0, 200) });
}

/** What the sync loop pushes: proposals with no local decision recorded.
 *  Nothing on the phone mints decisions today (a coach decides server-side),
 *  so this is normally every recorded proposal — the filter is kept so the
 *  semantics match the web sync loop exactly. */
export function pendingProgressionProposals(): ProgressionProposal[] {
  const decided = new Set(state.decisions.map((d) => d.proposalId));
  return state.proposals.filter((p) => !decided.has(p.id));
}

export function resetProgressionLedgerForTests(): void {
  persist(empty());
}
