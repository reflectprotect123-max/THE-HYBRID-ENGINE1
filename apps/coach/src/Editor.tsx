import { useState } from 'react';
import { isWarmup, ymd, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { useLib } from './store';
import { useCoachCloud } from './cloud';
import {
  COND_FORMATS,
  EFFORTS,
  LIBRARY,
  assertPublishable,
  condSummary,
  fmtLabel,
  fmtRest,
  isCond,
  letters,
  newCond,
  newEx,
  newBlock,
  newSet,
  summary,
  type CoachBlock,
  type CoachEx,
  type CoachSession,
} from './model';

/*
 * The session editor.
 *
 * One card per exercise, collapsed to a single line until you open it — the
 * point of the approved design was that a whole session should be readable at a
 * glance and only one thing should be editable at a time.
 *
 * Set targets are TYPED, not chipped. Chips could not express "8-12", a ladder,
 * or a warm-up, and every set that didn't fit the chips had to be worked around.
 */
export function Editor({
  publishing,
  setPublishing,
}: {
  publishing: boolean;
  setPublishing: (b: boolean) => void;
}) {
  const { lib, day, update } = useLib();
  const cloud = useCoachCloud();
  const [open, setOpen] = useState<{ b: number; e: number } | null>({ b: 0, e: 0 });
  const [pick, setPick] = useState<{ b: number; e: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [athlete, setAthlete] = useState('');
  // The coach's LOCAL day. toISOString() is UTC, so a coach east of Greenwich
  // would open the app in the morning and be offered yesterday's date — and one
  // west of it, tomorrow's. `scheduled_date` is the day the athlete sees the
  // session on, so that off-by-one lands the session on the wrong day.
  const [date, setDate] = useState(() => ymd(new Date()));

  /*
   * The editor stays mounted across a day switch (it only unmounts for a rest
   * day), so per-session state has to be reset explicitly. Otherwise Day 2 opens
   * showing "Valid — 2 blocks ready to send" left over from Day 1, and an open
   * card index that means something different in the new session. The athlete
   * and the date are deliberately NOT reset: publishing a whole week to one
   * athlete is the normal case.
   */
  const selKey = lib.sel.p + '/' + lib.sel.w + '/' + lib.sel.d;
  const [lastSel, setLastSel] = useState(selKey);
  if (lastSel !== selKey) {
    setLastSel(selKey);
    setOpen({ b: 0, e: 0 });
    setPick(null);
    setMsg('');
  }

  if (!day) return null;
  const s = day;
  const LTR = letters(s);

  /** Every edit goes through here so "saves as you go" stays true. */
  const edit = (fn: (sess: CoachSession) => void) =>
    update((d) => {
      const target = d.programs[d.sel.p].weeks[d.sel.w].days[d.sel.d];
      if (!target) return false;
      fn(target);
    });

  /**
   * A delete, followed by the same pruning `sanitizeSession` applies on load.
   *
   * Without it the two disagree: the editor is happy to keep a block with no
   * exercises, or a session with no blocks, but the loader drops both — so the
   * coach carries on typing a title and a note into something a reload will
   * throw away without a word. The published shape disagrees too: emit.newBlock
   * substitutes a nameless blank exercise for an empty block, so the athlete
   * receives a phantom card the coach never wrote.
   */
  const removeThenPrune = (fn: (sess: CoachSession) => void) => {
    setOpen(null);
    setPick(null);
    update((d) => {
      const slot = d.programs[d.sel.p].weeks[d.sel.w];
      const target = slot.days[d.sel.d];
      if (!target) return false;
      fn(target);
      target.blocks = target.blocks.filter((b) => isCond(b) || b.ex.length);
      if (!target.blocks.length) slot.days[d.sel.d] = null;
    });
  };

  /**
   * Validate first, always — a session that cannot cross the emit contract must
   * fail here, in front of the coach who can fix it, rather than on a phone.
   */
  function validate() {
    try {
      const snap = assertPublishable(s);
      setMsg(`Valid — ${snap.blocks.length} block${snap.blocks.length === 1 ? '' : 's'} ready to send.`);
      return true;
    } catch (e) {
      setMsg('Could not convert session: ' + (e as Error).message);
      return false;
    }
  }

  async function publish() {
    if (!validate()) return;
    const to = athlete || cloud.user?.id || '';
    if (!to) {
      setMsg('Sign in to send this to an athlete.');
      return;
    }
    setPublishing(true);
    const err = await cloud.publish(s, to, date);
    setPublishing(false);
    setMsg(err || `Sent to ${cloud.athletes.find((a) => a.id === to)?.label || 'athlete'} for ${date}.`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-2 font-[750] uppercase tracking-[.14em] text-dim">
        Week {lib.sel.w + 1} · Day {lib.sel.d + 1} · saves as you go
      </div>

      <input
        value={s.title}
        onChange={(e) => edit((d) => void (d.title = e.target.value))}
        spellCheck={false}
        aria-label="session name"
        className="w-full rounded-md border border-transparent bg-transparent text-8 font-[800] outline-none hover:border-line focus:border-gold-line"
      />

      <label className="block rounded-lg border border-line bg-panel p-2 shadow-card">
        <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">
          Coach instructions · travels with the session
        </span>
        <textarea
          value={s.note}
          onChange={(e) => edit((d) => void (d.note = e.target.value))}
          placeholder="Anything the athlete should read before starting…"
          rows={2}
          className="mt-1 w-full resize-y rounded-md border border-line bg-well px-1 py-1 text-4 outline-none focus:border-gold-line"
        />
      </label>

      {s.blocks.map((b, bi) => (
        <section key={bi}>
          <div className="mb-1 flex items-center gap-1">
            <input
              value={b.h}
              onChange={(e) => edit((d) => void (d.blocks[bi].h = e.target.value))}
              spellCheck={false}
              aria-label="block name"
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-0.5 text-5 font-[750] outline-none hover:border-line focus:border-gold-line"
            />
            {isCond(b) ? (
              <span className="text-3 text-dim">heart rate</span>
            ) : (
              <input
                value={b.mins}
                onChange={(e) => edit((d) => void ((d.blocks[bi] as CoachBlock).mins = e.target.value))}
                placeholder="mins"
                aria-label="block duration"
                className="num w-8 rounded-md border border-line bg-well px-0.5 py-0.5 text-center text-3 outline-none focus:border-gold-line"
              />
            )}
            <button
              onClick={() => removeThenPrune((d) => void d.blocks.splice(bi, 1))}
              aria-label="remove block"
              className="h-4 rounded-md border border-line2 px-1 text-3 text-dim hover:text-bad"
            >
              ✕
            </button>
          </div>

          {isCond(b) ? (
            <CondCard
              fmt={b.fmt}
              eff={b.eff}
              open={open?.b === bi}
              summary={condSummary(b)}
              label={fmtLabel(b.fmt)}
              onToggle={() => setOpen(open?.b === bi ? null : { b: bi, e: 0 })}
              onFmt={(v) => edit((d) => void ((d.blocks[bi] as never as { fmt: CondFmtKey }).fmt = v))}
              onEff={(v) => edit((d) => void ((d.blocks[bi] as never as { eff: EffortKey }).eff = v))}
            />
          ) : (
            <div className={b.ss ? 'rounded-lg border border-gold-line/40 bg-gold-wash/40 p-1' : undefined}>
              {b.ex.map((ex, ei) => (
                <div key={ex.id}>
                  <ExCard
                    ex={ex}
                    letter={LTR[bi + '-' + ei] || '?'}
                    open={open?.b === bi && open?.e === ei}
                    onToggle={() => setOpen(open?.b === bi && open?.e === ei ? null : { b: bi, e: ei })}
                    onPick={() => setPick({ b: bi, e: ei })}
                    onSet={(si, key, v) =>
                      edit((d) => void ((d.blocks[bi] as CoachBlock).ex[ei].sets[si][key] = v))
                    }
                    onAddSet={() => edit((d) => void (d.blocks[bi] as CoachBlock).ex[ei].sets.push(newSet()))}
                    onDelSet={(si) => edit((d) => void (d.blocks[bi] as CoachBlock).ex[ei].sets.splice(si, 1))}
                    onRest={(delta) =>
                      edit((d) => {
                        const e2 = (d.blocks[bi] as CoachBlock).ex[ei];
                        e2.rest = Math.max(0, Math.min(3600, e2.rest + delta));
                      })
                    }
                    onCue={(v) => edit((d) => void ((d.blocks[bi] as CoachBlock).ex[ei].cue = v))}
                    onMove={(dir) =>
                      edit((d) => {
                        const arr = (d.blocks[bi] as CoachBlock).ex;
                        const j = ei + dir;
                        if (j < 0 || j >= arr.length) return;
                        [arr[ei], arr[j]] = [arr[j], arr[ei]];
                      })
                    }
                    onDelete={() => removeThenPrune((d) => void (d.blocks[bi] as CoachBlock).ex.splice(ei, 1))}
                  />
                  {ei < b.ex.length - 1 ? (
                    <Seam
                      on={b.ss}
                      onClick={() => edit((d) => void ((d.blocks[bi] as CoachBlock).ss = !(d.blocks[bi] as CoachBlock).ss))}
                    />
                  ) : null}
                </div>
              ))}
              <button
                onClick={() => edit((d) => void (d.blocks[bi] as CoachBlock).ex.push(newEx()))}
                className="mt-1 h-4 rounded-md border border-dashed border-line2 px-1.5 text-3 font-[650] text-muted hover:border-gold-line hover:text-gold2"
              >
                ＋ Exercise
              </button>
            </div>
          )}
        </section>
      ))}

      <div className="flex flex-wrap gap-1">
        <AddBtn onClick={() => edit((d) => void d.blocks.push(newBlock('New block')))}>＋ Block</AddBtn>
        <AddBtn onClick={() => edit((d) => void d.blocks.push(newCond()))}>♥ Conditioning</AddBtn>
      </div>

      <div className="mt-2 border-t border-line pt-2">
        <div className="flex flex-wrap items-center gap-1">
          {cloud.user ? (
            <>
              <select
                value={athlete}
                onChange={(e) => setAthlete(e.target.value)}
                aria-label="athlete"
                className="h-6 rounded-md border border-line bg-well px-1 text-4 text-text outline-none focus:border-gold-line"
              >
                {cloud.athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="scheduled date"
                className="num h-6 rounded-md border border-line bg-well px-1 text-4 text-text outline-none focus:border-gold-line"
              />
              <button
                onClick={() => void publish()}
                disabled={publishing}
                className="h-6 rounded-md px-2.5 text-5 font-[650] text-[#1b1509] shadow-brass [background:var(--brass)] disabled:opacity-40"
              >
                {publishing ? 'Sending…' : 'Send to athlete'}
              </button>
            </>
          ) : (
            <button
              onClick={validate}
              className="h-6 rounded-md px-2.5 text-5 font-[650] text-[#1b1509] shadow-brass [background:var(--brass)]"
            >
              Validate &amp; publish
            </button>
          )}
        </div>
        {msg ? <p className="mt-1 text-4 text-muted">{msg}</p> : null}
        {!cloud.user ? (
          <p className="mt-1 text-3 text-dim">
            Sign in to send this to an athlete. Until then it stays on this machine — validation still runs, so you
            know it would cross the boundary cleanly.
          </p>
        ) : null}
      </div>

      {pick ? (
        <Picker
          onClose={() => setPick(null)}
          onPick={(name) => {
            edit((d) => void ((d.blocks[pick.b] as CoachBlock).ex[pick.e].name = name));
            setPick(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AddBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-5 rounded-md border border-dashed border-line2 px-2 text-4 font-[650] text-muted hover:border-gold-line hover:text-gold2"
    >
      {children}
    </button>
  );
}

/** The chain button between two cards. Clicking it makes them one superset. */
function Seam({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div className="relative h-2">
      <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
      <button
        onClick={onClick}
        title={on ? 'split them apart' : 'chain into a superset'}
        aria-label={on ? 'split the superset here' : 'chain into a superset'}
        className={
          'absolute top-1/2 left-1/2 grid h-3 w-3 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill border text-2 ' +
          (on ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 bg-panel text-dim hover:text-muted')
        }
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 12h6M8 8.5 5.5 11a3.5 3.5 0 0 0 5 5L13 13.5M16 15.5l2.5-2.5a3.5 3.5 0 0 0-5-5L11 10.5" />
        </svg>
      </button>
    </div>
  );
}

function ExCard({
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
}) {
  if (!open) {
    return (
      <section className="rounded-lg border border-line bg-panel shadow-card">
        <button onClick={onToggle} className="flex w-full items-center gap-1.5 p-1.5 text-left">
          <Ltr>{letter}</Ltr>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-5 font-[750]">{ex.name || 'Exercise'}</b>
            <span className="num block truncate text-3 text-dim">{summary(ex)}</span>
          </span>
          <span className="text-6 text-dim">›</span>
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gold-line bg-panel shadow-lift">
      <div className="flex items-center gap-1.5 p-1.5">
        <Ltr>{letter}</Ltr>
        <span className="min-w-0 flex-1">
          <button onClick={onPick} className="flex items-center gap-0.5 text-5 font-[750] hover:text-gold2">
            {ex.name || 'Exercise'}
            <span className="text-3 text-dim">✎</span>
          </button>
          <span className="num block truncate text-3 text-dim">{summary(ex)}</span>
        </span>
        <button onClick={onToggle} aria-label="collapse" className="text-6 text-dim hover:text-text">
          ▴
        </button>
      </div>

      <div className="border-t border-line p-2">
        <Row label="Sets & reps">
          <div className="flex flex-col gap-1">
            {ex.sets.map((st, si) => {
              const w = isWarmup(st);
              return (
                <div key={si} className="flex items-center gap-1">
                  <span
                    className={
                      'num w-8 shrink-0 text-3 font-[650] ' + (w ? 'text-gold2' : 'text-dim')
                    }
                  >
                    {w ? 'Warm' : 'Set ' + (si + 1)}
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
                    placeholder={w ? '—' : 'RPE'}
                    aria-label={`target RPE for set ${si + 1}`}
                    className="num h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 outline-none focus:border-gold-line"
                  />
                  {ex.sets.length > 1 ? (
                    <button
                      onClick={() => onDelSet(si)}
                      aria-label={`remove set ${si + 1}`}
                      className="h-4 w-4 rounded-md text-3 text-dim hover:text-bad"
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                </div>
              );
            })}
            <button
              onClick={onAddSet}
              className="h-4 w-fit rounded-md border border-dashed border-line2 px-1 text-3 text-muted hover:border-gold-line hover:text-gold2"
            >
              ＋ Add set
            </button>
            <p className="max-w-[52ch] text-3 text-dim">
              Type what the athlete should hit — <b className="text-muted">8</b>,{' '}
              <b className="text-muted">8-12</b>, <b className="text-muted">max</b>. Start with{' '}
              <b className="text-muted">W</b> for a warm-up (<b className="text-muted">W</b> or{' '}
              <b className="text-muted">W10</b>). A different number per set makes a ladder.
            </p>
          </div>
        </Row>

        <Row label="Rest">
          <div className="flex items-center gap-1">
            <Step onClick={() => onRest(-15)}>−</Step>
            <span className="num w-10 text-center text-4 font-[750]">{fmtRest(ex.rest)}</span>
            <Step onClick={() => onRest(15)}>+</Step>
          </div>
        </Row>

        <Row label="Note for the athlete">
          <textarea
            value={ex.cue}
            onChange={(e) => onCue(e.target.value)}
            rows={2}
            placeholder="Cues, or a prescribed load — the athlete reads this on the card."
            className="w-full resize-y rounded-md border border-line bg-well px-1 py-1 text-4 outline-none focus:border-gold-line"
          />
        </Row>

        <div className="mt-1.5 flex justify-end gap-1 border-t border-line pt-1.5">
          <Ctl onClick={() => onMove(-1)} label="move up">
            ↑
          </Ctl>
          <Ctl onClick={() => onMove(1)} label="move down">
            ↓
          </Ctl>
          <Ctl onClick={onDelete} label="remove" danger>
            ✕
          </Ctl>
        </div>
      </div>
    </section>
  );
}

function CondCard({
  fmt,
  eff,
  open,
  summary: sum,
  label,
  onToggle,
  onFmt,
  onEff,
}: {
  fmt: CondFmtKey;
  eff: EffortKey;
  open: boolean;
  summary: string;
  label: string;
  onToggle: () => void;
  onFmt: (v: CondFmtKey) => void;
  onEff: (v: EffortKey) => void;
}) {
  return (
    <section className={'rounded-lg border bg-panel shadow-card ' + (open ? 'border-gold-line' : 'border-line')}>
      <button onClick={onToggle} className="flex w-full items-center gap-1.5 p-1.5 text-left">
        <Ltr>♥</Ltr>
        <span className="min-w-0 flex-1">
          <b className="block text-5 font-[750]">{label}</b>
          <span className="block truncate text-3 text-dim">{sum}</span>
        </span>
        <span className="text-6 text-dim">{open ? '▴' : '›'}</span>
      </button>

      {open ? (
        <div className="border-t border-line p-2">
          <Row label="Format">
            <div className="flex flex-wrap gap-1">
              {COND_FORMATS.map(([k, name]) => (
                <Pill key={k} on={k === fmt} onClick={() => onFmt(k)}>
                  {name}
                </Pill>
              ))}
            </div>
          </Row>
          <Row label="Effort">
            <div className="flex flex-wrap gap-1">
              {EFFORTS.map(([k, name, band]) => (
                <Pill key={k} on={k === eff} onClick={() => onEff(k)}>
                  {name}
                  <i className="ml-0.5 text-2 not-italic opacity-70">{band}</i>
                </Pill>
              ))}
            </div>
          </Row>
        </div>
      ) : null}
    </section>
  );
}

function Picker({ onClose, onPick }: { onClose: () => void; onPick: (n: string) => void }) {
  const [q, setQ] = useState('');
  const list = LIBRARY.filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={onClose}>
      <div
        className="w-full max-w-[420px] rounded-lg border border-line2 bg-panel p-2 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search movements, or type your own"
          className="h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
        />
        <ul className="mt-1 max-h-[50vh] overflow-y-auto">
          {list.map((n) => (
            <li key={n}>
              <button onClick={() => onPick(n)} className="w-full rounded-md px-1 py-1 text-left text-4 hover:bg-panel2">
                {n}
              </button>
            </li>
          ))}
          {q && !list.includes(q) ? (
            <li>
              <button
                onClick={() => onPick(q)}
                className="w-full rounded-md px-1 py-1 text-left text-4 text-gold2 hover:bg-panel2"
              >
                Use “{q}”
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/* --- small shared bits --- */

function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <span className="num grid h-4 min-w-4 shrink-0 place-items-center rounded-sm border border-gold-line bg-gold-wash px-0.5 text-3 font-[800] text-gold2">
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-start gap-1.5">
      <label className="w-20 shrink-0 pt-0.5 text-2 font-[750] uppercase tracking-[.14em] text-dim">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Step({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-4 w-4 rounded-md border border-line2 bg-panel2 text-5 font-[750] text-muted hover:text-text"
    >
      {children}
    </button>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={
        'h-4 rounded-pill border px-1.5 text-3 font-[650] ' +
        (on ? 'border-done-line bg-done-bg text-done-ink' : 'border-line2 bg-panel2 text-muted hover:text-text')
      }
    >
      {children}
    </button>
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
        'h-4 w-4 rounded-md border border-line2 text-3 ' + (danger ? 'text-dim hover:text-bad' : 'text-muted hover:text-text')
      }
    >
      {children}
    </button>
  );
}
