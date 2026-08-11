import { resolveSession } from '@hybrid/auto-coach';
import { useDb } from '../store/db';
import { usePolicy } from '../store/policy';
import { cx } from '../ui';

const STATE_TONE: Record<string, string> = {
  uncertain: 'text-warn',
  safety_stop: 'text-bad',
};

/**
 * Exception surface for this account's own Auto-Coached activity — there is
 * no cross-athlete queue to build here, coach and athlete share one account.
 *
 * apps/web/src/autocoach/ledger.ts exists (built concurrently), but by
 * design it only records apply/undo of resolutions that were actually
 * applied — `canApply` in applyResolution.ts hard-excludes `safety_stop`,
 * so a safety exception can never reach the ledger, and `uncertain` is not a
 * state the resolver currently emits at all. The ledger therefore cannot
 * answer "recent safety_stop / uncertain resolutions" by construction. This
 * instead reads today's live resolution the same way `TodayAutoCoach` in
 * ResolutionPreview.tsx does, and shows it only when the state itself is an
 * exception — not every day's routine `normal`/`advisory` outcome.
 */
export function ExceptionHistorySection() {
  const { workouts, athleteState } = useDb();
  const policy = usePolicy();
  const today = new Date().toISOString().slice(0, 10);
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  const workout =
    workouts.find((w) => w.dates?.includes(today)) ?? workouts.find((w) => w.days?.includes(wd)) ?? null;

  const resolution = workout ? resolveSession({ workout, policy, state: athleteState }) : null;
  const exception =
    resolution && (resolution.state === 'safety_stop' || resolution.state === 'uncertain') ? resolution : null;

  return (
    <div className="mt-1 rounded border border-line bg-panel p-1">
      <h3 className="text-[10px] uppercase tracking-wider text-dim">Exceptions</h3>
      {!workout ? (
        <p className="mt-0.5 text-[11px] text-muted">No session scheduled today — nothing to check.</p>
      ) : !exception ? (
        <p className="mt-0.5 text-[11px] text-muted">No exception today — the resolver has nothing to flag.</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5">
          <li className="text-[11px]">
            <div className="flex items-baseline gap-1">
              <span className="tabular-nums text-dim">{today}</span>
              <span className={cx('ml-auto uppercase tracking-wide', STATE_TONE[exception.state])}>
                {exception.state.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-0.5 text-muted">{exception.athleteMessage}</p>
            <p className="mt-0.5 text-[10px] text-dim">{exception.reasonCodes.join(', ') || 'no reason codes'}</p>
          </li>
        </ul>
      )}
      <p className="mt-0.5 text-[10px] leading-snug text-dim">
        Shows today only. A fuller history depends on a decision ledger for Auto-Coached exceptions
        that does not exist in this codebase yet.
      </p>
    </div>
  );
}
