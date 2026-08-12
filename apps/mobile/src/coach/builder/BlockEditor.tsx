import { useState } from 'react';
import { View } from 'react-native';
import { CON_EFFORTS, CON_FORMATS } from '@hybrid/engine';
import type { CatalogueEntry, EffortKey } from '@hybrid/engine';
import { Card, Chip, Input, Kicker, Ltr, T, Tap } from '../../ui';
import { ExercisePicker } from './ExercisePicker';
import { SetRows } from './SetRows';
import {
  BLOCK_CATEGORIES,
  CONDITIONING_CATEGORIES,
  CONDITIONING_EFFORTS,
  CONDITIONING_FORMATS,
  CONDITIONING_MODALITIES,
  newCondValue,
  newSetRows,
  type BlockExercise,
  type BlockValue,
  type CondValue,
} from './types';

/*
 * Ported from apps/web/src/coach/library/BlockEditor.tsx.
 *
 * Nothing about what a block IS is redeclared here: `BlockValue`,
 * `BlockExercise`, `CondValue`, the category lists and `newCondValue` all come
 * from `./types`, which the web file and this one agree on character for
 * character. A session authored on the phone must reopen identically on the
 * bench, and the only way to guarantee that is one declaration.
 *
 * Presentational, like the web original: the catalogue arrives as a prop and
 * every change leaves through `onChange`. No store access, no navigation.
 */

/** A, B, C … — the mockup letters exercises within a block rather than numbering them. */
function letterFor(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

/**
 * One block of a session, as the mockup draws it: a head carrying the block's
 * number, its kind and a remove action, over a body holding either the
 * exercises and the library picker, or — for a conditioning category — a
 * prescription instead.
 *
 * The block's number comes from its POSITION, not from stored state — the
 * mockup relabels every block on each change for the same reason. A stored
 * ordinal survives a deletion and starts lying.
 *
 * React Native has no <select>, so the web's block-kind dropdown becomes a row
 * of tappable chips, the same substitution `./SetRows` and `./ExercisePicker`
 * already make. Every tap target follows `Tap`'s `box` convention so the 44px
 * floor is reached by slop rather than by inflating the drawn control.
 */
export function BlockEditor({
  block,
  entries,
  index,
  onChange,
  onRemove,
}: {
  block: BlockValue;
  entries: CatalogueEntry[];
  index: number;
  onChange: (next: BlockValue) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isConditioning = CONDITIONING_CATEGORIES.includes(block.category);

  function addExercise(name: string) {
    const id = `${block.id}-${block.exercises.length}-${name}`;
    onChange({
      ...block,
      exercises: [
        ...block.exercises,
        // Reps and kilos: the pair a coach reaches for most, and a valid pair
        // by `isColumnPairValid` so nothing opens already locked.
        { id, name, columnA: 'reps', columnB: 'weight_kg', sets: newSetRows(id) },
      ],
    });
  }

  function removeExercise(id: string) {
    onChange({ ...block, exercises: block.exercises.filter((e) => e.id !== id) });
  }

  function patchExercise(id: string, patch: Partial<BlockExercise>) {
    onChange({
      ...block,
      exercises: block.exercises.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  return (
    <Card>
      <View className="flex-row items-center gap-1">
        <Tap
          onPress={() => setExpanded((v) => !v)}
          box={24}
          label="Collapse block"
          selected={expanded}
          className="items-center justify-center rounded-sm border border-line2 bg-panel2"
        >
          <T w="bold" className="text-3 text-dim">
            {expanded ? '⌄' : '›'}
          </T>
        </Tap>
        <View className="flex-1">
          <Kicker>{`BLOCK ${String(index + 1).padStart(2, '0')}`}</Kicker>
        </View>
        <Tap
          onPress={onRemove}
          box={24}
          label="Remove block"
          className="items-center justify-center"
        >
          <T w="bold" className="text-4 text-dim">
            ×
          </T>
        </Tap>
      </View>

      <View testID="cb-block-kind" className="mt-1 flex-row flex-wrap gap-0.5">
        {BLOCK_CATEGORIES.map((c) => (
          <Chip
            key={c}
            on={block.category === c}
            onPress={() => {
              /* Switching INTO a conditioning category seeds its defaults;
                 switching out drops them. Keeping a stale conditioning value on
                 a strength block would round-trip a block the coach can no
                 longer see or edit. */
              onChange(
                CONDITIONING_CATEGORIES.includes(c)
                  ? { ...block, category: c, conditioning: block.conditioning ?? newCondValue(c) }
                  : { id: block.id, category: c, exercises: block.exercises },
              );
            }}
          >
            {c}
          </Chip>
        ))}
      </View>

      {expanded && isConditioning && (
        <View className="mt-1.5">
          <CondBlockFields
            value={block.conditioning ?? newCondValue(block.category)}
            mixed={block.category === 'Mixed modal'}
            onChange={(conditioning) => onChange({ ...block, conditioning })}
          />
        </View>
      )}

      {expanded && !isConditioning && (
        <View className="mt-1.5">
          <View testID="cb-block-exercises">
            {block.exercises.map((ex, i) => (
              <View key={ex.id} className={i === 0 ? '' : 'mt-2 border-t border-line pt-2'}>
                <View className="flex-row items-center gap-1">
                  <Ltr>{letterFor(i)}</Ltr>
                  <T w="med" className="flex-1 text-5 text-text">
                    {ex.name}
                  </T>
                  <Tap
                    onPress={() => removeExercise(ex.id)}
                    box={24}
                    label={`Remove ${ex.name}`}
                    className="items-center justify-center"
                  >
                    <T w="bold" className="text-4 text-dim">
                      ×
                    </T>
                  </Tap>
                </View>
                <View className="mt-1">
                  <SetRows
                    sets={ex.sets}
                    columnA={ex.columnA}
                    columnB={ex.columnB}
                    onColumnChange={(which, value) =>
                      patchExercise(ex.id, which === 'a' ? { columnA: value } : { columnB: value })
                    }
                    onSetsChange={(sets) => patchExercise(ex.id, { sets })}
                  />
                </View>
              </View>
            ))}
          </View>

          {!pickerOpen && (
            <Tap
              onPress={() => setPickerOpen(true)}
              box={{ h: 40 }}
              label="Add exercise from library"
              className="mt-1.5 items-center justify-center rounded-md border border-line2 bg-panel2"
            >
              <T w="med" className="text-4 text-text">
                + Add exercise from library
              </T>
            </Tap>
          )}

          {pickerOpen && (
            <View className="mt-1.5">
              <ExercisePicker
                entries={entries}
                onPick={addExercise}
                onNewExercise={(name) => {
                  if (name) addExercise(name);
                }}
                onDone={() => setPickerOpen(false)}
              />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const MODALITY_LABELS: Record<string, string> = {
  row: 'Row', run: 'Run', ski: 'Ski', bike: 'Bike', air_bike: 'Air bike',
};

/**
 * A conditioning block's prescription.
 *
 * Every control maps onto a field the engine's `CondBlock` already has, and
 * the coach picks an EFFORT rather than a heart-rate zone: `CON_EFFORTS` owns
 * that mapping, and letting a coach set a zone directly would make the two
 * disagree the moment either changed. So the zone is REPORTED at the foot of
 * the card and there is no control offering it.
 *
 * A Mixed modal block hides the format and modality choices rather than
 * showing them greyed out — it IS free format with no single modality, and a
 * disabled control that can never change is a question the coach has to read
 * and dismiss every time. The sentence that replaces them says so in words.
 */
function CondBlockFields({
  value,
  mixed,
  onChange,
}: {
  value: CondValue;
  mixed: boolean;
  onChange: (next: CondValue) => void;
}) {
  const effort = CON_EFFORTS[value.effort as EffortKey] ?? CON_EFFORTS.easy;
  return (
    <View>
      {mixed ? (
        <T className="text-3 text-dim">
          One continuous effort, heart rate recorded start to finish. No intervals and no prescribed
          rest — the rest timer is there if the athlete wants it.
        </T>
      ) : (
        <View className="gap-1.5">
          <View>
            <T w="semi" className="text-2 uppercase tracking-widest text-dim">
              Format
            </T>
            <View testID="cb-cond-format" className="mt-0.5 flex-row flex-wrap gap-0.5">
              {CONDITIONING_FORMATS.map((f) => (
                <Chip key={f} on={value.fmt === f} onPress={() => onChange({ ...value, fmt: f })}>
                  {CON_FORMATS[f]?.name ?? f}
                </Chip>
              ))}
            </View>
          </View>

          <View>
            <T w="semi" className="text-2 uppercase tracking-widest text-dim">
              Modality
            </T>
            <View testID="cb-cond-modality" className="mt-0.5 flex-row flex-wrap gap-0.5">
              {CONDITIONING_MODALITIES.map((m) => (
                <Chip
                  key={m || 'mixed'}
                  on={value.modality === m}
                  onPress={() => onChange({ ...value, modality: m })}
                >
                  {m ? MODALITY_LABELS[m] : 'Mixed / any'}
                </Chip>
              ))}
            </View>
          </View>
        </View>
      )}

      <View className="mt-1.5">
        <T w="semi" className="text-2 uppercase tracking-widest text-dim">
          Effort
        </T>
        <View testID="cb-cond-effort" className="mt-0.5 flex-row flex-wrap gap-0.5">
          {CONDITIONING_EFFORTS.map((e) => (
            <Chip key={e} on={value.effort === e} onPress={() => onChange({ ...value, effort: e })}>
              {CON_EFFORTS[e].name}
            </Chip>
          ))}
        </View>
      </View>

      <View className="mt-1.5 flex-row items-end gap-1">
        <View className="min-w-0 flex-1">
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">
            {mixed ? 'Target minutes' : 'Minutes'}
          </T>
          <Input
            value={value.minutes}
            onChangeText={(v) => onChange({ ...value, minutes: v })}
            accessibilityLabel={mixed ? 'Target minutes' : 'Minutes'}
            keyboardType="numeric"
            num
            className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
          />
        </View>
        <View className="min-w-0 flex-1">
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">
            Target distance (m)
          </T>
          <Input
            value={value.targetDistanceM}
            onChangeText={(v) => onChange({ ...value, targetDistanceM: v })}
            accessibilityLabel="Target distance in metres"
            placeholder="optional"
            keyboardType="numeric"
            num
            className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
          />
        </View>
      </View>

      {/* The zone is DERIVED, so it is reported rather than offered. */}
      <T num className="mt-1.5 text-3 text-dim">
        {`${effort.name} · RPE ${effort.rpe[0]}–${effort.rpe[1]} · ${effort.cue} · heart-rate zone ${effort.zone}`}
      </T>
    </View>
  );
}
