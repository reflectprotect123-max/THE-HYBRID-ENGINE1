import { useEffect, useState } from 'react';
import {
  CON_EFFORTS,
  blockExercises,
  condEffort,
  duplicateExercise,
  fillLinkedSets,
  isCond,
  isText,
  newBlock,
  newCondBlock,
  newEx,
  newTextBlock,
  newWarmupBlock,
  sessionLetters,
  ymd,
  type CondFmtKey,
  type EffortKey,
  type ModeKey,
  type StrengthBlock,
  type TextBlock,
} from '@hybrid/engine';
import { useLib } from './store';
import { useCoachCloud } from './cloud';
import { assertPublishable, type CoachSession } from './model';
import { ADD, BRASS, Field, IconLink, IconSend, MICRO, WELL } from './ui';
import { ExCard } from './editor/ExerciseCard';
import { CondCard } from './editor/ConditioningCard';
import { TextBlockCard } from './editor/TextBlockCard';
import { Picker } from './editor/MovementPicker';
import { Glance } from './editor/SessionGlance';

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
 *
 * This file is the SHELL: state, the store calls, layout, and the seam between
 * two cards. The cards themselves live in ./editor — one file each, named for
 * what it draws. It was 946 lines in one file before that, which is more than
 * anyone reads before editing.
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
  const LTR = sessionLetters({ id: s.id, date: '', status: 'completed', blocks: s.blocks });

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
      target.blocks = target.blocks.filter((b) => isCond(b) || isText(b) || blockExercises(b as StrengthBlock).length);
      if (!target.blocks.length) slot.days[d.sel.d] = null;
    });
  };

  /** Would this delete, after the pruning above, leave the day with nothing? */
  const destroysDay = (fn: (sess: CoachSession) => void) => {
    const probe = structuredClone(s);
    fn(probe);
    return probe.blocks.filter((b) => isCond(b) || isText(b) || blockExercises(b as StrengthBlock).length).length === 0;
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
          value={s.name || ''}
          onChange={(e) => edit((d) => void (d.name = e.target.value))}
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
                  value={b.heading || ''}
                  onChange={(e) => edit((d) => void (d.blocks[bi].heading = e.target.value))}
                  spellCheck={false}
                  aria-label="block name"
                  size={Math.max(6, Math.min(28, (b.heading || '').length + 1))}
                  className="min-w-0 rounded-sm border border-transparent bg-transparent px-0.5 py-0.5 text-3 font-[800] tracking-[.14em] text-gold2 uppercase outline-none transition-colors duration-150 hover:border-line2 focus:border-gold-line focus:bg-well"
                />
                <span className="h-px flex-1 bg-line" />
                {isCond(b) ? (
                  <span className={MICRO}>Heart rate</span>
                ) : isText(b) ? (
                  <span className={MICRO}>Metcon</span>
                ) : (
                  <>
                    <input
                      value={(b as StrengthBlock).minutes || ''}
                      onChange={(e) => edit((d) => void ((d.blocks[bi] as StrengthBlock).minutes = e.target.value))}
                      placeholder="—"
                      aria-label="block duration"
                      /* The only genuinely numeric field on this screen. The
                         target and RPE cells look numeric and are not — they
                         carry "8-12", "max", "W10" — so a numeric keypad there
                         would hide the very characters that make them useful. */
                      inputMode="numeric"
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

              {isText(b) ? (
                <TextBlockCard
                  body={(b as TextBlock).body || ''}
                  onChange={(v) => edit((d) => void ((d.blocks[bi] as TextBlock).body = v))}
                />
              ) : isCond(b) ? (
                <CondCard
                  fmt={b.condFmt}
                  eff={condEffort(b).key}
                  open={open?.b === bi}
                  onToggle={() => setOpen(open?.b === bi ? null : { b: bi, e: 0 })}
                  onFmt={(v) => edit((d) => void ((d.blocks[bi] as never as { condFmt: CondFmtKey }).condFmt = v))}
                  onEff={(v) =>
                    edit((d) => {
                      const cb = d.blocks[bi] as never as { effort: EffortKey; targetZone: string };
                      cb.effort = v;
                      cb.targetZone = CON_EFFORTS[v].zone;
                    })
                  }
                />
              ) : (
                <div className={(b as StrengthBlock).warmup ? 'rounded-lg border border-dashed border-line2 p-1' : undefined}>
                  {blockExercises(b as StrengthBlock).map((ex, ei, exs) => {
                    const next = exs[ei + 1];
                    return (
                      <div key={ex.id}>
                        <ExCard
                          ex={ex}
                          letter={LTR[bi]?.[ei] ?? '?'}
                          open={open?.b === bi && open?.e === ei}
                          onToggle={() => setOpen(open?.b === bi && open?.e === ei ? null : { b: bi, e: ei })}
                          onPick={() => setPick({ b: bi, e: ei })}
                          onSet={(si, key, v) =>
                            // Type once, it fills the rest: fillLinkedSets carries the
                            // edit forward into any later set still at its untouched
                            // blank default, so a plain 3x5 is one field, not three.
                            edit((d) => {
                              const target = (d.blocks[bi] as StrengthBlock).exercises[ei];
                              target.sets = fillLinkedSets(target.sets, si, key, v);
                            })
                          }
                          onAddSet={() => edit((d) => void (d.blocks[bi] as StrengthBlock).exercises[ei].sets.push({ t: '', rpe: '' }))}
                          onDelSet={(si) => edit((d) => void (d.blocks[bi] as StrengthBlock).exercises[ei].sets.splice(si, 1))}
                          onRest={(delta) =>
                            edit((d) => {
                              const e2 = (d.blocks[bi] as StrengthBlock).exercises[ei];
                              e2.rest = Math.max(0, Math.min(3600, (e2.rest || 0) + delta));
                            })
                          }
                          onCue={(v) => edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises[ei].cue = v))}
                          onMode={(m: ModeKey) => edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises[ei].mode = m))}
                          onTempo={(v) => edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises[ei].tempo = v))}
                          onMove={(dir) =>
                            edit((d) => {
                              const arr = (d.blocks[bi] as StrengthBlock).exercises;
                              const j = ei + dir;
                              if (j < 0 || j >= arr.length) return;
                              [arr[ei], arr[j]] = [arr[j], arr[ei]];
                            })
                          }
                          onDuplicate={() => {
                            // Open the new copy, not the original left behind —
                            // that is the one the coach is about to edit.
                            setOpen({ b: bi, e: ei + 1 });
                            edit((d) => void ((d.blocks[bi] as StrengthBlock).exercises = duplicateExercise((d.blocks[bi] as StrengthBlock).exercises, ei)));
                          }}
                          deleteArmed={armed === 'e' + bi + '-' + ei}
                          armedClass={ARMED_BTN}
                          onDelete={() =>
                            requestRemove('e' + bi + '-' + ei, (d) => void (d.blocks[bi] as StrengthBlock).exercises.splice(ei, 1))
                          }
                        />
                        {next ? (
                          <Seam
                            on={!!ex.ssNext}
                            onClick={() =>
                              edit((d) => {
                                const t = (d.blocks[bi] as StrengthBlock).exercises[ei];
                                t.ssNext = !t.ssNext;
                              })
                            }
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => edit((d) => void (d.blocks[bi] as StrengthBlock).exercises.push(newEx()))}
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
          <button onClick={() => edit((d) => void d.blocks.push(newBlock()))} className={ADD}>
            ＋ Block
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newWarmupBlock()))} className={ADD}>
            ☀ Warm-up / Cooldown
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newCondBlock()))} className={ADD}>
            ♥ Conditioning
          </button>
          <button onClick={() => edit((d) => void d.blocks.push(newTextBlock()))} className={ADD}>
            ✎ Metcon / notes
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
          current={blockExercises(s.blocks[pick.b] as StrengthBlock)[pick.e]?.name || ''}
          onClose={() => setPick(null)}
          onPick={(name) => {
            edit((d) => void ((d.blocks[pick.b] as StrengthBlock).exercises[pick.e].name = name));
            setPick(null);
          }}
        />
      ) : null}
    </div>
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
