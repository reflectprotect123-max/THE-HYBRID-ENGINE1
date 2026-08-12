import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { Workout } from '@hybrid/engine';
import { authoredSessions, filterSessions, type SessionSummary } from './session-list';
import { Btn, Empty, Input, T, Tap } from '../../ui';

/**
 * Choose one of the coach's own sessions to put on a day — the native twin of
 * `apps/web/src/coach/library/SessionPicker.tsx`.
 *
 * This is Stage 3c's "Sessions", reached the way it is actually useful: from
 * the Calendar's "Add from library" on an empty day. Picking one seeds the day
 * builder — 3c's rule is one editor, and this does not become a second.
 *
 * Presentational only: workouts come in as a prop, callbacks go out. No store
 * access, no navigation — the screen that hosts this owns both.
 */
export function SessionPicker({
  workouts,
  date,
  onPick,
  onCreateInstead,
}: {
  workouts: readonly Workout[];
  date?: string;
  onPick: (id: string) => void;
  onCreateInstead: () => void;
}) {
  const [query, setQuery] = useState('');
  const all = useMemo(() => authoredSessions(workouts), [workouts]);
  const shown = useMemo(() => filterSessions(all, query), [all, query]);

  if (all.length === 0) {
    // The empty state when the coach has written nothing yet — it says so and
    // offers the way forward, never a blank panel.
    return (
      <View>
        <Empty
          title="You have not written any sessions yet"
          action={
            <Btn variant="brass" onPress={onCreateInstead}>
              Build this day from scratch
            </Btn>
          }
        />
      </View>
    );
  }

  return (
    <View>
      <T w="bold" className="text-6 text-text">
        Add a session{date ? ` to ${date}` : ''}
      </T>
      <T className="mt-0.5 text-4 text-muted">
        Pick one you have already written. It opens in the builder as a copy — editing it here never
        changes the original.
      </T>

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Session name"
        accessibilityLabel="Search sessions"
        className="mt-2 h-5 rounded-md border border-line bg-well px-1.5 text-4 text-text"
      />

      {shown.length === 0 ? (
        // A distinct "nothing matches that search" state — not the same as
        // having no sessions at all, which is the branch above.
        <T className="mt-1 text-4 text-dim">No session matches "{query}".</T>
      ) : (
        <View className="mt-1">
          {shown.map((session) => (
            <Tap
              key={session.id}
              onPress={() => onPick(session.id)}
              label={`${session.name}, ${summarise(session)}`}
              box={{ h: 44 }}
              className="mt-0.5 rounded-md border border-line bg-panel3 p-1.5"
            >
              <T w="semi" className="text-4 text-text" numberOfLines={1}>
                {session.name}
              </T>
              <T className="mt-0.5 text-3 text-dim">{summarise(session)}</T>
            </Tap>
          ))}
        </View>
      )}

      <Btn variant="ghost" className="mt-2" onPress={onCreateInstead}>
        Build this day from scratch instead
      </Btn>
    </View>
  );
}

/** Only facts the summary actually has. An unknown kind is omitted, not guessed. */
function summarise(session: SessionSummary): string {
  const parts = [`${session.blockCount} block${session.blockCount === 1 ? '' : 's'}`];
  if (session.kind) parts.push(session.kind);
  if (session.dates.length) parts.push(`already on ${session.dates.length} day${session.dates.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
