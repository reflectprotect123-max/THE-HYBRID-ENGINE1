import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { CatalogueEntry } from '@hybrid/engine';
import { BlockEditor } from './BlockEditor';
import type { BlockValue, DayBuilderValue } from './types';
import { Btn, Input, T, Tap } from '../../ui';

/*
 * Ported from apps/web/src/coach/library/DayBuilder.tsx.
 *
 * `DayBuilderValue` and `BlockValue` are NOT redeclared here — they live in
 * `./types`, this builder's shared value shapes, so a session authored here
 * and one authored on web agree on what a day IS.
 */

/** "Tuesday, August 11" — the mockup's `formatTitle`, unchanged. */
function formatTitle(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The coach's authoring screen for one session, in two modes.
 *
 * ONE component rather than two, so the half that matters — coach instructions
 * and the blocks — is built and fixed once. `mode` decides only what wraps it:
 * a date, a published status and Publish, or neither and Save to library.
 *
 * THE HONESTY RULE. `publishWorkoutDraft` takes a PREFERRED start date and
 * PREFERRED weekdays and routes through the same Coordinator-placement path as
 * assigning a template. So a heading reading "Tuesday, August 11" beside a
 * Publish button implies a placement the coach has not made. `CoachAuthoring`
 * already refuses to blur this — it labels its day toggles "PREFERRED DAYS ·
 * INPUT, NOT PLACEMENT" — and the Calendar may not contradict its sibling
 * screen. The dated mode says so, in words, every time.
 */
export function DayBuilder({
  mode,
  date,
  published,
  entries,
  initialValue,
  onPublish,
  onSave,
  onBack,
}: {
  mode: 'dated' | 'library';
  date?: string;
  published: boolean;
  entries: CatalogueEntry[];
  /**
   * The session already stored for this day, if there is one. Seeds the editor
   * ONCE, on mount — after that the coach's own edits are the truth, and
   * re-seeding from a prop would overwrite what they are typing. The store
   * hydrates synchronously on mobile too, so there is no later arrival to
   * wait for.
   */
  initialValue?: DayBuilderValue;
  onPublish: (value: DayBuilderValue) => void;
  onSave: (value: DayBuilderValue) => void;
  onBack: () => void;
}) {
  const [instructions, setInstructions] = useState(initialValue?.instructions ?? '');
  const [blocks, setBlocks] = useState<BlockValue[]>(initialValue?.blocks ?? []);

  const value: DayBuilderValue = { instructions, blocks };
  const dated = mode === 'dated' && !!date;

  function addBlock() {
    setBlocks((prev) => [
      ...prev,
      { id: `b${prev.length}-${prev.length ? prev[prev.length - 1].id : 'first'}`, category: 'Strength/Power', exercises: [] },
    ]);
  }

  return (
    <ScrollView
      className="flex-1 bg-bg"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16 }}
    >
      <View className="flex-row items-center justify-between gap-1">
        <Tap onPress={onBack} box={{ h: 44 }} label={dated ? 'Back to calendar' : 'Back to library'}>
          <T w="med" className="text-4 text-gold2">
            {dated ? '‹ Back to calendar' : '‹ Back to library'}
          </T>
        </Tap>
        {dated ? (
          <Btn variant="brass" onPress={() => onPublish(value)}>
            Publish session
          </Btn>
        ) : (
          <Btn variant="brass" onPress={() => onSave(value)}>
            Save to library
          </Btn>
        )}
      </View>

      {dated && (
        <>
          <T w="bold" className="mt-2 text-8 text-text" style={{ letterSpacing: -0.5 }}>
            {formatTitle(date as string)}
          </T>
          <View className="mt-0.5 flex-row items-center gap-1">
            <T className="text-3 text-muted">{date}</T>
            <T w="semi" className={`text-3 ${published ? 'text-gold2' : 'text-dim'}`}>
              {published ? 'Published' : 'Unpublished'}
            </T>
          </View>
          <T className="mt-1 text-4 text-muted">
            This is a <T w="semi" className="text-4 text-text">preferred day</T>, not a placement — the
            Coordinator resolves where the session actually lands in the week.
          </T>
        </>
      )}

      <View className="mt-2">
        <T w="semi" className="text-2 uppercase tracking-widest text-dim">
          Coach instructions
        </T>
        <Input
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Use this area to help the athlete understand goals for today's session."
          accessibilityLabel="Coach instructions"
          multiline
          className="mt-0.5 min-h-[88px] rounded-md border border-line bg-well px-1.5 py-1 text-5 text-text"
          style={{ textAlignVertical: 'top' }}
        />
      </View>

      <View className="mt-2 gap-1.5">
        {blocks.length === 0 ? (
          <T className="text-4 text-muted">Nothing on this day yet — add a block to start.</T>
        ) : (
          blocks.map((b, i) => (
            <BlockEditor
              key={b.id}
              block={b}
              entries={entries}
              index={i}
              onChange={(next: BlockValue) => setBlocks((prev) => prev.map((x) => (x.id === b.id ? next : x)))}
              onRemove={() => setBlocks((prev) => prev.filter((x) => x.id !== b.id))}
            />
          ))
        )}
      </View>

      <View className="mt-2 gap-1">
        <Btn onPress={addBlock} className="w-full">
          + Add block
        </Btn>
        {/* The mockup defers this itself; the note is its own wording. RN has
            no `title` tooltip, so the reason rides the accessible label, as
            ExercisePicker's disabled "+ New circuit" already does in this
            directory. */}
        <Btn disabled label="Multiple sessions in one day are not supported yet" className="w-full">
          + Add new session
        </Btn>
        <T className="text-3 text-muted">
          Multiple sessions in one day is next on the list — for now this day holds one.
        </T>
      </View>
    </ScrollView>
  );
}
