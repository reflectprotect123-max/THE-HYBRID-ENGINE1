import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  canAdvance,
  nextStep,
  prevStep,
  type BlockKind,
  type FlowDraft,
  type FlowStep,
} from '@hybrid/guided-flow';
import { CON_EFFORTS, newCondBlock, newTextBlock, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { useDb } from '../../store/db';
import { Btn, Kicker, Title } from '../../ui';
import type { RootStackParams } from '../../App';
import { BlockTypeStep } from './BlockTypeStep';
import { CondDetailStep } from './CondDetailStep';
import { TextStep } from './TextStep';

interface Draft extends FlowDraft {
  blockKind: Exclude<BlockKind, null> | null;
  effort: EffortKey;
  minutes: number;
}

const EMPTY_DRAFT: Draft = {
  blockKind: null,
  condFmt: '',
  effort: 'medium',
  minutes: 0,
  text: '',
};

const BLOCK_LABEL: Record<Exclude<BlockKind, null>, string> = {
  warmup: 'Warm-up / Cooldown',
  cond: 'Conditioning',
  metcon: 'Metcon / notes',
};

/*
 * The 'lift' block kind — its own movement/sets/reps/rpe steps
 * (`MovementStep`/`SetsStep`/`RepsStep`/`RpeStep`), the `known` movement
 * list fed to `MovementStep` (`knownMovements`), and `newBlock()` — went
 * whole with the rest of strength on 17 August 2026. This wizard now only
 * ever authors a conditioning block or a text block (warm-up/cooldown or
 * metcon/notes); `@hybrid/guided-flow`'s `BlockKind` dropped 'lift' the same
 * day, so there is no third path to branch on here any more.
 */
export function GuidedBuilderScreen() {
  const { params } = useRoute<RouteProp<RootStackParams, 'GuidedBuilder'>>();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const { db, update } = useDb();
  // By-id subject lookup goes through the WHOLE db, not the scoped view: the
  // guided flow itself flips a new workout's kind to conditioning the moment a
  // conditioning block is added, and a scoped lookup would make the editor
  // lose the workout it is editing mid-flow. Holding the id is authorization
  // enough; scoping is for discovery surfaces, not the subject in hand.
  const currentWorkout = db.workouts.find((x) => x.id === params.id);
  // A workout that has already committed to a kind only offers that kind's
  // blocks — a conditioning block cannot join a workout that already carries
  // a text block, and vice versa (`CondBlock`'s own doc comment: `sanitizeDB`
  // treats a mixed workout as two workouts, once, on load). A brand-new one
  // (no kind yet) offers all three. `kind` is trustworthy here — sanitizeDB
  // never invents one for a blockless workout and never overwrites a stored
  // one.
  const allowedKinds: Exclude<BlockKind, null>[] | undefined =
    currentWorkout?.kind === 'conditioning'
      ? ['cond']
      : currentWorkout?.kind === 'strength'
        ? ['warmup', 'metcon']
        : undefined;

  const [step, setStep] = useState<FlowStep>('block-type');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [added, setAdded] = useState<string[]>([]);
  const [phase, setPhase] = useState<'flow' | 'add-another'>('flow');

  const state = { blockKind: draft.blockKind };

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  /*
   * Dropping the record the Library minted for a flow that authored nothing.
   *
   * "＋ New session" writes the Workout BEFORE this screen opens, so leaving the
   * first question would otherwise strand a permanent, blockless session — which
   * the Library then lists as "conditioning", since it reads any zero-block
   * workout that way. Tombstoned rather than merely spliced out, the same as
   * Library.tsx's own delete: without the tombstone the next sync sees a workout
   * the remote still has and restores it.
   *
   * Guarded twice: an empty `added` means nothing was committed in THIS wizard
   * session, and the blocks check means the stored workout is genuinely empty,
   * so a session that already has work in it can never be caught by this.
   */
  const dropPhantom = useCallback(() => {
    if (added.length) return;
    update((d) => {
      const w = d.workouts.find((x) => x.id === params.id);
      if (!w || w.blocks.length) return false;
      d.workouts = d.workouts.filter((x) => x.id !== params.id);
      d.settings.deletedIds = { ...(d.settings.deletedIds || {}), [params.id]: Date.now() };
    });
  }, [added.length, params.id, update]);

  function commitBlock() {
    const kind = draft.blockKind;
    if (!kind) return;
    let label = '';
    update((d) => {
      const w = d.workouts.find((x) => x.id === params.id);
      if (!w) return false;
      // The first block authored is what decides the workout's kind, and it is
      // decided once — `allowedKinds` above keeps every later block on the
      // same side of the split.
      if (!w.kind) w.kind = kind === 'cond' ? 'conditioning' : 'strength';
      if (kind === 'cond') {
        // @hybrid/engine's flat-exported `newCondBlock` (from session.ts) is
        // zero-argument — the 4-arg version only exists as `emit.newCondBlock`,
        // reachable through the namespaced `emit` export, not this flat import.
        // Build with the zero-arg constructor, then set the fields by hand;
        // CON_EFFORTS[effort].zone reproduces the same zone derivation
        // emit.newCondBlock does internally (confirmed identical mapping:
        // easy→low, medium→mod, hard→high, in both CON_EFFORTS and emit's
        // own EFFORTS table).
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
      return;
    }
    commitBlock();
  }

  function goBack() {
    const prev = prevStep(step, state);
    if (prev) {
      setStep(prev);
      return;
    }
    // No earlier step than block-type: this is a cancel, so leave — and take the
    // phantom session with us.
    dropPhantom();
    nav.navigate('Tabs', { screen: 'Library' } as never);
  }

  /*
   * Android's hardware back and the swipe-back gesture both POP this screen,
   * which would drop the whole flow — and the block being authored — from any
   * step. The spec's rule is that back goes to the previous step within the
   * current block and only leaves from the first question, so intercept the
   * native action and step backward instead. `beforeRemove` fires for both the
   * button and the gesture, which is why it is what Conditioning.tsx guards a
   * live run with (apps/mobile/src/screens/Conditioning.tsx:156).
   *
   * Left to proceed on the first question (leaving IS right there, and the
   * phantom is dropped on the way out) and on "add another?", which is not a
   * step and whose blocks are already saved.
   */
  useEffect(() => {
    const unsub = nav.addListener('beforeRemove', (e) => {
      if (phase !== 'flow') return;
      const prev = prevStep(step, state);
      if (!prev) {
        dropPhantom();
        return;
      }
      e.preventDefault();
      setStep(prev);
    });
    return unsub;
  }, [nav, phase, step, draft.blockKind, dropPhantom]);

  function pick(kind: Exclude<BlockKind, null>) {
    // A fresh block starts from a clean draft: without this, an earlier
    // block's answers leak into this one.
    setDraft({ ...EMPTY_DRAFT, blockKind: kind });
    setStep(nextStep('block-type', { blockKind: kind }) ?? 'block-type');
  }

  function renderStep() {
    if (step === 'block-type') return <BlockTypeStep onPick={pick} onBack={goBack} allowed={allowedKinds} />;

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
    // The same centred layout the seven step screens use, rather than <Screen>'s
    // top-aligned ScrollView — one flow should not change shape halfway through.
    return (
      <View className="flex-1 items-center justify-center gap-3 p-4">
        <Kicker>{added.join(', ')} added</Kicker>
        <Title>Add another block?</Title>
        <View className="mt-2 flex-row gap-2">
          <Btn variant="brass" onPress={() => { setDraft(EMPTY_DRAFT); setStep('block-type'); setPhase('flow'); }}>
            Yes, add another
          </Btn>
          <Btn onPress={() => nav.navigate('Planner', { id: params.id })}>No, I&apos;m done</Btn>
        </View>
      </View>
    );
  }

  /*
   * The persistent progress header the spec asks for — "a multi-step flow with
   * no sense of where you are in it is a known, avoidable source of confusion".
   * It wraps the steps rather than being repeated inside all seven of them, and
   * is left off the "add another?" screen above, which already carries its own
   * running summary and would otherwise say where you are twice.
   */
  return (
    <View className="flex-1">
      <View className="px-4" style={{ paddingTop: insets.top + 16 }}>
        <Kicker>{`Session · block ${added.length + 1}`}</Kicker>
      </View>
      {renderStep()}
    </View>
  );
}
