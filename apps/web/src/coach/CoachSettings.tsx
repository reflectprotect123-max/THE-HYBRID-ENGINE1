import { useEffect, useState, type ReactNode } from 'react';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import './coach-redesign.css';

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

export function CoachSettings() {
  const { repository } = useCoachWorkspace();
  const [section, setSection] = useState<Section>('Workspace');
  const [weekStart, setWeekStart] = useState('Monday');
  const [units, setUnits] = useState('Kilograms');
  const [notifications, setNotifications] = useState(true);
  const [library, setLibrary] = useState({ strength: true, conditioning: true, beginner: true });
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    repository.getSettings().then((settings) => {
      if (!active) return;
      setWeekStart(settings.weekStartsOn === 'monday' ? 'Monday' : 'Sunday');
      setUnits(settings.defaultLoadUnit === 'kg' ? 'Kilograms' : 'Pounds');
      setNotifications(settings.priorityNotifications);
      setLibrary({ strength: settings.visibleLibraries.strength, conditioning: settings.visibleLibraries.conditioning, beginner: settings.visibleLibraries.beginnerFoundations });
    }).catch(() => { if (active) setMessage('Saved settings could not be loaded. Defaults are shown.'); });
    return () => { active = false; };
  }, [repository]);

  const save = async () => {
    await repository.saveSettings({
      weekStartsOn: weekStart === 'Monday' ? 'monday' : 'sunday',
      defaultLoadUnit: units === 'Kilograms' ? 'kg' : 'lb',
      priorityNotifications: notifications,
      visibleLibraries: { strength: library.strength, conditioning: library.conditioning, beginnerFoundations: library.beginner },
    });
    setMessage('Workspace preferences saved in the replaceable demo repository.');
  };

  return (
    <main className="rd-content">
      <div className="st-grid">
        <nav className="st-tabs" aria-label="Settings sections">{SECTIONS.map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)} className={`st-tab${section === item ? ' active' : ''}`}>{item}</button>)}</nav>
        <div>
          {section === 'Workspace' && <SettingsSection title="Workspace" detail="How ARC looks and behaves for you."><SelectRow label="Training week begins" value={weekStart} onChange={setWeekStart} options={['Monday', 'Sunday']} /><SelectRow label="Default load unit" value={units} onChange={setUnits} options={['Kilograms', 'Pounds']} /><ToggleRow label="Priority notifications" detail="Safety, conflicts and programming gaps only." checked={notifications} onChange={setNotifications} /></SettingsSection>}
          {section === 'Programming' && <SettingsSection title="Programming" detail="Choose what appears in your Library. Progression rules remain versioned."><ToggleRow label="Strength library" detail="Exercises, sessions and reusable blocks." checked={library.strength} onChange={(checked) => setLibrary((current) => ({ ...current, strength: checked }))} /><ToggleRow label="Conditioning library" detail="Modalities, subsystems and intensity progressions." checked={library.conditioning} onChange={(checked) => setLibrary((current) => ({ ...current, conditioning: checked }))} /><ToggleRow label="Beginner foundations" detail="Keep genuinely accessible starting blocks visible by default." checked={library.beginner} onChange={(checked) => setLibrary((current) => ({ ...current, beginner: checked }))} /><details className="border-t border-line py-3 text-xs"><summary className="cursor-pointer font-medium">Advanced programming defaults</summary><p className="mt-1 text-muted">Block lengths, protected anchors and reduction bounds will live here once backed by versioned server policy.</p></details></SettingsSection>}
          {section === 'Decisions & safety' && <SettingsSection title="Decisions & safety" detail="These controls describe authority. Safety gates cannot be disabled."><ReadOnlyRow label="Progression increases" value="Coach approval required" /><ReadOnlyRow label="Pain or illness" value="Hold and human review" /><ReadOnlyRow label="Missing or contradictory data" value="Unknown · never inferred clear" /><ToggleRow label="Decision notifications" detail="Notify when an approval, conflict or safety review is waiting." checked={notifications} onChange={setNotifications} /><p className="border-t border-line pt-3 text-[11px] text-warn">Owner-controlled policies must be versioned, scoped and audited before this demo can change them.</p></SettingsSection>}
          {section === 'Coaches & access' && <SettingsSection title="Coaches & access" detail="Organisation-owner controls for the future multi-client backend."><ReadOnlyRow label="Organisation owner" value="You · full control" /><ReadOnlyRow label="Assistant coaches" value="0 invited" /><ReadOnlyRow label="Symptom reports" value="Visible to organisation coaches" /><ReadOnlyRow label="Private coach notes" value="Coach-only" /><button type="button" onClick={() => setMessage('Coach invitations are demonstrated only. Backend roles and tenant policies are not connected.')} className="mt-3 rounded-md border border-line2 bg-panel px-2 py-1.5 text-xs text-muted hover:text-text">Review access model</button></SettingsSection>}
          {section === 'Data & sync' && <SettingsSection title="Data & sync" detail="Be honest about what is local, connected or unavailable."><ReadOnlyRow label="Coach workspace" value="Local demonstration" /><ReadOnlyRow label="Multi-client data" value="Synthetic fixtures only" /><ReadOnlyRow label="Authoritative receipts" value="Backend required" /><ReadOnlyRow label="Offline replay" value="Not implemented" /><button type="button" onClick={() => setMessage('No sync was started. This front end does not transmit client data.')} className="mt-3 rounded-md border border-line2 bg-panel px-2 py-1.5 text-xs text-muted hover:text-text">Check connection</button></SettingsSection>}
          <div className="mt-4 flex items-center border-t border-line2 pt-3"><p className="text-[11px] text-dim">Demo preferences persist locally behind the CoachWorkspaceRepository contract.</p><button type="button" onClick={save} className="ml-auto rounded-md border border-gold-line bg-gold-wash px-3 py-1.5 text-xs font-semibold text-gold2">Save settings</button></div>
          {message && <p className="mt-2 text-xs text-good" role="status">✓ {message}</p>}
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
function SelectRow({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <label className="flex min-h-14 items-center gap-2 border-b border-line py-2 last:border-b-0"><span className="text-sm font-medium">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="ml-auto rounded-md border border-line2 bg-well px-2 py-1.5 text-xs text-text">{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
function ToggleRow({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex min-h-16 cursor-pointer items-center gap-3 border-b border-line py-2 last:border-b-0"><span><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block text-[11px] text-muted">{detail}</span></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="ml-auto h-4 w-4 accent-[var(--color-gold)]" /></label>; }
function ReadOnlyRow({ label, value }: { label: string; value: string }) { return <div className="flex min-h-14 items-center gap-2 border-b border-line py-2 last:border-b-0"><span className="text-sm font-medium">{label}</span><span className="ml-auto text-right text-xs text-muted">{value}</span></div>; }
