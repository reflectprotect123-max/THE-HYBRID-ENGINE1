import { fmtRest, formatPct, isWarmup, pctForSet, rxLine, type Exercise, type LoggedSet } from '@hybrid/engine';
import { Card, LetterChip, cx } from '../../ui';

type PctMode = 'reps' | 'seconds' | 'pctFlat' | 'pctRange';

const MODE_LABEL: Record<PctMode, string> = {
  reps: 'Reps',
  seconds: 'Seconds',
  pctFlat: '% flat + reps',
  pctRange: '% range + reps',
};

function modeOf(ex: Exercise<LoggedSet>): PctMode {
  if (ex.mode === 'seconds') return 'seconds';
  const withPct = ex.sets.find((s) => s.pct1rm);
  if (!withPct || !withPct.pct1rm) return 'reps';
  return withPct.pct1rm.lo === withPct.pct1rm.hi ? 'pctFlat' : 'pctRange';
}

/**
 * One exercise, as a card — collapsed to a single line until opened. Split
 * out of `Planner.tsx`, which had grown past 500 lines doing every block
 * kind's job in one file.
 */
export function ExerciseCard({
  ex,
  letter,
  open,
  listId,
  onToggle,
  onNameChange,
  onSet,
  onAddSet,
  onDelSet,
  onRest,
  onDuplicate,
  onRemove,
  onModeChange,
  onPctChange,
}: {
  ex: Exercise<LoggedSet>;
  letter: string;
  open: boolean;
  /** Which datalist this movement name should offer — prep-first inside a
      warm-up block, logged movements everywhere else. */
  listId: string;
  onToggle: () => void;
  onNameChange: (v: string) => void;
  onSet: (si: number, key: 't' | 'rpe', v: string) => void;
  onAddSet: () => void;
  onDelSet: (si: number) => void;
  onRest: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onModeChange: (mode: PctMode) => void;
  onPctChange: (lo: number, hi: number) => void;
}) {
  const mode = modeOf(ex);
  const pctSet = ex.sets.find((s) => s.pct1rm);

  return (
    <Card className={open ? 'border-gold-line shadow-lift' : undefined}>
      <button className="flex w-full items-center gap-1 text-left" onClick={onToggle}>
        <LetterChip letter={letter} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-5 font-[750]">{ex.name || 'Exercise'}</b>
          <span className="num block truncate text-3 text-dim">{rxLine(ex)}</span>
        </span>
        <span className="text-6 text-dim">{open ? '▴' : '›'}</span>
      </button>

      {open ? (
        <div className="mt-1.5 border-t border-line pt-1.5">
          {/* A native datalist: no dependency, no popup to position, and no
              inline script — which matters, because the deployed CSP is
              script-src self and `check:csp` fails the build on inline script. */}
          <input
            value={ex.name}
            list={listId}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Movement"
            aria-label="movement name"
            className="h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
          />

          <div className="mt-1.5 flex gap-0.5" role="group" aria-label="target type">
            {(Object.keys(MODE_LABEL) as PctMode[]).map((m) => (
              <button
                key={m}
                // Guard against destroying a mode the selector cannot itself
                // represent (amrap, reps_seconds, completion all read back as
                // "Reps" here): if the button already LOOKS selected, tapping
                // it must be a no-op rather than a silent, permanent rewrite
                // of `ex.mode` to whatever this button's own value means.
                onClick={() => m !== mode && onModeChange(m)}
                aria-pressed={mode === m}
                className={cx(
                  'h-4 flex-1 rounded-md border px-1 text-2 font-[650] uppercase tracking-[.08em]',
                  mode === m ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 text-dim',
                )}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          {mode === 'pctFlat' || mode === 'pctRange' ? (
            <div className="mt-1 flex items-center gap-1">
              <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">% of 1RM</span>
              <input
                type="number"
                value={pctSet?.pct1rm?.lo ?? ''}
                onChange={(e) => {
                  const lo = Number(e.target.value) || 0;
                  onPctChange(lo, mode === 'pctFlat' ? lo : (pctSet?.pct1rm?.hi ?? lo));
                }}
                aria-label="percent low"
                className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
              />
              {mode === 'pctRange' ? (
                <>
                  <span className="text-3 text-dim">–</span>
                  <input
                    type="number"
                    value={pctSet?.pct1rm?.hi ?? ''}
                    onChange={(e) => onPctChange(pctSet?.pct1rm?.lo ?? 0, Number(e.target.value) || 0)}
                    aria-label="percent high"
                    className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                  />
                </>
              ) : null}
            </div>
          ) : null}

          <div className="mt-1.5 flex flex-col gap-1">
            {ex.sets.map((st, si) => (
              <div key={si} className="flex items-center gap-1">
                <span className={cx('num w-8 shrink-0 text-3 font-[650]', isWarmup(st) ? 'text-gold2' : 'text-dim')}>
                  {isWarmup(st) ? 'Warm' : 'Set ' + (si + 1)}
                </span>
                <input
                  value={st.t}
                  onChange={(e) => onSet(si, 't', e.target.value)}
                  placeholder="reps"
                  aria-label={`target for set ${si + 1}`}
                  className="num h-4 w-14 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                />
                <input
                  value={st.rpe}
                  onChange={(e) => onSet(si, 'rpe', e.target.value)}
                  placeholder={isWarmup(st) ? '—' : 'RPE'}
                  aria-label={`target RPE for set ${si + 1}`}
                  className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                />
                {(mode === 'pctFlat' || mode === 'pctRange') && !isWarmup(st) ? (
                  <span className="num text-2 text-gold2" aria-label={`percent of 1RM for set ${si + 1}`}>
                    {(() => {
                      const p = pctForSet(ex, si);
                      return p == null ? '' : formatPct(p);
                    })()}
                  </span>
                ) : null}
                {ex.sets.length > 1 ? (
                  <button
                    onClick={() => onDelSet(si)}
                    aria-label={`remove set ${si + 1}`}
                    className="h-4 w-4 text-3 text-dim hover:text-bad"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
            <button
              onClick={onAddSet}
              className="h-4 w-fit rounded-md border border-dashed border-line2 px-1 text-3 text-muted hover:border-gold-line hover:text-gold2"
            >
              ＋ Add set
            </button>
            <p className="max-w-[46ch] text-3 text-dim">
              Type what you want to hit — <b className="text-muted">8</b>, <b className="text-muted">8-12</b>,{' '}
              <b className="text-muted">max</b>. Start with <b className="text-muted">W</b> for a warm-up (
              <b className="text-muted">W</b> or <b className="text-muted">W10</b>).
            </p>
          </div>

          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Rest</span>
            <button
              onClick={() => onRest(-15)}
              className="h-4 w-4 rounded-md border border-line2 bg-panel2 text-5 text-muted"
            >
              −
            </button>
            <span className="num w-10 text-center text-4 font-[750]">{fmtRest(ex.rest || 0)}</span>
            <button
              onClick={() => onRest(15)}
              className="h-4 w-4 rounded-md border border-line2 bg-panel2 text-5 text-muted"
            >
              +
            </button>
            <button
              onClick={onDuplicate}
              className="ml-auto h-4 rounded-md border border-line2 px-1 text-3 text-dim hover:text-gold2"
            >
              Duplicate
            </button>
            <button onClick={onRemove} className="h-4 rounded-md border border-line2 px-1 text-3 text-dim hover:text-bad">
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
