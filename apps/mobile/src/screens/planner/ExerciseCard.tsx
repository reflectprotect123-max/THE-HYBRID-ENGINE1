import { View } from 'react-native';
import { fmtRest, formatPct, isWarmup, pctForSet, rxLine, type Exercise, type LoggedSet } from '@hybrid/engine';
import { Btn, Card, Chip, Input, Ltr, T, Tap } from '../../ui';

/** How many name suggestions fit under the field without pushing the sets off. */
const MAX_SUGGEST = 6;

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

/*
 * Movements you have already written, offered back.
 *
 * Not a catalogue — the sessions ARE the catalogue, and `knownMovements`
 * derives this on read. The point is that "Squat" and "Back Squat" are two
 * different lifts to the history, the PR detector and the earned working
 * weight, so the cheapest way to stop a lift fragmenting is to make retyping
 * it unnecessary.
 *
 * Hidden once what you have typed already matches something exactly — at that
 * point the row is only telling you what is already in the box.
 */
function Suggest({ typed, known, onPick }: { typed: string; known: string[]; onPick: (name: string) => void }) {
  const q = String(typed || '').trim().toLowerCase();
  const hits = known.filter((n) => n.toLowerCase() !== q && (!q || n.toLowerCase().includes(q))).slice(0, MAX_SUGGEST);
  if (!hits.length) return null;

  return (
    <View className="mt-0.5 flex-row flex-wrap gap-0.5">
      {hits.map((n) => (
        <Chip key={n} onPress={() => onPick(n)}>
          {n}
        </Chip>
      ))}
    </View>
  );
}

/**
 * One exercise, as a card — collapsed to a single line until opened. Split out
 * of `Planner.tsx`, which had grown past 470 lines doing every block kind's
 * job in one file.
 */
export function ExerciseCard({
  ex,
  letter,
  open,
  suggestPool,
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
  /** Prep-first inside a warm-up block, logged movements everywhere else. */
  suggestPool: string[];
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
    <Card className={`mb-1 ${open ? 'border-gold-line' : ''}`}>
      <Tap onPress={onToggle} label={`${open ? 'collapse' : 'expand'} ${ex.name || 'exercise'}`}>
        <View className="flex-row items-center gap-1">
          <Ltr>{letter}</Ltr>
          <View className="flex-1">
            <T w="semi" className="text-5 text-text" numberOfLines={1}>
              {ex.name || 'Exercise'}
            </T>
            <T num className="text-3 text-dim" numberOfLines={1}>
              {rxLine(ex)}
            </T>
          </View>
          <T className="text-6 text-dim">{open ? '▴' : '›'}</T>
        </View>
      </Tap>

      {open ? (
        <View className="mt-1.5 border-t border-line pt-1.5">
          <Input
            value={ex.name}
            onChangeText={onNameChange}
            placeholder="Movement"
            accessibilityLabel="movement name"
            className="h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
          />
          <Suggest typed={ex.name} known={suggestPool} onPick={onNameChange} />

          <View className="mt-1.5 flex-row gap-0.5">
            {(Object.keys(MODE_LABEL) as PctMode[]).map((m) => (
              <Tap
                key={m}
                // Guard against destroying a mode the selector cannot itself
                // represent (amrap, reps_seconds, completion all read back as
                // "Reps" here): if the button already LOOKS selected, tapping
                // it must be a no-op rather than a silent, permanent rewrite
                // of `ex.mode` to whatever this button's own value means.
                onPress={() => m !== mode && onModeChange(m)}
                role="radio"
                selected={mode === m}
                label={MODE_LABEL[m]}
                box={{ h: 20 }}
                className={`flex-1 rounded-md border px-1 py-0.5 ${
                  mode === m ? 'border-gold-line bg-gold-wash' : 'border-line2'
                }`}
              >
                <T className={`text-center text-2 uppercase tracking-widest ${mode === m ? 'text-gold2' : 'text-dim'}`}>
                  {MODE_LABEL[m]}
                </T>
              </Tap>
            ))}
          </View>

          {mode === 'pctFlat' || mode === 'pctRange' ? (
            <View className="mt-1 flex-row items-center gap-1">
              <T w="semi" className="text-2 uppercase tracking-widest text-dim">% of 1RM</T>
              <Input
                num
                value={pctSet?.pct1rm?.lo != null ? String(pctSet.pct1rm.lo) : ''}
                onChangeText={(v) => {
                  const lo = Number(v) || 0;
                  onPctChange(lo, mode === 'pctFlat' ? lo : (pctSet?.pct1rm?.hi ?? lo));
                }}
                accessibilityLabel="percent low"
                className="h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
              />
              {mode === 'pctRange' ? (
                <>
                  <T className="text-3 text-dim">–</T>
                  <Input
                    num
                    value={pctSet?.pct1rm?.hi != null ? String(pctSet.pct1rm.hi) : ''}
                    onChangeText={(v) => onPctChange(pctSet?.pct1rm?.lo ?? 0, Number(v) || 0)}
                    accessibilityLabel="percent high"
                    className="h-4 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
                  />
                </>
              ) : null}
            </View>
          ) : null}

          {ex.sets.map((st, si) => (
            <View key={si} className="mt-1 flex-row items-center gap-1">
              <T w="semi" num className={`w-8 text-3 ${isWarmup(st) ? 'text-gold2' : 'text-dim'}`}>
                {isWarmup(st) ? 'Warm' : 'Set ' + (si + 1)}
              </T>
              <Input
                num
                value={st.t}
                // Type once, it fills the rest — see fillLinkedSets.
                onChangeText={(v) => onSet(si, 't', v)}
                placeholder="reps"
                accessibilityLabel="set target"
                className="h-5 w-14 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
              />
              <Input
                num
                value={st.rpe}
                onChangeText={(v) => onSet(si, 'rpe', v)}
                placeholder={isWarmup(st) ? '—' : 'RPE'}
                accessibilityLabel="RPE"
                className="h-5 w-12 rounded-md border border-line bg-well px-1 text-center text-4 text-text"
              />
              {(mode === 'pctFlat' || mode === 'pctRange') && !isWarmup(st) ? (
                <T num accessibilityLabel={`percent of 1RM for set ${si + 1}`} className="text-2 text-gold2">
                  {(() => {
                    const p = pctForSet(ex, si);
                    return p == null ? '' : formatPct(p);
                  })()}
                </T>
              ) : null}
              {ex.sets.length > 1 ? (
                <Tap onPress={() => onDelSet(si)} box={{ h: 20, w: 24 }} label={`delete set ${si + 1}`}>
                  <T className="px-1 text-3 text-dim">✕</T>
                </Tap>
              ) : null}
            </View>
          ))}
          <Btn className="mt-1 self-start" onPress={onAddSet}>
            ＋ Add set
          </Btn>
          <T className="mt-1 text-3 text-dim">
            Type what you want to hit — 8, 8-12, max. Start with W for a warm-up (W or W10).
          </T>

          <View className="mt-1.5 flex-row items-center gap-1">
            <T w="semi" className="text-2 uppercase tracking-widest text-dim">Rest</T>
            <Btn onPress={() => onRest(-15)}>−</Btn>
            <T w="semi" num className="w-10 text-center text-4 text-text">{fmtRest(ex.rest || 0)}</T>
            <Btn onPress={() => onRest(15)}>+</Btn>
            {/* An exercise added by mistake was permanent: the sets could be
                removed one by one, and the block deleted whole, but never the
                movement itself. */}
            <View className="flex-1" />
            <Tap
              label={`duplicate ${ex.name || 'exercise'}`}
              onPress={onDuplicate}
              box={{ h: 28 }}
              className="mr-1 rounded-md border border-line2 px-1 py-0.5"
            >
              <T className="text-3 text-dim">Duplicate</T>
            </Tap>
            <Tap
              label={`remove ${ex.name || 'exercise'}`}
              onPress={onRemove}
              box={{ h: 28 }}
              className="rounded-md border border-line2 px-1 py-0.5"
            >
              <T className="text-3 text-dim">Remove</T>
            </Tap>
          </View>
        </View>
      ) : null}
    </Card>
  );
}
