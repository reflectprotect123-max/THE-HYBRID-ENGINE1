import { cx } from '../ui';
import { updatePolicy, usePolicy } from '../autocoach/policy';
import { ExceptionHistorySection } from './ExceptionHistory';

/**
 * Coach-facing view of the athlete-owned Auto-Coached policy. Everything
 * below the header is read-only by construction — the only control wired to
 * `updatePolicy` is Pause/Resume, mirroring the athlete-side control in
 * SessionReceipt. The coach can see the policy and halt it; only the athlete
 * changes what it's allowed to do.
 */

const MODE_LABEL: Record<string, string> = {
  shadow: 'Shadow — shown, never applied',
  assisted: 'Assisted — asks before applying',
  auto_daily: 'Auto-daily — applies automatically',
};

const STATUS_TONE: Record<string, string> = {
  active: 'text-ok',
  paused: 'text-warn',
  revoked: 'text-bad',
};

const PERMISSION_LABEL: Record<string, string> = {
  cap_intensity: 'Cap intensity',
  trim_conditioning_minutes: 'Trim conditioning minutes',
  hold_progression: 'Hold progression',
};

const PERMISSION_VALUE_TONE: Record<string, string> = {
  off: 'text-dim',
  ask_first: 'text-gold2',
  auto: 'text-ok',
};

export function PolicyInspector({ onClose }: { onClose: () => void }) {
  const policy = usePolicy();

  return (
    <div className="fixed inset-0 z-30 grid place-items-center" role="dialog" aria-modal="true" aria-label="Auto-Coached policy">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[80vh] w-[min(460px,calc(100vw-32px))] overflow-y-auto rounded-md border border-line2 bg-panel3 p-2 shadow-2xl">
        <div className="flex items-baseline gap-1">
          <h2 className="text-sm font-semibold">Auto-Coached policy</h2>
          <span className={cx('ml-auto text-xs uppercase tracking-wide', STATUS_TONE[policy.status])}>
            {policy.status}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-dim">
          This policy belongs to the athlete's account, not the bench. You can watch it and pause
          it; only the athlete changes what it's permitted to do.
        </p>

        <div className="mt-1 rounded border border-line bg-panel p-1">
          <div className="flex items-baseline gap-1">
            <span className="text-[10px] uppercase tracking-wider text-dim">Mode</span>
            <span className="ml-auto text-xs text-text">{MODE_LABEL[policy.mode] ?? policy.mode}</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-[10px] uppercase tracking-wider text-dim">Policy version</span>
            <span className="ml-auto text-xs tabular-nums text-text">{policy.version}</span>
          </div>
        </div>

        <div className="mt-1 rounded border border-line bg-panel p-1">
          <h3 className="text-[10px] uppercase tracking-wider text-dim">Permissions</h3>
          <ul className="mt-0.5 space-y-0.5">
            {(Object.keys(policy.permissions) as (keyof typeof policy.permissions)[]).map((key) => (
              <li key={key} className="flex items-baseline gap-1 text-xs">
                <span className="text-text">{PERMISSION_LABEL[key] ?? key}</span>
                <span className={cx('ml-auto uppercase tracking-wide', PERMISSION_VALUE_TONE[policy.permissions[key]])}>
                  {policy.permissions[key].replace('_', ' ')}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-1 rounded border border-line bg-panel p-1">
          <h3 className="text-[10px] uppercase tracking-wider text-dim">Limits</h3>
          <div className="mt-0.5 flex items-baseline gap-1 text-xs">
            <span className="text-text">RPE cap</span>
            <span className="ml-auto tabular-nums text-muted">{policy.rpeCap}</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1 text-xs">
            <span className="text-text">Minimum conditioning kept</span>
            <span className="ml-auto tabular-nums text-muted">
              {Math.round(policy.minConditioningFraction * 100)}%
            </span>
          </div>
        </div>

        <ExceptionHistorySection />

        <div className="mt-1 flex justify-end gap-1">
          <button
            className="rounded px-1 py-0.5 text-xs text-muted outline outline-1 outline-line hover:text-text disabled:opacity-40"
            disabled={policy.status === 'revoked'}
            onClick={() =>
              updatePolicy((p) => ({ ...p, status: p.status === 'paused' ? 'active' : 'paused' }))
            }
          >
            {policy.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            className="rounded px-1 py-0.5 text-xs text-muted outline outline-1 outline-line2 hover:text-text"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
