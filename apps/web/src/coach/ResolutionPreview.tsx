import { useEffect, useMemo, useRef } from 'react';
import { useDb } from '../store/db';
import { useWhoop } from '../cloud/whoop';
import { useConcept2 } from '../cloud/concept2';
import { cx } from '../ui';
import {
  acknowledge,
  ackKey,
  recordLedger,
  setReviewBaseline,
  slimPlan,
  useBench,
} from './bench-store';
import { resolveSession } from '@hybrid/auto-coach';
import { usePolicy } from '../store/policy';
import { AthleteStatus } from './AthleteStatus';
import { diffPlans } from './diff';

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

const STALE_MS = 24 * 60 * 60 * 1000;

function agoLabel(isoOrNull: string | null | undefined): { text: string; stale: boolean } {
  if (!isoOrNull) return { text: 'never synced', stale: true };
  const then = new Date(isoOrNull).getTime();
  if (!Number.isFinite(then)) return { text: 'sync time unknown', stale: true };
  const ms = Date.now() - then;
  const h = Math.floor(ms / 3_600_000);
  const text = h < 1 ? 'synced <1h ago' : h < 48 ? `synced ${h}h ago` : `synced ${Math.floor(h / 24)}d ago`;
  return { text, stale: ms > STALE_MS };
}

function IntegrationCards() {
  const whoop = useWhoop();
  const c2 = useConcept2();
  const wSync = agoLabel(whoop.lastSyncAt);
  const cSync = agoLabel(c2.lastSyncAt);
  const rec = whoop.sample?.recoveryScore;
  const recNum = rec == null ? null : Number(rec);
  const recTone =
    recNum == null ? 'text-dim' : recNum >= 67 ? 'text-ok' : recNum >= 34 ? 'text-warn' : 'text-bad';
  return (
    <div className="mt-0.5 space-y-0.5">
      <div className="rounded border border-line bg-well px-1 py-0.5">
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ok">Whoop</span>
          <span className={cx('ml-auto text-[10px]', whoop.connected && wSync.stale ? 'text-warn' : 'text-dim')}>
            {whoop.connected ? (wSync.stale ? `stale — ${wSync.text}` : wSync.text) : 'not connected'}
          </span>
        </div>
        {whoop.connected && whoop.sample ? (
          <div className="mt-0.5 flex flex-wrap gap-2 text-xs tabular-nums">
            {recNum != null && (
              <span>
                <b className={cx('font-semibold', recTone)}>{recNum}%</b>{' '}
                <span className="text-[9px] uppercase text-dim">recovery</span>
              </span>
            )}
            {whoop.sample.hrvMs != null && (
              <span>
                <b className="font-semibold">{String(whoop.sample.hrvMs)}</b>{' '}
                <span className="text-[9px] uppercase text-dim">hrv ms</span>
              </span>
            )}
            {whoop.sample.restingHr != null && (
              <span>
                <b className="font-semibold">{String(whoop.sample.restingHr)}</b>{' '}
                <span className="text-[9px] uppercase text-dim">rhr</span>
              </span>
            )}
            {whoop.sample.sleepPerformance != null && (
              <span>
                <b className="font-semibold">{String(whoop.sample.sleepPerformance)}%</b>{' '}
                <span className="text-[9px] uppercase text-dim">sleep</span>
              </span>
            )}
          </div>
        ) : (
          <p className="mt-0.5 text-[11px] text-dim">
            {whoop.connected
              ? 'Connected, no sample yet — readiness reads unknown, never assumed green.'
              : 'Not connected — readiness reads unknown, never assumed green.'}
          </p>
        )}
      </div>
      <div className="rounded border border-line bg-well px-1 py-0.5">
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-blue">Concept2</span>
          <span className={cx('ml-auto text-[10px]', c2.connected && cSync.stale ? 'text-warn' : 'text-dim')}>
            {c2.connected ? (cSync.stale ? `stale — ${cSync.text}` : cSync.text) : 'not connected'}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted">
          {c2.connected
            ? c2.results.length
              ? `${c2.results.length} logged result${c2.results.length === 1 ? '' : 's'} synced from the erg.`
              : 'Connected — no results synced yet.'
            : 'Not connected — erg results are not feeding the bench.'}
        </p>
      </div>
    </div>
  );
}

/* Today's session through the auto-coach resolver, coach's eyes: what the
   athlete's shadow receipt says, with the policy state visible. Read-only —
   the coach pauses or narrows the policy with the athlete, not silently. */
function TodayAutoCoach() {
  const { workouts, athleteState } = useDb();
  const policy = usePolicy();
  const today = new Date().toISOString().slice(0, 10);
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  const workout =
    workouts.find((w) => w.dates?.includes(today)) ??
    workouts.find((w) => w.days?.includes(wd)) ??
    null;
  if (!workout) return null;
  const r = resolveSession({ workout, policy, state: athleteState });
  const ops = r.operations.filter((o) => o.type !== 'keep_as_planned');
  // Nothing to review recedes to reference weight; a safety stop is the one
  // thing on this whole rail that should look like it needs a human — same
  // border-bad/40 treatment the athlete's own receipt uses for the identical
  // state, so the two surfaces agree on what "urgent" looks like.
  const needsEyes = ops.length > 0 || r.state === 'safety_stop' || r.state === 'uncertain';
  return (
    <section
      className={cx(
        'mt-1 rounded border p-1',
        r.state === 'safety_stop'
          ? 'border-bad/40 bg-panel'
          : needsEyes
            ? 'border-line bg-panel'
            : 'border-line bg-panel3',
      )}
    >
      <h3 className="text-[10px] uppercase tracking-wider text-dim">
        Today — auto-coached ({policy.status === 'paused' ? 'paused' : policy.mode})
      </h3>
      <p className={cx('mt-0.5 text-[11px]', r.state === 'safety_stop' ? 'text-bad' : 'text-muted')}>
        {r.athleteMessage}
      </p>
      {ops.length > 0 && (
        <ul className="mt-0.5 space-y-[1px]">
          {ops.map((o, i) => (
            <li key={i} className="text-[11px] tabular-nums">
              <span className="text-dim line-through">{o.before}</span>
              <span className="text-muted"> → </span>
              <span className="text-gold2">{o.after}</span>
              <span className="ml-1 text-[9px] uppercase text-dim">{o.reasonCode}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ResolutionPreview() {
  const { weeklyPlan, athleteState, workouts } = useDb();
  const bench = useBench();
  const { readiness, dataQuality, constraints, illness } = athleteState;
  const scheduled = weeklyPlan.entries;
  const drops = weeklyPlan.decisions.filter((d) => d.action === 'dropped');

  const slim = useMemo(() => slimPlan(weeklyPlan), [weeklyPlan]);
  const changes = useMemo(() => diffPlans(bench.lastPlan, slim), [bench.lastPlan, slim]);

  /* First sight of a week is the baseline, not a wall of "changes" — and new
     Coordinator drops enter the ledger once, when first observed. */
  const seededWeek = useRef<string | null>(null);
  useEffect(() => {
    if (!bench.lastPlan || bench.lastPlan.weekStart !== slim.weekStart) {
      if (seededWeek.current !== slim.weekStart) {
        seededWeek.current = slim.weekStart;
        setReviewBaseline(slim);
      }
      return;
    }
    const known = new Set(bench.lastPlan.drops.map((d) => `${d.proposalId}:${d.reasonCode}`));
    for (const d of slim.drops) {
      if (!known.has(`${d.proposalId}:${d.reasonCode}`)) recordLedger('coordinator', d.explanation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed off content identity
  }, [slim.weekStart, JSON.stringify(slim.drops)]);

  const titleFor = (proposalId: string) =>
    workouts.find((w) => w.id === proposalId)?.name || 'session';

  return (
    <div className="flex max-h-[calc(100vh-41px)] flex-col overflow-y-auto p-1 text-sm">
      <h2 className="px-0.5 text-[11px] uppercase tracking-[0.18em] text-dim">
        Resolution · week of {weeklyPlan.weekStart}
      </h2>

      {/* WHAT CHANGED — leads the rail, not buried under it. The highest-
          value line for a coach returning to a week they've already seen;
          the before/after the market never shows. */}
      {changes.length > 0 && (
        <section className="mt-1 rounded border border-gold-line bg-panel p-1">
          <h3 className="text-[10px] uppercase tracking-wider text-gold2">
            Changed since your last review
          </h3>
          <ul className="mt-0.5 space-y-0.5">
            {changes.map((c, i) => (
              <li key={i} className="text-[11px] text-muted">
                <span
                  className={cx(
                    'mr-1 text-[9px] uppercase tracking-wide',
                    c.kind === 'new-drop' ? 'text-warn' : 'text-gold2',
                  )}
                >
                  {c.kind.replace('-', ' ')}
                </span>
                {c.text}
              </li>
            ))}
          </ul>
          <button
            className="mt-1 rounded bg-gold-wash px-1 py-0.5 text-[11px] text-gold2 outline outline-1 outline-gold-line focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={() => {
              setReviewBaseline(slim);
              recordLedger('coach', `Reviewed ${changes.length} plan change${changes.length === 1 ? '' : 's'} for week of ${slim.weekStart}`);
            }}
          >
            Mark reviewed
          </button>
        </section>
      )}

      {/* SIGNAL — raw telemetry feeding the inference below; reference
          weight, never the thing a coach opens the bench to look at first. */}
      <section className="mt-1 rounded border border-line bg-panel3 p-1">
        <h3 className="text-[10px] uppercase tracking-wider text-dim">Signal — integrations</h3>
        <IntegrationCards />
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

      <AthleteStatus />

      <TodayAutoCoach />

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
            {drops.map((d) => {
              const acked = !!bench.acks[ackKey(slim.weekStart, d.proposalId, d.reasonCode)];
              const editable = workouts.some((w) => w.id === d.proposalId);
              return (
                <div key={`${d.proposalId}:${d.reasonCode}`} className={cx('py-0.5', acked && 'opacity-75')}>
                  <p className="text-[11px] text-muted">
                    <span className="text-warn">{REASON_LABEL[d.reasonCode] ?? d.reasonCode}</span>
                    {' — '}
                    {d.explanation}
                  </p>
                  {acked ? (
                    <span className="text-[10px] uppercase tracking-wide text-dim">reviewed</span>
                  ) : (
                    <span className="mt-0.5 flex gap-1">
                      <button
                        className="rounded px-1 py-[1px] text-[11px] text-muted outline outline-1 outline-line2 hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
                        onClick={() => {
                          acknowledge(slim.weekStart, d.proposalId, d.reasonCode);
                          recordLedger('coach', `Reviewed drop of “${titleFor(d.proposalId)}” (${d.reasonCode})`);
                        }}
                      >
                        Acknowledge
                      </button>
                      {/* "Adjust proposal" opened `/coach/planner/:id`, deleted
                          with the rest of the old authoring chain on 14 August
                          2026. Acknowledging a drop is unaffected — that is
                          this panel's own action and the one that records to
                          the ledger. The note below still says a proposal can
                          be adjusted; it is adjusted where the session is
                          edited now, not from here. */}
                    </span>
                  )}
                </div>
              );
            })}
            <p className="mt-0.5 text-[10px] leading-snug text-dim">
              A drop is the Coordinator holding a safety or capacity line — it cannot be overridden,
              but the proposal can be adjusted until it resolves.
            </p>
          </div>
        )}
      </section>

      {/* DECISION LEDGER — pure audit trail, the quietest thing on the rail */}
      {bench.ledger.length > 0 && (
        <section className="mt-1 rounded border border-line bg-panel3 p-1">
          <h3 className="text-[10px] uppercase tracking-wider text-dim">Decision ledger</h3>
          <ul className="mt-0.5 space-y-[1px]">
            {bench.ledger.slice(0, 8).map((l, i) => (
              <li key={`${l.at}:${i}`} className="flex gap-1 text-[10px] text-dim">
                <span
                  className={cx(
                    'w-[86px] shrink-0 uppercase tracking-wide',
                    l.who === 'coordinator' ? 'text-gold' : 'text-blue',
                  )}
                >
                  {l.who}
                </span>
                <span className="min-w-0">{l.what}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-1 px-0.5 text-[10px] leading-relaxed text-dim">
        The Coordinator resolves proposals against safety constraints — the bench proposes, it
        never overrides. Drops can be acknowledged or the proposal adjusted until it resolves;
        your review baseline powers the changed-since panel above.
      </p>
    </div>
  );
}
