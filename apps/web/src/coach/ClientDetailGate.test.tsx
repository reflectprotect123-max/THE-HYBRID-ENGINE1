import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClientDetailGateView, clientDetailGateVerdict } from './ClientDetailGate';
import type { ClientSummary } from './contracts';

/*
 * The failure this closes: ArcCoachFrame's banner discloses "this is not this
 * client's data" ABOVE content that keeps rendering and keeps working, so a
 * coach who does not read it can still approve a progression proposal that
 * silently describes their own account under a roster client's name — exactly
 * what docs/HANDOFF_2026-08-08_ARC_IMPORT.md names as the risk worth
 * budgeting for. This gate blocks instead of disclosing, and every case below
 * is one where getting the verdict wrong would let that failure back in.
 */

const client = (over: Partial<ClientSummary>): ClientSummary => ({
  id: 'c1', name: 'Jane Athlete', initials: 'JA', source: 'roster-summary',
  assignment: null,
  completion: { strength: { completed: 0, planned: 0 }, conditioning: { completed: 0, planned: 0 }, nutritionDays: 0, checkInDays: 0 },
  conditioningMinutes: { easy: 0, moderate: 0, hard: 0 },
  attention: null,
  ...over,
});

describe('clientDetailGateVerdict', () => {
  it('allows the signed-in athlete — this IS their own detail', () => {
    expect(clientDetailGateVerdict(client({ source: 'engine-local' }), false)).toBe('allow');
  });

  it('allows when nothing is selected yet, rather than blocking on a transient null', () => {
    expect(clientDetailGateVerdict(null, false)).toBe('allow');
  });

  it('blocks a real roster client on a route without a layer-3 backend', () => {
    expect(clientDetailGateVerdict(client({ source: 'roster-summary' }), false)).toBe('roster');
  });

  it('allows a real roster client through on a route WITH a layer-3 backend', () => {
    // The screen itself is responsible for branching on selectedClient.source
    // from here — this gate only decides whether to let it try.
    expect(clientDetailGateVerdict(client({ source: 'roster-summary' }), true)).toBe('allow');
  });

  it('still blocks a synthetic fixture even on a layer-3-ready route', () => {
    // A fixture has nothing behind it at all, in any tier — layer3Ready does
    // not change that.
    expect(clientDetailGateVerdict(client({ source: 'synthetic-fixture' }), true)).toBe('fixture');
  });

  it('blocks a synthetic fixture, with its own distinct verdict', () => {
    // Distinct from 'roster' because the two are different facts: one is a
    // real person whose detail is not built yet, the other is not a person.
    expect(clientDetailGateVerdict(client({ source: 'synthetic-fixture' }), false)).toBe('fixture');
  });
});

describe('ClientDetailGateView', () => {
  const render = (verdict: 'allow' | 'roster' | 'fixture', clientName = 'Jane Athlete') =>
    renderToStaticMarkup(
      <ClientDetailGateView tool="Decisions" verdict={verdict} clientName={clientName} onSwitchToLocal={() => {}}>
        <div id="real-content">the coach's own progression ledger</div>
      </ClientDetailGateView>,
    );

  it('renders the real tool when allowed', () => {
    const html = render('allow');
    expect(html).toContain('real-content');
  });

  it('renders NEITHER the tool NOR its data when blocked for a roster client', () => {
    // The content must be entirely absent from the markup, not merely hidden
    // behind a warning — a hidden-but-present node is still a leak to anyone
    // reading the DOM instead of looking at the screen.
    const html = render('roster');
    expect(html).not.toContain('real-content');
    expect(html).toContain('Jane Athlete');
    expect(html).toContain('not readable here yet');
  });

  it('renders neither the tool nor its data when blocked for a fixture', () => {
    const html = render('fixture');
    expect(html).not.toContain('real-content');
    expect(html).toContain('synthetic handoff fixture');
  });

  it('names the specific tool, not a generic refusal reused everywhere', () => {
    const html = renderToStaticMarkup(
      <ClientDetailGateView tool="Nutrition" verdict="roster" clientName="Jane Athlete" onSwitchToLocal={() => {}}>
        <div>content</div>
      </ClientDetailGateView>,
    );
    expect(html).toContain('Nutrition');
  });

  it('gives the roster case an explanation distinct from the fixture case', () => {
    // A real, authorised athlete and an invented demonstration client fail for
    // different reasons, and the copy must not collapse them into one.
    const roster = render('roster');
    const fixture = render('fixture');
    expect(roster).toContain('layer 3');
    expect(fixture).not.toContain('layer 3');
  });
});
