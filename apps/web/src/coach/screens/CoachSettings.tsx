import { useEffect, useState, type ReactNode } from 'react';
import { useCoachWorkspace } from '../data/CoachWorkspaceContext';
import type { ClientSummary, CoachInvite, CoachOrganization } from '../data/contracts';
import { failureMessage } from '../data/failure';
import '../coach-redesign.css';

/*
 * `/coach/settings` in the workspace redesign's own styling — stage 2 of
 * `docs/superpowers/specs/2026-08-11-coach-workspace-redesign-design.md`.
 *
 * Stage 1 ported the mockup's stylesheet whole, and the 34 `st-` rules for
 * this screen sat unused in `coach-redesign.css` from that day. There is no
 * mockup HTML left in the repo, so that rule set IS the specification: the
 * grid, the tab column, the panels, the row shapes, the toggle, the advanced
 * disclosure, the warning line and the save row are all described there,
 * phone block included. This file writes JSX against those class names and
 * adds no CSS of its own.
 *
 * The frame is `rd-content`, the same one every stage-1 screen uses.
 */

const SECTIONS = ['Workspace', 'Programming', 'Decisions & safety', 'Coaches & access', 'Data & sync'] as const;
type Section = typeof SECTIONS[number];

/**
 * The Multi-client row's value, DERIVED from the roster the workspace already
 * loaded rather than written down.
 *
 * The states are kept apart on purpose. An empty roster and a roster that has
 * not arrived yet look identical to a naive `clients.length`, and printing
 * "0 athletes" while the request is still in flight is the same class of lie
 * as the written claim this row replaced.
 */
function describeClients(clients: readonly ClientSummary[], error: string | null, loading: boolean): string {
  if (error) return 'Could not be counted';
  if (loading) return 'Counting…';
  if (clients.length === 0) return 'No athletes yet';

  const fixtures = clients.filter((client) => client.source === 'synthetic-fixture').length;
  const head = `${clients.length} athlete${clients.length === 1 ? '' : 's'}`;
  if (fixtures === 0) return head;
  if (fixtures === clients.length) return `${head} · all fixtures`;
  return `${head} · ${fixtures} fixture${fixtures === 1 ? '' : 's'}`;
}

/**
 * A 32-hex-character code in four readable groups.
 *
 * The separators are cosmetic and safe: `redeem_coach_invite` strips every
 * non-hex character before it compares, precisely so a code read aloud, or
 * retyped with the spacing a human sees, still works.
 */
function formatCode(code: string): string {
  return (code.match(/.{1,8}/g) ?? [code]).join(' ');
}

/** How many whole days remain, floored — "expires in 0 days" is today, which
 *  is what a coach needs to hear rather than a rounded-up tomorrow. */
function daysUntil(iso: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(iso) - now) / 86_400_000));
}

function describeInvite(invite: CoachInvite, now: number): string {
  switch (invite.status) {
    case 'accepted': return 'Redeemed · on your roster';
    case 'revoked': return 'Revoked';
    case 'expired': return 'Expired · unused';
    default: {
      const days = daysUntil(invite.expiresAt, now);
      return `Unused · expires in ${days} day${days === 1 ? '' : 's'}`;
    }
  }
}

/**
 * The summary line for the invite block.
 *
 * "Not loaded", "loaded and empty" and "loaded with invites" are three states,
 * and printing "none yet" while the request is still in flight is the same
 * class of lie the Multi-client row above was rewritten to stop telling.
 */
function describeInvites(invites: readonly CoachInvite[], error: string | null, loading: boolean): string {
  if (error) return 'Could not be loaded';
  if (loading) return 'Loading…';
  const open = invites.filter((invite) => invite.status === 'open').length;
  const accepted = invites.filter((invite) => invite.status === 'accepted').length;
  if (invites.length === 0) return 'None created';
  return `${open} unused · ${accepted} redeemed`;
}

export function CoachSettings() {
  const { repository, clients, loading: clientsLoading, error: clientsError } = useCoachWorkspace();
  const [section, setSection] = useState<Section>('Workspace');
  const [weekStart, setWeekStart] = useState('Monday');
  const [units, setUnits] = useState('Kilograms');
  const [notifications, setNotifications] = useState(true);
  const [library, setLibrary] = useState({ strength: true, conditioning: true, beginner: true });
  const [message, setMessage] = useState('');
  // Which VOICE the message speaks in, tracked separately from the text so the
  // save row never has to pattern-match a sentence to decide on a colour.
  const [loadFailed, setLoadFailed] = useState(false);

  /*
   * Athlete invites. The coach's HALF of getting somebody onto the roster —
   * this screen mints a code and nothing more. No control here attaches an
   * athlete, because none can: the roster row is written by the athlete's own
   * `redeem_coach_invite` call, from their session, with their own id.
   *
   * The repository methods are optional on the contract (the demo repository
   * has no server to mint against), so every call is guarded rather than
   * assumed — an older repository must render as "no organisation", not crash
   * the settings screen.
   */
  const [organizations, setOrganizations] = useState<readonly CoachOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [invites, setInvites] = useState<readonly CoachInvite[]>([]);
  const [invitesSettled, setInvitesSettled] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteFailed, setInviteFailed] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  const clientCount = describeClients(clients, clientsError, clientsLoading);
  const now = Date.now();
  const selectedOrganization = organizations.find((org) => org.id === organizationId) ?? organizations[0] ?? null;

  useEffect(() => {
    let active = true;
    setInvitesSettled(false);
    const listOrgs = repository.listCoachOrganizations?.bind(repository);
    const listInvites = repository.listCoachInvites?.bind(repository);
    Promise.all([listOrgs ? listOrgs() : [], listInvites ? listInvites() : []])
      .then(([orgs, list]) => {
        if (!active) return;
        setOrganizations(orgs);
        setOrganizationId((current) => current ?? orgs[0]?.id ?? null);
        setInvites(list);
      })
      .catch(() => { if (active) setInvitesError('Athlete invites could not be loaded.'); })
      .finally(() => { if (active) setInvitesSettled(true); });
    return () => { active = false; };
  }, [repository]);

  /*
   * The bootstrap. Until 15 August 2026 a coach with no organisation was
   * permanently stuck: the warning below told them the truth and offered no
   * cure, because nothing in the product — no RPC, no policy, no screen —
   * could create the row every other coach table hangs off.
   *
   * Deliberately NOT automatic on first load. Creating an organisation is an
   * act with a name attached, and silently minting "Your organisation" the
   * first time someone opens Settings makes an object nobody chose.
   */
  const [orgName, setOrgName] = useState('');
  const [orgBusy, setOrgBusy] = useState(false);

  const createOrganization = async () => {
    const make = repository.createOrganization?.bind(repository);
    if (!make || !orgName.trim()) return;
    setOrgBusy(true);
    try {
      const org = await make(orgName.trim());
      setOrganizations((current) => [...current, org]);
      setOrganizationId(org.id);
      setOrgName('');
      setInviteFailed(false);
      setInviteMessage(`${org.name} created. You own it — now create an invite.`);
    } catch (cause) {
      setInviteFailed(true);
      setInviteMessage(failureMessage(cause, 'The organisation could not be created.'));
    } finally {
      setOrgBusy(false);
    }
  };

  const createInvite = async () => {
    const mint = repository.createCoachInvite?.bind(repository);
    if (!mint || !selectedOrganization) return;
    setInviteBusy(true);
    try {
      const invite = await mint(selectedOrganization.id);
      setInvites((current) => [invite, ...current]);
      setInviteFailed(false);
      setInviteMessage('Code created. It links nobody until the athlete redeems it.');
    } catch (cause) {
      setInviteFailed(true);
      setInviteMessage(failureMessage(cause, 'The invite could not be created.'));
    } finally {
      setInviteBusy(false);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    const revoke = repository.revokeCoachInvite?.bind(repository);
    if (!revoke) return;
    setInviteBusy(true);
    try {
      const invite = await revoke(inviteId);
      setInvites((current) => current.map((item) => (item.id === invite.id ? invite : item)));
      setInviteFailed(false);
      setInviteMessage('Code revoked. Anyone already on your roster stays there.');
    } catch (cause) {
      setInviteFailed(true);
      setInviteMessage(failureMessage(cause, 'The invite could not be revoked.'));
    } finally {
      setInviteBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    repository.getSettings().then((settings) => {
      if (!active) return;
      setWeekStart(settings.weekStartsOn === 'monday' ? 'Monday' : 'Sunday');
      setUnits(settings.defaultLoadUnit === 'kg' ? 'Kilograms' : 'Pounds');
      setNotifications(settings.priorityNotifications);
      setLibrary({ strength: settings.visibleLibraries.strength, conditioning: settings.visibleLibraries.conditioning, beginner: settings.visibleLibraries.beginnerFoundations });
    }).catch(() => { if (active) { setLoadFailed(true); setMessage('Saved settings could not be loaded. Defaults are shown.'); } });
    return () => { active = false; };
  }, [repository]);

  const save = async () => {
    await repository.saveSettings({
      weekStartsOn: weekStart === 'Monday' ? 'monday' : 'sunday',
      defaultLoadUnit: units === 'Kilograms' ? 'kg' : 'lb',
      priorityNotifications: notifications,
      visibleLibraries: { strength: library.strength, conditioning: library.conditioning, beginnerFoundations: library.beginner },
    });
    setLoadFailed(false);
    /* Said "saved in the replaceable demo repository" until 15 August 2026,
       which was left over from before the bench was wired to Supabase and read
       to a coach as "none of this is real". `coach/index.tsx` has passed
       `supabaseCoachWorkspaceRepository` since layer 3. */
    setMessage('Workspace preferences saved.');
  };

  return (
    <main className="rd-content">
      <div className="st-grid">
        <nav className="st-tabs" aria-label="Settings sections">{SECTIONS.map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)} className={`st-tab${section === item ? ' active' : ''}`}>{item}</button>)}</nav>
        <div>
          {section === 'Workspace' && (
            <SettingsSection title="Workspace" detail="How ARC looks and behaves for you.">
              <SelectRow label="Training week begins" value={weekStart} onChange={setWeekStart} options={['Monday', 'Sunday']} />
              <SelectRow label="Default load unit" value={units} onChange={setUnits} options={['Kilograms', 'Pounds']} />
              <ToggleRow label="Priority notifications" detail="Safety, conflicts and programming gaps only." checked={notifications} onChange={setNotifications} />
            </SettingsSection>
          )}
          {section === 'Programming' && (
            <SettingsSection title="Programming" detail="Choose what appears in your Library. Progression rules remain versioned.">
              <ToggleRow label="Strength library" detail="Exercises, sessions and reusable blocks." checked={library.strength} onChange={(checked) => setLibrary((current) => ({ ...current, strength: checked }))} />
              <ToggleRow label="Conditioning library" detail="Modalities, subsystems and intensity progressions." checked={library.conditioning} onChange={(checked) => setLibrary((current) => ({ ...current, conditioning: checked }))} />
              <ToggleRow label="Beginner foundations" detail="Keep genuinely accessible starting blocks visible by default." checked={library.beginner} onChange={(checked) => setLibrary((current) => ({ ...current, beginner: checked }))} />
              <details className="st-advanced">
                <summary>Advanced programming defaults</summary>
                <p>Block lengths, protected anchors and reduction bounds will live here once backed by versioned server policy.</p>
              </details>
            </SettingsSection>
          )}
          {/* These three are NOT rewritten. They describe the live auto-coach
              policy — pain and illness really do hold for human review, and
              missing data really is left unknown rather than inferred clear —
              and they were already exactly right. */}
          {section === 'Decisions & safety' && (
            <SettingsSection title="Decisions & safety" detail="These controls describe authority. Safety gates cannot be disabled.">
              <ReadOnlyRow label="Progression increases" value="Coach approval required" />
              <ReadOnlyRow label="Pain or illness" value="Hold and human review" />
              <ReadOnlyRow label="Missing or contradictory data" value="Unknown · never inferred clear" />
              <ToggleRow label="Decision notifications" detail="Notify when an approval, conflict or safety review is waiting." checked={notifications} onChange={setNotifications} />
              <p className="st-warning">Owner-controlled policies must be versioned, scoped and audited before this bench can change them.</p>
            </SettingsSection>
          )}
          {section === 'Coaches & access' && (
            <SettingsSection title="Coaches & access" detail="Who can see what, and who is allowed to change it.">
              <ReadOnlyRow label="Organisation owner" value="You · full control" />
              {/* Stays. There is no invite mechanism to count, and none has
                  been used, so the written zero is not a claim that can rot. */}
              <ReadOnlyRow label="Assistant coaches" value="0 invited" />
              <ReadOnlyRow label="Symptom reports" value="Visible to organisation coaches" />
              <ReadOnlyRow label="Private coach notes" value="Coach-only" />

              {/*
                The invite block. Everything below states, in the screen's own
                words, the property the migration enforces: a code is an offer,
                and the athlete's redemption is what makes the link.
              */}
              {organizations.length > 1 && (
                <SelectRow
                  label="Invite athletes into"
                  detail="You coach in more than one organisation. An athlete joins the one you choose here."
                  value={selectedOrganization?.name ?? ''}
                  onChange={(name) => setOrganizationId(organizations.find((org) => org.name === name)?.id ?? null)}
                  options={organizations.map((org) => org.name)}
                />
              )}
              <ReadOnlyRow
                label="Athlete invites"
                detail="A code you send. The athlete redeeming it is what puts them on your roster — creating one links nobody."
                value={invitesSettled || invitesError ? describeInvites(invites, invitesError, false) : 'Loading…'}
                alert={Boolean(invitesError)}
              />
              {/* The newest few. An accepted invite is kept rather than swept
                  away — a coach chasing "it didn't work" needs to see that it
                  did — but the list is bounded so a year of them cannot bury
                  the rest of this panel. */}
              {invites.slice(0, 6).map((invite) => (
                <div className="st-row" key={invite.id}>
                  <RowText label={formatCode(invite.code)} detail={describeInvite(invite, now)} />
                  <span className="st-row-value">
                    {invite.status === 'open' && repository.revokeCoachInvite
                      ? <button type="button" className="cb-add-btn ghost" disabled={inviteBusy} onClick={() => revokeInvite(invite.id)}>Revoke</button>
                      : null}
                  </span>
                </div>
              ))}
              {invites.length > 6 ? <ReadOnlyRow label="Older invites" value={`${invites.length - 6} not shown`} /> : null}
              {invitesSettled && !invitesError && organizations.length === 0 ? (
                <>
                  <p className="st-warning">
                    You are not an owner or coach of any organisation, so there is nothing to invite an
                    athlete into. Create one and you own it.
                  </p>
                  <div className="st-row">
                    <input
                      className="st-input"
                      aria-label="organisation name"
                      placeholder="Organisation name"
                      value={orgName}
                      maxLength={120}
                      disabled={orgBusy || !repository.createOrganization}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                    <span className="st-row-value">
                      <button
                        type="button"
                        className="cb-add-btn"
                        disabled={orgBusy || !orgName.trim() || !repository.createOrganization}
                        onClick={createOrganization}
                      >
                        Create organisation
                      </button>
                    </span>
                  </div>
                </>
              ) : null}
              <div className="st-save-row">
                <button
                  type="button"
                  className="cb-add-btn ghost"
                  disabled={inviteBusy || !selectedOrganization || !repository.createCoachInvite}
                  onClick={createInvite}
                >
                  Create athlete invite
                </button>
                {inviteMessage
                  ? (inviteFailed
                      ? <p className="st-warning" role="status">{inviteMessage}</p>
                      : <p className="st-save-note show" role="status">{inviteMessage}</p>)
                  : null}
              </div>
            </SettingsSection>
          )}
          {section === 'Data & sync' && (
            <SettingsSection title="Data & sync" detail="Where this workspace's data actually lives.">
              <ReadOnlyRow
                label="Coach workspace"
                detail="Assignments, templates, decisions, read audit, grants, receipts."
                value="Supabase · eight RLS-owned tables"
              />
              {/* COUNTED, not written. `listClients()` is already on the
                  contract and the provider already calls it, so this row
                  reports what the roster actually holds. A written claim here
                  ("synthetic fixtures only") is exactly what went stale and
                  ended up asserting the opposite of the truth. */}
              <ReadOnlyRow
                label="Multi-client data"
                detail="Counted from the roster this workspace loaded, not asserted."
                value={clientCount}
                alert={Boolean(clientsError)}
              />
              {/* Neither "backend required" nor "backed". The table is in the
                  migration; nothing on this bench reads it yet. Saying either
                  half alone would be picking the flattering one. */}
              <ReadOnlyRow
                label="Authoritative receipts"
                detail="autocoach_receipts exists in the schema."
                value="Stored · not read by this bench"
              />
              {/* The row the screen was missing. These four preferences are the
                  one genuinely device-local thing here, and the screen used to
                  blame the whole workspace for what is true only of them. */}
              <ReadOnlyRow
                label="Workspace preferences"
                detail="The four settings on this screen, keyed hybrid-arc-settings-v1."
                value="This device only"
              />
              <ReadOnlyRow label="Offline replay" value="Not implemented" alert />
            </SettingsSection>
          )}
          {/*
            One save row, one place a message appears.
            `.st-save-note` is styled with `--color-ok`, so it is the SUCCESS
            voice and only the success voice. The load failure gets
            `.st-warning` instead — a separate element rather than an extra
            class, because `.st-save-note` is declared after `.st-warning` in
            the stylesheet and would win the colour, which is precisely the
            "red-meaning message in green ink" this must not ship.
          */}
          <div className="st-save-row">
            <button type="button" className="cb-add-btn ghost" onClick={save}>Save settings</button>
            {message
              ? (loadFailed
                  ? <p className="st-warning" role="status">{message}</p>
                  : <p className="st-save-note show" role="status">{message}</p>)
              : null}
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * One `.st-panel` per section.
 *
 * The stylesheet hides an inactive panel with `display: none` and shows
 * `.st-panel.active`. Only the active panel is ever rendered here, so nothing
 * needs hiding — but the one that IS rendered must still carry `.active`, or
 * it inherits `display: none` from the base rule and the screen goes blank.
 */
function SettingsSection({ title, detail, children }: { title: string; detail: string; children: ReactNode }) { const id = `settings-${title.replaceAll(' ', '-').toLowerCase()}`; return <section className="st-panel active" aria-labelledby={id}><h2 id={id} className="rd-section-label">{title}</h2><p className="rd-panel-note">{detail}</p>{children}</section>; }
/** The label column every row shares: `.st-row-label`, and `.st-row-sub`
 *  under it when there is something worth saying. */
function RowText({ label, detail }: { label: string; detail?: string }) {
  return (
    <span className="st-row-text">
      <span className="st-row-label">{label}</span>
      {detail ? <span className="st-row-sub">{detail}</span> : null}
    </span>
  );
}

function SelectRow({ label, detail, value, onChange, options }: { label: string; detail?: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="st-row">
      <RowText label={label} detail={detail} />
      <select className="rd-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

/**
 * `.st-toggle` is a BUTTON in the stylesheet's shape — a 40×24 pill with an
 * absolutely-positioned `.st-toggle-knob` that slides on `.on`. A checkbox
 * cannot be styled into that, so the input this replaced is gone.
 *
 * What the input gave for free has to be put back by hand, and is: the button
 * carries `role="switch"` and `aria-checked`, and takes its accessible name
 * from `aria-label` rather than from a wrapping `<label>`, which does not
 * name a button. Without those three it is a styled div — visible to a
 * sighted mouse user and to nobody else.
 */
function ToggleRow({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="st-row">
      <RowText label={label} detail={detail} />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`st-toggle${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="st-toggle-knob" />
      </button>
    </div>
  );
}

/**
 * A row that states a fact rather than changing one.
 *
 * `alert` paints the value in `--color-zone-red` and is for a value that
 * genuinely reads as a warning — something unavailable or blocked. It is not
 * for editorialising about a value that is merely uninteresting.
 */
function ReadOnlyRow({ label, detail, value, alert = false }: { label: string; detail?: string; value: string; alert?: boolean }) {
  return (
    <div className="st-row readonly">
      <RowText label={label} detail={detail} />
      <span className={`st-row-value${alert ? ' alert' : ''}`}>{value}</span>
    </div>
  );
}
