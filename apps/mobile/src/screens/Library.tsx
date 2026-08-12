import { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  CON_FORMATS,
  agoLabel,
  blockExercises,
  duplicateWorkout,
  isCond,
  isCondWorkout,
  knownMovements,
  rxLine,
  sessionOpeners,
  ungroupedWorkouts,
  uid,
  workoutStats,
  workoutsInFolder,
  type Folder,
  type LoggedSet,
  type StrengthBlock,
  type Workout,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { Btn, Card, Chip, Empty, Input, Kicker, Screen, SectionHead, T, Tabs, Tap, Title } from '../ui';
import type { RootStackParams } from '../App';

/*
 * Two letters, in seven equal columns — the same change as the web app's.
 *
 * Three-letter chips in a wrapping row do not fit a phone: SAT dropped to a
 * line of its own, so a week rendered as 6 + 1 and every session card carried
 * an extra row of height to say nothing. `flex-1` per cell cannot wrap.
 *
 * Two letters rather than one because Sunday and Saturday are both S, and
 * unlike Home's week strip there is no date underneath to tell them apart.
 */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/*
 * Everything you can train.
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, workouts, sessions, update } = useDb();
  const [open, setOpen] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  // 'NEW' while creating a folder, a folder id while renaming one, else null.
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // The picker Modal's OWN "+ New folder" inline-create state, separate from
  // `editingFolder`/`folderName` above. Those two are shared by the
  // background folder list's inline create AND rename UI; the picker only
  // ever creates (never renames), but reusing the same state meant tapping
  // "+ New folder" inside the picker also mounted the identical inline input
  // in the accessibility-hidden background list behind it, and an
  // uncommitted entry there could leak into the NEXT time the picker opened.
  const [pickerEditingFolder, setPickerEditingFolder] = useState(false);
  const [pickerFolderName, setPickerFolderName] = useState('');

  /* Three slices of one library, not three destinations. Sessions are things
     you START; exercises and mobility are things you LOOK UP. In one list the
     448 movements buried the sessions you actually run. */
  const [tab, setTab] = useState<'sessions' | 'exercises' | 'mobility'>('sessions');
  const [q, setQ] = useState('');

  const mine = workouts;
  // Memoized, not just `|| []` inline: when `db.settings.folders` is
  // undefined that fallback mints a fresh array every render, which defeats
  // `ungrouped`'s own useMemo below on every render regardless of whether
  // anything folder-related actually changed.
  const folders = useMemo(() => db.settings.folders || [], [db.settings.folders]);
  const ungrouped = useMemo(() => ungroupedWorkouts(mine, folders), [mine, folders]);
  const movements = useMemo(() => knownMovements(workouts, sessions), [workouts, sessions]);
  const mobility = useMemo(
    () => (Array.isArray(db.settings.mobility) ? db.settings.mobility : []),
    [db.settings.mobility],
  );
  const shown = useMemo(() => {
    const list = tab === 'exercises' ? movements : tab === 'mobility' ? mobility : [];
    const k = q.trim().toLowerCase();
    return (k ? list.filter((m) => m.toLowerCase().includes(k)) : list).slice(0, 40);
  }, [tab, q, movements, mobility]);

  /** Into the guided builder, one step at a time, rather than dropping you
   *  straight into a blank editor. */
  const add = () => {
    const w: Workout = { id: uid(), name: 'New session', blocks: [], updatedAt: Date.now() };
    update((d) => {
      d.workouts.push(w);
    });
    nav.navigate('GuidedBuilder', { id: w.id });
  };

  /** A clone, independent from the id up — see `duplicateWorkout`'s own doc
   *  comment for why. Lands on Planner, pre-populated, not GuidedBuilder:
   *  GuidedBuilder is append-only and cannot open on existing content. */
  const duplicate = (w: Workout) => {
    // The library's own names, so the copy lands on one that is not already in
    // the list it is about to join — see `duplicateWorkout`.
    const copy = duplicateWorkout(w, workouts.map((x) => x.name || ''));
    update((d) => {
      d.workouts.push(copy);
    });
    nav.navigate('Planner', { id: copy.id });
  };

  const toggleDay = (id: string, i: number) =>
    update((d) => {
      const w = d.workouts.find((x) => x.id === id);
      if (!w) return false;
      const days = new Set(w.days || []);
      if (days.has(i)) days.delete(i);
      else days.add(i);
      w.days = Array.from(days).sort((a, b) => a - b);
      w.updatedAt = Date.now();
    });

  const remove = (id: string) =>
    update((d) => {
      d.workouts = d.workouts.filter((x) => x.id !== id);
      // A tombstone, not just a local delete: without one the next sync sees a
      // workout the remote still has and cheerfully restores it.
      d.settings.deletedIds = { ...(d.settings.deletedIds || {}), [id]: Date.now() };
    });

  /* Asks first. The tombstone above is exactly why: this is not a local
     tidy-up that a re-sync quietly undoes, it removes the session from every
     device you own and there is no way back to it. */
  const confirmRemove = (w: Workout) =>
    Alert.alert(`Delete "${w.name || 'Session'}"?`, 'This removes it from every device. It cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(w.id) },
    ]);

  const startNewFolder = () => {
    setEditingFolder('NEW');
    setFolderName('');
  };

  const startRenameFolder = (f: Folder) => {
    setEditingFolder(f.id);
    setFolderName(f.name);
  };

  const commitFolderEdit = () => {
    const name = folderName.trim();
    if (!name) {
      setEditingFolder(null);
      return;
    }
    if (editingFolder === 'NEW') {
      update((d) => {
        d.settings.folders = [...(d.settings.folders || []), { id: uid(), name }];
      });
    } else if (editingFolder) {
      const id = editingFolder;
      update((d) => {
        d.settings.folders = (d.settings.folders || []).map((x) => (x.id === id ? { ...x, name } : x));
      });
    }
    setEditingFolder(null);
  };

  /** The picker Modal's own "+ New folder" — see the `pickerEditingFolder`
   *  state doc comment above for why this is not just `startNewFolder` /
   *  `commitFolderEdit` reused. Creation-only, so there is no rename branch
   *  to mirror `commitFolderEdit`'s `editingFolder` id case. */
  const startPickerNewFolder = () => {
    setPickerEditingFolder(true);
    setPickerFolderName('');
  };

  const commitPickerFolderEdit = () => {
    const name = pickerFolderName.trim();
    setPickerEditingFolder(false);
    if (!name) return;
    update((d) => {
      d.settings.folders = [...(d.settings.folders || []), { id: uid(), name }];
    });
  };

  /** Opens the picker for a workout with a clean slate: any uncommitted
   *  in-picker "+ New folder" entry from a previous open must not leak into
   *  this one. */
  const openPicker = (workoutId: string) => {
    setPickerEditingFolder(false);
    setPickerFolderName('');
    setPickerFor(workoutId);
  };

  const closePicker = () => {
    setPickerFor(null);
    setPickerEditingFolder(false);
    setPickerFolderName('');
  };

  const removeFolder = (f: Folder) =>
    Alert.alert(`Delete folder "${f.name}"?`, 'Workouts inside stay in your library.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          update((d) => {
            d.settings.folders = (d.settings.folders || []).filter((x) => x.id !== f.id);
            d.workouts.forEach((w) => {
              if ((w.folderIds || []).includes(f.id)) w.folderIds = (w.folderIds || []).filter((id) => id !== f.id);
            });
            // A tombstone, not just a local delete: without one the next sync
            // sees a folder the remote still has and cheerfully restores it —
            // see `remove` above for the same pattern applied to a workout id.
            d.settings.deletedIds = { ...(d.settings.deletedIds || {}), [f.id]: Date.now() };
          }),
      },
    ]);

  const toggleFolderForWorkout = (workoutId: string, folderId: string) =>
    update((d) => {
      const w = d.workouts.find((x) => x.id === workoutId);
      if (!w) return false;
      const set = new Set(w.folderIds || []);
      if (set.has(folderId)) set.delete(folderId);
      else set.add(folderId);
      w.folderIds = Array.from(set);
    });

  return (
    <Screen>
      <Kicker>Library</Kicker>
      <Title>Your library</Title>

      <Tabs
        value={tab}
        onChange={(k) => {
          setTab(k);
          setQ('');
        }}
        tabs={[
          { key: 'sessions', label: 'Sessions', count: workouts.length },
          { key: 'exercises', label: 'Exercises', count: movements.length },
          { key: 'mobility', label: 'Mobility', count: mobility.length },
        ]}
      />

      {tab !== 'sessions' ? (
        <NameList
          shown={shown}
          total={tab === 'exercises' ? movements.length : mobility.length}
          q={q}
          setQ={setQ}
          noun={tab === 'exercises' ? 'movements' : 'mobility & prep'}
          onPick={tab === 'exercises' ? (m) => nav.navigate('Exercise', { name: m }) : undefined}
          empty={
            tab === 'exercises'
              ? 'Nothing logged yet. Movements appear here as you train them.'
              : 'No mobility work saved. These are the stretches, breathing and prep you do around training — they carry no load to track, so this is a reference list.'
          }
        />
      ) : null}

      {tab !== 'sessions' ? null : (
      <>
      <Btn variant="brass" className="mt-2" onPress={add}>
        ＋ New session
      </Btn>

      {/* The whole "Yours" section — folder management plus every row — is
          hidden from accessibility, not unmounted, while the picker Modal is
          up. The folder list's own "+ New folder"/"Add" controls carry the
          exact same labels the Modal renders for the same purpose, and a
          screen reader (or a test query) cannot tell two same-named live
          controls apart — but unmounting to solve that cost a real UX
          regression: `Screen` wraps everything in a ScrollView, and RN does
          not restore scroll offset when content that was removed (shrinking
          the scroll height) comes back, so closing the picker on a workout
          deep in a long list dropped the user back near the top. Hiding via
          `importantForAccessibility`/`accessibilityElementsHidden` instead
          keeps the layout — and the scroll position — intact while still
          making the background unreachable to VoiceOver/TalkBack and to
          accessibility-label queries, exactly the effect a real native Modal
          already has on what's behind it. */}
      <View
        importantForAccessibility={pickerFor != null ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={pickerFor != null}
      >
      <SectionHead title="Yours" />
      <Btn variant="ghost" className="mb-1" onPress={startNewFolder}>
        + New folder
      </Btn>
      {editingFolder === 'NEW' ? (
        <View className="mb-1 flex-row items-center gap-1">
          <Input
            value={folderName}
            onChangeText={setFolderName}
            placeholder="Folder name"
            accessibilityLabel="New folder name"
            className="h-5 flex-1 rounded-md border border-line bg-well px-1.5 text-4 text-text"
          />
          <Btn variant="brass" onPress={commitFolderEdit}>
            Add
          </Btn>
        </View>
      ) : null}
      {folders.map((f) => {
        const inFolder = workoutsInFolder(mine, f.id);
        const isOpen = !!openFolders[f.id];
        return (
          <View key={f.id} className="mb-1">
            {editingFolder === f.id ? (
              <View className="flex-row items-center gap-1">
                <Input
                  value={folderName}
                  onChangeText={setFolderName}
                  placeholder="Folder name"
                  accessibilityLabel="New folder name"
                  className="h-5 flex-1 rounded-md border border-line bg-well px-1.5 text-4 text-text"
                />
                <Btn variant="brass" onPress={commitFolderEdit}>
                  Save
                </Btn>
              </View>
            ) : (
              <Card className="flex-row items-center">
                <Tap
                  className="min-w-0 flex-1 flex-row items-center"
                  onPress={() => setOpenFolders((o) => ({ ...o, [f.id]: !o[f.id] }))}
                  label={`${isOpen ? 'collapse' : 'expand'} ${f.name} folder`}
                >
                  <T className="text-4 text-dim">{isOpen ? '▾' : '▸'}</T>
                  <T w="semi" className="ml-1 min-w-0 flex-1 text-5 text-text" numberOfLines={1}>
                    {f.name}
                  </T>
                  <T num className="text-3 text-dim">
                    ({inFolder.length})
                  </T>
                </Tap>
                <Tap
                  onPress={() => startRenameFolder(f)}
                  box={32}
                  label={`rename ${f.name}`}
                  className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
                >
                  <T w="med" className="text-3 text-muted">
                    ✎
                  </T>
                </Tap>
                <Tap
                  onPress={() => removeFolder(f)}
                  box={32}
                  label={`delete folder ${f.name}`}
                  className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
                >
                  <T w="med" className="text-4 text-muted">
                    ✕
                  </T>
                </Tap>
              </Card>
            )}
            {isOpen ? (
              <View className="mt-0.5 pl-2">
                {inFolder.map((w) => (
                  <WorkoutRow
                    key={w.id}
                    w={w}
                    open={open}
                    setOpen={setOpen}
                    duplicate={duplicate}
                    confirmRemove={confirmRemove}
                    nav={nav}
                    toggleDay={toggleDay}
                    onOpenFolders={openPicker}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {ungrouped.length ? (
        ungrouped.map((w) => (
          <WorkoutRow
            key={w.id}
            w={w}
            open={open}
            setOpen={setOpen}
            duplicate={duplicate}
            confirmRemove={confirmRemove}
            nav={nav}
            toggleDay={toggleDay}
            onOpenFolders={setPickerFor}
          />
        ))
      ) : !folders.length ? (
        <Empty title="Nothing here yet" body="Tap “＋ New session” to build your first one." />
      ) : null}
      </View>
      </>
      )}

      <Modal visible={pickerFor != null} transparent animationType="fade" onRequestClose={closePicker}>
        <View className="flex-1 items-center justify-center bg-black/50 p-2">
          <Card className="w-full">
            <T w="semi" className="text-6 text-text">
              Folders
            </T>
            {/* Only the per-folder chips scroll — with enough folders they
                would otherwise overflow the (vertically centered) modal in
                both directions and push "Done" off screen with no way back
                on iOS. The "+ New folder" input and "Done" stay outside this
                ScrollView so they are always reachable regardless of how
                many folders there are. maxHeight is a fraction of the modal
                rather than a fixed px, so it scales with the device instead
                of being right on one phone and wrong on the next. */}
            <ScrollView style={{ maxHeight: '60%' }} className="mt-1">
              {folders.map((f) => {
                const w = mine.find((x) => x.id === pickerFor);
                const on = pickerFor ? (w?.folderIds || []).includes(f.id) : false;
                return (
                  <View key={f.id} className="mb-1">
                    <Chip
                      on={on}
                      onPress={() => pickerFor && toggleFolderForWorkout(pickerFor, f.id)}
                      label={`${f.name}, ${on ? 'in folder' : 'not in folder'}`}
                    >
                      {f.name}
                    </Chip>
                  </View>
                );
              })}
              {!folders.length ? (
                <T className="text-4 text-dim">No folders yet.</T>
              ) : null}
            </ScrollView>
            {pickerEditingFolder ? (
              <View className="mt-1 flex-row items-center gap-1">
                <Input
                  value={pickerFolderName}
                  onChangeText={setPickerFolderName}
                  placeholder="Folder name"
                  accessibilityLabel="New folder name"
                  className="h-5 flex-1 rounded-md border border-line bg-well px-1.5 text-4 text-text"
                />
                <Btn variant="brass" onPress={commitPickerFolderEdit}>
                  Add
                </Btn>
              </View>
            ) : (
              <Btn variant="ghost" className="mt-1" onPress={startPickerNewFolder}>
                + New folder
              </Btn>
            )}
            <Btn variant="brass" className="mt-1.5" onPress={closePicker}>
              Done
            </Btn>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

/**
 * A searchable list of names — the web app's `NameList`.
 *
 * Shared by Exercises and Mobility because they are the same object at
 * different weights: one opens a history the app can draw, the other does not,
 * because mobility work carries no numbers and a tappable row would promise a
 * screen that has nothing on it.
 */
function NameList({
  shown,
  total,
  q,
  setQ,
  onPick,
  noun,
  empty,
}: {
  shown: string[];
  total: number;
  q: string;
  setQ: (s: string) => void;
  onPick?: (m: string) => void;
  noun: string;
  empty: string;
}) {
  if (!total) {
    return (
      <View className="mt-2">
        <Empty title="Nothing here yet" body={empty} />
      </View>
    );
  }
  return (
    <>
      <Input
        value={q}
        onChangeText={setQ}
        placeholder={`Search ${total} ${noun}`}
        accessibilityLabel={`Search ${noun}`}
        className="mt-2 h-5 rounded-md border border-line bg-well px-1.5 text-4 text-text"
      />
      {shown.map((m) =>
        onPick ? (
          <Tap
            key={m}
            onPress={() => onPick(m)}
            label={`${m} history`}
            className="mt-0.5 flex-row items-center rounded-md border border-line bg-panel3 p-1.5"
          >
            <T w="med" className="min-w-0 flex-1 text-4 text-text" numberOfLines={1}>
              {m}
            </T>
            <T className="text-3 text-dim">›</T>
          </Tap>
        ) : (
          <View key={m} className="mt-0.5 rounded-md border border-line bg-panel3 p-1.5">
            <T className="text-4 text-muted">{m}</T>
          </View>
        ),
      )}
      {!shown.length ? <T className="mt-1 p-1.5 text-4 text-dim">Nothing matches “{q}”.</T> : null}
    </>
  );
}

/*
 * What this session actually means to you, on the card.
 *
 * The Library is the screen you open to DECIDE what to train, and until now it
 * answered with a name and a block count. These two lines are the two things
 * that bear on the decision: when you last did it, and what you would be
 * lifting if you started it now.
 *
 * Both are suppressed when empty rather than rendered blank — a session you
 * have never trained should say nothing, not "last trained never · opens at".
 */
function Signal({ w }: { w: Workout }) {
  const { db, sessions, whoop } = useDb();
  const stats = useMemo(() => workoutStats(w, sessions), [w, sessions]);
  // Through sessionOpeners, so this figure and the one the logger prefills come
  // from the same function — including the red-morning easing.
  const opens = useMemo(() => sessionOpeners(w, db.settings, whoop), [w, db.settings, whoop]);

  if (!stats.count && !opens.length) return null;

  return (
    <View className="mt-0.5">
      {stats.count ? (
        <T num className="text-3 text-dim">
          {agoLabel(stats.lastDate)} · {stats.count} {stats.count === 1 ? 'time' : 'times'}
        </T>
      ) : null}
      {opens.length ? (
        <T num className="text-3 text-muted" numberOfLines={1}>
          opens at {opens.map((o) => `${o.name} ${o.kg}`).join(' · ')}
          {opens.some((o) => o.eased) ? ' (eased today)' : ''}
        </T>
      ) : null}
    </View>
  );
}

/** One workout's card: expand/Detail, day chips, Edit/Duplicate, the
 *  row-level delete ✕. Extracted so folder groups and the flat ungrouped
 *  list can both render the same row without duplicating this markup. */
function WorkoutRow({
  w,
  open,
  setOpen,
  duplicate,
  confirmRemove,
  nav,
  toggleDay,
  onOpenFolders,
}: {
  w: Workout;
  open: string | null;
  setOpen: (id: string | null) => void;
  duplicate: (w: Workout) => void;
  confirmRemove: (w: Workout) => void;
  nav: NativeStackNavigationProp<RootStackParams>;
  toggleDay: (id: string, i: number) => void;
  onOpenFolders: (workoutId: string) => void;
}) {
  return (
    <Card className="mb-1">
      {/* Delete sits on the ROW, not behind the expand. It used to only
          appear once you had tapped the card open, which is not
          somewhere anyone looks for it. */}
      <View className="flex-row items-center">
        <Tap
          className="min-w-0 flex-1 flex-row items-center"
          onPress={() => setOpen(open === w.id ? null : w.id)}
          label={`${open === w.id ? 'collapse' : 'expand'} ${w.name || 'session'}`}
        >
          <T w="semi" className="min-w-0 flex-1 text-5 text-text" numberOfLines={1}>
            {w.name || 'Session'}
          </T>
          <T num className="ml-1 text-3 text-dim">
            {isCondWorkout(w) || !w.blocks.length
              ? 'conditioning'
              : `${w.blocks.length} ${w.blocks.length === 1 ? 'block' : 'blocks'}`}
          </T>
        </Tap>
        <Tap
          onPress={() => confirmRemove(w)}
          box={32}
          label={`delete ${w.name || 'session'}`}
          className="ml-1 h-4 w-4 items-center justify-center rounded-md border border-line2 bg-panel2"
        >
          <T w="med" className="text-4 text-muted">
            ✕
          </T>
        </Tap>
      </View>

      <Signal w={w} />

      <View className="mt-1 flex-row gap-0.5">
        {DAYS.map((d, i) => (
          // The cell owns the width; the chip stretches to fill it, so
          // seven always land on one row whatever the label does.
          <View key={d} className="flex-1">
            <Chip
              on={(w.days || []).includes(i)}
              onPress={() => toggleDay(w.id, i)}
              label={`${DAY_NAMES[i]} — ${(w.days || []).includes(i) ? 'scheduled' : 'not scheduled'}`}
            >
              {d}
            </Chip>
          </View>
        ))}
      </View>

      {/* Folders lives outside the expand gate, alongside the day chips: it
          is a quick assign/remove action, not something that only makes
          sense once the card's full detail is on screen — unlike
          Edit/Duplicate below, which act on content you can only see open. */}
      <Btn
        variant="ghost"
        className="mt-1.5"
        label={`folders for ${w.name || 'session'}`}
        onPress={() => onOpenFolders(w.id)}
      >
        Folders
      </Btn>

      {open === w.id ? (
        <>
          <Detail w={w} />
          <Btn variant="brass" className="mt-1.5" onPress={() => nav.navigate('Planner', { id: w.id })}>
            Edit
          </Btn>
          <Btn
            variant="ghost"
            className="mt-1.5"
            label={`duplicate ${w.name || 'session'}`}
            onPress={() => duplicate(w)}
          >
            Duplicate
          </Btn>
        </>
      ) : null}
    </Card>
  );
}

/**
 * The block/exercise listing for one workout, read-only.
 *
 * Exported so the Day preview screen (`../screens/Day.tsx`) can reuse it
 * rather than growing a second copy of the same block-by-block render.
 */
export function Detail({ w }: { w: Workout }) {
  return (
    <View className="mt-1.5 border-t border-line pt-1.5">
      {w.blocks.map((b, bi) => (
        <View key={b.id ?? bi} className="mb-1">
          <T w="semi" className="text-3 uppercase tracking-widest text-dim">{b.heading || 'Block'}</T>
          {isCond(b) ? (
            <T className="text-4 text-muted">
              {CON_FORMATS[b.condFmt]?.name ?? b.condFmt} · {b.effort || b.targetZone}
            </T>
          ) : (
            blockExercises(b as StrengthBlock<LoggedSet>).map((ex, ei) => (
              <T key={ex.id ?? ei} num className="text-4 text-muted">
                <T w="semi" className="text-text">{ex.name || 'Exercise'}</T> {rxLine(ex)}
              </T>
            ))
          )}
        </View>
      ))}
    </View>
  );
}
