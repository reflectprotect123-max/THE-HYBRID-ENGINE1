import { useMemo, useState } from 'react';
import type { ProgramTemplate, TrainingDomain } from './contracts';
import './coach-redesign.css';

/*
 * The Library's Programs half — stage 3b of
 * `docs/superpowers/specs/2026-08-11-stage3b-programs-design.md`.
 *
 * Two things about where this sits.
 *
 * The mockup's stylesheet is the specification, as it has been for every
 * stage: `.lib-table` and its seven-column `.lib-row` grid describe the list,
 * and `#lib-detail-view[hidden]` / `.lib-days` / `.lib-ex-list` describe a
 * separate DETAIL VIEW rather than an inline expansion. The 11 August plan
 * said "expands a row", written before that rule set was read closely. The
 * stylesheet wins — this file adds no CSS.
 *
 * And the assign controls are here, not in a sidebar, because the sidebar is
 * gone. The owner deleted it on 11 August and it took the app's ONLY
 * program-assignment path with it: `saveAssignmentDraft` has had zero callers
 * since, which `CoachLibrary`'s own header comment predicted in as many words.
 * Re-homing it was always a UI job — the repository method never changed.
 *
 * What this screen does NOT do is recommend. The panel this replaces fell back
 * to a recommender while its label was hardcoded to "ARC recommends", so a
 * coach who picked a program themselves was told ARC had picked it. The coach
 * picks; the screen says they picked.
 */

/** Monday-first, matching the deleted configurator's own array exactly —
 *  including `Sun` carrying 0, which is what `Date#getDay` returns. */
const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

const DOMAINS: { value: TrainingDomain; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'conditioning', label: 'Conditioning' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Two letters for the row chip, from the program's own name. */
function initials(name: string): string {
  const words = name.split(/[\s·]+/).filter(Boolean);
  return (words[0]?.[0] ?? '?').concat(words[1]?.[0] ?? '').toUpperCase();
}

export interface ProgramsTabProps {
  templates: readonly ProgramTemplate[];
  loading: boolean;
  error: string;
  clients: readonly { id: string; name: string }[];
  onAssign: (template: ProgramTemplate, clientId: string, startDate: string, weekdays: number[]) => void;
}

export function ProgramsTab({ templates, loading, error, clients, onAssign }: ProgramsTabProps) {
  const [domain, setDomain] = useState<TrainingDomain>('strength');
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(() => templates.filter((item) => item.domain === domain), [templates, domain]);
  const open = visible.find((item) => item.id === openId) ?? null;

  return (
    <>
      {/*
        The training-system filter. `role="tab"` rather than a plain button
        because it selects between two views of the same list, which is what
        a tab is — and it is how the screen is addressed by test and by
        screen reader alike.
      */}
      <div className="lib-tabs" role="tablist" aria-label="Training system">
        {DOMAINS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={domain === item.value}
            className={domain === item.value ? 'active' : undefined}
            onClick={() => { setDomain(item.value); setOpenId(null); }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {open
        ? <ProgramDetail template={open} clients={clients} onBack={() => setOpenId(null)} onAssign={onAssign} />
        : <ProgramList domain={domain} templates={visible} loading={loading} error={error} onOpen={setOpenId} />}
    </>
  );
}

/*
 * A load failure and an empty Library are DIFFERENT, and rendering one for
 * both is a defect this screen was already fixed for once: a coach whose
 * connection dropped was told they had no programs, which is a reason to go
 * and write one rather than a reason to retry.
 */
function ProgramList({ domain, templates, loading, error, onOpen }: {
  domain: TrainingDomain;
  templates: readonly ProgramTemplate[];
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
}) {
  if (error) {
    return (
      <div className="lib-table" role="alert">
        <div className="lib-row" style={{ display: 'block', cursor: 'default' }}>
          <p className="lib-title" style={{ fontSize: 13 }}>{error}</p>
          <p className="lib-detail-sub">This is a connection problem, not an empty Library.</p>
        </div>
      </div>
    );
  }

  if (loading) return <p className="lib-sub" role="status">Loading the Library…</p>;

  if (templates.length === 0) {
    return <p className="lib-sub">No {domain} programs published yet.</p>;
  }

  return (
    <div className="lib-table">
      <div className="lib-table-head">
        <span />
        <span>Program</span>
        <span>Level</span>
        <span>Focus</span>
        <span className="th-team">Dose</span>
        <span className="th-by">Status</span>
        <span className="th-actions" />
      </div>
      {templates.map((template) => (
        <button key={template.id} type="button" className="lib-row" onClick={() => onOpen(template.id)}>
          <span />
          <span className="td-name">
            <span className="row-chip">{initials(template.name)}</span>
            <span className="td-name-text">
              <span className="n">{template.name}</span>
              <span className="n2">{template.summary}</span>
            </span>
          </span>
          <span className="td-diff">{template.level}</span>
          <span className="td-focus">{template.category}</span>
          <span className="td-team">{template.sessionsPerWeek}× · {template.weeks} weeks</span>
          <span className="td-by">{template.status}</span>
          <span className="td-actions" />
        </button>
      ))}
    </div>
  );
}

function ProgramDetail({ template, clients, onBack, onAssign }: {
  template: ProgramTemplate;
  clients: readonly { id: string; name: string }[];
  onBack: () => void;
  onAssign: ProgramsTabProps['onAssign'];
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [startDate, setStartDate] = useState(today());
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [problem, setProblem] = useState('');

  const toggle = (value: number) => setWeekdays((current) =>
    current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort());

  const submit = () => {
    // The guard the deleted configurator had, kept: the Coordinator resolves
    // placement, but it resolves it WITHIN the days the coach is willing to
    // train. With none chosen there is nothing to resolve inside.
    if (weekdays.length === 0) { setProblem('Choose at least one preferred training day.'); return; }
    if (!clientId) { setProblem('Choose an athlete to assign this to.'); return; }
    setProblem('');
    onAssign(template, clientId, startDate, weekdays);
  };

  return (
    <div>
      <div className="lib-detail-head">
        <span className="row-chip">{initials(template.name)}</span>
        <div>
          <h2>{template.name}</h2>
          <p className="lib-detail-sub">
            {template.category} · {template.level} · {template.sessionsPerWeek}× · {template.weeks} weeks
          </p>
        </div>
      </div>

      {/*
        Every program is in the empty state until phase 2 gives a program a way
        to hold more than one editable draft (`coach_workout_drafts` carries
        `unique (template_id)` today). So the empty state is the COMMON case
        here, not the edge, and it says what is true rather than rendering a
        blank panel that reads as a bug.
      */}
      {template.sessions.length === 0 ? (
        <p className="lib-sub">No sessions recorded for this program yet.</p>
      ) : (
        <div className="lib-days">
          {template.sessions.map((session, index) => (
            <div key={session.id} className="lib-day-col">
              <p className="lib-day-label">Session {index + 1}</p>
              <div className="lib-day-card">
                <p className="lib-day-card-title">{session.name}</p>
                <ul className="lib-ex-list">
                  {session.blocks.length === 0
                    ? <li><p>No blocks yet</p></li>
                    : session.blocks.map((block, bi) => (
                      <li key={bi}>
                        <span className="ex-badge">{String.fromCharCode(65 + bi)}</span>
                        <p>{blockLabel(block)}</p>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="lib-day-label" style={{ marginTop: 22 }}>Progression</p>
      <ul className="lib-ex-list">
        {template.progression.stages.map((stage) => (
          <li key={stage}><p>{stage}</p></li>
        ))}
      </ul>

      <p className="lib-day-label" style={{ marginTop: 22 }}>Assign</p>
      <div className="lib-toolbar">
        <label className="lib-detail-sub">
          Assign to
          <select className="rd-select" value={clientId} onChange={(event) => setClientId(event.target.value)}>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label className="lib-detail-sub">
          Preferred start
          <input className="rd-select" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
      </div>
      <div className="lib-tabs">
        {WEEKDAYS.map((day) => (
          <button
            key={day.value}
            type="button"
            aria-pressed={weekdays.includes(day.value)}
            className={weekdays.includes(day.value) ? 'active' : undefined}
            onClick={() => toggle(day.value)}
          >
            {day.label}
          </button>
        ))}
      </div>
      {/*
        The Coordinator owns placement. The screen this replaces said so, and
        saying it here is not decoration: a coach who picks Monday and is not
        told otherwise reasonably reads it as the day the session will happen.
      */}
      <p className="lib-detail-sub">Preferences are not resolved calendar positions.</p>
      {problem ? <p className="st-warning" role="alert">{problem}</p> : null}
      <div className="lib-detail-cta-row">
        <button type="button" className="lib-cta ghost" onClick={onBack}>Back to programs</button>
        <button type="button" className="lib-cta" onClick={submit}>Prepare assignment</button>
      </div>
    </div>
  );
}

/** A block's one-line name, without reaching into a shape this screen does
 *  not own. `@hybrid/engine`'s blocks are a union; every arm carries a
 *  `heading` or a `name` at most, so anything else is shown as its kind. */
function blockLabel(block: unknown): string {
  const b = block as { heading?: unknown; name?: unknown };
  if (typeof b?.heading === 'string' && b.heading) return b.heading;
  if (typeof b?.name === 'string' && b.name) return b.name;
  return 'Block';
}
