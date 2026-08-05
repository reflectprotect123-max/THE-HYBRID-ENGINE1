import { useDb } from '../store/db';
import { cx } from '../ui';

/*
 * The trust surface. Renders what the Coordinator resolved this week and —
 * more importantly — why, in three visibly distinct layers:
 *
 *   signal     what was observed (readiness, data quality, constraints)
 *   inference  what the system concluded (each decision's explanation)
 *   action     what the plan now says (scheduled / dropped / locked)
 *
 * Everything here is read-only by construction: the preview renders values
 * `useDb` already derives. Viewing it cannot modify the plan, which is rule 1
 * of the trust playbook enforced structurally rather than by discipline.
 */

const REASON_LABEL: Record<string, string> = {
  accepted: 'accepted',
  locked_existing: 'locked — already in the week',
  dropped_illness_safety: 'dropped — illness safety',
  dropped_pain_safety: 'dropped — pain safety',
  dropped_domain_cap: 'dropped — domain cap',
  dropped_no_available_slot: 'dropped — no open slot',
  dropped_interference: 'dropped — interference',
  dropped_spacing: 'dropped — spacing',
  dropped_weekly_cap: 'dropped — weekly cap',
};

function BandChip({ band }: { band: string }) {
  const tone =
    band === 'high'
      ? 'text-ok outline-ok/40'
      : band === 'unknown'
        ? 'text-dim outline-line2'
        : band === 'low'
          ? 'text-gold2 outline-gold-line'
          : 'text-muted outline-line2';
  return (
    <span className={cx('rounded-full px-1 py-[1px] text-[10px] uppercase tracking-wide outline outline-1', tone)}>
      {band}
    </span>
  );
}

export function ResolutionPreview() {
  const { weeklyPlan, athleteState } = useDb();
  const { readiness, dataQuality, constraints, illness } = athleteState;
  const scheduled = weeklyPlan.entries;
  const drops = weeklyPlan.decisions.filter((d) => d.action === 'dropped');

  return (
    <div className="flex max-h-[calc(100vh-41px)] flex-col overflow-y-auto p-1 text-sm">
      <h2 className="px-0.5 text-[11px] uppercase tracking-[0.18em] text-dim">
        Resolution · week of {weeklyPlan.weekStart}
      </h2>

      {/* SIGNAL */}
      <section className="mt-1 rounded border border-line bg-panel p-1">
        <h3 className="text-[10px] uppercase tracking-wider text-dim">Signal — observed</h3>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">readiness</span>
          <BandChip band={readiness.band} />
          {/* Missing data must read as unknown, never as green. */}
          <span className="text-xs text-muted">data</span>
          <BandChip band={dataQuality === 'missing' ? 'unknown' : dataQuality} />
          {illness.status !== 'clear' && (
            <span className="rounded-full px-1 py-[1px] text-[10px] uppercase tracking-wide text-warn outline outline-1 outline-warn/40">
              illness: {illness.status}
            </span>
          )}
        </div>
        {dataQuality === 'missing' && (
          <p className="mt-0.5 text-[11px] text-dim">
            No readiness data — the plan below is resolved without it, not despite it.
          </p>
        )}
        {readiness.rationale.length > 0 && (
          <ul className="mt-0.5 space-y-[1px] text-[11px] text-muted">
            {readiness.rationale.slice(0, 3).map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        )}
      </section>

      {/* INFERENCE */}
      <section className="mt-1 rounded border border-line bg-panel p-1">
        <h3 className="text-[10px] uppercase tracking-wider text-dim">Inference — constraints</h3>
        {constraints.length === 0 ? (
          <p className="mt-0.5 text-[11px] text-muted">No active constraints this week.</p>
        ) : (
          <ul className="mt-0.5 space-y-0.5">
            {constraints.map((c) => (
              <li key={`${c.code}:${c.domain}`} className="text-[11px]">
                <span className={cx('font-medium', c.hard ? 'text-warn' : 'text-gold2')}>
                  {c.hard ? 'hard' : 'soft'}
                </span>{' '}
                <span className="text-text">{c.reason}</span>
                <span className="block text-muted">→ {c.adjustment}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ACTION */}
      <section className="mt-1 rounded border border-line bg-panel p-1">
        <h3 className="text-[10px] uppercase tracking-wider text-dim">Action — this week's plan</h3>
        {scheduled.length === 0 ? (
          <p className="mt-0.5 text-[11px] text-muted">Nothing scheduled — no proposals survived.</p>
        ) : (
          <ul className="mt-0.5 space-y-0.5">
            {scheduled.map((e) => (
              <li key={e.id} className="flex items-baseline gap-1 text-[11px]">
                <span className="w-[34px] shrink-0 tabular-nums text-dim">{e.date.slice(5)}</span>
                <span
                  aria-hidden
                  className={cx(
                    'inline-block h-1 w-1 shrink-0 rounded-full',
                    e.domain === 'strength' ? 'bg-gold' : 'bg-blue',
                  )}
                />
                <span className="min-w-0 truncate text-text">{e.title}</span>
                {e.locked && <span className="text-[10px] text-dim">locked</span>}
              </li>
            ))}
          </ul>
        )}
        {drops.length > 0 && (
          <div className="mt-1 border-t border-line pt-0.5">
            {drops.map((d) => (
              <p key={d.proposalId} className="text-[11px] text-muted">
                <span className="text-warn">{REASON_LABEL[d.reasonCode] ?? d.reasonCode}</span>
                {' — '}
                {d.explanation}
              </p>
            ))}
          </div>
        )}
      </section>

      <p className="mt-1 px-0.5 text-[10px] leading-relaxed text-dim">
        Read-only preview. The Coordinator resolves proposals against safety constraints — the
        bench proposes, it never overrides. Per-change decisions and plan versions arrive in
        phase 3.
      </p>
    </div>
  );
}
