import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import type { ExperienceLevel, ProgramTemplate, TrainingDomain } from './contracts';

const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

function today(): string { return new Date().toISOString().slice(0, 10); }

export function CoachLibrary() {
  const { clients, selectedClient, selectClient, repository } = useCoachWorkspace();
  const [templates, setTemplates] = useState<readonly ProgramTemplate[]>([]);
  const [domain, setDomain] = useState<TrainingDomain>('strength');
  const [level, setLevel] = useState<ExperienceLevel>('beginner');
  const [days, setDays] = useState<2 | 3 | 4>(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(today());
  const [preferredWeekdays, setPreferredWeekdays] = useState<number[]>([1, 4]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    repository.listProgramTemplates()
      .then((items) => { if (active) setTemplates(items); })
      .catch(() => { if (active) setError('The Library could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repository]);

  const recommended = useMemo(
    () => templates.find((item) => item.domain === domain && item.level === level && item.sessionsPerWeek === days)
      ?? templates.find((item) => item.domain === domain && item.level === level)
      ?? templates.find((item) => item.domain === domain),
    [days, domain, level, templates],
  );
  const visible = templates.filter((item) => item.domain === domain);
  const selected = templates.find((item) => item.id === selectedId) ?? recommended;

  const toggleWeekday = (value: number) => setPreferredWeekdays((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort());
  const prepareAssignment = async () => {
    if (!selected || !selectedClient) return;
    if (preferredWeekdays.length === 0) { setError('Choose at least one preferred training day.'); return; }
    setError('');
    await repository.saveAssignmentDraft({
      id: `assignment:${selectedClient.id}:${selected.id}`,
      clientId: selectedClient.id,
      programTemplateId: selected.id,
      preferredStartDate: startDate,
      preferredWeekdays,
      baseProgramVersion: `${selected.id}:v1`,
      state: 'ready-for-coordinator',
      createdAt: new Date().toISOString(),
    });
    setMessage(`${selected.name} is prepared for ${selectedClient.name}. Preferred days are inputs; the Coordinator still resolves the week.`);
  };

  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="border-b border-line2 px-3 py-3 sm:px-4">
        <p className="text-[10px] uppercase tracking-[.18em] text-gold">ARC · library</p>
        <h1 className="mt-0.5 text-xl font-semibold sm:text-2xl">Build once. Coach the individual.</h1>
        <p className="mt-1 max-w-[68ch] text-xs text-muted">Choose a real engine progression model, then prepare athlete and schedule inputs for the Coordinator.</p>
      </header>

      <div className="grid gap-5 p-3 sm:p-4 xl:grid-cols-[350px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-4 xl:self-start" aria-labelledby="guide-title">
          <div className="flex items-baseline"><div><p className="text-[9px] uppercase tracking-wider text-gold">Quick start</p><h2 id="guide-title" className="text-base font-semibold">Prepare an assignment</h2></div><span className="ml-auto text-[10px] text-dim">Coordinator input</span></div>
          <div className="mt-3 space-y-3 border-y border-line2 py-3">
            <Choice label="Training system" values={['strength', 'conditioning']} value={domain} onChange={(value) => setDomain(value as TrainingDomain)} />
            <Choice label="Experience" values={['beginner', 'developing', 'experienced']} value={level} onChange={(value) => setLevel(value as ExperienceLevel)} />
            <Choice label="Sessions each week" values={['2', '3', '4']} value={String(days)} onChange={(value) => setDays(Number(value) as 2 | 3 | 4)} />
            <label className="block text-xs"><span className="mb-1 block font-medium">Assign to</span><select value={selectedClient?.id ?? ''} onChange={(event) => selectClient(event.target.value)} className="w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text">{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.source === 'synthetic-fixture' ? ' · fixture' : client.source === 'roster-summary' ? ' · summary only' : ''}</option>)}</select></label>
            <label className="block text-xs"><span className="mb-1 block font-medium">Preferred start</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-md border border-line2 bg-well px-2 py-2 text-sm text-text" /></label>
            <fieldset><legend className="text-xs font-medium">Preferred training days</legend><div className="mt-1 grid grid-cols-4 gap-1">{WEEKDAYS.map((day) => <button key={day.value} type="button" aria-pressed={preferredWeekdays.includes(day.value)} onClick={() => toggleWeekday(day.value)} className={`min-h-8 rounded-md border px-1 text-[11px] ${preferredWeekdays.includes(day.value) ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 bg-panel text-muted'}`}>{day.label}</button>)}</div><p className="mt-1 text-[10px] text-dim">Preferences are not resolved calendar positions.</p></fieldset>
          </div>
          {selected && <section className="mt-3 rounded-lg border border-gold-line/70 bg-gold-wash p-2.5" aria-live="polite"><p className="text-[9px] uppercase tracking-wider text-gold2">ARC recommends</p><h3 className="mt-0.5 text-sm font-semibold">{selected.name}</h3><p className="mt-1 text-xs text-muted">{selected.weeks} weeks · {selected.sessionsPerWeek} sessions/week · {selected.summary}</p><button type="button" onClick={prepareAssignment} className="mt-2 w-full rounded-md border border-gold-line bg-gold-wash px-2 py-1.5 text-xs font-semibold text-gold2">Prepare for {selectedClient?.name.split(' ')[0] ?? 'client'}</button></section>}
          {message && <p className="mt-2 text-xs text-good" role="status">✓ {message}</p>}
          {error && <p className="mt-2 text-xs text-bad" role="alert">{error}</p>}
        </aside>

        <div className="min-w-0 space-y-4">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-dim">Program templates</p>
            <div role="tablist" aria-label="Filter Library by training system" className="mt-1 flex gap-4 border-b border-line2">
              {(['strength', 'conditioning'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={domain === value}
                  onClick={() => setDomain(value)}
                  className={`min-h-11 -mb-px border-b-2 px-0.5 text-sm font-semibold capitalize transition-colors ${domain === value ? 'border-gold text-text' : 'border-transparent text-muted hover:text-text'}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div role="tabpanel" className="divide-y divide-line border-y border-line2">
            {!loading && error && (
              <div className="px-2 py-6 text-center" role="alert">
                <p className="text-sm text-bad">{error}</p>
                <p className="mt-1 text-xs text-dim">This is a connection problem, not an empty Library.</p>
              </div>
            )}
            {!loading && !error && visible.length === 0 && (
              <div className="px-2 py-6 text-center">
                <p className="text-sm text-muted">No {domain} templates published yet.</p>
                <p className="mt-1 text-xs text-dim">Build a session and publish it as a template to assign it to a client.</p>
                <Link to="/coach/author" className="mt-3 inline-block rounded-md border border-gold-line bg-gold-wash px-2 py-1.5 text-xs font-semibold text-gold2">Open the session builder</Link>
              </div>
            )}
            {visible.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id} className={`grid w-full gap-2 px-2 py-3 text-left hover:bg-panel sm:grid-cols-[minmax(0,1fr)_125px_110px_24px] ${selected?.id === item.id ? 'bg-panel' : ''}`}><div><div className="flex flex-wrap items-baseline gap-1.5"><h3 className="text-sm font-semibold">{item.name}</h3><span className="text-[9px] uppercase tracking-wide text-dim">{item.category}</span>{item.status === 'draft' && <span className="text-[9px] uppercase tracking-wide text-warn">Draft</span>}</div><p className="mt-0.5 text-xs text-muted">{item.summary}</p></div><div><p className="text-[9px] uppercase tracking-wide text-dim">Starting point</p><p className="mt-0.5 text-xs capitalize">{item.level}</p></div><div><p className="text-[9px] uppercase tracking-wide text-dim">Dose</p><p className="mt-0.5 text-xs">{item.sessionsPerWeek}× · {item.weeks} weeks</p></div><span aria-hidden="true" className="self-center text-gold2">→</span></button>)}
          </div>
          {selected && <section className="grid gap-3 rounded-lg border border-line2 bg-panel3 p-3 lg:grid-cols-[1fr_auto]"><div><p className="text-[9px] uppercase tracking-wider text-dim">{selected.source === 'engine-derived' ? 'Engine-derived progression' : 'Coach template progression'}</p><h2 className="mt-0.5 text-base font-semibold">{selected.name}</h2><ol className="mt-2 flex flex-wrap gap-1 text-xs">{selected.progression.stages.map((stage, index) => <li key={stage} className="rounded border border-line2 bg-well px-2 py-1"><span className="mr-1 text-gold2">{index + 1}</span>{stage}</li>)}</ol><p className="mt-2 text-[11px] text-dim">All increases remain coach-approval proposals. Pain, illness or contradictory data routes to hold or review.</p></div><div className="flex items-end gap-1"><Link to="/coach/author" className="rounded-md border border-line2 bg-panel px-2 py-1.5 text-xs text-muted hover:text-text">Open session builder</Link><button type="button" onClick={prepareAssignment} className="rounded-md border border-gold-line bg-gold-wash px-2 py-1.5 text-xs font-semibold text-gold2">Prepare assignment</button></div></section>}
        </div>
      </div>
    </main>
  );
}

function Choice({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (value: string) => void }) {
  return <fieldset><legend className="text-xs font-medium">{label}</legend><div className="mt-1 flex flex-wrap gap-1">{values.map((item) => <button key={item} type="button" aria-pressed={value === item} onClick={() => onChange(item)} className={`min-h-8 rounded-md border px-2 text-xs capitalize ${value === item ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 bg-panel text-muted hover:text-text'}`}>{item}</button>)}</div></fieldset>;
}
