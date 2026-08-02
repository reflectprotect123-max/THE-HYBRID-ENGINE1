import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  decideStrengthProgression,
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
  targetLine,
  todayRecovery,
  type Exercise,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { useRest } from '../store/rest';
import { useSetTimer } from '../store/setTimer';
import { Btn, Chip, Input, Ltr, T, Tap } from '../ui';
import { setKeepAwake } from '../native/capabilities';
import type { RootStackParams } from '../App';

/*
 * The logger stage, natively.
 *
 * Structurally identical to the web version because the FLOW is engine logic —
 * curSetIndex, advanceAfterSet, prefillPrimary and the autoregulation call are
 * all shared. What differs is only presentation and the platform affordances:
 * the screen is kept awake while the session is live, and rest fires a real
 * scheduled notification rather than hoping a JS timer survives the pocket.
 *
 * The number fields are `h-[56px]` and not `h-7`: 7 is not on the theme's 8px
 * spacing scale, so `h-7` fell through to Tailwind's default 1.75rem = 28px and
 * clipped a 34px (`text-9`) figure top and bottom on a real screen.
 */
type Props = NativeStackScreenProps<RootStackParams, 'Logger'>;
type Phase = 'input' | 'rpe' | 'rest';

/** A live countdown for `seconds`-mode holds (stretches, planks). While
 *  running the field mirrors the timer's remaining seconds and is read-only;
 *  Start/Stop own the value the way a manual edit normally would. */
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
    <>
      <T w="semi" className="mt-2 text-2 uppercase tracking-widest text-dim">
        {label}
      </T>
      <View className="mt-0.5 flex-row items-center gap-1">
        <Input
          accessibilityLabel="seconds"
          value={mine ? String(timer.left) : value}
          onChangeText={onChange}
          editable={!mine}
          keyboardType="number-pad"
          w="semi"
          num
          className="h-[56px] flex-1 rounded-md border border-line bg-well text-center text-9 text-text"
        />
        {mine ? (
          <Btn variant="ghost" size="md" onPress={() => onChange(String(timer.stop()))}>
            Stop
          </Btn>
        ) : (
          <Btn variant="ghost" size="md" onPress={() => timer.start(targetSec, setKey)} disabled={!targetSec}>
            Start
          </Btn>
        )}
      </View>
    </>
  );
}

export function LoggerScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { activeSession, db, whoop, updateSession } = useDb();
  const rest = useRest();
  /* Consumed by the SCREEN, not only by the field. While a hold runs the box
     shows `timer.left` and `v1` still holds the prefilled target, so the
     confirm flow has to be able to stop the clock and commit what was
     actually held — see `stopSetTimerIfRunning`. */
  const setTimer = useSetTimer();

  const [loc, setLoc] = useState({ bi: route.params.bi, ei: route.params.ei });
  const [phase, setPhase] = useState<Phase>('input');
  const [rpe, setRpe] = useState(7.5);
  const [hint, setHint] = useState<{ txt: string; cls: 'good' | 'bad' } | null>(null);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [platesOpen, setPlatesOpen] = useState(false);

  const s = activeSession;
  const block = s?.blocks[loc.bi];
  const ex = block && !isCond(block) ? blockExercises(block as StrengthBlock<LoggedSet>)[loc.ei] : undefined;
  const si = ex ? curSetIndex(ex) : -1;
  const st = ex && si >= 0 ? ex.sets[si] : undefined;
  const lift = !!ex && isLiftMode(ex.mode);

  // The screen must not sleep mid-set; released when the stage closes.
  useEffect(() => {
    void setKeepAwake(true);
    return () => void setKeepAwake(false);
  }, []);

  const setKey = `${loc.bi}-${loc.ei}-${si}`;
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
    setV1(claimed ?? prefillPrimary(ex, si, db.sessions, { settings: db.settings, whoop }));
    setV2(prefillSecondary(ex, si));
    setNoteOpen(false);
    setPlatesOpen(false);
  }, [ex, si, setKey, db.sessions, db.settings, whoop, setTimer]);

  useEffect(() => {
    if (phase === 'rest' && !rest.running) setPhase('input');
  }, [phase, rest.running]);

  const prog = useMemo(() => (s ? sessionProgress(s) : { done: 0, total: 0, pct: 0 }), [s]);
  const letters = useMemo(() => (s ? sessionLetters(s) : {}), [s]);

  /* The exercise directly after this one in the same block — the only thing it
     can be supersetted INTO. Null on the last of a block, where the control is
     hidden rather than shown disabled: an offer you cannot take is noise. */
  const partner = useMemo(() => {
    if (!s || !loc) return null;
    const b = s.blocks[loc.bi];
    if (!b || isCond(b)) return null;
    return blockExercises(b)[loc.ei + 1] || null;
  }, [s, loc]);

  const toggleSuperset = () => {
    if (!s || !loc) return;
    updateSession(s.id, (ds) => {
      const src = (ds.blocks[loc.bi] as StrengthBlock<LoggedSet>)?.exercises?.[loc.ei];
      if (!src) return false;
      src.ssNext = !src.ssNext;
      ds.updatedAt = Date.now();
    });
  };
  // Where "next exercise" points. Never the current location — re-entering
  // would reset the stage and discard an RPE already dialled in.
  const next = useMemo(() => (s ? nextLoggerLocation(s, loc.bi, loc.ei) : null), [s, loc.bi, loc.ei]);

  /* Where the prefilled weight came from. A number that appears in the box on
     its own is either trusted blindly or ignored; naming its origin — earned
     last session, and whether today's recovery eased it — is what makes it
     a suggestion rather than an instruction. */
  const earned = useMemo(
    () => (ex && lift ? nextWorkingWeight(ex.name, db.settings, whoop) : null),
    [ex, lift, db.settings, whoop],
  );

  const rec = todayRecovery(whoop);
  const earnedExplained = useMemo(
    () => (earned ? explainWorkingWeight(earned, rec) : null),
    [earned, rec],
  );

  const isFirstWorkingSet = !!ex && ex.sets.findIndex((s2) => !isWarmup(s2)) === si;
  /* Gated on `isFirstWorkingSet` — the only place it is rendered — BEFORE
     `db.sessions` is touched. Every keystroke writes through to the session,
     which hands the store a fresh array, so an ungated memo re-scanned the
     whole training history on each character typed on the gym-floor screen. */
  const strengthSuggestion = useMemo(
    () =>
      isFirstWorkingSet && ex && lift && st && !isWarmup(st)
        ? decideStrengthProgression(ex.name, db.sessions, { t: st.t, rpe: st.rpe })
        : null,
    [isFirstWorkingSet, ex, lift, st, db.sessions],
  );

  if (!s || !block || isCond(block) || !ex) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-3">
        <T w="semi" className="text-6 text-text">No live session</T>
        <Btn variant="brass" className="mt-2" onPress={() => navigation.goBack()}>
          Back
        </Btn>
      </View>
    );
  }

  /*
   * Every keystroke lands on the set, not just in component state.
   *
   * Android reclaims a backgrounded process aggressively, and a session is
   * ninety minutes of screen-on time — so "typed but not yet confirmed" has to
   * survive the process dying. `prefillPrimary` reads `aVal` back first, which
   * makes the round trip lossless. Sanitising still happens on confirm: what is
   * half-typed is not yet a claim about what was lifted.
   */
  function writeVal(slot: 1 | 2, val: string) {
    if (slot === 1) setV1(val);
    else setV2(val);
    if (!s || si < 0) return;
    updateSession(s.id, (ds) => {
      const dst = (ds.blocks[loc.bi] as StrengthBlock<LoggedSet>)?.exercises?.[loc.ei]?.sets?.[si];
      if (!dst) return false;
      if (slot === 1) dst.aVal = val;
      else dst.aVal2 = val;
      ds.updatedAt = Date.now();
    });
  }

  /* Written through on change for the same reason: a note saved on blur alone
     is lost whenever the field never gets to blur — the keyboard's Done key,
     the back gesture, or the OS reclaiming the app. */
  function writeNote(txt: string) {
    if (!s || si < 0) return;
    updateSession(s.id, (ds) => {
      const dst = (ds.blocks[loc.bi] as StrengthBlock<LoggedSet>)?.exercises?.[loc.ei]?.sets?.[si];
      if (!dst) return false;
      dst.note = txt;
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
      const dex = (ds.blocks[loc.bi] as StrengthBlock<LoggedSet>).exercises[loc.ei];
      const dst = dex.sets[si];

      // Sanitised on the way in — "1e309" stored verbatim parses back to
      // Infinity everywhere it is later read, and survives every restart.
      dst.aVal = lift ? sanNumStr(primary) : String(primary || '').trim();
      // Only write the second field when this mode HAS one, or when something
      // was actually typed. Writing it unconditionally blanks a previously
      // logged value on every mode that renders a single input.
      if (v2 !== '' || dex.mode === 'reps_kg' || dex.mode === 'reps_seconds') dst.aVal2 = sanNumStr(v2);
      // A warm-up is never rated — same rule as web: no wasted tap, and no
      // fabricated 7.5 stored as if the athlete rated it.
      if (!isWarmup(dst)) dst.felt = fmtRpe(rpe);
      dst.done = true;

      // A warm-up must never move the working weight.
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
          const dtxt = adj.delta > 0 ? `+${adj.delta} kg` : adj.delta < 0 ? `${adj.delta} kg` : 'hold weight';
          const lead =
            adj.verdict === 'missed the rep floor' ? 'That set missed the rep floor' : `That set was ${adj.verdict}`;
          nextHint = {
            txt: `${lead} — ${dtxt} for ${isFinal ? 'next session' : 'Set ' + (si + 2)} (${adj.newWeight} kg).`,
            cls: adj.cls,
          };
          const nx = dex.sets[si + 1];
          if (!isFinal && nx && !nx.done && !nx.aVal) nx.aVal = String(adj.newWeight);
        }
      }
      ds.updatedAt = Date.now();
    });

    setHint(nextHint);
    setRpe(7.5);

    const after = JSON.parse(JSON.stringify(s)) as typeof s;
    (after.blocks[loc.bi] as StrengthBlock<LoggedSet>).exercises[loc.ei].sets[si].done = true;
    const { next: dest, restSec } = advanceAfterSet(after, loc.bi, loc.ei);

    if (restSec > 0 && dest) {
      rest.start(restSec);
      setPhase('rest');
      if (dest.bi !== loc.bi || dest.ei !== loc.ei) setLoc(dest);
    } else if (dest && (dest.bi !== loc.bi || dest.ei !== loc.ei)) {
      setLoc(dest);
      setHint(null);
      setPhase('input');
    } else {
      setPhase('input');
    }
  }

  const step = (dir: 1 | -1) => {
    // parseFloat('1e309') is Infinity and `|| 0` lets it straight through: the
    // field then reads "Infinity" and the plate breakdown below is asked to
    // load a bar with it.
    const cur = parseFloat(v1);
    const from = Number.isFinite(cur) ? cur : 0;
    writeVal(1, String(Math.max(0, Math.min(MAX_KG, Math.round((from + dir * AUTOREG.stepKg) * 100) / 100))));
  };

  const plates = lift && parseFloat(v1) > 0 ? plateBreakdown(parseFloat(v1), 20, [25, 20, 15, 10, 5, 2.5, 1.25]) : null;

  return (
    <ScrollView
      className="flex-1 bg-bg"
      // Without this the keypad eats the first tap on Finish Set — the button
      // you press after typing a weight, every single set.
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="flex-row items-start gap-1">
        <Tap
          onPress={() => navigation.goBack()}
          label="back to session"
          box={40}
          className="h-5 w-5 items-center justify-center rounded-md border border-line2 bg-panel2"
        >
          <T className="text-6 text-muted">←</T>
        </Tap>
        <View className="flex-1">
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">
            {block.heading || 'Block'}
            {!isCond(block) && !isText(block) && block.superset ? ' · superset' : ''}
          </T>
          <T w="bold" className="text-7 text-text">{s.name || 'Session'}</T>
        </View>
      </View>

      <View className="mt-2 h-0.5 overflow-hidden rounded-pill bg-track">
        <View className="h-full rounded-pill bg-gold2" style={{ width: `${prog.pct}%` }} />
      </View>
      <View className="mt-0.5 flex-row justify-between">
        <T num className="text-2 text-dim">
          {prog.done} of {prog.total} done
        </T>
        <T num className="text-2 text-dim">{prog.pct}%</T>
      </View>

      <View className="mt-2 rounded-lg border border-line bg-panel p-2">
        <View className="flex-row items-center gap-1">
          <Ltr>{letters[loc.bi]?.[loc.ei] ?? '?'}</Ltr>
          <T w="bold" className="flex-1 text-7 text-text" numberOfLines={1}>
            {ex.name || 'Exercise'}
          </T>
        </View>
        <T num className="mt-0.5 text-3 text-dim">
          {[ex.tempo ? '@' + ex.tempo : '', Number(ex.rest) ? 'rest ' + fmtRest(ex.rest) : 'no rest']
            .filter(Boolean)
            .join(' · ')}
        </T>

        {partner ? (
          <Tap
            onPress={toggleSuperset}
            role="radio"
            selected={!!ex.ssNext}
            label={`superset with ${partner.name || 'the next exercise'}, ${ex.ssNext ? 'on' : 'off'}`}
            box={{ h: 34 }}
            className={`mt-1 flex-row items-center gap-1 rounded-md border px-1 py-1 ${
              ex.ssNext ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel3'
            }`}
          >
            <T className={`text-4 ${ex.ssNext ? 'text-gold2' : 'text-dim'}`}>⇄</T>
            {/* On, it states a fact; off, it asks. Same control, and which one
                it is should be readable without hunting for the highlight. */}
            <T className={`flex-1 text-3 ${ex.ssNext ? 'text-gold2' : 'text-dim'}`} numberOfLines={1}>
              {ex.ssNext ? 'Supersetted with ' : 'Superset with '}
              <T w="semi">{partner.name || 'next'}</T>
              {ex.ssNext ? '' : '?'}
            </T>
          </Tap>
        ) : null}

        {ex.cue ? (
          <T className="mt-1 rounded-md border border-gold-line bg-gold-wash px-1 py-1 text-4 text-gold2">
            {ex.cue}
          </T>
        ) : null}

        <View className="mt-1.5 flex-row gap-0.5">
          {ex.sets.map((set, i) => (
            <View
              key={i}
              className={`h-0.5 flex-1 rounded-pill ${set.done ? 'bg-gold2' : i === si ? 'bg-gold' : 'bg-track'}`}
            />
          ))}
        </View>

        {si >= 0 && st ? (
          <>
            <View className="mt-2 flex-row justify-between">
              <T w="semi" className="text-2 uppercase tracking-widest text-dim">
                Set {si + 1} of {ex.sets.length}
                {isWarmup(st) ? ' · warm-up' : ''}
              </T>
              <T w="semi" num className="text-2 text-gold2">target {targetLine(ex, st)}</T>
            </View>

            {phase === 'input' ? (
              <>
                {lift ? (
                  <>
                    <View className="mt-2 flex-row items-baseline justify-between">
                      <T w="semi" className="text-2 uppercase tracking-widest text-dim">Weight</T>
                      {earned && !isWarmup(st) ? (
                        <T num className="text-2 text-muted">
                          {(earned.dailyAdj < 0
                            ? `earned ${earned.earned}kg · ${earned.note}`
                            : `earned ${earned.earned}kg last time`) +
                            (earnedExplained?.confidence === 'low' ? ' · no recovery data today' : '')}
                        </T>
                      ) : null}
                    </View>
                    <View className="mt-0.5 flex-row gap-1">
                      <Tap
                        onPress={() => step(-1)}
                        label={`minus ${AUTOREG.stepKg} kg`}
                        box={{ w: 48 }}
                        className="w-6 items-center justify-center rounded-md border border-line2 bg-panel2"
                      >
                        <T className="text-7 text-muted">−</T>
                      </Tap>
                      <Input
                        value={v1}
                        onChangeText={(t) => writeVal(1, t)}
                        keyboardType="decimal-pad"
                        accessibilityLabel="kg"
                        w="semi"
                        num
                        className="h-[56px] flex-1 rounded-md border border-line bg-well text-center text-9 text-text"
                        placeholder="kg"
                      />
                      <Tap
                        onPress={() => step(1)}
                        label={`plus ${AUTOREG.stepKg} kg`}
                        box={{ w: 48 }}
                        className="w-6 items-center justify-center rounded-md border border-line2 bg-panel2"
                      >
                        <T className="text-7 text-muted">+</T>
                      </Tap>
                    </View>
                    <T w="semi" className="mt-2 text-2 uppercase tracking-widest text-dim">Reps</T>
                    <Input
                      value={v2}
                      onChangeText={(t) => writeVal(2, t)}
                      keyboardType="number-pad"
                      accessibilityLabel="reps"
                      w="semi"
                      num
                      className="mt-0.5 h-[56px] rounded-md border border-line bg-well text-center text-9 text-text"
                    />
                    {strengthSuggestion?.prescription && isFirstWorkingSet ? (
                      <View className="mt-1 flex-row items-center justify-between">
                        <T className="text-2 text-muted">{strengthSuggestion.note}</T>
                        <Btn
                          variant="ghost"
                          size="md"
                          onPress={() => {
                            if (strengthSuggestion.prescription?.load != null) {
                              writeVal(1, String(strengthSuggestion.prescription.load));
                            }
                            if (strengthSuggestion.prescription?.reps != null) {
                              writeVal(2, String(strengthSuggestion.prescription.reps));
                            }
                          }}
                        >
                          Apply
                        </Btn>
                      </View>
                    ) : null}
                  </>
                ) : ex.mode === 'reps_seconds' ? (
                  /* Two fields, like the web app: this mode records BOTH, and
                     collapsing it to one box labelled "Reps" wrote the seconds
                     into the reps field and lost the other half of the set. */
                  <>
                    <T w="semi" className="mt-2 text-2 uppercase tracking-widest text-dim">Secs</T>
                    <Input
                      value={v1}
                      onChangeText={(t) => writeVal(1, t)}
                      keyboardType="number-pad"
                      accessibilityLabel="seconds"
                      w="semi"
                      num
                      className="mt-0.5 h-[56px] rounded-md border border-line bg-well text-center text-9 text-text"
                    />
                    <T w="semi" className="mt-2 text-2 uppercase tracking-widest text-dim">Reps</T>
                    <Input
                      value={v2}
                      onChangeText={(t) => writeVal(2, t)}
                      keyboardType="number-pad"
                      accessibilityLabel="reps"
                      w="semi"
                      num
                      className="mt-0.5 h-[56px] rounded-md border border-line bg-well text-center text-9 text-text"
                    />
                  </>
                ) : ex.mode === 'seconds' ? (
                  <SecondsTimerField
                    /* Keyed on the set, so moving the cursor gives the field a
                       FRESH instance rather than reusing the one that armed a
                       hold for some other set. `loc` and `si` both change
                       without unmounting this subtree — without the key React
                       reconciles the same element in the same slot and the
                       instance, effect and all, survives the move. */
                    key={setKey}
                    setKey={setKey}
                    label="Secs"
                    value={v1}
                    onChange={(t) => writeVal(1, t)}
                    /* `st.t` is free text — '20-30', '30s', '20-30s/side' are
                       all legal authored targets, and Number() makes NaN of
                       every one of them, which left Start disabled with no
                       explanation. `repTopOf` is the parser the rest of this
                       screen already targets: the top of a range is what the
                       athlete is aiming at. */
                    targetSec={Number(repTopOf(st.t)) || 0}
                  />
                ) : (
                  <>
                    <T w="semi" className="mt-2 text-2 uppercase tracking-widest text-dim">
                      Reps
                    </T>
                    <Input
                      value={v1}
                      onChangeText={(t) => writeVal(1, t)}
                      keyboardType="number-pad"
                      w="semi"
                      num
                      accessibilityLabel="reps"
                      className="mt-0.5 h-[56px] rounded-md border border-line bg-well text-center text-9 text-text"
                    />
                  </>
                )}

                {/* The two things you reach for with the bar in front of you: a
                    note about how the set went, and what to actually load. */}
                <View className="mt-1.5">
                  <View className="flex-row flex-wrap items-center gap-1">
                    {/* Truncated on the chip, not in the data: a pill sized by
                        120 characters of free text pushes itself off the card,
                        because a React Native flex item does not shrink. */}
                    <Chip on={!!st.note} onPress={() => setNoteOpen((o) => !o)}>
                      {st.note ? (st.note.length > 24 ? `${st.note.slice(0, 24)}…` : st.note) : 'note'}
                    </Chip>
                    {plates ? <Chip on={platesOpen} onPress={() => setPlatesOpen((o) => !o)}>plates</Chip> : null}
                  </View>

                  {noteOpen ? (
                    <Input
                      autoFocus
                      value={st.note || ''}
                      onChangeText={writeNote}
                      maxLength={120}
                      placeholder="note (e.g. belt, tweak)"
                      accessibilityLabel="set note text"
                      className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
                    />
                  ) : null}

                  {platesOpen && plates ? (
                    <T num className="mt-1 rounded-md border border-line bg-well px-1 py-0.5 text-3 text-muted">
                      {plates.perSide.length ? `per side: ${plates.perSide.join(' · ')}` : 'bar only'}
                      {plates.loadable
                        ? ''
                        : ` — nearest is ${plates.achievableKg}kg (${plates.delta > 0 ? '+' : ''}${plates.delta})`}
                    </T>
                  ) : null}
                </View>

                <Btn
                  variant="brass"
                  size="lg"
                  className="mt-2"
                  onPress={() => {
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
                </Btn>
              </>
            ) : null}

            {phase === 'rpe' ? (
              <View className="mt-2 rounded-md border border-line bg-well p-2">
                <T w="semi" className="text-center text-2 uppercase tracking-widest text-dim">
                  How hard was that? · RPE
                </T>
                {/* The chips used to start at 5, which made every value the web
                    app's 1–10 slider can reach below that simply unreachable —
                    and a warm-up is honestly rated 3. The low end is on the chip
                    row now, and the stepper covers the halves between. */}
                <View className="mt-0.5 flex-row items-center justify-center gap-1">
                  <Tap
                    onPress={() => setRpe((r) => Math.max(1, Math.round((r - 0.5) * 10) / 10))}
                    label="lower RPE by a half"
                    box={{ h: 40, w: 48 }}
                    className="h-5 w-6 items-center justify-center rounded-md border border-line2 bg-panel2"
                  >
                    <T className="text-7 text-muted">−</T>
                  </Tap>
                  <T w="black" num className="w-10 text-center text-9 text-gold2">{fmtRpe(rpe)}</T>
                  <Tap
                    onPress={() => setRpe((r) => Math.min(10, Math.round((r + 0.5) * 10) / 10))}
                    label="raise RPE by a half"
                    box={{ h: 40, w: 48 }}
                    className="h-5 w-6 items-center justify-center rounded-md border border-line2 bg-panel2"
                  >
                    <T className="text-7 text-muted">+</T>
                  </Tap>
                </View>
                <View className="mt-1 flex-row flex-wrap justify-center gap-1">
                  {[1, 2, 3, 4, 5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((n) => (
                    <Tap
                      key={n}
                      onPress={() => setRpe(n)}
                      label={`RPE ${fmtRpe(n)}`}
                      className={`h-5 w-6 items-center justify-center rounded-pill border ${
                        rpe === n ? 'border-done-line bg-done-bg' : 'border-line2 bg-panel2'
                      }`}
                    >
                      <T w="semi" num className={`text-4 ${rpe === n ? 'text-done-ink' : 'text-muted'}`}>
                        {fmtRpe(n)}
                      </T>
                    </Tap>
                  ))}
                </View>
                <T className="mt-1 text-center text-2 text-dim">1 · barely felt it — 10 · max effort</T>
                <Btn variant="brass" size="lg" className="mt-2" onPress={confirmSet}>
                  Confirm Set
                </Btn>
              </View>
            ) : null}

            {phase === 'rest' ? (
              <View className="mt-2 items-center rounded-md border border-line bg-well p-2">
                <T w="semi" className="text-2 uppercase tracking-widest text-dim">Rest</T>
                <T w="black" num className="mt-0.5 text-9 text-gold2">{fmtRest(rest.left)}</T>
                <View className="mt-1 h-0.5 w-full overflow-hidden rounded-pill bg-track">
                  <View className="h-full rounded-pill bg-gold2" style={{ width: `${rest.frac * 100}%` }} />
                </View>
                <View className="mt-2 flex-row gap-1">
                  <Tap
                    onPress={() => rest.add(15)}
                    label="add 15 seconds of rest"
                    box={{ h: 34 }}
                    className="rounded-md border border-line2 px-2 py-1"
                  >
                    <T w="med" num className="text-4 text-muted">+15s</T>
                  </Tap>
                  <Tap
                    onPress={() => {
                      rest.stop();
                      setPhase('input');
                    }}
                    label="skip the rest timer"
                    box={{ h: 34 }}
                    className="rounded-md border border-line2 px-2 py-1"
                  >
                    <T w="med" className="text-4 text-muted">Skip rest</T>
                  </Tap>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View className="mt-3 items-center rounded-md border border-done-line bg-done-bg p-3">
            <T w="semi" className="text-5 text-done-ink">
              All {ex.sets.length} set{ex.sets.length === 1 ? '' : 's'} logged
            </T>
          </View>
        )}

        {hint ? (
          <T num className={`mt-2 text-4 ${hint.cls === 'good' ? 'text-gold2' : 'text-bad'}`}>{hint.txt}</T>
        ) : null}

        <LoggedList ex={ex} />
      </View>

      {/* Moving on without going back through the session list. `next` never
          points at the exercise already on the stage. */}
      <View className="mt-2 flex-row gap-1">
        <Btn className="flex-1" onPress={() => navigation.goBack()}>
          ‹ Back to session
        </Btn>
        {next ? (
          <Btn
            className="flex-1"
            onPress={() => {
              setLoc({ bi: next.bi, ei: next.ei });
              setPhase('input');
              setHint(null);
            }}
          >
            {next.name} ›
          </Btn>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** Every set already confirmed this stage, so a mid-session glance answers
 *  "what did I just do" without scrolling back through Training. Transcribed
 *  from the web logger's `LoggedList` — same shape, same order. */
function LoggedList({ ex }: { ex: Exercise<LoggedSet> }) {
  const done = ex.sets.map((st, i) => ({ st, i })).filter((x) => x.st.done);
  if (!done.length) return null;
  return (
    <View className="mt-2 border-t border-line">
      {done.map(({ st, i }) => (
        <View key={i} className="flex-row items-center gap-1 border-b border-line py-1">
          <T num className="w-4 text-4 text-dim">{i + 1}</T>
          <T num className="flex-1 text-4 text-text">
            {(st.aVal || '—') + (isLiftMode(ex.mode) ? 'kg' : '') + (st.aVal2 ? ' × ' + st.aVal2 : '')}
            {isWarmup(st) ? '  warm-up' : ''}
          </T>
          {st.felt ? <T num className="text-4 text-gold2">RPE {st.felt}</T> : null}
        </View>
      ))}
    </View>
  );
}
