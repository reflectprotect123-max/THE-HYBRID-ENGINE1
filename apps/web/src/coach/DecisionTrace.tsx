import { resolveSession } from '@hybrid/auto-coach';
import type { Workout } from '@hybrid/engine';
import { useDb } from '../store/db';
import { usePolicy } from '../autocoach/policy';
import { cx } from '../ui';
import {
  buildDecisionTrace,
  OUTCOME_EXPLANATION,
  OUTCOME_LABEL,
  type ConstraintOutcome,
} from './trace';

/**
 * "Why did it decide that" for today's real session.
 *
 * ResolutionPreview shows the active constraints and TodayAutoCoach shows the
 * resulting operations, but nothing joins the two — so an active constraint
 * that changed nothing reads as a system that ignored it. This panel is that
 * join, plus the three parts of the resolver's own output that no surface
 * renders today: the readiness signals behind the band, the recovery-debt
 * estimate, and the abstention reason when the resolver declined to act.
 *
 * Read-only by construction, like ResolutionPreview: it calls the same pure
 * `resolveSession` the athlete's receipt calls and renders the return value.
 * Opening it cannot change the plan.
 */

const OUTCOME_TONE: Record<ConstraintOutcome, string> = {
  applied: 'text-gold2 outline-gold-line',
  permission_off: 'text-warn outline-warn/40',
  superseded_by_safety: 'text-warn outline-warn/40',
  out_of_domain: 'text-dim outline-line2',
  not_evaluated: 'text-dim outline-line2',
  no_action_defined: 'text-dim outline-line2',
  no_change: 'text-muted outline-line2',
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-ok',
  limited: 'text-warn',
  insufficient: 'text-bad',
};

const STATE_TONE: Record<string, string> = {
  normal: 'text-muted',
  advisory: 'text-gold2',
  uncertain: 'text-warn',
  safety_stop: 'text-bad',
};

/** Same lookup TodayAutoCoach and ExceptionHistory use — one day, one session. */
function todaysWorkout(workouts: Workout[], today: string): Workout | null {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  return (
    workouts.find((w) => w.dates?.includes(today)) ??
    workouts.find((w) => w.days?.includes(wd)) ??
    null
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="mt-0.5 flex items-baseline gap-1 text-xs">
      <span className="text-text">{label}</span>
      <span className={cx('ml-auto tabular-nums', tone ?? 'text-muted')}>{value}</span>
    </div>
  );
}

export function DecisionTrace({ onClose }: { onClose: () => void }) {
  const { workouts, athleteState } = useDb();
  const policy = usePolicy();
  const today = new Date().toISOString().slice(0, 10);
  const workout = todaysWorkout(workouts, today);
  const resolution = workout ? resolveSession({ workout, policy, state: athleteState }) : null;
  const domain = workout?.kind ?? 'strength';
  const trace = resolution ? buildDecisionTrace(athleteState, resolution, policy, domain) : null;

  const { readiness, recoveryDebt, dataQuality } = athleteState;

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Why today resolved this way"
    >
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[80vh] w-[min(520px,calc(100vw-32px))] overflow-y-auto rounded-md border border-line2 bg-panel3 p-2 shadow-2xl">
        <h2 className="text-sm font-semibold">Why today resolved this way</h2>
        <p className="mt-0.5 text-[11px] text-dim">
          The deterministic trace behind today&rsquo;s real session — every active constraint and
          what the resolver did with it. Read-only; opening this changes nothing.
        </p>

        {!workout || !resolution || !trace ? (
          <p className="mt-1 rounded border border-line bg-panel p-1 text-[11px] text-muted">
            No session scheduled today, so there is nothing to resolve.
          </p>
        ) : (
          <>
            {/* OUTCOME — what the resolver returned, including the gates */}
            <section className="mt-1 rounded border border-line bg-panel p-1">
              <h3 className="text-[10px] uppercase tracking-wider text-dim">Outcome</h3>
              <Row
                label="State"
                value={resolution.state.replace('_', ' ')}
                tone={cx('uppercase', STATE_TONE[resolution.state])}
              />
              <Row
                label="Confidence"
                value={resolution.confidence}
                tone={CONFIDENCE_TONE[resolution.confidence]}
              />
              <Row label="Session domain" value={domain} />
              <Row
                label="Confirmation required"
                value={resolution.requiresConfirmation ? 'yes' : 'no'}
              />
              <Row label="Auto-apply allowed" value={resolution.autoApplyAllowed ? 'yes' : 'no'} />
              {resolution.abstentionReason && (
                <p className="mt-0.5 border-t border-line pt-0.5 text-[11px] text-warn">
                  Abstained — {resolution.abstentionReason.replace(/_/g, ' ')}. The resolver
                  declined to act rather than guess.
                </p>
              )}
            </section>

            {/* CONSTRAINT TRACE — the join that does not exist anywhere else */}
            <section className="mt-1 rounded border border-line bg-panel p-1">
              <h3 className="text-[10px] uppercase tracking-wider text-dim">
                Constraints — and what became of each
              </h3>
              {trace.lines.length === 0 ? (
                <p className="mt-0.5 text-[11px] text-muted">
                  No active constraints. Nothing argued for a change today.
                </p>
              ) : (
                <ul className="mt-0.5 space-y-1">
                  {trace.lines.map((line) => (
                    <li key={`${line.constraint.code}:${line.constraint.domain}`}>
                      <div className="flex items-baseline gap-1">
                        <span className={cx('text-[11px]', line.constraint.hard ? 'text-warn' : 'text-muted')}>
                          {line.constraint.hard ? 'hard' : 'soft'}
                        </span>
                        <span className="min-w-0 text-[11px] text-text">{line.constraint.reason}</span>
                        <span
                          className={cx(
                            'ml-auto shrink-0 rounded-full px-1 py-[1px] text-[10px] uppercase tracking-wide outline outline-1',
                            OUTCOME_TONE[line.outcome],
                          )}
                        >
                          {OUTCOME_LABEL[line.outcome]}
                        </span>
                      </div>
                      <p className="text-[10px] text-dim">{OUTCOME_EXPLANATION[line.outcome]}</p>
                      {line.operations.length > 0 && (
                        <ul className="mt-[1px] space-y-[1px]">
                          {line.operations.map((o, i) => (
                            <li key={i} className="text-[11px] tabular-nums">
                              <span className="text-dim line-through">{o.before}</span>
                              <span className="text-muted"> → </span>
                              <span className="text-gold2">{o.after}</span>
                              <span className="ml-1 text-[9px] uppercase text-dim">
                                {o.materiality}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {trace.unattributedOperations.length > 0 && (
                <div className="mt-1 border-t border-line pt-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-dim">
                    Operations with no active constraint
                  </p>
                  <ul className="mt-[1px] space-y-[1px]">
                    {trace.unattributedOperations.map((o, i) => (
                      <li key={i} className="text-[11px] tabular-nums">
                        <span className="text-dim line-through">{o.before}</span>
                        <span className="text-muted"> → </span>
                        <span className="text-gold2">{o.after}</span>
                        <span className="ml-1 text-[9px] uppercase text-dim">{o.reasonCode}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* SIGNAL — the inputs behind the readiness band, never surfaced before */}
            <section className="mt-1 rounded border border-line bg-panel3 p-1">
              <h3 className="text-[10px] uppercase tracking-wider text-dim">
                Signals behind the readiness band
              </h3>
              <Row
                label="Readiness"
                value={`${readiness.score ?? '—'} · ${readiness.band}`}
                tone={readiness.band === 'unknown' ? 'text-dim' : 'text-muted'}
              />
              <Row
                label="Data quality"
                value={dataQuality === 'missing' ? 'missing' : dataQuality}
                tone={dataQuality === 'good' ? 'text-muted' : 'text-warn'}
              />
              {readiness.signals.length === 0 ? (
                <p className="mt-0.5 text-[11px] text-dim">
                  No signals fed this estimate — unknown, not assumed green.
                </p>
              ) : (
                <ul className="mt-0.5 space-y-[1px]">
                  {readiness.signals.map((s) => (
                    <li key={`${s.source}:${s.name}`} className="flex items-baseline gap-1 text-[11px]">
                      <span className="text-muted">{s.name}</span>
                      <span className="text-[9px] uppercase text-dim">{s.source}</span>
                      <span className="ml-auto tabular-nums text-text">{s.value}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-0.5 border-t border-line pt-0.5">
                <Row
                  label="Recovery debt"
                  value={`${recoveryDebt.score} · ${recoveryDebt.band} · ${recoveryDebt.daysObserved}d observed`}
                  tone={recoveryDebt.band === 'high' ? 'text-warn' : 'text-muted'}
                />
                {recoveryDebt.rationale.map((r) => (
                  <p key={r} className="text-[10px] text-dim">
                    · {r}
                  </p>
                ))}
              </div>
            </section>
          </>
        )}

        <div className="mt-1 flex justify-end">
          <button
            className="rounded px-1 py-0.5 text-xs text-muted outline outline-1 outline-line2 hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
