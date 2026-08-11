import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  decideStrengthProgression,
  deviationFelt,
  explainWorkingWeight,
  fmtRest,
  fmtRpe,
  isCond,
  isText,
  isLiftMode,
  isWarmup,
  MAX_KG,
  nextLoggerLocation,
  nextWorkingWeight,
  plateBreakdown,
  prefillPrimary,
  prefillSecondary,
  repFloorOf,
  repTopOf,
  rpeCenterOf,
  sanNumStr,
  saneKg,
  sessionLetters,
  sessionProgress,
  sessionVolume,
  lastTimeSets,
  workingSetOrdinal,
  targetLine,
  todayRecovery,
  type Deviation,
  type Exercise,
  type LoggedSet,
  type Session,
  type StrengthBlock,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { useRest } from '../store/rest';
import { useSetTimer } from '../store/setTimer';
import { requestWakeLock, releaseWakeLock } from '../native/wakeLock';
import { RestChip } from '../components/RestChip';
import { Button, Card, Kicker, LetterChip, Meter, cx } from '../ui';

/*
 * The full-screen logger stage.
 *
 * One set at a time, big inputs, and nothing else on the screen — the athlete
 * is standing over a bar. Finish Set → rate it → Confirm, which logs the set,
 * moves the next set's weight by the autoregulation formula, and runs the rest
 * timer in place.
 *
 * All transient stage state (`phase`, the dialled RPE, the hint) lives in React
 * state, NOT on the session. Every value the athlete types lands on the
 * session's set objects as it is typed, so history, PRs and the recap are
 * untouched by how the stage happens to be rendered — and so nothing typed is
 * ever only in a component.
 *
 * Which exercise is on the stage lives in the URL, not in state. Two sources of
 * truth for the same thing means the address bar can name one exercise while
 * the screen shows another, and a reload mid-session then throws the athlete
 * back to the first movement of the workout.
 */

type Phase = 'input' | 'rpe' | 'rest';

export function Logger() {
  const { bi: biStr, ei: eiStr } = useParams();
  const bi = Number(biStr);
  const ei = Number(eiStr);
  const nav = useNavigate();
  const { activeSession, sessions, settings, whoop, updateSession } = useDb();
  const rest = useRest();
  /* Consumed by the STAGE, not only by the field. While a hold runs the box
     shows `timer.left` and `v1` still holds the prefilled target, so the
     confirm flow has to be able to stop the clock and commit what was
     actually held — see `stopSetTimerIfRunning`. */
  const setTimer = useSetTimer();

  // `replace`, so the back arrow still leaves the stage for the session list
  // rather than walking back through every exercise the flow moved through.
  const goTo = (l: { bi: number; ei: number }) => nav(`/log/${l.bi}/${l.ei}`, { replace: true });
  const [phase, setPhase] = useState<Phase>('input');
  const [rpe, setRpe] = useState(7.5);
  const [hint, setHint] = useState<{ txt: string; cls: 'good' | 'bad' } | null>(null);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [platesOpen, setPlatesOpen] = useState(false);

  const s = activeSession;
  const block = s?.blocks[bi];
  const ex = block && !isCond(block) ? blockExercises(block as StrengthBlock<LoggedSet>)[ei] : undefined;
  const si = ex ? curSetIndex(ex) : -1;
  const st = ex && si >= 0 ? ex.sets[si] : undefined;
  const lift = !!ex && isLiftMode(ex.mode);

  // Prefill when the set under the cursor changes — not on every render, or a
  // keystroke would be overwritten by the prefill that produced it.
  const setKey = `${bi}-${ei}-${si}`;
  const lastKey = useRef('');
  /* Seconds actually held, captured the instant the countdown was stopped —
     see `stopSetTimerIfRunning`. A ref rather than state because `confirmSet`
     can run in the SAME tick as the stop, before `setV1` has re-rendered. */
  const heldRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ex || si < 0 || lastKey.current === setKey) return;
    lastKey.current = setKey;
    // A held duration belongs to the set it was held for. Moving the cursor
    // drops it, or a stop on one set would be committed onto the next.
    heldRef.current = null;
    /*
     * A hold that ran out while its own field was unmounted — the athlete
     * started a plank and stepped away — is claimed by `SecondsTimerField`'s
     * effect on the render where they come BACK to that set. React runs a
     * child's effect before its parent's, so by the time this one runs the
     * claim has already written the seconds actually held into the session and
     * into `v1`. This closure's `ex` is the one rendered before that write,
     * where `aVal` was still empty, so prefilling from it overwrote a real
     * logged duration with a suggestion — and the confirm that followed logged
     * the suggestion.
     *
     * The fix is agreement, not ordering: an unclaimed finish belonging to THIS
     * set is what the field is about to show either way, so this effect names
     * the same number rather than trusting a snapshot taken before it existed.
     * The claim is gated on `owner` in both places, so a finish armed on some
     * other set is still prefilled past rather than adopted here.
     */
    const claimed =
      ex.mode === 'seconds' && setTimer.finished && setTimer.owner === setKey && setTimer.total > 0
        ? String(setTimer.total)
        : null;
    setV1(claimed ?? prefillPrimary(ex, si, sessions, { settings, whoop }));
    setV2(prefillSecondary(ex, si));
    setNoteOpen(false);
    setPlatesOpen(false);
  }, [ex, si, setKey, sessions, settings, whoop, setTimer]);

  // Rest ending returns the stage to input for whatever set is now current.
  useEffect(() => {
    if (phase === 'rest' && !rest.running) setPhase('input');
  }, [phase, rest.running]);

  // Keep the screen awake for as long as there's a live session on the
  // stage — not for the "No live session" placeholder below, which the
  // athlete may leave sitting on their lock screen indefinitely.
  useEffect(() => {
    if (!s) return;
    let cancelled = false;
    let lock: WakeLockSentinel | null = null;
    requestWakeLock().then((l) => {
      if (cancelled) {
        l?.release();
        return;
      }
      lock = l;
    });
    return () => {
      cancelled = true;
      releaseWakeLock(lock);
    };
  }, [!!s]);

  const prog = useMemo(() => (s ? sessionProgress(s) : { done: 0, total: 0, pct: 0 }), [s]);
  const letters = useMemo(() => (s ? sessionLetters(s) : {}), [s]);
  const next = useMemo(() => (s ? nextLoggerLocation(s, bi, ei) : null), [s, bi, ei]);

  /* What this lift did last time, per working set. Rendered as a label beside
     the row, not the input's placeholder: it is data, not a hint, and a
     placeholder both fails contrast and vanishes exactly when you would
     compare against it. */
  const lastSets = useMemo(() => (ex ? lastTimeSets(ex.name, sessions) : []), [ex, sessions]);

  /*
   * What each row's kg column SUGGESTS — the ghost behind the input.
   *
   * This is `prefillPrimary` per row, which is how the table shows an
   * adjustment without applying one. The one-set stage put that number IN the
   * box; a table cannot, because a row's value is `aVal` and `aVal` means one
   * thing only — what was actually entered. A suggestion sitting there would be
   * indistinguishable from a logged value, which is the whole reason
   * `prefillPrimary` documents itself as a read and not a write.
   *
   * So the suggestion goes where a suggestion belongs: the placeholder. Rate
   * the set above with ↑/↓ and this is the number that moves, while the box
   * stays empty until someone types in it. Proposed, never applied.
   *
   * Falls back to last time's weight for the same working set, which is what
   * the ghost was before and is still the right answer when nothing today has
   * anything to say.
   */
  const ghosts = useMemo(
    () => (ex ? ex.sets.map((_, i) => prefillPrimary(ex, i, sessions, { settings, whoop })) : []),
    [ex, sessions, settings, whoop],
  );

  /* Where the prefilled weight came from. A number that appears in the box on
     its own is either trusted blindly or ignored; naming its origin — earned
     last session, and whether today's recovery eased it — is what makes it a
     suggestion rather than an instruction. */
  const earned = useMemo(
    () => (ex && lift ? nextWorkingWeight(ex.name, settings, whoop) : null),
    [ex, lift, settings, whoop],
  );

  const rec = todayRecovery(whoop);
  const earnedExplained = useMemo(
    () => (earned ? explainWorkingWeight(earned, rec) : null),
    [earned, rec],
  );

  const isFirstWorkingSet = !!ex && ex.sets.findIndex((s2) => !isWarmup(s2)) === si;
  /* Gated on `isFirstWorkingSet` — the only place it is rendered — BEFORE
     `sessions` is touched. Every keystroke writes through to the session, which
     hands `useDb` a fresh array, so an ungated memo re-scanned the whole
     training history on each character typed on the gym-floor screen. */
  const strengthSuggestion = useMemo(
    () =>
      isFirstWorkingSet && ex && lift && st && !isWarmup(st)
        ? decideStrengthProgression(ex.name, sessions, { t: st.t, rpe: st.rpe })
        : null,
    [isFirstWorkingSet, ex, lift, st, sessions],
  );

  if (!s || !block || isCond(block) || !ex) {
    return (
      <div className="grid min-h-full place-items-center p-3">
        <Card className="text-center">
          <p className="text-6 font-[750]">No live session</p>
          <p className="mt-1 text-4 text-muted">Start one from Training.</p>
          <Button className="mt-2" variant="brass" onClick={() => nav('/training')}>
            Go to Training
          </Button>
        </Card>
      </div>
    );
  }

  const letter = letters[bi]?.[ei] ?? '?';

  /*
   * Every keystroke lands on the set, not just in component state.
   *
   * The vanilla app wrote through on input for a reason: stepping off the stage
   * to check the session list, the phone reclaiming the tab between sets, or a
   * reload, must not cost the number already typed. `prefillPrimary` reads
   * `aVal` back first, so the round trip is lossless. Sanitising still happens
   * on confirm — what is half-typed is not yet a claim about what was lifted.
   */
  /* The exercise directly after this one in the same block — the only thing it
     can be supersetted INTO. Null on the last of a block, where the control is
     hidden rather than shown disabled: an offer you cannot take is noise. */
  const partner =
    block && !isCond(block) ? blockExercises(block as StrengthBlock<LoggedSet>)[ei + 1] || null : null;

  function toggleSuperset() {
    if (!s) return;
    updateSession(s.id, (ds) => {
      const src = (ds.blocks[bi] as StrengthBlock<LoggedSet>)?.exercises?.[ei];
      if (!src) return false;
      src.ssNext = !src.ssNext;
      ds.updatedAt = Date.now();
    });
  }

  /* Table edits ANY set, not only the one under cursor, so stage's
     write-through for `si` generalised by index. Same contract: every keystroke
     lands on session as typed, never only in component state. */
  function writeSetVal(idx: number, slot: 1 | 2, val: string) {
    if (!s) return;
    updateSession(s.id, (ds) => {
      const dst = (ds.blocks[bi] as StrengthBlock<LoggedSet>)?.exercises?.[ei]?.sets?.[idx];
      if (!dst) return false;
      if (slot === 1) dst.aVal = val;
      else dst.aVal2 = val;
      ds.updatedAt = Date.now();
    });
  }

  /*
   * The tick. One tap logs a set, tapping again takes it back.
   *
   * Carries what `confirmSet` carried for the one-set stage, and what the first
   * attempt at this screen did not: `advanceAfterSet` moves the flow to the next
   * exercise and is what a superset alternates through. Ticking without it
   * logged sets perfectly and stranded the athlete on the exercise they had just
   * finished.
   *
   * Deliberately NOT `setPhase('rest')`. The stage swapped itself for a rest
   * panel because it had one set on screen and nothing else to show; the table
   * has every set, and hiding them for a countdown removes what rest is for —
   * seeing what is coming and fixing what you just typed. RestChip floats over
   * the table instead.
   *
   * Un-ticking returns early: a correction, not the end of a set, so no rest and
   * no advance. `done` is the only field touched, so reps and weight survive.
   */
  function toggleSetDone(idx: number) {
    if (!s || !ex) return;
    const wasDone = !!ex.sets[idx]?.done;
    updateSession(s.id, (ds) => {
      const dst = (ds.blocks[bi] as StrengthBlock<LoggedSet>)?.exercises?.[ei]?.sets?.[idx];
      if (!dst) return false;
      dst.done = !dst.done;
      /*
       * Sanitise on the way IN, exactly as `confirmSet` does — the tick is this
       * table's confirm, and it was the only commit path in the screen that
       * did not do it. Write-through keeps what is half-typed verbatim on
       * purpose (a reload must not cost a keystroke), so "1e309" sits in `aVal`
       * quite legitimately right up until the tap that turns it into a claim
       * about what was lifted. Stored verbatim it parses back to Infinity
       * everywhere it is later read — recap, exercise history, the Progress
       * chart — and survives every reload.
       *
       * Only on the way to done: un-ticking is a correction, and rewriting the
       * numbers underneath someone who is about to retype them is not.
       */
      if (dst.done) {
        dst.aVal = sanNumStr(dst.aVal);
        dst.aVal2 = sanNumStr(dst.aVal2);
      }
      ds.updatedAt = Date.now();
    });
    if (wasDone) return;
    // Read the flow decision off the session as it will be after the write —
    // `s` here is still pre-write, same as confirmSet does.
    const after = structuredClone(s);
    const ab = after.blocks[bi] as StrengthBlock<LoggedSet>;
    ab.exercises[ei].sets[idx].done = true;
    const { next: dest, restSec } = advanceAfterSet(after, bi, ei);
    if (restSec > 0) rest.start(restSec);
    if (dest && (dest.bi !== bi || dest.ei !== ei)) goTo(dest);
  }

  /*
   * Say how the set went, after it is already logged.
   *
   * The tick commits; this is the second, optional tap — "easier" or "harder
   * than asked" — and it is the ONLY thing on this screen that writes `felt`.
   * A set logged and left alone stays unrated on purpose: every engine reader
   * treats an unwritten `felt` as no evidence, so the weight holds and nothing
   * is banked. See `deviationFelt` for why filling in a centre instead would be
   * worse than writing nothing at all.
   *
   * Tapping the same direction again clears the rating, because the only way to
   * correct a mis-tap otherwise would be to un-tick the set and lose the reps
   * and weight with it.
   *
   * Warm-ups are refused outright rather than hidden-and-refused: the engine
   * ignores warm-up ratings everywhere, so a rating stored on one is a number
   * that would display as data the athlete gave and change nothing.
   */
  function rateSet(idx: number, dir: Deviation) {
    if (!s || !ex) return;
    const target = ex.sets[idx];
    if (!target || !target.done || isWarmup(target)) return;
    const felt = fmtRpe(deviationFelt(target, dir));
    updateSession(s.id, (ds) => {
      const dst = (ds.blocks[bi] as StrengthBlock<LoggedSet>)?.exercises?.[ei]?.sets?.[idx];
      if (!dst) return false;
      dst.felt = dst.felt === felt ? undefined : felt;
      ds.updatedAt = Date.now();
    });
  }

  /*
   * Take the one opt-in suggestion the engine is offering.
   *
   * It writes through `writeVal`, which lands on the set under the cursor —
   * the same set the table's first unfinished row is showing — so the table
   * and the one-set stage take it the same way, and neither writes anywhere
   * near `settings.liftProgress`. Applying it is the athlete's tap, not the
   * app's decision: coach-contract rule 7 is about what the app does WITHOUT
   * being asked.
   */
  function applySuggestion() {
    const p = strengthSuggestion?.prescription;
    if (!p) return;
    if (p.load != null) writeVal(1, String(p.load));
    if (p.reps != null) writeVal(2, String(p.reps));
  }

  function writeVal(slot: 1 | 2, val: string) {
    if (slot === 1) setV1(val);
    else setV2(val);
    if (!s || si < 0) return;
    updateSession(s.id, (ds) => {
      const dst = (ds.blocks[bi] as StrengthBlock<LoggedSet>)?.exercises?.[ei]?.sets?.[si];
      if (!dst) return false;
      if (slot === 1) dst.aVal = val;
      else dst.aVal2 = val;
      ds.updatedAt = Date.now();
    });
  }

  /*
   * Stop a still-running hold and commit what it actually counted.
   *
   * The Finish Set button is live for the whole countdown, and while the
   * countdown runs the field displays `timer.left` — but `v1` was never
   * touched, so it still holds the prefilled TARGET. Confirming from there
   * logged "held 30s" for a plank abandoned at 9. This does precisely what the
   * Stop button does, one step earlier in the flow, so whatever Stop would
   * have written is what gets logged.
   */
  function stopSetTimerIfRunning() {
    // `owner`, not just `running`: a hold armed on a DIFFERENT set is not this
    // set's to stop, and certainly not its seconds to log.
    if (!setTimer.running || setTimer.owner !== setKey || !ex || ex.mode !== 'seconds') return;
    const held = String(setTimer.stop());
    heldRef.current = held;
    writeVal(1, held);
  }

  // Declared as a function statement, so the early return above does not narrow
  // `s` inside it — re-assert what the closure actually depends on.
  function confirmSet() {
    if (!s || !ex || si < 0 || !st) return;
    stopSetTimerIfRunning();
    /* `heldRef` over `v1`: the write above lands in state for the NEXT render,
       and this one is committing now. Null for every set that is not a
       stopped hold, which is where `v1` is the truth. */
    const primary = heldRef.current ?? v1;
    heldRef.current = null;
    const isFinal = si >= ex.sets.length - 1;
    let nextHint: typeof hint = null;

    updateSession(s.id, (ds) => {
      const db = ds.blocks[bi] as StrengthBlock<LoggedSet>;
      const dex = db.exercises[ei];
      const dst = dex.sets[si];

      // Sanitise on the way IN. Refusing to propagate Infinity was not enough:
      // "1e309" stored verbatim parses back to Infinity everywhere it is later
      // read — recap, exercise history, the Progress chart — and survives every
      // reload.
      dst.aVal = lift ? sanNumStr(primary) : String(primary || '').trim();
      if (v2 !== '' || dex.mode === 'reps_kg' || dex.mode === 'reps_seconds') dst.aVal2 = sanNumStr(v2);
      // A warm-up is never rated: the engine ignores warm-up RPE everywhere
      // (sessionRpe, autoregulation), so asking was one wasted tap — and the
      // untouched 7.5 default then displayed as data the athlete never gave.
      if (!isWarmup(dst)) dst.felt = fmtRpe(rpe);
      dst.done = true;

      // A warm-up at RPE 4 would otherwise tell the engine to add weight, and a
      // heavy single warm-up to take it off. Neither reads working effort.
      if (lift && !isWarmup(dst)) {
        const weight = saneKg(dst.aVal);
        const reps = parseInt(String(dst.aVal2), 10) || 0;
        if (weight > 0 && reps > 0) {
          const adj = computeSetAdjustment(
            reps,
            rpe,
            repFloorOf(dst.t),
            weight,
            rpeCenterOf(dst),
          );
          const dtxt = adj.delta > 0 ? '+' + adj.delta + ' kg' : adj.delta < 0 ? adj.delta + ' kg' : 'hold weight';
          const lead =
            adj.verdict === 'missed the rep floor' ? 'That set missed the rep floor' : 'That set was ' + adj.verdict;
          nextHint = {
            txt: `${lead} — ${dtxt} for ${isFinal ? 'next session' : 'Set ' + (si + 2)} (${adj.newWeight} kg).`,
            cls: adj.cls,
          };
        }
      }

      ds.updatedAt = Date.now();
    });

    setHint(nextHint);
    setRpe(7.5);

    // Read the flow decision off the session as it will be after the write.
    const after = structuredClone(s);
    const ab = after.blocks[bi] as StrengthBlock<LoggedSet>;
    ab.exercises[ei].sets[si].done = true;
    const { next: dest, restSec } = advanceAfterSet(after, bi, ei);

    if (restSec > 0 && dest) {
      rest.start(restSec);
      setPhase('rest');
      if (dest.bi !== bi || dest.ei !== ei) goTo(dest);
    } else if (dest && (dest.bi !== bi || dest.ei !== ei)) {
      goTo(dest);
      setHint(null);
      setPhase('input');
    } else {
      setPhase('input');
    }
  }

  function stepWeight(dir: 1 | -1) {
    // parseFloat('1e309') is Infinity, and `|| 0` lets it straight through:
    // the field then read "Infinity" and the plate breakdown was asked to load
    // a bar with it.
    const cur = parseFloat(v1);
    const from = Number.isFinite(cur) ? cur : 0;
    writeVal(1, String(Math.max(0, Math.min(MAX_KG, Math.round((from + dir * AUTOREG.stepKg) * 100) / 100))));
  }

  const meta = [ex.tempo ? '@' + ex.tempo : '', Number(ex.rest) ? 'rest ' + fmtRest(ex.rest) : 'no rest']
    .filter(Boolean)
    .join(' · ');

  /*
   * Where the weight this exercise is asking for came from.
   *
   * Hoisted out of `StepperField`'s `note` so the table and the one-set stage
   * say the same sentence — it is a fact about the exercise and the athlete's
   * history, not about which of the two is on screen.
   */
  const earnedNote =
    earned && st && !isWarmup(st)
      ? (earned.dailyAdj < 0 ? `earned ${earned.earned}kg · ${earned.note}` : `earned ${earned.earned}kg last time`) +
        (earnedExplained?.confidence === 'low' ? ' · no recovery data today' : '')
      : '';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-2 pt-2 pb-3">
      <header className="flex items-start gap-1">
        <button
          onClick={() => nav('/training')}
          aria-label="back to session"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line2 bg-panel2 text-6 text-muted hover:text-text"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <Kicker>
            {block.heading || 'Block'}
            {!isCond(block) && !isText(block) && block.superset ? ' · superset' : ''}
          </Kicker>
          <h1 className="text-7 leading-tight font-[800] [overflow-wrap:anywhere]">{s.name || 'Session'}</h1>
        </div>
      </header>

      {/* Work done and time on clock. Owns the progress meter now — a second
          one underneath would be two readings of the same thing. */}
      <div className="mt-2">
        <SessionStats s={s} prog={prog} />
        <div className="num mt-0.5 flex justify-between text-2 font-[650] text-dim">
          <span>
            {prog.done} of {prog.total} done
          </span>
          <span>{prog.pct}%</span>
        </div>
      </div>

      {/* Hugs its content: stretching it to fill the viewport left a dead
          panel below the set history with nothing in it.
          Not `tone="raised"`: raised marks a one-off highlight (Home's
          Resume/Start card), but this card is the permanent working
          surface — every set gets logged inside it, so a gold edge here
          would be chrome, not a highlight. Plain default tone. */}
      <Card className="mt-2">
        <div className="flex items-center gap-1">
          <LetterChip letter={letter} onClick={() => nav('/training')} />
          <span className="min-w-0 flex-1 truncate text-7 font-[800]">{ex.name || 'Exercise'}</span>
        </div>
        <div className="mt-0.5 text-3 text-dim">{meta}</div>

        {partner ? (
          <button
            onClick={toggleSuperset}
            role="switch"
            aria-checked={!!ex.ssNext}
            aria-label={`Superset with ${partner.name || 'the next exercise'}`}
            className={cx(
              'mt-1 flex w-full items-center gap-1 rounded-md border px-1 py-1 text-left text-3',
              ex.ssNext ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line bg-panel3 text-dim',
            )}
          >
            <span aria-hidden>⇄</span>
            {/* On, it states a fact; off, it asks. Same control, and which one
                it is should be readable without hunting for the highlight. */}
            <span className="min-w-0 flex-1 truncate">
              {ex.ssNext ? 'Supersetted with ' : 'Superset with '}
              <b className="font-[650]">{partner.name || 'next'}</b>
              {ex.ssNext ? '' : '?'}
            </span>
          </button>
        ) : null}

        {ex.cue ? (
          <p className="mt-1 rounded-md border border-gold-line bg-gold-wash px-1 py-0.5 text-4 text-gold2">
            {ex.cue}
          </p>
        ) : null}

        {/*
          * Provenance, and the one suggestion allowed to beat it.
          *
          * Both are computed for lift modes ONLY (`earned`, `strengthSuggestion`
          * above), and both used to render inside the one-set stage — so
          * wrapping that stage in `!lift` to make room for the table left them
          * computed for exactly the modes that could no longer show them, and
          * took two features off screen without anyone deciding to drop them.
          * They describe the exercise rather than any single row, so above the
          * table is where they belong now.
          */}
        {lift && earnedNote ? <p className="mt-1 text-2 text-muted">{earnedNote}</p> : null}
        {lift && strengthSuggestion?.prescription && isFirstWorkingSet ? (
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className="text-2 text-muted">{strengthSuggestion.note}</span>
            <Button variant="ghost" size="sm" onClick={applySuggestion}>
              Apply
            </Button>
          </div>
        ) : null}

        {/* Table owns lift modes. A seconds hold or a completion has no
            reps-and-kilos pair for columns, so those keep the one-set stage
            and the field that counts rather than is typed into. */}
        {lift ? (
          <SetsTable
            ex={ex}
            lastSets={lastSets}
            ghosts={ghosts}
            onWrite={writeSetVal}
            onToggle={toggleSetDone}
            onRate={rateSet}
          />
        ) : (
          <Dots ex={ex} si={si} />
        )}

        {!lift && si >= 0 && st ? (
          <>
            <div className="num mt-2 flex items-baseline justify-between text-2 font-[750] uppercase tracking-[.14em] text-dim">
              <span>
                Set {si + 1} of {ex.sets.length}
                {isWarmup(st) ? ' · warm-up' : ''}
              </span>
              <em className="not-italic text-gold2">target {targetLine(ex, st)}</em>
            </div>

            {phase === 'input' ? (
              <>
                {lift ? (
                  <>
                    <StepperField
                      label="Weight"
                      note={earnedNote}
                      unit="kg"
                      value={v1}
                      onChange={(v) => writeVal(1, v)}
                      onStep={stepWeight}
                      inputMode="decimal"
                    />
                    <PlainField label="Reps" value={v2} onChange={(v) => writeVal(2, v)} inputMode="numeric" />
                    {strengthSuggestion?.prescription && isFirstWorkingSet ? (
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className="text-2 text-muted">{strengthSuggestion.note}</span>
                        <Button variant="ghost" size="sm" onClick={applySuggestion}>
                          Apply
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : ex.mode === 'reps_seconds' ? (
                  <>
                    <PlainField label="Secs" value={v1} onChange={(v) => writeVal(1, v)} inputMode="numeric" />
                    <PlainField label="Reps" value={v2} onChange={(v) => writeVal(2, v)} inputMode="numeric" />
                  </>
                ) : ex.mode === 'seconds' ? (
                  <SecondsTimerField
                    /* Keyed on the set, so moving the cursor gives the field a
                       FRESH instance rather than reusing the one that armed a
                       hold for some other set. `bi`/`ei` come from the URL and
                       `si` from the session, and none of them unmount this
                       subtree on their own — without the key React reconciles
                       the same element in the same slot and the instance,
                       effect and all, survives the move. */
                    key={setKey}
                    setKey={setKey}
                    label="Secs"
                    value={v1}
                    onChange={(v) => writeVal(1, v)}
                    /* `st.t` is free text — '20-30', '30s', '20-30s/side' are
                       all legal authored targets, and Number() makes NaN of
                       every one of them, which left Start disabled with no
                       explanation. `repTopOf` is the parser the rest of this
                       screen already targets: the top of a range is what the
                       athlete is aiming at. */
                    targetSec={Number(repTopOf(st.t)) || 0}
                  />
                ) : (
                  <PlainField label="Reps" value={v1} onChange={(v) => writeVal(1, v)} inputMode="numeric" />
                )}

                <Affordances
                  note={st.note || ''}
                  noteOpen={noteOpen}
                  onToggleNote={() => setNoteOpen((o) => !o)}
                  onNote={(txt) =>
                    updateSession(s.id, (ds) => {
                      const dst = (ds.blocks[bi] as StrengthBlock<LoggedSet>)?.exercises?.[ei]?.sets?.[si];
                      if (!dst) return false;
                      dst.note = txt;
                    })
                  }
                  weightKg={lift ? parseFloat(v1) || 0 : 0}
                  platesOpen={platesOpen}
                  onTogglePlates={() => setPlatesOpen((o) => !o)}
                />

                <Button
                  variant="brass"
                  size="lg"
                  className="mt-2 w-full"
                  onClick={() => {
                    /* Finish Set is the moment the hold ended — stop the clock
                       HERE, not two taps later at Confirm, or the seconds spent
                       dialling in an RPE are counted as part of the set. */
                    if (st && isWarmup(st)) confirmSet();
                    else {
                      stopSetTimerIfRunning();
                      setPhase('rpe');
                    }
                  }}
                >
                  Finish Set
                </Button>
              </>
            ) : null}

            {phase === 'rpe' ? <RpeStep rpe={rpe} onRpe={setRpe} onConfirm={confirmSet} /> : null}

            {phase === 'rest' ? (
              <div className="mt-2 rounded-md border border-line bg-well p-2 text-center shadow-well">
                <Kicker>Rest</Kicker>
                <div className="num mt-0.5 text-9 font-[900] text-gold2">{fmtRest(rest.left)}</div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-pill bg-track">
                  <span
                    className="block h-full rounded-pill bg-gold2"
                    style={{ width: rest.frac * 100 + '%', transition: 'width .25s linear' }}
                  />
                </div>
                <div className="mt-2 flex justify-center gap-1">
                  <Button onClick={() => rest.add(15)}>+15s</Button>
                  <Button
                    onClick={() => {
                      rest.stop();
                      setPhase('input');
                    }}
                  >
                    Skip rest
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : !lift ? (
          <div className="mt-3 grid place-items-center gap-1 rounded-md border border-done-line bg-done-bg p-3 text-center">
            <span className="text-7">✓</span>
            <p className="text-5 font-[750] text-done-ink">
              All {ex.sets.length} set{ex.sets.length === 1 ? '' : 's'} logged
            </p>
          </div>
        ) : null}

        {hint ? (
          <p
            className={cx(
              'mt-2 rounded-md border px-1 py-1 text-4',
              hint.cls === 'good'
                ? 'border-gold-line bg-gold-wash text-gold2'
                : 'border-bad/40 bg-bad/10 text-bad',
            )}
          >
            {hint.txt}
          </p>
        ) : null}

        {/* Table lists every set already; a second list of the same sets was
            the one-set stage's way of showing what the stage itself hid. */}
        {!lift ? <LoggedList ex={ex} /> : null}
      </Card>

      <footer className="mt-auto flex gap-1 pt-2">
        <Button className="flex-1" onClick={() => nav('/training')}>
          ‹ Back to session
        </Button>
        {next ? (
          <Button
            className="flex-1"
            onClick={() => {
              goTo(next);
              setPhase('input');
              setHint(null);
            }}
          >
            {next.name} ›
          </Button>
        ) : null}
      </footer>

      {/* The floating chip would be a second clock counting the same rest. */}
      <RestChip hidden={phase === 'rest'} />
    </div>
  );
}

/*
 * The session bar: elapsed time, work done so far, and every set in the whole
 * session as a row of dots.
 *
 * Modelled on the reference logger's top bar. It answers "how long have I been
 * here and how much have I done" without leaving the exercise — questions the
 * progress percentage alone could not, because a percentage says nothing about
 * whether the last forty minutes produced two sets or twenty.
 *
 * The clock ticks off `startedAt` rather than counting up from mount: the tab
 * gets reclaimed mid-session on a phone, and a counter that restarts at zero
 * when the screen comes back is worse than no counter at all.
 */
function SessionStats({ s, prog }: { s: Session; prog: { done: number; total: number; pct: number } }) {
  const startedAt = Number(s.startedAt) || 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;
  const hh = elapsed == null ? null : String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = elapsed == null ? null : String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = elapsed == null ? null : String(elapsed % 60).padStart(2, '0');

  /* Reps and volume across the WHOLE session, warm-ups included — this is a
     "what have I done today" readout, not the training record, and a warm-up
     set is still work the athlete did. `sessionVolume` is the record's own
     answer for kg and is reused rather than recomputed. */
  const reps = useMemo(() => {
    let n = 0;
    for (const b of s.blocks) {
      if (isCond(b) || isText(b)) continue;
      for (const e of blockExercises(b as StrengthBlock<LoggedSet>)) {
        for (const st of e.sets) if (st.done) n += parseInt(String(st.aVal2), 10) || 0;
      }
    }
    return n;
  }, [s]);
  const kg = useMemo(() => sessionVolume(s), [s]);

  return (
    <div className="border-b border-line pb-1">
      <div className="flex items-start gap-1">
        <div className="num flex flex-1 items-baseline gap-1.5">
          <span className="text-7 font-[800]">{reps.toLocaleString()}</span>
          <span className="text-2 font-[750] uppercase tracking-[.1em] text-dim">reps</span>
          <span className="ml-1 text-7 font-[800]">{kg.toLocaleString()}</span>
          <span className="text-2 font-[750] uppercase tracking-[.1em] text-dim">kg</span>
        </div>
        {elapsed != null ? (
          <span className="num shrink-0 text-5 font-[750]" style={{ color: "var(--color-neon-strain)" }}>
            {hh}:{mm}:{ss}
          </span>
        ) : null}
      </div>
      <div className="mt-1">
        <Meter pct={prog.pct} />
      </div>
    </div>
  );
}

function Dots({ ex, si }: { ex: Exercise<LoggedSet>; si: number }) {
  return (
    <div className="mt-1.5 flex gap-0.5" aria-hidden>
      {ex.sets.map((st, i) => (
        <span
          key={i}
          className={cx(
            'h-0.5 flex-1 rounded-pill transition-colors duration-150',
            st.done ? 'bg-gold2' : i === si ? 'bg-gold/60' : 'bg-track',
          )}
        />
      ))}
    </div>
  );
}

function StepperField({
  label,
  note,
  unit,
  value,
  onChange,
  onStep,
  inputMode,
}: {
  label: string;
  /** where a prefilled value came from — see the `earned` memo above */
  note?: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  onStep: (dir: 1 | -1) => void;
  inputMode: 'decimal' | 'numeric';
}) {
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-1">
        <label className="text-2 font-[750] uppercase tracking-[.14em] text-dim">{label}</label>
        {note ? <span className="num text-2 text-muted">{note}</span> : null}
      </div>
      <div className="mt-0.5 flex items-stretch gap-1">
        <button
          onClick={() => onStep(-1)}
          aria-label={`minus ${AUTOREG.stepKg} ${unit}`}
          className="w-6 shrink-0 rounded-md border border-line2 bg-panel2 text-7 font-[750] text-muted active:bg-well"
        >
          −
        </button>
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode={inputMode}
            placeholder={unit}
            aria-label={label}
            className="num h-7 w-full rounded-md border border-line bg-well px-1 text-center text-9 font-[800] text-text shadow-well outline-none placeholder:text-dim focus:border-gold-line"
          />
          <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-4 text-dim">
            {unit}
          </span>
        </div>
        <button
          onClick={() => onStep(1)}
          aria-label={`plus ${AUTOREG.stepKg} ${unit}`}
          className="w-6 shrink-0 rounded-md border border-line2 bg-panel2 text-7 font-[750] text-muted active:bg-well"
        >
          +
        </button>
      </div>
    </div>
  );
}

function PlainField({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode: 'decimal' | 'numeric';
}) {
  return (
    <div className="mt-2">
      <label className="text-2 font-[750] uppercase tracking-[.14em] text-dim">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        aria-label={label}
        className="num mt-0.5 h-7 w-full rounded-md border border-line bg-well px-1 text-center text-9 font-[800] text-text shadow-well outline-none focus:border-gold-line"
      />
    </div>
  );
}

function SecondsTimerField({
  label,
  value,
  onChange,
  targetSec,
  setKey,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  targetSec: number;
  /** Which set this field is showing — `bi-ei-si`. Handed to `start` so the
   *  provider can name the owner of the hold, and checked again on completion. */
  setKey: string;
}) {
  const timer = useSetTimer();

  /*
   * Claim a completed hold — but only this set's own.
   *
   * `finished`/`total` sit in the provider until someone acks them, and this
   * effect also runs on MOUNT, not just on the transition. So a hold that
   * expired while this field was unmounted — the athlete was rating the last
   * set, or had moved to another exercise entirely — used to be claimed by
   * whichever seconds field mounted next, writing a duration counted for a
   * different movement against a different target.
   *
   * The ack happens either way: a stale finish left in the provider would
   * otherwise haunt every field that mounts after it. Only the WRITE is gated.
   *
   * Deliberately depends only on `timer.finished` — this should fire once on
   * the transition to finished, not on every render where `onChange`/`timer`
   * identity happens to change. The project has no lint script enforcing
   * exhaustive-deps, so no eslint-disable comment is needed here.
   */
  useEffect(() => {
    if (!timer.finished) return;
    if (timer.owner === setKey) onChange(String(timer.total));
    timer.ack();
  }, [timer.finished]);

  /* Only THIS set's hold takes over the field. One timer serves the whole app,
     so without the same ownership check a field for another set mirrored a
     countdown it never started — and its Stop button wrote those seconds
     straight into the wrong set. */
  const mine = timer.running && timer.owner === setKey;

  return (
    <div className="mt-2">
      <label className="text-2 font-[750] uppercase tracking-[.14em] text-dim">{label}</label>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          aria-label={label}
          value={mine ? String(timer.left) : value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={mine}
          inputMode="numeric"
          className="h-7 flex-1 rounded-md border border-line bg-well text-center text-9 text-text"
        />
        {mine ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(String(timer.stop()))}>
            Stop
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => timer.start(targetSec, setKey)} disabled={!targetSec}>
            Start
          </Button>
        )}
      </div>
    </div>
  );
}

function RpeStep({ rpe, onRpe, onConfirm }: { rpe: number; onRpe: (n: number) => void; onConfirm: () => void }) {
  return (
    <div className="mt-2 rounded-md border border-line bg-well p-2 text-center shadow-well">
      <Kicker>How hard was that? · RPE</Kicker>
      <b className="num mt-0.5 block text-9 font-[900] text-gold2">{fmtRpe(rpe)}</b>
      <input
        type="range"
        min={1}
        max={10}
        step={0.5}
        value={rpe}
        onChange={(e) => onRpe(Number(e.target.value))}
        aria-label="RPE from 1 to 10"
        className="mt-1 w-full accent-gold2"
      />
      <div className="flex justify-between text-2 text-dim">
        <span>1 · barely felt it</span>
        <span>10 · max effort</span>
      </div>
      <Button variant="brass" size="lg" className="mt-2 w-full" onClick={onConfirm}>
        Confirm Set
      </Button>
    </div>
  );
}

function Affordances({
  note,
  noteOpen,
  onToggleNote,
  onNote,
  weightKg,
  platesOpen,
  onTogglePlates,
}: {
  note: string;
  noteOpen: boolean;
  onToggleNote: () => void;
  onNote: (txt: string) => void;
  weightKg: number;
  platesOpen: boolean;
  onTogglePlates: () => void;
}) {
  const plates = weightKg > 0 ? plateBreakdown(weightKg, 20, [25, 20, 15, 10, 5, 2.5, 1.25]) : null;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={onToggleNote}
          aria-label="set note"
          className={cx(
            'h-4 rounded-pill border px-1 text-3 font-[650]',
            note ? 'border-gold-line bg-gold-wash text-gold2' : 'border-line2 text-muted',
          )}
        >
          {note ? note : 'note'}
        </button>
        {plates ? (
          <button
            onClick={onTogglePlates}
            aria-label="plate breakdown"
            className="h-4 rounded-pill border border-line2 px-1 text-3 font-[650] text-muted"
          >
            plates
          </button>
        ) : null}
      </div>

      {noteOpen ? (
        // Written through on change, like the weight and reps beside it. Saving
        // on blur alone lost the note whenever the field did not get a chance to
        // blur — a reload, the phone reclaiming the tab, or the on-screen
        // keyboard's Done key.
        <input
          autoFocus
          value={note}
          onChange={(e) => onNote(e.target.value)}
          maxLength={120}
          placeholder="note (e.g. belt, tweak)"
          aria-label="set note text"
          className="mt-1 h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
        />
      ) : null}

      {platesOpen && plates ? (
        <p className="num mt-1 rounded-md border border-line bg-well px-1 py-0.5 text-3 text-muted">
          {plates.perSide.length ? `per side: ${plates.perSide.join(' · ')}` : 'bar only'}
          {plates.loadable ? '' : ` — nearest is ${plates.achievableKg}kg (${plates.delta > 0 ? '+' : ''}${plates.delta})`}
        </p>
      ) : null}
    </div>
  );
}

function LoggedList({ ex }: { ex: Exercise<LoggedSet> }) {
  const done = ex.sets.map((st, i) => ({ st, i })).filter((x) => x.st.done);
  if (!done.length) return null;
  return (
    <ul className="mt-2 divide-y divide-line border-t border-line">
      {done.map(({ st, i }) => (
        <li key={i} className="num flex items-center gap-1 py-1 text-4">
          <span className="w-4 text-dim">{i + 1}</span>
          <span className="flex-1 text-text">
            {st.aVal || '—'}
            {isLiftMode(ex.mode) ? 'kg' : ''}
            {st.aVal2 ? ' × ' + st.aVal2 : ''}
            {isWarmup(st) ? <span className="ml-1 text-2 text-dim">warm-up</span> : null}
          </span>
          {st.felt ? <span className="text-gold2">RPE {st.felt}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/*
 * Every set of this exercise at once, editable in place — the reference
 * logger's table.
 *
 * This replaces a stage that showed ONE set and hid the rest behind it. The
 * difference is not cosmetic: mid-exercise you want to see what you have
 * already put on the bar and what is still coming, and a one-set stage makes
 * that a memory exercise. Reps sit left of weight because that is the order the
 * prescription is read in ("3 x 6-8 @ 100"), not the order the old stage
 * happened to stack them.
 *
 * Every keystroke writes straight through to the session, exactly as the single
 * set stage did — stepping off the screen, the tab being reclaimed between
 * sets, or a reload must not cost a number already typed.
 *
 * The tick is the whole commit. It marks the set done and nothing else, which
 * is the one real DEVIATION from what this app did before: the old flow forced
 * an RPE rating between finishing a set and it counting, and autoregulation
 * fed on that rating.
 *
 * Rating is now optional, and it is two targets rather than a slider — ↑ or ↓
 * against what the set asked for, appearing under the row once it is ticked
 * (`deviationFelt` is the rule they mean). One tap in the common case, two to
 * autoregulate. A set left unrated holds its weight, which is not a gap: an
 * unwritten `felt` is the engine's own way of saying nobody gave evidence, and
 * inventing some would be worse than having none.
 *
 * What moves is the GHOST in the kg column of the sets below, never their
 * values — the table proposes, and the athlete's typing is the only thing that
 * ever fills a box.
 */
function targetHint(st: LoggedSet): string {
  /* An authored "@80%" is a LOAD, and this is the ghost for the reps column.
     It reaches the athlete already resolved into kilos, in the kg column's own
     ghost (`prescribedKg`), so echoing it here would put the same instruction
     in two places and put it in the wrong one. */
  const raw = String(st.t || '').replace(/@\s*\d+(?:\.\d+)?\s*%/g, ' ').trim();
  if (!raw) return '';
  /* "W10" is a warm-up marked in the target itself; the W is a flag for the
     engine, not something to echo into an input the athlete types reps into. */
  return isWarmup(st) ? raw.replace(/^W/i, '') : raw;
}

function SetsTable({
  ex,
  lastSets,
  ghosts,
  onWrite,
  onToggle,
  onRate,
}: {
  ex: Exercise<LoggedSet>;
  lastSets: { kg: number | null; reps: number }[];
  ghosts: string[];
  onWrite: (idx: number, slot: 1 | 2, val: string) => void;
  onToggle: (idx: number) => void;
  onRate: (idx: number, dir: Deviation) => void;
}) {
  const allDone = ex.sets.length > 0 && ex.sets.every((st) => st.done);
  return (
    <div className="mt-2">
      <div className="grid grid-cols-[40px_1fr_1fr_44px] items-center gap-1 px-0.5 pb-0.5 text-2 font-[750] uppercase tracking-[.1em] text-dim">
        <span>Sets</span>
        <span>Reps</span>
        <span>Kg</span>
        <button
          onClick={() => ex.sets.forEach((st, i) => (allDone ? st.done && onToggle(i) : !st.done && onToggle(i)))}
          aria-label={allDone ? 'Un-tick every set' : 'Tick every set'}
          aria-pressed={allDone}
          className={cx(
            'grid h-4 w-4 place-items-center justify-self-end rounded-pill text-4 transition-colors',
            allDone ? "border border-done-line bg-done-bg text-done-ink" : "border border-line2 bg-panel2 text-dim",
          )}
        >
          ✓✓
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {ex.sets.map((st, i) => {
          const last = lastSets[workingSetOrdinal(ex.sets, i)];
          return (
            <li key={i} className="grid grid-cols-[40px_1fr_1fr_44px] items-center gap-1">
              <span className="num text-5 text-dim">{i + 1}</span>
              <input
                inputMode="numeric"
                value={String(st.aVal2 ?? '')}
                onChange={(e) => onWrite(i, 2, e.target.value)}
                placeholder={targetHint(st)}
                aria-label={`Reps for set ${i + 1}`}
                className="h-6 w-full rounded-md border border-line2 bg-panel3 text-center text-6 font-[650] text-text placeholder:text-2 placeholder:font-[650] placeholder:text-dim"
              />
              <input
                inputMode="decimal"
                value={String(st.aVal ?? '')}
                onChange={(e) => onWrite(i, 1, e.target.value)}
                /* What this row SUGGESTS — the autoregulated number when a set
                   above was rated, otherwise last time's weight for the same
                   working set. A ghost rather than a value on purpose: see
                   `ghosts` in Logger. */
                placeholder={ghosts[i] || (last?.kg != null ? String(last.kg) : '')}
                aria-label={`Kilograms for set ${i + 1}`}
                className="h-6 w-full rounded-md border border-line2 bg-panel3 text-center text-6 font-[650] text-text placeholder:text-2 placeholder:font-[650] placeholder:text-dim"
              />
              <button
                onClick={() => onToggle(i)}
                aria-label={`${st.done ? 'Un-log' : 'Log'} set ${i + 1}`}
                aria-pressed={!!st.done}
                className={cx(
                  'grid h-6 w-6 place-items-center justify-self-end rounded-pill text-6 transition-colors',
                  st.done ? 'border border-done-line bg-done-bg text-done-ink' : 'border border-line2 bg-panel2 text-dim',
                )}
              >
                ✓
              </button>

              {/*
                * How it went, asked only once it is already logged.
                *
                * A second row rather than two more columns: the row is
                * `40px 1fr 1fr 44px` on a 420px screen and a fifth and sixth
                * target would squeeze the two inputs the athlete actually types
                * into. It appears on the tick, which is the moment the question
                * makes sense, and never on a warm-up — the engine ignores
                * warm-up ratings everywhere, so offering one would be offering
                * a control that does nothing.
                */}
              {st.done && !isWarmup(st) ? (
                <div className="col-span-4 -mt-0.5 flex items-center justify-end gap-1 pb-0.5">
                  <span className="mr-auto pl-1 text-2 font-[650] text-dim">
                    {st.felt ? `rated ${st.felt} — vs asked` : 'vs asked?'}
                  </span>
                  {(['easier', 'harder'] as const).map((dir) => {
                    const on = !!st.felt && st.felt === fmtRpe(deviationFelt(st, dir));
                    return (
                      <button
                        key={dir}
                        onClick={() => onRate(i, dir)}
                        aria-label={`Set ${i + 1} was ${dir} than asked`}
                        aria-pressed={on}
                        className={cx(
                          'grid h-6 w-6 place-items-center rounded-pill text-6 transition-colors',
                          on
                            ? 'border border-gold-line bg-gold-wash text-gold2'
                            : 'border border-line2 bg-panel2 text-dim',
                        )}
                      >
                        {dir === 'easier' ? '↑' : '↓'}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
