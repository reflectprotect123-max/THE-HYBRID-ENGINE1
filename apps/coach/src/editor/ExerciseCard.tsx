import { isWarmup } from '@hybrid/engine';
import { fmtRest, summary, type CoachEx } from '../model';
import { IconRight, IconUp, Ltr, MICRO, WELL } from '../ui';

/*
 * One exercise, as a card.
 *
 * Split out of Editor.tsx, which had grown to 946 lines. `Ctl` lives here
 * rather than in a shared file because this card is its only caller — a
 * helper that travels with its user is one fewer file to open.
 */

/**
 * 05-coach-05. A grey header band carrying the letter chip, the movement name
 * and the set count; a prescription table beneath it when the card is open.
 */
export function ExCard({
  ex,
  letter,
  open,
  onToggle,
  onPick,
  onSet,
  onAddSet,
  onDelSet,
  onRest,
  onCue,
  onMove,
  onDelete,
  deleteArmed,
  armedClass,
}: {
  ex: CoachEx;
  letter: string;
  open: boolean;
  onToggle: () => void;
  onPick: () => void;
  onSet: (si: number, key: 't' | 'rpe', v: string) => void;
  onAddSet: () => void;
  onDelSet: (si: number) => void;
  onRest: (delta: number) => void;
  onCue: (v: string) => void;
  onMove: (dir: 1 | -1) => void;
  onDelete: () => void;
  /** True when this card's delete would destroy the day and awaits a confirming press. */
  deleteArmed: boolean;
  armedClass: string;
}) {
  const COLS = 'grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_40px]';
  const CELL =
    'num w-full border-l border-line bg-transparent px-1 py-1 text-5 font-[750] outline-none ' +
    'placeholder:font-[500] placeholder:text-dim focus:bg-gold-wash ' +
    'focus:shadow-[inset_0_0_0_1px_var(--color-gold)] focus-visible:outline-offset-0';

  if (!open) {
    return (
      <section className="overflow-hidden rounded-md border border-line bg-panel shadow-card transition-colors duration-150 hover:border-line2">
        <button onClick={onToggle} className="flex w-full items-center gap-1 bg-panel2 px-1.5 py-1 text-left">
          <Ltr>{letter}</Ltr>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-5 font-[750]">{ex.name || 'Exercise'}</b>
            <span className="num mt-0.5 block truncate text-3 text-muted">{summary(ex)}</span>
          </span>
          <span className="num shrink-0 text-3 font-[750] text-dim">{ex.sets.length} sets</span>
          <span className="shrink-0 text-dim" aria-hidden="true">
            <IconRight />
          </span>
        </button>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-md border border-gold-line bg-panel shadow-lift">
      <div className="flex items-center gap-1 border-b border-line bg-panel2 px-1.5 py-1">
        <Ltr>{letter}</Ltr>
        <span className="min-w-0 flex-1">
          {/* 05-coach-05's `.c-namewrap`: the name IS the movement picker. */}
          <button
            onClick={onPick}
            className="flex w-full items-center gap-1 rounded-sm border border-line2 bg-panel3 px-1 py-0.5 text-left transition-colors duration-150 hover:border-gold-line"
          >
            <b className="min-w-0 flex-1 truncate text-5 font-[750]">{ex.name || 'Exercise'}</b>
            <span className="shrink-0 text-3 text-dim" aria-hidden="true">
              ✎
            </span>
          </button>
          <span className="num mt-0.5 block truncate text-3 text-muted">{summary(ex)}</span>
        </span>
        <button
          onClick={onToggle}
          aria-label="collapse"
          className="grid h-4 w-4 shrink-0 place-items-center rounded-sm text-dim transition-colors duration-150 hover:bg-panel3 hover:text-text"
        >
          <IconUp />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-2">
        <div>
          <div className={MICRO + ' mb-1'}>Prescription</div>
          <div className="overflow-hidden rounded-sm border border-line bg-panel">
            <div className={COLS + ' border-b border-line bg-panel2'}>
              <div className={MICRO + ' px-1 py-1'}>Set</div>
              <div className={MICRO + ' border-l border-line px-1 py-1'}>Target</div>
              <div className={MICRO + ' border-l border-line px-1 py-1'}>RPE</div>
              <div className="border-l border-line" />
            </div>

            {ex.sets.map((st, si) => {
              const w = isWarmup(st);
              return (
                <div key={si} className={COLS + ' border-b border-line ' + (w ? 'bg-gold-wash/60' : '')}>
                  <span
                    className={
                      'num flex items-center px-1 text-2 font-[800] tracking-[.1em] uppercase ' +
                      (w ? 'text-gold2' : 'text-dim')
                    }
                  >
                    {w ? 'Warm' : 'Set ' + (si + 1)}
                  </span>
                  <input
                    value={st.t}
                    onChange={(e) => onSet(si, 't', e.target.value)}
                    placeholder="reps"
                    aria-label={`target for set ${si + 1}`}
                    className={CELL + (w ? ' text-muted' : ' text-text')}
                  />
                  <input
                    value={st.rpe}
                    onChange={(e) => onSet(si, 'rpe', e.target.value)}
                    placeholder={w ? '—' : 'RPE'}
                    aria-label={`target RPE for set ${si + 1}`}
                    className={CELL + (w ? ' text-dim' : ' text-gold2')}
                  />
                  {ex.sets.length > 1 ? (
                    <button
                      onClick={() => onDelSet(si)}
                      aria-label={`remove set ${si + 1}`}
                      className="grid place-items-center border-l border-line text-3 text-dim transition-colors duration-150 hover:bg-bad/10 hover:text-bad"
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="border-l border-line" />
                  )}
                </div>
              );
            })}

            <button
              onClick={onAddSet}
              className="w-full px-1 py-1 text-3 font-[650] text-muted transition-colors duration-150 hover:bg-panel2 hover:text-gold2"
            >
              ＋ Add set
            </button>
          </div>

          <p className="mt-1 max-w-[68ch] text-3 text-dim">
            Type what the athlete should hit — <b className="text-muted">8</b>, <b className="text-muted">8-12</b>,{' '}
            <b className="text-muted">max</b>. Start with <b className="text-muted">W</b> for a warm-up (
            <b className="text-muted">W</b> or <b className="text-muted">W10</b>). A different number per set makes a
            ladder.
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <div>
            <div className={MICRO + ' mb-1'}>Rest</div>
            <div className="inline-flex items-stretch overflow-hidden rounded-md border border-line bg-well shadow-well">
              <button
                onClick={() => onRest(-15)}
                aria-label="less rest"
                className="w-5 text-6 font-[800] text-gold2 transition-colors duration-150 hover:bg-panel2"
              >
                −
              </button>
              <span className="num grid min-w-10 place-items-center px-1 text-5 font-[800]">{fmtRest(ex.rest)}</span>
              <button
                onClick={() => onRest(15)}
                aria-label="more rest"
                className="w-5 text-6 font-[800] text-gold2 transition-colors duration-150 hover:bg-panel2"
              >
                +
              </button>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <label className={MICRO + ' mb-1 block'} htmlFor={'cue-' + ex.id}>
              Note for the athlete
            </label>
            <textarea
              id={'cue-' + ex.id}
              value={ex.cue}
              onChange={(e) => onCue(e.target.value)}
              rows={2}
              placeholder="Cues, or a prescribed load — the athlete reads this on the card."
              className={WELL + ' w-full resize-y px-1 py-1 text-4'}
            />
          </div>
        </div>

        <div className="flex justify-end gap-1 border-t border-line pt-1">
          <Ctl onClick={() => onMove(-1)} label="move up">
            ↑
          </Ctl>
          <Ctl onClick={() => onMove(1)} label="move down">
            ↓
          </Ctl>
          {deleteArmed ? (
            <button
              onClick={onDelete}
              aria-label="confirm — delete the whole session"
              title="This is the last exercise. Deleting it makes this a rest day and discards the title and note."
              className={armedClass}
            >
              Delete session?
            </button>
          ) : (
            <Ctl onClick={onDelete} label="remove" danger>
              ✕
            </Ctl>
          )}
        </div>
      </div>
    </section>
  );
}

function Ctl({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={
        'grid h-4 w-5 place-items-center rounded-sm border border-line2 text-3 transition-colors duration-150 ' +
        (danger ? 'text-dim hover:border-bad/50 hover:text-bad' : 'text-muted hover:border-gold-line hover:text-gold2')
      }
    >
      {children}
    </button>
  );
}
