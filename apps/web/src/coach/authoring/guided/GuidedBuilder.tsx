import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import {
  canAdvance,
  nextStep,
  prevStep,
  type BlockKind,
  type FlowDraft,
  type FlowStep,
} from '@hybrid/guided-flow';
import {
  CON_EFFORTS,
  knownMovements,
  newBlock,
  newCondBlock,
  newTextBlock,
  type CondFmtKey,
  type EffortKey,
} from '@hybrid/engine';
import { useDb } from '../../../store/db';
import { Button, Kicker } from '../../../ui';
import { BlockTypeStep } from './BlockTypeStep';
import { MovementStep } from './MovementStep';
import { SetsStep } from './SetsStep';
import { RepsStep } from './RepsStep';
import { RpeStep } from './RpeStep';
import { CondDetailStep } from './CondDetailStep';
import { TextStep } from './TextStep';

interface Draft extends FlowDraft {
  blockKind: Exclude<BlockKind, null> | null;
  isWarmupSet: boolean;
  sets: number;
  effort: EffortKey;
  minutes: number;
}

const EMPTY_DRAFT: Draft = {
  blockKind: null,
  isWarmupSet: false,
  movementName: '',
  sets: 3,
  reps: '',
  rpe: '',
  condFmt: '',
  effort: 'medium',
  minutes: 0,
  text: '',
};

const BLOCK_LABEL: Record<Exclude<BlockKind, null>, string> = {
  lift: 'Lift',
  warmup: 'Warm-up / Cooldown',
  cond: 'Conditioning',
  metcon: 'Metcon / notes',
};

/**
 * The guided, one-step-at-a-time session builder. Replaces the old
 * "blank session straight into the Planner" entry point (see Library.tsx's
 * `addWorkout`) with a flow that authors one block at a time, then hands off
 * to the existing Planner for anything beyond a session's first pass —
 * there is no review/chain/split screen here (docs/superpowers/specs/
 * 2026-07-30-athlete-guided-session-builder-design.md).
 */
export function GuidedBuilder() {
  const { id } = useParams<{ id: string }>();
  const { db, update } = useDb();
  const nav = useNavigate();
  const [search] = useSearchParams();
  const location = useLocation();
  const requestedReturn = search.get('returnTo');
  /* `/coach/library`, not `/library` — same reason as Planner.tsx's fallback:
     the athlete Library this pointed at no longer exists, so the old value
     bounced the coach to the Command Center through App.tsx's catch-all. */
  const returnTo = requestedReturn?.startsWith('/coach') ? requestedReturn : '/coach/library';
  /*
   * Where the flow HANDS OFF once a session's first pass is authored.
   *
   * Stage 3a INTENDED to point the coach side at the new day builder — the
   * 2026-07-29 design asks for "coach instructions and Deliver/publish" as the
   * flow's final full-screen step. It does not yet, and deliberately: the day
   * builder opens EMPTY. It has no load path for an existing workout and no
   * save path back, so handing off to it would drop every block this wizard
   * just authored. Rewire this the moment DayBuilder loads and saves a real
   * session, and not before.
   */
  const plannerPath = `${location.pathname.startsWith('/coach/') ? '/coach/planner' : '/planner'}/${id}?returnTo=${encodeURIComponent(returnTo)}`;
  const navType = useNavigationType();
  const known = useMemo(() => knownMovements(db.workouts, db.sessions), [db.workouts, db.sessions]);
  const currentWorkout = db.workouts.find((x) => x.id === id);
  // A workout that has already committed to a kind only offers that kind's
  // blocks; a brand-new one (no kind yet) offers all four and commits on the
  // first block. `kind` is trustworthy here — sanitizeDB never invents one for
  // a blockless workout and never overwrites a stored one.
  const allowedKinds: Exclude<BlockKind, null>[] | undefined =
    currentWorkout?.kind === 'conditioning'
      ? ['cond']
      : currentWorkout?.kind === 'strength'
        ? ['lift', 'warmup', 'metcon']
        : undefined;

  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [added, setAdded] = useState<string[]>([]);
  const [phase, setPhase] = useState<'flow' | 'add-another'>('flow');

  /*
   * Leaving the flow, and dropping the record the Library minted for it.
   *
   * "＋ New session" writes the Workout BEFORE the wizard opens, so backing out
   * of the very first question would otherwise strand a permanent, blockless
   * session — which the Library then lists as "conditioning", since it reads
   * any zero-block workout that way. Tombstoned rather than merely spliced out,
   * the same as Library.tsx's own delete: without the tombstone the next sync
   * sees a workout the remote still has and restores it.
   *
   * Guarded twice over. An empty `added` means nothing was committed during THIS
   * wizard session; the blocks check inside the callback means the stored
   * workout is genuinely empty. The second guard is what keeps a finished
   * session safe when the browser's Back walks back into a remounted wizard
   * from the Planner — a fresh mount has an empty `added`, but that workout is
   * no phantom.
   */
  const abandon = useCallback(
    (replace = false) => {
      if (id && !added.length) {
        update((d) => {
          const w = d.workouts.find((x) => x.id === id);
          if (!w || w.blocks.length) return false;
          d.workouts = d.workouts.filter((x) => x.id !== id);
          d.settings.deletedIds = { ...(d.settings.deletedIds || {}), [id]: Date.now() };
        });
      }
      nav(returnTo, { replace });
    },
    [added.length, id, nav, returnTo, update],
  );

  /*
   * What a BACKWARD browser navigation means inside the wizard.
   *
   * The spec's rule is that back goes to the previous step within the current
   * block, never straight out of the flow — except from the first question,
   * where leaving IS right. The wizard's steps are React state, not routes, so
   * there is nothing for the browser to go back to: plain Back would leave
   * /build/:id altogether and lose the block being authored.
   *
   * This app's router is a declarative <BrowserRouter>, not a data router, so
   * useBlocker does not exist here. Instead every step forward pushes a history
   * entry for the SAME path (`guard` below), so history depth mirrors step
   * depth, and a POP that is still on /build/:id is one of those entries being
   * consumed — step back instead. A POP that genuinely leaves the route
   * unmounts this screen and never reaches here, which is exactly what should
   * happen from the first question.
   *
   * The step to land on is read from the POPPED entry's OWN `guidedStep`
   * state (written by `guard` below), not recomputed by decrementing the
   * CURRENT React `step`. Those two can drift: two forward pushes issued in
   * quick succession can commit their location updates in a different render
   * than the `setStep` that accompanies them, so `step` sometimes already
   * reads the new value while `location` still reports the previous push's
   * key — recomputing "previous" from that already-advanced `step` then
   * skips a step on the way back. Reading the landed-on entry's own tag is
   * immune to that: whichever entry a POP lands on, it says what it is.
   *
   * An entry with no `guidedStep` tag is the wizard's OWN initial /build/:id
   * entry (from Library's "＋ New session" nav, which predates any `guard`
   * call) — never anything to abandon to. A POP that actually leaves
   * /build/:id unmounts this screen before this effect can run at all, so
   * every untagged entry this ever sees is that first one: 'block-type'.
   */
  const handleBackward = useCallback(
    (poppedState: unknown) => {
      if (phase === 'add-another') {
        // Not a step, and the block is already saved, so the honest destination is
        // the Planner — the same place "No, I'm done" goes.
        if (id) nav(plannerPath, { replace: true });
        return;
      }
      const target = (poppedState as { guidedStep?: FlowStep } | null)?.guidedStep ?? 'block-type';
      setStep(target);
    },
    [id, nav, phase, plannerPath],
  );

  /*
   * Only a backward navigation matters, and only once per POP.
   *
   * This used to dedupe by comparing `location.key` against the last key
   * SEEN by this effect at all (pushes included), to stop a re-run of this
   * effect — its deps include `handleBackward`, which used to change
   * identity on every step — from re-processing a location it had already
   * handled. That guard was itself the bug behind a CI-only failure
   * (confirmed via two rounds of CI's own trace/diagnostic output): two
   * `guard()` pushes issued back-to-back sometimes commit only ONE
   * distinguishable history entry between them, so a POP later landing back
   * on that shared key read as "already seen" (by a PUSH) and was silently
   * swallowed — handleBackward() never ran.
   *
   * Tracking the last key this effect actually HANDLED AS A POP, rather
   * than the last key seen for any reason, fixes that: a push's key,
   * however it coalesces, never writes to `lastPoppedKey`, so it can never
   * make a later POP look like a duplicate. This still needs to be a key
   * comparison and not just "is navType POP" alone, though — handleBackward
   * no longer depends on `step`/`draft` (it reads the landed-on entry's own
   * tag), so it's far more stable across renders than before, but it can
   * still change identity (on a `phase` flip) on a render where `navType`
   * happens to still read 'POP' from an earlier, already-handled navigation
   * — e.g. the browser's own Forward button lands on the flow's last step
   * (also reported as POP), and clicking through to the end changes `phase`
   * without any intervening `guard()` push to refresh `navType`. Without
   * this comparison that would re-run handleBackward on a POP it already
   * processed. The initial value covers the first render, where
   * react-router reports POP for a plain load.
   */
  const lastPoppedKey = useRef(location.key);
  useEffect(() => {
    if (navType !== 'POP') return;
    if (lastPoppedKey.current === location.key) return;
    lastPoppedKey.current = location.key;
    handleBackward(location.state);
  }, [handleBackward, location.key, location.state, navType]);

  if (!id) return null;
  const state = { blockKind: draft.blockKind, isWarmupSet: draft.isWarmupSet };

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  /** One same-path history entry per step, so the browser's Back has something
   *  of ours to consume (see `handleBackward`). */
  function guard(next: FlowStep) {
    nav(location.pathname, { state: { guidedStep: next } });
  }

  function commitBlock() {
    const kind = draft.blockKind;
    if (!kind) return;
    let label = '';
    update((d) => {
      const w = d.workouts.find((x) => x.id === id);
      if (!w) return false;
      // The first block authored is what decides the workout's kind, and it is
      // decided once — `allowedKinds` above keeps every later block on the
      // same side of the split.
      if (!w.kind) w.kind = kind === 'cond' ? 'conditioning' : 'strength';
      if (kind === 'lift') {
        const block = newBlock();
        const t = draft.isWarmupSet ? 'W' + draft.reps : draft.reps;
        const rpe = draft.isWarmupSet ? '' : draft.rpe;
        block.exercises[0].name = draft.movementName;
        block.exercises[0].sets = Array.from({ length: draft.sets }, () => ({ t, rpe }));
        w.blocks.push(block);
        label = draft.movementName;
      } else if (kind === 'cond') {
        // @hybrid/engine's top-level `newCondBlock` (packages/engine/src/session.ts)
        // takes no arguments and returns sensible defaults — `heading:
        // 'Conditioning'` among them, so only what was authored is filled in
        // here. The overload with (heading, condFmt, effort, minutes) params
        // lives under the `emit` namespace export, not this flat import.
        // `targetZone` is kept in lockstep with `effort` the same way
        // emit.newCondBlock does.
        const block = newCondBlock();
        block.condFmt = (draft.condFmt || 'intervals') as CondFmtKey;
        block.effort = draft.effort;
        block.targetZone = CON_EFFORTS[draft.effort].zone;
        block.minutes = draft.minutes || '';
        w.blocks.push(block);
        label = 'Conditioning';
      } else {
        const block = newTextBlock();
        block.heading = BLOCK_LABEL[kind];
        block.body = draft.text;
        w.blocks.push(block);
        label = BLOCK_LABEL[kind];
      }
      w.updatedAt = Date.now();
    });
    setAdded((a) => [...a, label]);
    setPhase('add-another');
  }

  function goNext() {
    const next = nextStep(step, state);
    if (next) {
      setStep(next);
      guard(next);
      return;
    }
    commitBlock();
  }

  /*
   * The in-page back control, routed through history rather than straight to
   * `setStep`, so this control and the browser's own Back consume the same
   * entries and cannot drift apart. From the first question there is no earlier
   * step, so this is a cancel: leave, dropping the phantom session.
   */
  function goBack() {
    if (prevStep(step, state)) nav(-1);
    else abandon();
  }

  function pick(kind: Exclude<BlockKind, null>) {
    // A fresh block starts from a clean draft: without this, `isWarmupSet` (and
    // every other answer) leaks out of the previous block into this one.
    setDraft({ ...EMPTY_DRAFT, blockKind: kind });
    const next = nextStep('block-type', { blockKind: kind, isWarmupSet: false }) ?? 'block-type';
    setStep(next);
    guard(next);
  }

  function renderStep(): ReactNode {
    if (step === 'block-type') return <BlockTypeStep onPick={pick} onBack={goBack} allowed={allowedKinds} />;

    if (step === 'movement') {
      return (
        <MovementStep
          value={draft.movementName}
          known={known}
          onChange={(v) => patch({ movementName: v })}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('movement', draft)}
        />
      );
    }

    if (step === 'sets') {
      return <SetsStep value={draft.sets} onChange={(n) => patch({ sets: n })} onNext={goNext} onBack={goBack} />;
    }

    if (step === 'reps') {
      return (
        <RepsStep
          value={draft.reps}
          isWarmupSet={draft.isWarmupSet}
          onChange={(v) => patch({ reps: v })}
          onWarmupSetChange={(v) => patch({ isWarmupSet: v })}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('reps', draft)}
        />
      );
    }

    if (step === 'rpe') {
      return (
        <RpeStep
          value={draft.rpe}
          onChange={(v) => patch({ rpe: v })}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('rpe', draft)}
        />
      );
    }

    if (step === 'cond-detail') {
      return (
        <CondDetailStep
          condFmt={draft.condFmt as CondFmtKey | ''}
          effort={draft.effort}
          minutes={draft.minutes}
          onChange={(p) => patch(p)}
          onNext={goNext}
          onBack={goBack}
          disabled={!canAdvance('cond-detail', draft)}
        />
      );
    }

    // step === 'text'
    const question = draft.blockKind === 'warmup' ? "What's the warm-up?" : "What's the workout?";
    return (
      <TextStep
        question={question}
        value={draft.text}
        onChange={(v) => patch({ text: v })}
        onNext={goNext}
        onBack={goBack}
        disabled={!canAdvance('text', draft)}
      />
    );
  }

  if (phase === 'add-another') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
        <Kicker>{added.join(', ')} added</Kicker>
        <h1 className="text-8 font-[800]">Add another block?</h1>
        <div className="mt-1 flex gap-1">
          <Button
            variant="brass"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setStep('block-type');
              setPhase('flow');
            }}
          >
            Yes, add another
          </Button>
          <Button onClick={() => nav(plannerPath)}>No, I'm done</Button>
        </div>
      </div>
    );
  }

  /*
   * The persistent progress header the spec asks for — "a multi-step flow with
   * no sense of where you are in it is a known, avoidable source of confusion".
   * It wraps the steps rather than being repeated inside all seven of them, and
   * is left off the "add another?" screen, which already carries its own running
   * summary and would otherwise say where you are twice.
   *
   * `h-full` on the wrapper rather than `min-h-full`: each step centres itself
   * with `min-h-full`, which needs a parent whose height is definite to resolve
   * a percentage against.
   */
  return (
    <div className="flex h-full flex-col">
      <header className="mx-auto w-full max-w-[560px] shrink-0 px-2 pt-2 text-center">
        <Kicker>Session · block {added.length + 1}</Kicker>
      </header>
      <div className="min-h-0 flex-1">{renderStep()}</div>
    </div>
  );
}
