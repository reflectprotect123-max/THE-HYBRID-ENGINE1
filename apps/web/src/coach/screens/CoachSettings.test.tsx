// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CoachSettings } from './CoachSettings';
import { FakeCoachWorkspaceRepository, openInvite, renderCoachScreen, rosterClient } from '../testing/coach-test-harness';
import type { CoachWorkspaceSettings } from '../data/contracts';

/**
 * `CoachSettings` loads persisted preferences through
 * `repository.getSettings()` in a mount effect before any control reflects
 * them, the same async-settle shape as every other coach-bench screen —
 * `act(async () => {})` flushes that load (and the provider's own client
 * resolution) before assertions run, matching `CoachNutrition.test.tsx`.
 */
async function renderSettings(repository: FakeCoachWorkspaceRepository = new FakeCoachWorkspaceRepository()) {
  const result = renderCoachScreen(<CoachSettings />, { repository });
  await act(async () => {});
  return result;
}

function savedSettingsFixture(over: Partial<CoachWorkspaceSettings> = {}): CoachWorkspaceSettings {
  return {
    weekStartsOn: 'sunday',
    defaultLoadUnit: 'lb',
    priorityNotifications: false,
    visibleLibraries: { strength: false, conditioning: true, beginnerFoundations: false },
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('CoachSettings', () => {
  it('renders all five section tabs with Workspace active by default', async () => {
    await renderSettings();

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const tabs = within(nav).getAllByRole('button');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Workspace',
      'Programming',
      'Decisions & safety',
      'Coaches & access',
      'Data & sync',
    ]);

    expect(within(nav).getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Programming' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 2, name: 'Workspace' })).toBeInTheDocument();
  });

  it('switches the visible section when a different tab is clicked', async () => {
    await renderSettings();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });

    expect(screen.queryByText('Strength library')).not.toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Programming' }));
    expect(screen.getByText('Strength library')).toBeInTheDocument();
    expect(screen.getByText('Conditioning library')).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Programming' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Training week begins')).not.toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: 'Decisions & safety' }));
    expect(screen.getByText('Progression increases')).toBeInTheDocument();
    expect(screen.getByText('Coach approval required')).toBeInTheDocument();
    expect(screen.queryByText('Strength library')).not.toBeInTheDocument();
  });

  it('loads saved settings on mount and populates the workspace and library controls', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.settings = savedSettingsFixture();
    await renderSettings(repo);

    expect(screen.getByDisplayValue('Sunday')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pounds')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Priority notifications/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Programming' }));
    expect(screen.getByRole('switch', { name: /Strength library/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /Conditioning library/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Beginner foundations/ })).not.toBeChecked();
  });

  it('saves the current form state through the repository and shows the success message', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    await renderSettings(repo);

    fireEvent.change(screen.getByDisplayValue('Monday'), { target: { value: 'Sunday' } });
    fireEvent.change(screen.getByDisplayValue('Kilograms'), { target: { value: 'Pounds' } });
    fireEvent.click(screen.getByRole('switch', { name: /Priority notifications/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

    expect(repo.settings).toEqual({
      weekStartsOn: 'sunday',
      defaultLoadUnit: 'lb',
      priorityNotifications: false,
      visibleLibraries: { strength: true, conditioning: true, beginnerFoundations: true },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      /* Said "in the replaceable demo repository" until 15 August 2026 — copy
         left over from before the bench was wired to Supabase, which read to a
         coach as "none of this is real". */
      'Workspace preferences saved.',
    );
    // The success voice: `.st-save-note` is the only class in the stylesheet
    // painted with `--color-ok`.
    expect(screen.getByRole('status')).toHaveClass('st-save-note');
  });

  /*
   * The honesty rows, per the spec's "Settings says where the data actually
   * lives" amendment (13 August 2026). This screen used to assert the OPPOSITE
   * of the truth — a "local demonstration" over "synthetic fixtures only" —
   * while the workspace sat on eight RLS-owned Supabase tables.
   *
   * The multi-client row is COUNTED rather than written, and these two cases
   * are what stops the count regressing into a written claim: a real roster is
   * reported as what it holds, and a roster that is merely a fixture set says
   * so instead of passing itself off as clients.
   */
  it('counts the multi-client row from the roster rather than asserting it', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [
      rosterClient({ id: 'a', name: 'Alex Morgan', source: 'engine-local' }),
      rosterClient({ id: 'b', name: 'Riley Roster', source: 'roster-summary' }),
      rosterClient({ id: 'c', name: 'Fixture Fiona', source: 'synthetic-fixture' }),
    ];
    await renderSettings(repo);

    fireEvent.click(screen.getByRole('button', { name: 'Data & sync' }));
    expect(screen.getByText('3 athletes · 1 fixture')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic fixtures only')).not.toBeInTheDocument();
    expect(screen.queryByText('Local demonstration')).not.toBeInTheDocument();
  });

  it('says so when every athlete on the roster is a fixture', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.clients = [rosterClient({ id: 'c', name: 'Fixture Fiona', source: 'synthetic-fixture' })];
    await renderSettings(repo);

    fireEvent.click(screen.getByRole('button', { name: 'Data & sync' }));
    expect(screen.getByText('1 athlete · all fixtures')).toBeInTheDocument();
  });

  /*
   * The three Decisions & safety rows are the ONE set this stage does not
   * touch: they describe the live auto-coach policy, and CLAUDE.md is explicit
   * that pain and illness are safety flags rather than ordinary readiness
   * penalties. Pinned by text so a future restyle cannot quietly soften them.
   */
  it('leaves the three safety rows saying exactly what they said', async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Decisions & safety' }));
    expect(screen.getByText('Coach approval required')).toBeInTheDocument();
    expect(screen.getByText('Hold and human review')).toBeInTheDocument();
    expect(screen.getByText('Unknown · never inferred clear')).toBeInTheDocument();
  });

  it('shows the load-failure message and keeps defaults when getSettings rejects', async () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.getSettings = async () => {
      throw new Error('simulated getSettings failure');
    };
    await renderSettings(repo);

    expect(screen.getByRole('status')).toHaveTextContent('Saved settings could not be loaded. Defaults are shown.');
    // A failure must NOT wear the success colour. `.st-save-note` is declared
    // after `.st-warning` in the stylesheet, so putting both on one element
    // would have shipped a red-meaning message in green ink.
    expect(screen.getByRole('status')).toHaveClass('st-warning');
    expect(screen.getByRole('status')).not.toHaveClass('st-save-note');
    expect(screen.getByDisplayValue('Monday')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kilograms')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Priority notifications/ })).toBeChecked();
  });
});

/*
 * Athlete invites — the coach's half of getting somebody onto a roster.
 *
 * The property under test is never "a button exists". It is that this screen
 * cannot, by any control on it, attach an athlete: it mints an offer, and the
 * copy it prints says so. A future edit that turned "Create athlete invite"
 * into "Add athlete" would still render, still pass a smoke test, and would
 * have reversed the consent model — so the words are pinned too.
 */
describe('CoachSettings · athlete invites', () => {
  const withOrg = () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.organizations = [{ id: 'org-1', name: 'Hybrid Barbell', role: 'coach' }];
    return repo;
  };

  const openAccess = () => fireEvent.click(screen.getByRole('button', { name: 'Coaches & access' }));

  it('mints a code for the coach organisation and never names an athlete', async () => {
    const repo = withOrg();
    await renderSettings(repo);
    openAccess();

    expect(screen.getByText('None created')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create athlete invite' }));
    await act(async () => {});

    // The ONLY argument the coach's half of this flow carries is the tenant.
    // There is no athlete id here, and there must never be one.
    expect(repo.mintedFor).toEqual(['org-1']);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Code created. It links nobody until the athlete redeems it.',
    );
    expect(screen.getByRole('status')).toHaveClass('st-save-note');
  });

  it('says an invite links nobody, rather than offering to add an athlete', async () => {
    await renderSettings(withOrg());
    openAccess();

    expect(screen.getByRole('button', { name: 'Create athlete invite' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add athlete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/redeeming it is what puts them on your roster/)).toBeInTheDocument();
  });

  it('shows an existing code grouped, with how long it has left', async () => {
    const repo = withOrg();
    repo.invites = [openInvite()];
    await renderSettings(repo);
    openAccess();

    // Grouped for reading aloud; `redeem_coach_invite` strips the separators.
    expect(screen.getByText('01234567 89ABCDEF 01234567 89ABCDEF')).toBeInTheDocument();
    expect(screen.getByText('Unused · expires in 3 days')).toBeInTheDocument();
    expect(screen.getByText('1 unused · 0 redeemed')).toBeInTheDocument();
  });

  it('revokes an unused code and says the roster is untouched', async () => {
    const repo = withOrg();
    repo.invites = [openInvite()];
    await renderSettings(repo);
    openAccess();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await act(async () => {});

    expect(repo.revokedInvites).toEqual(['invite-1']);
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Code revoked. Anyone already on your roster stays there.',
    );
  });

  it('offers no revoke on a code that was already redeemed', async () => {
    const repo = withOrg();
    repo.invites = [openInvite({ status: 'accepted', acceptedAt: '2026-08-13T09:00:00.000Z' })];
    await renderSettings(repo);
    openAccess();

    expect(screen.getByText('Redeemed · on your roster')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('disables minting and says why when the coach has no organisation', async () => {
    await renderSettings(new FakeCoachWorkspaceRepository());
    openAccess();

    expect(screen.getByRole('button', { name: 'Create athlete invite' })).toBeDisabled();
    expect(screen.getByText(/not an owner or coach of any organisation/)).toBeInTheDocument();
  });

  it('reports a failed mint in the warning voice, never the success one', async () => {
    const repo = withOrg();
    repo.createInviteError = 'too many open invites';
    await renderSettings(repo);
    openAccess();

    fireEvent.click(screen.getByRole('button', { name: 'Create athlete invite' }));
    await act(async () => {});

    // Same trap as the save row: `.st-save-note` is declared after
    // `.st-warning` and is coloured `--color-ok`, so a failure wearing both
    // classes ships in green.
    expect(screen.getByRole('status')).toHaveTextContent('too many open invites');
    expect(screen.getByRole('status')).toHaveClass('st-warning');
    expect(screen.getByRole('status')).not.toHaveClass('st-save-note');
  });

  it('says invites could not be loaded rather than showing none', async () => {
    const repo = withOrg();
    repo.listCoachInvites = async () => { throw new Error('simulated listCoachInvites failure'); };
    await renderSettings(repo);
    openAccess();

    expect(screen.getByText('Could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('None created')).not.toBeInTheDocument();
  });

  /*
   * THE BOOTSTRAP. Until 15 August 2026 a coach with no organisation was
   * permanently stuck — the warning told them the truth and offered no cure,
   * because nothing in the product could create the row every other coach
   * table hangs off. These two pin the cure and the honesty of the state it
   * replaces.
   */
  describe('with no organisation', () => {
    it('offers a way out rather than only naming the problem', async () => {
      const repo = new FakeCoachWorkspaceRepository();
      repo.organizations = [];
      await renderSettings(repo);
      openAccess();
      expect(screen.getByText(/not an owner or coach of any organisation/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create organisation/i })).toBeInTheDocument();
    });

    it('creates one, and the coach owns it', async () => {
      const repo = new FakeCoachWorkspaceRepository();
      repo.organizations = [];
      await renderSettings(repo);
      openAccess();
      fireEvent.change(screen.getByLabelText('organisation name'), { target: { value: 'Hybrid HQ' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /create organisation/i }));
      });
      expect(repo.createdOrganizations).toEqual(['Hybrid HQ']);
      expect(screen.getByText(/Hybrid HQ created\. You own it/i)).toBeInTheDocument();
    });

    it('will not create an unnamed one — the button stays disabled', async () => {
      const repo = new FakeCoachWorkspaceRepository();
      repo.organizations = [];
      await renderSettings(repo);
      openAccess();
      expect(screen.getByRole('button', { name: /create organisation/i })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('organisation name'), { target: { value: '   ' } });
      expect(screen.getByRole('button', { name: /create organisation/i })).toBeDisabled();
    });
  });
});

/*
 * ENDING A COACHING RELATIONSHIP — the coach's half, wired 15 August 2026.
 *
 * `end_coach_relationship` was applied on 14 August and the repository grew
 * its method the same day; nothing called it from either side until now. The
 * rules worth failing a build over: the tenant and the athlete both reach the
 * command, one press does not end anything, and the screen states what the
 * command deliberately does NOT do to the week already published.
 */
describe('CoachSettings · ending a coaching relationship', () => {
  const openAccess = () => fireEvent.click(screen.getByRole('button', { name: 'Coaches & access' }));

  const withRoster = () => {
    const repo = new FakeCoachWorkspaceRepository();
    repo.organizations = [{ id: 'org-1', name: 'Hybrid Barbell', role: 'coach' }];
    repo.relationships = [
      { organizationId: 'org-1', athleteUserId: 'athlete-1', name: 'Sam Okoye', isSelf: false },
      { organizationId: 'org-1', athleteUserId: 'coach-1', name: 'Ada Lovelace', isSelf: true },
    ];
    return repo;
  };

  it('lists the live relationships and says what comes with one without a grant', async () => {
    await renderSettings(withRoster());
    openAccess();

    expect(screen.getByText('2 active')).toBeInTheDocument();
    expect(screen.getByText('Sam Okoye')).toBeInTheDocument();
    // The coach's own self-coaching row is shown rather than folded away: it
    // is a relationship, and it can be ended.
    expect(screen.getByText('You, on your own roster')).toBeInTheDocument();
    expect(
      screen.getByText(/Nutrition and readiness are the athlete's to grant from their own phone/),
    ).toBeInTheDocument();
  });

  it('does NOT end anything on the first press — it asks', async () => {
    const repo = withRoster();
    await renderSettings(repo);
    openAccess();

    fireEvent.click(screen.getByRole('button', { name: 'End coaching, Sam Okoye' }));
    await act(async () => {});

    expect(repo.endedRelationships).toEqual([]);
    expect(screen.getByRole('button', { name: 'Yes — end coaching Sam Okoye' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('backs out cleanly, leaving the row exactly as it was', async () => {
    const repo = withRoster();
    await renderSettings(repo);
    openAccess();

    fireEvent.click(screen.getByRole('button', { name: 'End coaching, Sam Okoye' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(repo.endedRelationships).toEqual([]);
    expect(screen.getByRole('button', { name: 'End coaching, Sam Okoye' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ends it on confirmation, and says what happens to the week already published', async () => {
    const repo = withRoster();
    await renderSettings(repo);
    openAccess();

    fireEvent.click(screen.getByRole('button', { name: 'End coaching, Sam Okoye' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes — end coaching Sam Okoye' }));
    await act(async () => {});

    expect(repo.endedRelationships).toEqual([{ organizationId: 'org-1', athleteUserId: 'athlete-1' }]);
    expect(screen.queryByText('Sam Okoye')).not.toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    /* The half a coach would otherwise assume wrongly in either direction. The
       migration is explicit that the published week survives, and a screen
       that stays quiet about it lets a coach believe they revoked it. */
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sam Okoye is no longer on your roster. The week you already published stays on their phone until it is over; nothing new can be sent.',
    );
    expect(screen.getByRole('status')).toHaveClass('st-save-note');
  });

  it('reports a refused end in the warning voice, and keeps the athlete on the roster', async () => {
    const repo = withRoster();
    repo.endRelationshipError = 'no active coaching relationship to end';
    await renderSettings(repo);
    openAccess();

    fireEvent.click(screen.getByRole('button', { name: 'End coaching, Sam Okoye' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes — end coaching Sam Okoye' }));
    await act(async () => {});

    expect(screen.getByRole('status')).toHaveClass('st-warning');
    expect(screen.getByText('Sam Okoye')).toBeInTheDocument();
  });

  it('says the roster could not be loaded rather than showing none', async () => {
    const repo = withRoster();
    repo.listRelationshipsError = 'permission denied';
    await renderSettings(repo);
    openAccess();

    expect(screen.getByText('Your roster could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('0 active')).not.toBeInTheDocument();
  });
});
