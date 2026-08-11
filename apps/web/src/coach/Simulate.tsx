import { useState } from 'react';
import { resolveSession, type AutoCoachResolution } from '@hybrid/auto-coach';
import { usePolicy } from '../store/policy';
import { cx } from '../ui';
import {
  buildFixtureSnapshot,
  buildFixtureWorkout,
  CONSTRAINT_PRESET_LABEL,
  SCENARIO_KIND_LABEL,
  type ConstraintPreset,
  type ScenarioKind,
} from './simulateFixtures';

const SCENARIO_KINDS: ScenarioKind[] = ['strength', 'conditioning'];
const CONSTRAINT_PRESETS: ConstraintPreset[] = [
  'none',
  'low_readiness',
  'time_limited',
  'pain_hold_active',
  'illness_flag_active',
];

const STATE_TONE: Record<string, string> = {
  normal: 'text-muted',
  advisory: 'text-gold2',
  uncertain: 'text-warn',
  safety_stop: 'text-bad',
};

/**
 * A coach-facing what-if tool. Runs the real, pure `resolveSession` against
 * a synthetic example workout and a synthetic athlete-state snapshot built
 * from the chosen preset — never `db.workouts` or the real `athleteState`,
 * and never the athlete's actual policy edits (the policy shown is
 * read-only). Nothing here writes to any store; the result panel is a
 * display of one pure function's return value and carries a persistent
 * SIMULATION label so it can never be mistaken for TodayAutoCoach's real
 * receipt in ResolutionPreview.tsx.
 */
export function Simulate({ onClose }: { onClose: () => void }) {
  const policy = usePolicy();
  const [kind, setKind] = useState<ScenarioKind>('strength');
  const [preset, setPreset] = useState<ConstraintPreset>('none');
  const [result, setResult] = useState<AutoCoachResolution | null>(null);

  const runSimulation = () => {
    const today = new Date().toISOString().slice(0, 10);
    const workout = buildFixtureWorkout(kind);
    const state = buildFixtureSnapshot(preset, today);
    setResult(resolveSession({ workout, policy, state }));
  };

  const ops = result?.operations.filter((o) => o.type !== 'keep_as_planned') ?? [];

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Simulate an Auto-Coached resolution"
    >
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[80vh] w-[min(480px,calc(100vw-32px))] overflow-y-auto rounded-md border border-line2 bg-panel3 p-2 shadow-2xl">
        <h2 className="text-sm font-semibold">Simulate a resolution</h2>
        <p className="mt-0.5 text-[11px] text-dim">
          Runs the real resolver against a synthetic example session and a synthetic athlete-state
          snapshot picked below — never today's real workout, never real signals. Nothing is applied
          or saved.
        </p>

        <div className="mt-1 rounded border border-line bg-panel p-1">
          <h3 className="text-[10px] uppercase tracking-wider text-dim">Scenario</h3>
          <label className="mt-0.5 flex items-center gap-1 text-xs text-text">
            Workout kind
            <select
              className="coach-input ml-auto"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as ScenarioKind);
                setResult(null);
              }}
            >
              {SCENARIO_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SCENARIO_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-0.5 flex items-center gap-1 text-xs text-text">
            Constraint preset
            <select
              className="coach-input ml-auto"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as ConstraintPreset);
                setResult(null);
              }}
            >
              {CONSTRAINT_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {CONSTRAINT_PRESET_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-0.5 text-[11px] text-dim">
            {SCENARIO_KIND_LABEL[kind]} — a synthetic example, one block
            {kind === 'strength' ? ', 3 sets' : ''}, not today's real session.
          </p>
        </div>

        <div className="mt-1 rounded border border-line bg-panel p-1">
          <h3 className="text-[10px] uppercase tracking-wider text-dim">Current policy (read-only)</h3>
          <div className="mt-0.5 flex items-baseline gap-1 text-xs">
            <span className="text-text">Mode</span>
            <span className="ml-auto text-muted">{policy.mode}</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1 text-xs">
            <span className="text-text">Status</span>
            <span className="ml-auto text-muted">{policy.status}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-dim">
            Simulate uses this policy exactly as it stands — change it from the Auto-Coached policy
            panel, not here.
          </p>
        </div>

        <div className="mt-1 flex justify-end gap-1">
          <button
            className="rounded bg-gold-wash px-1 py-0.5 text-xs text-gold2 outline outline-1 outline-gold-line focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={runSimulation}
          >
            Run simulation
          </button>
          <button
            className="rounded px-1 py-0.5 text-xs text-muted outline outline-1 outline-line2 hover:text-text focus-visible:outline-2 focus-visible:outline-gold2 focus-visible:outline-offset-2"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {result && (
          <div className="mt-1 rounded-md border-2 border-warn bg-well p-1">
            <span className="inline-block rounded-full bg-warn/20 px-1 py-[1px] text-[10px] font-semibold uppercase tracking-widest text-warn">
              Simulation — not applied, not real data
            </span>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-[10px] uppercase tracking-wider text-dim">Result</span>
              <span className={cx('ml-auto text-xs font-medium uppercase', STATE_TONE[result.state])}>
                {result.state.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted">{result.athleteMessage}</p>
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
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-dim">
              <span>confidence: {result.confidence}</span>
              <span>confirmation required: {result.requiresConfirmation ? 'yes' : 'no'}</span>
              <span>auto-apply allowed: {result.autoApplyAllowed ? 'yes' : 'no'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
