import { View } from 'react-native';
import { COLUMN_TYPES, availableSecondColumns, isColumnPairValid } from '@hybrid/engine';
import { Chip, Input, T, Tap } from '../../ui';
import type { SetRow } from './types';

/*
 * The shared set-row grid, ported from apps/web/src/coach/library/SetRows.tsx.
 *
 * Kept presentational on purpose — no store access, no navigation — because
 * the athlete Logger's sets table is meant to reuse this component next. The
 * only import beyond React Native primitives is the column vocabulary and its
 * pairing rule, both from `@hybrid/engine`, exactly as the web version does.
 *
 * `SetRow` and `newSetRows` are NOT redeclared here — they live in `./types`,
 * this builder's shared value shapes, so a native session authored here and a
 * web one agree on what a set IS.
 */

function placeholderFor(value: string): string {
  return COLUMN_TYPES.find((c) => c.value === value)?.placeholder ?? '';
}

/**
 * An exercise's sets, and the two chip rows choosing what its columns measure.
 *
 * React Native has no <select>, so the web's two dropdowns become two rows of
 * tappable chips (the app's shared `Chip`, as used by `CondBlockCard`) rather
 * than reaching for a picker dependency.
 *
 * The pair rule lives in `@hybrid/engine`'s `isColumnPairValid` — this renders
 * that verdict and nothing more. Two columns measuring the same thing produce
 * a set claiming "8 reps and 8 reps", which is bad data that survives into
 * every later read of it, so the second column's chips LOCK (disabled, not
 * merely re-coloured) rather than just looking odd.
 */
export function SetRows({
  sets,
  columnA,
  columnB,
  onColumnChange,
  onSetsChange,
}: {
  sets: SetRow[];
  columnA: string;
  columnB: string;
  onColumnChange: (which: 'a' | 'b', value: string) => void;
  onSetsChange: (sets: SetRow[]) => void;
}) {
  const pairValid = isColumnPairValid(columnA, columnB);

  function patch(id: string, key: 'a' | 'b', value: string) {
    onSetsChange(sets.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  }

  return (
    <View>
      <View className="gap-1.5">
        <View>
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">
            First column measures
          </T>
          <View testID="cb-set-column-a" className="mt-0.5 flex-row flex-wrap gap-0.5">
            {COLUMN_TYPES.map((c) => (
              <Chip key={c.value} on={columnA === c.value} onPress={() => onColumnChange('a', c.value)}>
                {c.label}
              </Chip>
            ))}
          </View>
        </View>

        <View>
          <T w="semi" className="text-2 uppercase tracking-widest text-dim">
            Second column measures
          </T>
          <View testID="cb-set-column-b" className="mt-0.5 flex-row flex-wrap gap-0.5">
            {availableSecondColumns(columnA).map((c) => (
              <Chip
                key={c.value}
                on={columnB === c.value}
                onPress={() => {
                  // Locked: a disabled second column ignores taps entirely,
                  // matching the web `<select disabled>` rather than merely
                  // dimming the chip's colour.
                  if (!pairValid) return;
                  onColumnChange('b', c.value);
                }}
              >
                {c.label}
              </Chip>
            ))}
          </View>
        </View>
      </View>

      {!pairValid && (
        <T className="mt-1 text-2 text-dim">
          Two columns cannot measure the same thing — pick another for the second.
        </T>
      )}

      <View className="mt-1.5 gap-1">
        {sets.map((s, i) => (
          <View key={s.id} className="flex-row items-center gap-1">
            <T w="bold" num className="w-3 text-3 text-dim">
              {i + 1}
            </T>
            <Input
              value={s.a}
              onChangeText={(v) => patch(s.id, 'a', v)}
              placeholder={placeholderFor(columnA)}
              accessibilityLabel={`Set ${i + 1} ${placeholderFor(columnA)}`}
              num
              className="h-5 min-w-0 flex-1 rounded-md border border-line bg-well px-1 text-5 text-text"
            />
            <Input
              value={s.b}
              onChangeText={(v) => patch(s.id, 'b', v)}
              placeholder={placeholderFor(columnB)}
              accessibilityLabel={`Set ${i + 1} ${placeholderFor(columnB)}`}
              num
              className="h-5 min-w-0 flex-1 rounded-md border border-line bg-well px-1 text-5 text-text"
            />
            <Tap
              onPress={() => onSetsChange(sets.filter((x) => x.id !== s.id))}
              box={24}
              label={`Remove set ${i + 1}`}
              className="items-center justify-center"
            >
              <T w="bold" className="text-4 text-dim">
                ×
              </T>
            </Tap>
          </View>
        ))}
      </View>

      <Tap
        onPress={() => onSetsChange([...sets, { id: `${sets.length}-${Date.now()}`, a: '', b: '' }])}
        box={{ h: 34 }}
        label="Add set"
        className="mt-1.5 items-center justify-center rounded-md border border-line2 bg-panel2"
      >
        <T w="med" className="text-4 text-text">
          + Add set
        </T>
      </Tap>
    </View>
  );
}
