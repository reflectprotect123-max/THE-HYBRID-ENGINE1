import { useEffect, useState, type KeyboardEvent } from 'react';
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
import { ADD, BRASS, Field, IconCheck, IconLink, IconRight, IconSend, IconUp, Ltr, MICRO, WELL } from './ui';

/*
 * The session editor.
 *
 * One card per exercise, collapsed to a single line until you open it — the
 * point of the approved design was that a whole session should be readable at a
 * glance and only one thing should be editable at a time.
 *
 * Set targets are TYPED, not chipped. Chips could not express "8-12", a ladder,
 * or a warm-up, and every set that didn't fit the chips had to be worked around.
 *
 * The layout is two columns on a wide screen: the session itself on the left,
 * and a sticky sidecar on the right holding the two things that are true of the
 * whole session rather than of one exercise — the coach's instructions
 * (design/cards/05-coach-04) and delivery (05-coach-01's `.c-assign`). On a
 * laptop that turns a 660px ribbon of content into a page that uses the machine
 * it runs on.
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
   * Which delete control, if any, is ARMED — waiting for a confirming second
   * press because the delete it describes would destroy the whole day, not
   * just the thing under the pointer. Keyed by control ('b2', 'e1-0') so only
   * the pressed control changes face. It reverts on its own after a few
   * seconds: an armed destructive button left behind is a trap.
   */
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(id);
  }, [armed]);

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
    setArmed(null);
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
    setArmed(null);
    update((d) => {
      const slot = d.programs[d.sel.p].weeks[d.sel.w];
      const target = slot.days[d.sel.d];
      if (!target) return false;
      fn(target);
      target.blocks = target.blocks.filter((b) => isCond(b) || b.ex.length);
      if (!target.blocks.length) slot.days[d.sel.d] = null;
    });
  };

  /** Would this delete, after the pruning above, leave the day with nothing? */
  const destroysDay = (fn: (sess: CoachSession) => void) => {
    const probe = structuredClone(s);
    fn(probe);
    return probe.blocks.filter((b) => isCond(b) || b.ex.length).length === 0;
  };

  /**
   * The gate in front of `removeThenPrune`. The pruning itself is correct — a
   * day with nothing in it IS a rest day — but entering it must not be silent:
   * removing the last exercise also discards the title, the note and the
   * heading. So a delete that would do that arms the control instead
   * (`--color-bad`, reading "Delete session?"), and only a second press within
   * a few seconds goes through. Ordinary deletes stay one tap.
   */
  const requestRemove = (key: string, fn: (sess: CoachSession) => void) => {
    if (armed !== key && destroysDay(fn)) {
      setArmed(key);
      return;
    }
    removeThenPrune(fn);
  };

  /** The armed face of a delete control — shared by both delete sites. */
  const ARMED_BTN =
    'inline-flex h-4 items-center rounded-md border border-bad/60 bg-bad/10 px-1 text-2 font-[800] ' +
    'tracking-[.08em] uppercase text-bad transition-colors duration-150 hover:bg-bad/20';

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
    <div className="mx-auto grid w-full max-w-[1240px] gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* ------------------------------------------------ the session itself */}
      <div className="min-w-0">
        <div className={MICRO}>
          Week {lib.sel.w + 1} · Day {lib.sel.d + 1} · saves as you go
        </div>

        <input
          value={s.title}
          onChange={(e) => edit((d) => void (d.title = e.target.value))}
          spellCheck={false}
          aria-label="session name"
          className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-0.5 py-0.5 text-8 font-[800] tracking-[-.02em] outline-none transition-colors duration-150 hover:border-line2 focus:border-gold-line focus:bg-well"
        />

        <div className="mt-2 flex flex-col gap-2">
          {s.blocks.map((b, bi) => (
            <section key={bi}>
              {/* The block heading is an input that still reads as a heading —
                  no edit mode to enter or leave. From the concept mock's
                  `.sech`, which is the answer this repo already reached. */}
              <div className="mb-1 flex items-center gap-1">
                <input
                  value={b.h}
                  onChange={(e) => edit((d) => void (d.blocks[bi].h = e.target.value))}
                  spellCheck={false}
                  aria-label="block name"
                  size={Math.max(6, Math.min(28, b.h.length + 1))}
                  className="min-w-0 rounded-sm border border-transparent bg-transparent px-0.5 py-0.5 text-3 font-[800] tracking-[.14em] text-gold2 uppercase outline-none transition-colors duration-150 hover:border-line2 focus:border-gold-line focus:bg-well"
                />
                <span className="h-px flex-1 bg-line" />
                {isCond(b) ? (
                  <span className={MICRO}>Heart rate</span>
                ) : (
                  <>
                    <input
                      value={b.mins}
                      onChange={(e) => edit((d) => void ((d.blocks[bi] as CoachBlock).mins = e.target.value))}
                      placeholder="—"
                      aria-label="block duration"
                      className={WELL + ' num h-4 w-6 px-0.5 text-center text-3'}
                    />
                    <span className={MICRO}>min</span>
                  </>
                )}
                {armed === 'b' + bi ? (
                  <button
                    onClick={() => requestRemove('b' + bi, (d) => void d.blocks.splice(bi, 1))}
                    aria-label="confirm — delete the whole session"
                    title="This is the last block. Deleting it makes this a rest day and discards the title and note."
                    className={ARMED_BTN}
                  >
                    Delete session?
                  </button>
                ) : (
                  <button
                    onClick={() => requestRemove('b' + bi, (d) => void d.blocks.splice(bi, 1))}
                    aria-label="remove block"
                    className="grid h-4 w-4 place-items-center rounded-md border border-line2 text-3 text-dim transition-colors duration-150 hover:border-bad/50 hover:text-bad"
                  >
                    ✕
                  </button>
                )}
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
                /* A chained block gets the concept mock's gold rail rather than
                   a tinted box: at this width a filled panel behind four cards
                   reads as a container, and the rail reads as "these flow on". */
                <div className={b.ss ? 'border-l-2 border-gold pl-2' : undefined}>
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
                        deleteArmed={armed === 'e' + bi + '-' + ei}
                        armedClass={ARMED_BTN}
                        onDelete={() =>
                          requestRemove('e' + bi + '-' + ei, (d) => void (d.blocks[bi] as CoachBlock).ex.splice(ei, 1))
                        }
                      />
                      {ei < b.ex.length - 1 ? (
                        <Seam
                          on={b.ss}
                          onClick={() =>
                            edit((d) => void ((d.blocks[bi] as CoachBlock).ss = !(d.blocks[bi] as CoachBlock).ss))
                          }
                        />
                      ) : null}
                    </div>
                  ))}
                  <button
                    onClick={() => edit((d) => void (d.blocks[bi] as CoachBlock).ex.push(newEx()))}
                    className={ADD + ' mt-1 h-5 text-3'}
                  >
                    ＋ Exercise
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          <button onClick={() => edit((d) => void d.blocks.push(newBlock('New block')))} className={ADD}>
            ＋ Block
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newCond()))} className={ADD}>
            ♥ Conditioning
          </button>
        </div>
      </div>

      {/* --------------------------------------------- session-level sidecar */}
      <aside className="min-w-0">
        <div className="flex flex-col gap-3 xl:sticky xl:top-3">
          {/* 05-coach-04 — the label sits on the border, so the note reads as a
              named part of the session rather than a stray text box. */}
          <Field label="Coach instructions">
            <textarea
              value={s.note}
              onChange={(e) => edit((d) => void (d.note = e.target.value))}
              placeholder="Anything the athlete should read before starting…"
              aria-label="coach instructions"
              rows={4}
              className={WELL + ' w-full resize-y px-1 py-1 text-4 leading-relaxed'}
            />
            <p className="mt-1 text-2 text-dim">Travels with the session to the athlete's phone.</p>
          </Field>

          <Glance sess={s} />

          <Field label="Deliver">
            <div className="flex flex-col gap-1">
              {cloud.user ? (
                <>
                  <label className={MICRO + ' block'} htmlFor="rx-athlete">
                    Athlete
                  </label>
                  <select
                    id="rx-athlete"
                    value={athlete}
                    onChange={(e) => setAthlete(e.target.value)}
                    aria-label="athlete"
                    className={WELL + ' h-5 w-full px-1 text-4'}
                  >
                    {cloud.athletes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>

                  <label className={MICRO + ' mt-1 block'} htmlFor="rx-date">
                    Scheduled date
                  </label>
                  <input
                    id="rx-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    aria-label="scheduled date"
                    className={WELL + ' num h-5 w-full px-1 text-4'}
                  />

                  <button onClick={() => void publish()} disabled={publishing} className={BRASS + ' mt-1 w-full'}>
                    <IconSend />
                    {publishing ? 'Sending…' : 'Send to athlete'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={validate} className={BRASS + ' w-full'}>
                    Validate &amp; publish
                  </button>
                  <p className="text-2 leading-relaxed text-dim">
                    Sign in to send this to an athlete. Until then it stays on this machine — validation still runs, so
                    you know it would cross the boundary cleanly.
                  </p>
                </>
              )}

              {/* 03-shared-03's toast, inline rather than floating: a floating
                  toast would have to dismiss itself, and that is behaviour. */}
              {msg ? (
                <p
                  role="status"
                  className={
                    'mt-1 rounded-md border bg-panel2 px-1.5 py-1 text-3 font-[650] shadow-card ' +
                    (/^(Could not|Sign in)/.test(msg) ? 'border-warn/40 text-warn' : 'border-done-line/50 text-done-ink')
                  }
                >
                  {msg}
                </p>
              ) : null}
            </div>
          </Field>
        </div>
      </aside>

      {pick ? (
        <Picker
          current={(s.blocks[pick.b] as CoachBlock).ex[pick.e]?.name || ''}
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

/**
 * What the coach has actually written, counted. Read-only and derived — it
 * makes no store call and adds no interaction; it is the kit's `.stat` trio
 * (three tabular numerals over micro-labels) doing the job a desktop tool's
 * sidecar exists for: telling you the shape of the thing without scrolling it.
 */
function Glance({ sess }: { sess: CoachSession }) {
  let movements = 0;
  let sets = 0;
  let mins = 0;
  let hr = 0;
  for (const b of sess.blocks) {
    if (isCond(b)) {
      hr += 1;
      continue;
    }
    const m = parseInt(b.mins, 10);
    if (Number.isFinite(m)) mins += m;
    movements += b.ex.length;
    for (const e of b.ex) sets += e.sets.length;
  }

  const stat = 'rounded-md border border-line bg-panel3 px-1 py-1 text-center';
  return (
    <Field label="Session">
      <div className="grid grid-cols-3 gap-1">
        <div className={stat}>
          <b className="num block text-7 font-[900]">{movements}</b>
          <span className={MICRO}>Movements</span>
        </div>
        <div className={stat}>
          <b className="num block text-7 font-[900]">{sets}</b>
          <span className={MICRO}>Sets</span>
        </div>
        <div className={stat}>
          <b className="num block text-7 font-[900]">{hr}</b>
          <span className={MICRO}>HR</span>
        </div>
      </div>
      <p className="mt-1 text-2 text-dim">
        {mins
          ? `${sess.blocks.length} blocks · about ${mins} min of programmed work.`
          : `${sess.blocks.length} block${sess.blocks.length === 1 ? '' : 's'}. Give a block a duration and it shows up here.`}
      </p>
    </Field>
  );
}

/**
 * The chain between two cards — 05-coach-05's `.c-chain`: dashed and quiet when
 * they are separate, solid brass when they flow on, with the connector running
 * behind it so the pair reads as one column of work.
 */
function Seam({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div className="relative flex h-4 items-center justify-center">
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line2" />
      <button
        onClick={onClick}
        title={on ? 'split them apart' : 'chain into a superset'}
        aria-label={on ? 'split the superset here' : 'chain into a superset'}
        className={
          'relative grid h-3 w-3 place-items-center rounded-pill border transition-colors duration-150 ' +
          (on
            ? 'border-gold text-[#1b1509] [background:var(--brass)]'
            : 'border-dashed border-line2 bg-panel2 text-muted hover:border-gold-line hover:text-gold2')
        }
      >
        <IconLink />
      </button>
    </div>
  );
}

/**
 * 05-coach-05. A grey header band carrying the letter chip, the movement name
 * and the set count; a prescription table beneath it when the card is open.
 */
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
    <section
      className={
        'overflow-hidden rounded-md border bg-panel shadow-card ' + (open ? 'border-zone-green/40' : 'border-line')
      }
    >
      <button onClick={onToggle} className="flex w-full items-center gap-1 bg-panel2 px-1.5 py-1 text-left">
        <Ltr cond>♥</Ltr>
        <span className="min-w-0 flex-1">
          <b className="block text-5 font-[750]">{label}</b>
          <span className="block truncate text-3 text-muted">{sum}</span>
        </span>
        <span className="shrink-0 text-dim" aria-hidden="true">
          {open ? <IconUp /> : <IconRight />}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-line p-2">
          <div>
            <div className={MICRO + ' mb-1'}>Format</div>
            <div className="flex flex-wrap gap-1">
              {COND_FORMATS.map(([k, name]) => (
                <Pill key={k} on={k === fmt} onClick={() => onFmt(k)}>
                  {name}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <div className={MICRO + ' mb-1'}>Effort</div>
            <div className="flex flex-wrap gap-1">
              {EFFORTS.map(([k, name, band]) => (
                <Pill key={k} on={k === eff} onClick={() => onEff(k)} zone={k}>
                  {name}
                  <i className="ml-0.5 text-1 font-[650] not-italic opacity-70">{band}</i>
                </Pill>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The movement picker. The sheet is the concept mock's; the option rows are
 * 05-coach-06's `.c-menu`, which is the one place in this app where a
 * menu-shaped list actually exists.
 */
function Picker({ current, onClose, onPick }: { current: string; onClose: () => void; onPick: (n: string) => void }) {
  const [q, setQ] = useState('');
  const list = LIBRARY.filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()));

  /*
   * Escape closes it. Declaring role="dialog" aria-modal="true" is a promise to
   * anyone using a keyboard or a screen reader that this behaves like a modal,
   * and a modal you can only leave by clicking the backdrop does not. The
   * backdrop click stays for the mouse; this is the other half.
   *
   * Bound on the wrapper rather than the document so it dies with the component
   * — a stray listener that closes a picker that is no longer open is its own
   * small bug.
   */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-3 pt-12"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a movement"
        className="w-full max-w-[460px] rounded-md border border-line2 bg-panel p-2 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-6 font-[800]">Choose a movement</h2>
        <p className="mt-0.5 text-3 text-dim">Search the library, or type any name.</p>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search movements, or type your own"
          aria-label="search movements"
          className={WELL + ' mt-1 h-5 w-full px-1.5 text-4'}
        />
        <ul className="mt-1 max-h-[46vh] overflow-y-auto">
          {q && !list.includes(q) ? (
            <li>
              <button
                onClick={() => onPick(q)}
                className="w-full rounded-sm px-1 py-1 text-left text-4 font-[650] text-gold2 hover:bg-panel2"
              >
                Use “{q}”
                <span className="block text-2 font-[500] text-dim">not in the library — add it anyway</span>
              </button>
            </li>
          ) : null}
          {list.map((n) => {
            const on = n === current;
            return (
              <li key={n}>
                <button
                  onClick={() => onPick(n)}
                  aria-current={on}
                  className={
                    'flex w-full items-center gap-1 rounded-sm px-1 py-1 text-left text-4 hover:bg-panel2 hover:text-gold2 ' +
                    (on ? 'font-[750] text-gold2' : '')
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{n}</span>
                  {on ? <IconCheck /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* --- small shared bits --- */

/**
 * 03-shared-02's chip. The effort variants take the HR zone inks the concept
 * mock gives them — those colours are meaning-bearing, so easy/medium/hard read
 * the same here as they do on the athlete's zone bars.
 */
function Pill({
  on,
  onClick,
  children,
  zone,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  zone?: EffortKey;
}) {
  const lit =
    zone === 'easy'
      ? 'border-zone-blue bg-zone-blue/10 text-zone-blue'
      : zone === 'medium'
        ? 'border-zone-green bg-zone-green/10 text-zone-green'
        : zone === 'hard'
          ? 'border-zone-red bg-zone-red/10 text-zone-red'
          : 'border-done-line bg-done-bg text-done-ink';
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={
        'inline-flex h-4 items-center rounded-pill border px-1.5 text-2 font-[750] tracking-[.06em] uppercase transition-colors duration-150 ' +
        (on ? lit : 'border-line2 bg-panel2 text-muted hover:border-gold-line hover:text-gold2')
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
        'grid h-4 w-5 place-items-center rounded-sm border border-line2 text-3 transition-colors duration-150 ' +
        (danger ? 'text-dim hover:border-bad/50 hover:text-bad' : 'text-muted hover:border-gold-line hover:text-gold2')
      }
    >
      {children}
    </button>
  );
}
