import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { CATALOGUE_TAGS, filterCatalogue, tagCounts, type CatalogueEntry } from '@hybrid/engine';
import { Btn, Card, Chip, Empty, Input, T, Tap } from '../../ui';

/**
 * Ported from apps/web/src/coach/library/ExercisePicker.tsx — the mockup's
 * "+ Add exercise from library" panel: search, filter chips with live
 * counts, the matching movements, and the actions under them.
 *
 * All filtering lives in `@hybrid/engine`'s `filterCatalogue` — this holds
 * the query and the active tags, and renders what the engine returns. Counts
 * come from `tagCounts` over the FULL list, not the filtered one: a chip
 * reading "0" because you already filtered it away would be a chip that lies
 * about the library. Same reasoning as web, unchanged by the port.
 *
 * Presentational, like the web original: catalogue entries come IN as a
 * prop. No store access, no navigation — the screen that mounts this owns
 * both.
 */
export function ExercisePicker({
  entries,
  onPick,
  onNewExercise,
  onDone,
}: {
  entries: CatalogueEntry[];
  onPick: (name: string) => void;
  onNewExercise: (name: string) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const counts = useMemo(() => tagCounts(entries), [entries]);
  const shown = useMemo(() => filterCatalogue(entries, query, activeTags), [entries, query, activeTags]);

  function toggleTag(tag: string) {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function clearFilters() {
    setQuery('');
    setActiveTags([]);
  }

  return (
    <Card>
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search the exercise library"
        accessibilityLabel="Search the exercise library"
        className="h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
      />

      <View className="mt-1.5 flex-row items-center justify-between gap-1">
        <T className="text-3 text-muted">
          <T w="bold" num className="text-3 text-text">
            {shown.length}
          </T>{' '}
          exercises shown
        </T>
        <Tap onPress={clearFilters} box={{ h: 32 }} label="Clear filters">
          <T w="med" className="text-3 text-gold2">
            Clear filters
          </T>
        </Tap>
      </View>

      <View className="mt-1 flex-row flex-wrap gap-0.5">
        {CATALOGUE_TAGS.map((tag) => {
          const count = counts.find((c) => c.tag === tag)?.count ?? 0;
          return (
            <Chip key={tag} on={activeTags.includes(tag)} onPress={() => toggleTag(tag)} label={tag}>
              {`${tag} ${count}`}
            </Chip>
          );
        })}
      </View>

      <View className="mt-1.5">
        {entries.length === 0 ? (
          /* Not the same fact as "your filters excluded everything" — same
             distinction the web picker draws. */
          <Empty
            title="Nothing in the library yet"
            body="No movements in your library yet — they appear here as you author sessions."
          />
        ) : shown.length === 0 ? (
          <Empty title="No matches" body="No exercises match those filters." />
        ) : (
          shown.map((entry, i) => (
            <Tap
              key={entry.name}
              box={{ h: 44 }}
              onPress={() => onPick(entry.name)}
              label={`Add ${entry.name}`}
              className={`flex-row items-center gap-1 ${i === 0 ? '' : 'mt-0.5 border-t border-line pt-1'}`}
            >
              <View className="h-4 w-4 items-center justify-center rounded-sm border border-line2 bg-panel2">
                <T w="bold" className="text-3 text-text">
                  {entry.name.charAt(0)}
                </T>
              </View>
              <T w="med" className="flex-1 text-5 text-text">
                {entry.name}
              </T>
              <T w="bold" className="text-5 text-gold2">
                +
              </T>
            </Tap>
          ))
        )}
      </View>

      <View className="mt-2 flex-row gap-1">
        {/*
          Circuit has a tab in the mockup and no definition anywhere in this
          system yet — see 2026-08-11-stage3c-sessions-exercises-design.md.
          Live, it would be a dead end; omitted, the mockup's intent is
          lost. Matches web: disabled, with the reason as the accessible
          label since a native control has no `title` tooltip to carry it.
        */}
        <View className="min-w-0 flex-1">
          <Btn disabled label="Circuits are not defined in this system yet" className="w-full">
            + New circuit
          </Btn>
        </View>
        <View className="min-w-0 flex-1">
          <Btn onPress={() => onNewExercise(query.trim())} className="w-full">
            + New exercise
          </Btn>
        </View>
        <View className="min-w-0 flex-1">
          <Btn variant="brass" onPress={onDone} className="w-full">
            Done
          </Btn>
        </View>
      </View>
    </Card>
  );
}
