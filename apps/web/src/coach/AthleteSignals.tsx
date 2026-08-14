import { useDb } from '../store/db';
import { useWhoop } from '../cloud/whoop';
import { useConcept2 } from '../cloud/concept2';
import { cx } from '../ui';
import { resolveSession } from '@hybrid/auto-coach';
import { usePolicy } from '../store/policy';
import { AthleteStatus } from './AthleteStatus';

/*
 * The signed-in athlete's own signals, in one place: what the wearables are
 * saying, what the athlete's state reads, and what today's session resolves to
 * through the auto-coach.
 *
 * SALVAGED FROM `ResolutionPreview.tsx`, 14 August 2026. That file was the
 * Coordinator's trust surface — signal / inference / action over a
 * `WeeklyPlan`'s entries and decisions — and it was deleted with the
 * Coordinator. These three panels were the part of it that never read a
 * weekly plan at all: they read Whoop, Concept2, `athleteState` and
 * `resolveSession`, none of which the Coordinator owned. Losing them would
 * have been collateral, so they moved instead of dying.
 *
 * Read-only by construction, exactly as the original was: every value here is
 * one `useDb`/`useWhoop`/`useConcept2`/`resolveSession` already derives.
 * Rendering this cannot change anything.
 */

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

/** The three panels together, in the order the old rail showed them. */
export function AthleteSignals() {
  return (
    <div className="space-y-1">
      <IntegrationCards />
      <AthleteStatus />
      <TodayAutoCoach />
    </div>
  );
}
