// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DbProvider } from '../store/db';
import { NutritionProvider } from '../store/nutrition';
import { WhoopProvider } from '../cloud/whoop';
import { Concept2Provider } from '../cloud/concept2';
import { ArcCoachFrame } from './ArcCoachFrame';
import { ClientDetailGate } from './ClientDetailGate';
import { CoachProgression } from './CoachProgression';
import { resetProgressionLedgerForTests } from '../store/progression';
import { FakeCoachWorkspaceRepository, renderCoachScreen, rosterClient } from './coach-test-harness';
import type { AthleteProgressionProposal } from './contracts';

/* Same stub AthleteStatus.test.tsx uses, character for character, and for the
   same reason: the real `SyncProvider` constructs a Supabase client. Nothing
   on any walk below is signed in, so "no user" is the honest answer. */
vi.mock('../cloud/sync', () => ({
  useSync: () => ({ user: null }),
  supabaseClient: null,
}));

/* WhoopProvider and Concept2Provider both poll
   `/.netlify/functions/integrations-status` on mount. jsdom has no base URL
   for a root-relative path, so the unstubbed call throws and buries the run
   in stack traces. An empty, well-formed 200 is what "not connected" looks
   like to both, which is the state every walk below is in anyway. */
vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));

/*
 * The pillar screens read the SIGNED-IN athlete's own stores, exactly like
 * `legacy` (and like `build`/`planner`, until those were deleted on 14 August
 * 2026). Without ClientDetailGate a coach would see their own
 * records under a roster client's name — the failure ClientDetailGate.tsx's
 * own header comment exists to prevent. Asserted statically because the
 * router is a lazy chunk, matching how checks/coach-contract.mjs proves the
 * same property for the routes that already have it.
 *
 * FIXED post-review (11 August 2026): the original assertion here was
 * `path="${path}"[^>]*element=\{<ClientDetailGate\b` — it stops matching the
 * instant it sees the literal `<ClientDetailGate` and never looks at what
 * attributes follow. Injecting `layer3Ready` into a pillar route left that
 * regex passing unchanged, which is exactly the regression this file exists
 * to catch: the four pillar routes' `layer3Ready`-ABSENCE is a privacy
 * boundary (a roster client must be refused, not shown the coach's own
 * records under someone else's name), and it had no working guard. The fix
 * captures the ClientDetailGate element's FULL opening tag — up to its own
 * closing `>`, not the router's `<Route ... />` — and asserts on that
 * captured text, not on whether the regex matched at all.
 */
describe('coach pillar routes', () => {
  const src = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');

  /** The `<ClientDetailGate ...>` opening tag for a given route `path`, e.g.
   *  `<ClientDetailGate tool="Readiness">` — everything up to (and
   *  including) the gate's own `>`, never crossing into its children or the
   *  next route. Fails the test immediately (via the non-null assertion) if
   *  the route or its gate isn't found at all, rather than silently letting
   *  a later `.not.toMatch` on `undefined` report a false pass. */
  function gateOpenTag(path: string): string {
    const re = new RegExp(`path="${path}"[^>]*element=\\{(<ClientDetailGate\\b[^>]*>)`);
    const match = src.match(re);
    expect(match, `no <ClientDetailGate> found for path="${path}"`).not.toBeNull();
    return match![1];
  }

  /*
   * REWRITTEN 13 August 2026, when the pillar gap was closed.
   *
   * This block used to assert `layer3Ready` was ABSENT from all four pillar
   * routes. That was never the property worth protecting — it was a proxy
   * for the real one, stated in this file's own header: a roster client must
   * be REFUSED rather than shown the coach's own records under someone
   * else's name. Absence of the flag bought that by blocking roster clients
   * outright, at the cost of the four main tiles of the dashboard being dead
   * ends for every athlete except yourself.
   *
   * The flag is now present and the property is protected directly instead:
   * each pillar branches on `selectedClient.source` before it renders
   * anything. Both halves are asserted together, and that pairing is the
   * point — `layer3Ready` WITHOUT a branch is precisely the leak the old
   * assertion feared, and would now fail here rather than passing quietly.
   */
  it.each(['readiness', 'strength', 'conditioning', 'nutrition'])(
    'lets a roster client through /coach/%s, because the screen branches for them',
    (path) => {
      expect(gateOpenTag(path)).toMatch(/\blayer3Ready\b/);
    },
  );

  it.each([
    ['readiness', 'Readiness'],
    ['strength', 'Strength'],
    ['conditioning', 'Conditioning'],
    ['nutrition', 'Nutrition'],
  ])('the %s pillar branches on the client source rather than assuming local', (_path, file) => {
    const pillar = readFileSync(resolve(__dirname, `pillars/${file}.tsx`), 'utf8');
    expect(
      pillar,
      `${file}.tsx renders a roster client without branching on selectedClient.source — it would show the signed-in coach's own records under that athlete's name.`,
    ).toMatch(/selectedClient\.source !== 'engine-local'/);
  });

  /* AMENDED 11 August 2026 — see "Task 7 amendment" below. The route is NOT a
     redirect: it survives as the roster decision surface, so it must still be
     gated with `layer3Ready` exactly as it is today. */
  it('keeps /coach/progression as a layer3Ready roster route, not a redirect', () => {
    const tag = gateOpenTag('progression');
    expect(tag).toContain('tool="Decisions"');
    expect(tag).toMatch(/\blayer3Ready\b/);
    expect(src).not.toMatch(/path="progression"[^>]*<Navigate/);
  });
});

/*
 * ---------------------------------------------------------------------------
 * REACHABILITY. Added 11 August 2026 by the Stage-1 whole-branch review.
 *
 * Task 2's Command Center rewrite deleted the old screen's system-links row.
 * Nothing rebuilt it, and `/coach/progression`, `/coach/legacy` and
 * `/coach/review/:weekStart` were left with no inbound link anywhere in
 * `apps/web/src` — mounted, gated, tested, and unreachable. The roster
 * approve/decline path in particular went dark: the pillars refuse a roster
 * client by design, so `/coach/progression` is the only surface that has it.
 *
 * The same defect had already been "fixed" twice on this branch, both times
 * with a guard that proves a component is MOUNTED. Mounted is not reachable.
 * So the two checks below are deliberately of two different kinds, and
 * neither one is a grep for a link element:
 *
 *  1. `every coach route is reachable from /coach` — an ORPHAN DETECTOR,
 *     and deliberately a GRAPH walk rather than a "does a link exist"
 *     grep. Both weaker forms were tried first and both were caught by
 *     deleting the rail entries and seeing what still passed:
 *       - counting any inbound link let `/coach/review/:weekStart` pass on
 *         `WeekReview`'s own "Open current week" link — a route vouching for
 *         itself;
 *       - excluding self-links STILL let it pass, on `CoachShell`'s link —
 *         but `CoachShell` is `/coach/legacy`, which was orphaned too. A
 *         link from one unreachable room to another is not a door.
 *     So this walks outward from `/coach` through each route's real import
 *     closure, and a route counts as reachable only if a chain of clickable
 *     links leads there from the workspace's own front door. `<Navigate>`
 *     is stripped first: a redirect moves someone who already arrived.
 *
 *  2. `a coach can walk from the rail to …` — three real navigations,
 *     rendered, clicked, and asserted on what the DESTINATION drew. The
 *     drawer is opened first because below `sm` the rail IS the drawer and
 *     its links are `aria-hidden` until then, so this is simultaneously the
 *     phone-width path.
 * ---------------------------------------------------------------------------
 */
describe('coach route reachability', () => {
  const coachDir = resolve(__dirname);
  const routerSrc = readFileSync(join(coachDir, 'index.tsx'), 'utf8');

  /** Every `path="…"` in `coach/index.tsx`'s router, minus the catch-all.
   *  `''` is the `index` route, `/coach` itself — the front door every walk
   *  below starts from. */
  const declaredPaths = [...routerSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== '*');

  function resolveModule(fromFile: string, spec: string): string | null {
    const base = join(dirname(fromFile), spec);
    for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function fileForComponent(name: string): string | null {
    const direct = [join(coachDir, `${name}.tsx`), join(coachDir, 'pillars', `${name}.tsx`)];
    return direct.find((f) => existsSync(f)) ?? null;
  }

  /** Every module a screen actually pulls in, transitively — because the
   *  link a coach clicks is often in a child component, not in the routed
   *  screen's own file. Relative imports only; a link cannot live in a
   *  package. */
  function importClosure(entries: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from\s+'(\.[^']*)'/g)) {
        const next = resolveModule(file, m[1]!);
        if (next && !seen.has(next)) queue.push(next);
      }
    }
    return seen;
  }

  /** `/coach/...` targets a human can click or be pushed to, from one file.
   *  `${…}` and `?query` are normalised away, so
   *  `` `/coach/day/${date}?pick=1` `` matches `day/:date`. */
  function linksIn(files: Iterable<string>): string[] {
    const out: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').replace(/<Navigate\b[^>]*>/g, '');
      for (const m of text.matchAll(/\bto=(?:"|\{`)(\/coach[^"`]*)/g)) out.push(m[1]!);
      for (const m of text.matchAll(/\bnavigate\(\s*['"`](\/coach[^'"`]*)/g)) out.push(m[1]!);
    }
    return out.map((t) => t.split('?')[0]!.replace(/\$\{[^}]*\}/g, '*').replace(/(.)\/$/, '$1'));
  }

  /** The components a route mounts. `element={…}` for a path, or — for the
   *  layout `<Route element={<ArcCoachFrame />}>` with no path — the chrome
   *  present on EVERY route, whose links are therefore edges from all of
   *  them. */
  function componentsFor(routePath: string): string[] {
    const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = routePath === ''
      ? /<Route\s+index\s+element=\{([\s\S]*?)\}\s*\/>/
      : new RegExp(`path="${escaped}"\\s+element=\\{([\\s\\S]*?)\\}\\s*/>`);
    const match = routerSrc.match(re);
    if (!match) return [];
    return [...match[1]!.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]!).filter((n) => n !== 'ClientDetailGate');
  }

  const layoutFiles = importClosure(
    [...routerSrc.matchAll(/<Route\s+element=\{<([A-Z]\w*)\s*\/>\}>/g)]
      .map((m) => fileForComponent(m[1]!))
      .filter((f): f is string => f != null),
  );

  function outgoing(routePath: string): string[] {
    const entries = componentsFor(routePath).map(fileForComponent).filter((f): f is string => f != null);
    return linksIn(new Set([...layoutFiles, ...importClosure(entries)]));
  }

  function matches(routePath: string, target: string): boolean {
    const want = `/coach${routePath ? `/${routePath}` : ''}`.split('/');
    const got = target.split('/');
    if (got.length !== want.length) return false;
    return want.every((seg, i) => (seg.startsWith(':') ? got[i]!.length > 0 : got[i] === seg));
  }

  /** Breadth-first from `/coach`. A route joins the set only when a route
   *  already IN the set links to it. */
  const reachable = (() => {
    const found = new Set<string>(['']);
    for (let changed = true; changed; ) {
      changed = false;
      for (const from of [...found]) {
        for (const target of outgoing(from)) {
          for (const candidate of declaredPaths) {
            if (!found.has(candidate) && matches(candidate, target)) {
              found.add(candidate);
              changed = true;
            }
          }
        }
      }
    }
    return found;
  })();

  it('parsed a real route table, a real layout and a real import graph', () => {
    // Every derivation above is a regex over source. If any of them silently
    // stops matching, the walk reports everything reachable from an empty
    // graph and this file becomes the fourth decorative guard on the branch.
    expect(declaredPaths).toEqual(expect.arrayContaining(['progression', 'library']));
    // Was 12; then 11, when `author`, `build/:id`, `planner/:id` and
    // `roster-plan/:workoutId` went with the old authoring chain on 14 August
    // 2026; then 10, after `review/:weekStart` went with the Coordinator the
    // same day; now 9, after `legacy` went with `CoachShell` hours later.
    // Lowered deliberately each time, with the reason, rather than left as a
    // floor no longer tied to anything.
    expect(declaredPaths.length).toBeGreaterThanOrEqual(9);
    expect(componentsFor('')).toContain('CoachCommandCenter');
    // `legacy`/`CoachShell` was the second probe here until it was deleted.
    // `library` replaces it: a route whose component is named differently from
    // its path, which is what this line is really checking the parser can do.
    expect(componentsFor('library')).toContain('CoachLibrary');
    expect([...layoutFiles].some((f) => f.endsWith('/ArcCoachFrame.tsx'))).toBe(true);
    expect(outgoing('').length).toBeGreaterThanOrEqual(6);
  });

  /*
   * The routes the owner deleted from the rail on 11 August 2026, and which
   * nothing else links to. They are reachable BY ADDRESS only, and that is the
   * decision, not a regression:
   *
   *   progression      — the only mount of RosterProgressionActions, so the
   *                      only roster approve/decline in the app. The route
   *                      stays so the capability stays.
   *   legacy           — the pre-redesign Program bench (CoachShell).
   *
   * There were three. `review/:weekStart`, the planned-versus-actual ledger,
   * is not unlinked now — it is DELETED, with the Coordinator whose decisions
   * it rendered (14 August 2026). It comes OFF this list rather than staying
   * on it, because an entry here asserts the route still exists.
   *
   * They are listed here rather than exempted silently, so that deleting a
   * route outright, or quietly re-linking one, both change this file.
   */
  /* `legacy` left this list on 14 August 2026 — the route and `CoachShell` were
   deleted outright rather than left as a typed-address back door. `progression`
   remains: it is unlinked by decision but still declared, which is what this
   list is for. */
const ORPHANED_BY_DECISION = ['progression'];

  it('still declares every orphaned-by-decision route, so no capability was deleted with its link', () => {
    expect(declaredPaths).toEqual(expect.arrayContaining(ORPHANED_BY_DECISION));
  });

  it.each(ORPHANED_BY_DECISION)('/coach/%s is deliberately unlinked — reachable by address, not by clicking', (routePath) => {
    expect(
      reachable.has(routePath),
      `/coach/${routePath} has an inbound link again. The owner removed it from the rail; re-adding one is a product decision, not a bug fix.`,
    ).toBe(false);
  });

  it.each(declaredPaths.filter((p) => !ORPHANED_BY_DECISION.includes(p)))(
    '/coach/%s is reachable by clicking from /coach',
    (routePath) => {
      expect(
        reachable.has(routePath),
        `/coach/${routePath} is declared but no chain of links reaches it from /coach`,
      ).toBe(true);
    },
  );
});

/* The navigation walks. Each one renders the frame plus the REAL gate and the
   REAL destination screen, then clicks the rail entry — no assertion here is
   satisfied by a link merely existing. */
function rosterProposal(over: Partial<AthleteProgressionProposal> = {}): AthleteProgressionProposal {
  return {
    id: 'prop-1',
    domain: 'strength',
    subject: 'Back squat',
    direction: 'increase',
    hard: false,
    before: { kg: 100, reps: 5 },
    after: { kg: 102.5, reps: 5 },
    createdAt: new Date().toISOString(),
    ...over,
  } as AthleteProgressionProposal;
}

async function walkFrom(repository: FakeCoachWorkspaceRepository, routes: React.ReactNode, initialEntry = '/coach') {
  const result = renderCoachScreen(
    <DbProvider>
      <NutritionProvider>
        {/* App.tsx's real nesting, minus SyncProvider: the legacy bench's
            onboarding panel reads `useWhoop()` and its athlete-status panel
            reads `useConcept2()`, and a walk that stops short of the real
            screen would be the "mounted, not reachable" mistake again. */}
        <WhoopProvider>
        <Concept2Provider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<ArcCoachFrame />}>
              <Route path="/coach" element={<p>Command center content</p>} />
              {routes}
            </Route>
          </Routes>
        </MemoryRouter>
        </Concept2Provider>
        </WhoopProvider>
      </NutritionProvider>
    </DbProvider>,
    { repository },
  );
  await act(async () => {});
  // Below `sm` the rail is a drawer whose links are aria-hidden until opened.
  fireEvent.click(screen.getByRole('button', { name: /open coach navigation/i }));
  return result;
}

describe('the coach rail', () => {
  beforeEach(() => {
    localStorage.clear();
    resetProgressionLedgerForTests();
  });

  /* The rail the owner asked for on 11 August 2026: three entries, no more.
     Asserted by walking the rendered chrome, not by reading the source — a
     rail entry that renders is what a coach actually sees. */
  const RAIL = ['Command', 'Library', 'Settings'];

  it('offers exactly Command, Library and Settings for a local coach', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'engine-local', name: 'Alex Morgan', source: 'engine-local' })];
    await walkFrom(repo, <Route path="/coach/legacy" element={<p>bench</p>} />);

    const rail = within(screen.getByRole('navigation', { name: /primary navigation/i }));
    expect(rail.getAllByRole('link').map((link) => link.textContent?.replace(/\d+$/, '').trim())).toEqual(RAIL);
  });

  it('offers the same three for a roster client — the rail no longer changes with the client', async () => {
    // Before the deletion this branched: Decisions for a roster client,
    // Program bench for a local one. Both are gone, so both clients see one
    // rail. A reappearing conditional entry fails here.
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'roster-summary' })];
    await walkFrom(repo, <Route path="/coach/legacy" element={<p>bench</p>} />);

    const rail = within(screen.getByRole('navigation', { name: /primary navigation/i }));
    expect(rail.getAllByRole('link').map((link) => link.textContent?.replace(/\d+$/, '').trim())).toEqual(RAIL);
  });

  it('names none of the three deleted destinations anywhere in the chrome', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ source: 'roster-summary' })];
    await walkFrom(repo, <Route path="/coach/legacy" element={<p>bench</p>} />);

    expect(screen.queryByRole('link', { name: /program bench/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /decisions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /week review/i })).not.toBeInTheDocument();
  });

  it('still reaches roster approve/decline when /coach/progression is opened by address', async () => {
    // The capability the deletion was allowed to keep. If this ever fails,
    // the route was deleted along with its link and roster coaching lost its
    // only approve/decline — which is a different, much larger decision.
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ name: 'Riley Roster', source: 'roster-summary' })];
    repo.progressionProposals = [rosterProposal()];
    renderCoachScreen(
      <DbProvider>
        <NutritionProvider>
          <MemoryRouter initialEntries={['/coach/progression']}>
            <Routes>
              <Route
                path="/coach/progression"
                element={<ClientDetailGate tool="Decisions" layer3Ready><CoachProgression /></ClientDetailGate>}
              />
            </Routes>
          </MemoryRouter>
        </NutritionProvider>
      </DbProvider>,
      { repository: repo },
    );
    await act(async () => {});

    expect(screen.getByText('Back squat')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    });
    expect(repo.decidedProposals).toEqual([
      { clientId: 'roster-1', proposalId: 'prop-1', decision: 'declined' },
    ]);
  });
});
