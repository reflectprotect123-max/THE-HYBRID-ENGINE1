import { useMemo, useState } from 'react';
import { CATALOGUE_TAGS, filterCatalogue, tagCounts, type CatalogueEntry } from '@hybrid/engine';

/**
 * The mockup's "+ Add exercise from library" panel: search, filter chips with
 * live counts, the matching movements, and the actions under them.
 *
 * All filtering lives in `@hybrid/engine`'s `filterCatalogue` — this holds the
 * query and the active tags, and renders what the engine returns. Counts come
 * from `tagCounts` over the FULL list, not the filtered one: a chip reading "0"
 * because you already filtered it away would be a chip that lies about the
 * library.
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

  /*
   * `picker-open` is not decoration. Reported from a phone, 14 August 2026:
   * tapping "+ Add exercise from library" made the block go EMPTY — no
   * picker, and no button to get back, so a coach on a phone could add a
   * block and then add nothing to it, forever.
   *
   * The phone stylesheet hides the picker until it is asked for:
   *
   *     .cb-picker { display: none; }
   *     .cb-picker.picker-open { display: block; }
   *
   * The mockup toggled that class by hand. This component was ported from it
   * and never applied it — a search for `picker-open` across the whole of
   * `apps/web/src` returned the CSS and nothing else. On desktop the rules do
   * not apply, so the screen worked everywhere it was reviewed.
   *
   * It is HARD-CODED rather than driven by a prop because in React this
   * component only exists while the picker is open — `BlockEditor` renders it
   * behind `pickerOpen &&`. Mounted IS open, so a prop could only ever be
   * `true`, and a second source of truth for one boolean is how this drifted
   * apart in the first place.
   */
  return (
    <div className="cb-picker picker-open">
      <input
        type="text"
        className="cb-picker-search"
        placeholder="Search the exercise library"
        aria-label="Search the exercise library"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <p className="cb-picker-count">
        <span className="cb-count-n" data-testid="picker-shown-count">
          {shown.length}
        </span>{' '}
        exercises shown
        <button type="button" className="cb-clear-filters" onClick={clearFilters}>
          Clear filters
        </button>
      </p>

      <div className="cb-picker-filters">
        {CATALOGUE_TAGS.map((tag) => {
          const count = counts.find((c) => c.tag === tag)?.count ?? 0;
          return (
            <label key={tag} className="cb-filter-chip">
              <input
                type="checkbox"
                value={tag}
                aria-label={tag}
                checked={activeTags.includes(tag)}
                onChange={() => toggleTag(tag)}
              />
              {tag} <span className="n" data-testid={`tag-count-${tag}`}>{count}</span>
            </label>
          );
        })}
      </div>

      <ul className="cb-picker-list">
        {entries.length === 0 ? (
          /* Not the same fact as "your filters excluded everything". */
          <li className="cb-picker-empty">
            No movements in your library yet — they appear here as you author sessions.
          </li>
        ) : shown.length === 0 ? (
          <li className="cb-picker-empty">No exercises match those filters.</li>
        ) : (
          shown.map((entry) => (
            <li key={entry.name}>
              <button
                type="button"
                className="cb-picker-row"
                data-name={entry.name}
                onClick={() => onPick(entry.name)}
              >
                <span className="swatch">{entry.name.charAt(0)}</span>
                <span className="name">{entry.name}</span>
                <span className="plus">+</span>
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="cb-picker-actions">
        {/*
          Circuit has a tab in the mockup and no definition anywhere in this
          system yet — see 2026-08-11-stage3c-sessions-exercises-design.md.
          Live, it would be a dead end; omitted, the mockup's intent is lost.
        */}
        <button
          type="button"
          className="cb-new-circuit"
          disabled
          title="Circuits are not defined in this system yet"
        >
          + New circuit
        </button>
        <button type="button" className="cb-new-exercise" onClick={() => onNewExercise(query.trim())}>
          + New exercise
        </button>
        <button type="button" className="cb-picker-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
