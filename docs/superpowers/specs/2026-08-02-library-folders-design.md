# Library folders — design

## Problem

The Library's Sessions tab lists every workout flat. As a program grows past a
week or two this becomes a long, undifferentiated scroll — no way to group
"Week 1" from "Week 2" without renaming workouts to fake an order.

## What this is

User-created, user-named folders inside Library's Sessions tab. A workout can
belong to zero, one, or several folders. Folders are purely organizational —
they carry no scheduling, no progression state, nothing a workout doesn't
already have. Deleting a folder never deletes a workout.

## Data model

`packages/engine/src/types.ts`:

```ts
export interface Folder {
  id: string;
  name: string;
}
```

- `Settings.folders?: Folder[]` — new field, same shape/spirit as the existing
  `mobility?: string[]` list: a flat, user-maintained collection with nothing
  to compute from — the app never guesses which folders exist.
- `Workout.folderIds?: string[]` — which folders a workout belongs to. Empty
  or absent means ungrouped. Same pattern as the existing `days`/`dates`
  arrays already on `Workout`.

### Deleting a folder

Splice it out of `settings.folders`, and strip its id from every workout's
`folderIds`. Workouts themselves are untouched — they simply lose that tag
and fall back to the ungrouped list (or stay visible under any OTHER folder
they were also tagged into).

### Deleting a workout

No folder-side cleanup needed. Folders only ever reference a workout by id;
once the workout record is gone (via the existing tombstoned delete), it is
gone from every folder's rendered contents too.

### Sync / merge

`mergeSettings` (`packages/engine/src/db.ts`) currently does last-write-wins
per field via `Object.assign`, except `mobility`, which gets a union merge —
because two devices adding different stretches are both real edits that
`Object.assign` would let one clobber the other.

`folders` needs the same treatment: union by `id`, not overwrite. Without it,
renaming a folder on web while a phone is offline could wipe out a folder
created on the phone in the meantime, once the web write syncs.

Folder deletion is routed through the existing `settings.deletedIds`
tombstone map — the same map workouts and sessions already share (ids are
`uid()`-generated, so cross-collision odds are the same negligible risk that
map already carries today). Without this, a device that deleted a folder
could have it silently revived by a stale sync from a device that hadn't
caught up yet — exactly the bug tombstones already exist to prevent for
workouts.

`Workout.folderIds` needs no special merge rule of its own: it merges as part
of whatever wins for that whole workout record already (same as `blocks` or
`days` today).

## Web UX (`apps/web/src/screens/Library.tsx`, Sessions tab)

- Folder headers render above the flat workout list: a collapsible row with a
  ▸/▾ chevron, the folder's name, and a count (e.g. "Week 1 (6)"). All
  folders start collapsed.
- Tapping the folder's name specifically opens inline rename (a plain text
  input swapped in, committed on blur/Enter).
- A "+ New folder" button sits above the folder list. Prompts for a name
  (reusing the same `window.prompt`-or-inline-input convention already used
  elsewhere in this screen), appends a new `{id: uid(), name}` to
  `settings.folders`.
- Drag-and-drop uses the native HTML5 DnD API (`draggable`, `onDragStart`,
  `onDragOver`, `onDrop`) — no new dependency; nothing like it exists in this
  repo yet, so this is genuinely new surface, kept as small as the native API
  allows. Dropping a workout row onto a folder header ADDS that folder's id
  to the workout's `folderIds` (never replaces the array — a workout can be
  in several folders). The folder header gets a highlight style while a drag
  is over it (`ondragover`/`ondragleave`).
- The whole workout row becomes `draggable`; a plain click/tap still opens
  the existing expand/Start/Duplicate/Delete controls untouched — HTML5 DnD
  only activates on an actual drag gesture, not a tap, so nothing already
  wired on the row needs to change.
- Workouts with no `folderIds` (or an empty array) list flat below every
  folder, exactly as the whole list renders today.
- A workout tagged into 2 folders renders inside BOTH — same workout id, no
  data duplication, it just appears in two places in the tree.
- Removing a workout from ONE folder without deleting the workout: a small
  ✕ appears on a workout row only when it's rendered INSIDE a folder — distinct
  from the existing workout-delete ✕ — and strips just that one folder id.

## Mobile UX (`apps/mobile/src/screens/Library.tsx`, Sessions tab)

- Same visual shape as web: collapsible folder headers (▸/▾ + name + count),
  all collapsed by default, "+ New folder" button above the list, tap the
  folder name to rename inline.
- No drag-and-drop — touch drag-and-drop in a scrolling list is unreliable to
  get right and this app has no precedent for it. Instead, each workout row
  gets a new "Folders" button (alongside the existing expand/Duplicate/
  Delete/Start controls) that opens a bottom-sheet checklist: one row per
  existing folder with a checkbox, multi-select (a workout can be in
  several), plus a "+ New folder" row inline for when none exist yet. "Done"
  applies the selected set as that workout's `folderIds`.
- The same picker covers both adding AND removing — unchecking a folder in
  that sheet removes the tag, no separate ✕ needed on mobile.
- Workouts with no `folderIds` list flat below the folders, same as web.

## Shared edge cases

- A folder with zero workouts still renders (e.g. right after creation, or
  once its last workout is deleted-from-Library) — not hidden, so there's
  still something to drag/pick things into.
- Library's search box (`q`) currently only searches the Exercises/Mobility
  tabs, never Sessions — folders don't change that. Called out here as a
  deliberate non-change, not an oversight.
- Folder order is creation order; no manual reordering in this pass.
- Every existing per-row control (expand, Start, Duplicate, the workout
  delete ✕) behaves identically whether a workout renders flat or inside a
  folder — folders are a rendering/grouping layer on top of the same list,
  not a new list.

## Testing

- `packages/engine` unit tests: `mergeSettings`'s new folder union-by-id rule
  (a folder created on each of two "devices" survives merge; a folder
  deleted-then-tombstoned on one side is not revived by a stale sync from the
  other) — mirrors the existing `mobility` merge tests.
- `checks/react-smoke.mjs`: create a folder; drag a seeded workout onto it
  (dispatched via raw DOM dragstart/dragover/drop events, the same idea
  Playwright already uses elsewhere in this suite for non-click
  interactions); confirm it renders inside the folder and disappears from
  the flat/ungrouped list; toggle expand/collapse; delete the folder and
  confirm the workout survives, ungrouped.
- Mobile RNTL: open the "Folders" picker for a workout, check two folders,
  confirm the workout renders under both headers; uncheck one, confirm it
  drops from only that header.

## Scope

**In scope:** folder CRUD (create/rename/delete) on both platforms, workout
add/remove-from-folder (drag on web, picker on mobile), collapsed-by-default
rendering, merge/tombstone handling for folders.

**Explicitly out of scope:** manual folder reordering, nesting folders inside
folders, folder search/filter, moving a workout between folders in one
gesture (web's drag only ever ADDS — removing uses the same small ✕ described
above), any change to Library's existing Exercises/Mobility tabs.
