import { blockExercises } from './session';
import type { AnySet, Block, Session, Workout } from './types';

/**
 * The filter tags the coach bench's exercise picker offers, from the approved
 * mockup's `FILTER_TAGS`.
 */
export const CATALOGUE_TAGS = ['Bodyweight', 'Barbell', 'Warm-up', 'Band', 'Conditioning'] as const;

export interface CatalogueEntry {
  name: string;
  tags: string[];
  uses: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Every movement the athlete actually has, with its coach-assigned tags.
 *
 * WHY THIS IS NOT `knownMovements`, which derives from the same two sources:
 * that function filters to `isLiftMode` — `reps_kg` and `amrap` only — because
 * its job is to stop one LIFT being spelled two ways, and `exLogFor`,
 * `detectPRs` and `bestE1rmByLift` all key on the name. Narrowing is correct
 * there and wrong here: a picker that fills a Conditioning block has to offer
 * conditioning movements, and the mockup's own seed tags "Row Erg" as
 * Conditioning. So `knownMovements` keeps its lift-only contract for the
 * progression paths that depend on it, and the catalogue derives beside it.
 *
 * The de-duplication rule IS copied from it deliberately — case-insensitive,
 * keeping the most recent spelling — because two lists that disagree about
 * whether it is "Back Squat" or "back squat" are worse than either list alone.
 *
 * The list is DERIVED; the tags are DECLARED. Inferring a tag from context —
 * calling a movement "Conditioning" because it once sat in a conditioning
 * block — would put a guess in a field the picker then filters on, and a
 * filter that hides real movements is worse than no filter.
 */
export function buildCatalogue(
  workouts: Workout[] = [],
  sessions: Session[] = [],
  tagsByMovement: Record<string, string[]> | undefined = undefined,
  movements: readonly string[] | undefined = undefined,
): CatalogueEntry[] {
  // Newest first, so the first spelling seen for a key is the freshest one.
  const src: { blocks: Block<AnySet>[]; at: number }[] = [];
  (workouts || []).forEach((w) => w && src.push({ blocks: w.blocks || [], at: w.updatedAt || 0 }));
  (sessions || []).forEach(
    (s) => s && src.push({ blocks: s.blocks || [], at: s.completedAt || s.updatedAt || 0 }),
  );
  src.sort((a, b) => b.at - a.at);

  const spelling = new Map<string, string>();
  const uses = new Map<string, number>();

  src.forEach((x) =>
    (x.blocks || []).forEach((b) =>
      blockExercises(b).forEach((e) => {
        const name = String(e?.name || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!spelling.has(key)) spelling.set(key, name);
        uses.set(key, (uses.get(key) || 0) + 1);
      }),
    ),
  );

  /*
   * A LIBRARY THE COACH OWNS BEATS ONE MINED OUT OF HISTORY.
   *
   * Passing `movements` makes that list the library, and it is the mode the
   * coach bench runs in as of 16 August 2026. The owner asked for the picker
   * emptied so he could rebuild it from what he actually enters: the derived
   * list had grown to 166 movements out of every workout and session ever
   * stored, including spellings nobody would choose again, and there was no
   * way to remove one — a name only left the picker when the last record
   * containing it was deleted.
   *
   * `uses` is still counted from history, because how often a movement has
   * been programmed is a fact about the records whether or not the coach has
   * adopted the name. A movement in the list that has never been used counts
   * zero, which is a real answer and not a missing one.
   *
   * An EMPTY array is a real, meaningful value — "the coach has an empty
   * library" — and only `undefined` falls back to mining. That distinction is
   * the whole point: `[]` is what an emptied library looks like, and it must
   * not silently reinflate to 166.
   */
  if (movements) {
    const seen = new Set<string>();
    return movements
      .map((m) => String(m || '').trim())
      .filter((name) => {
        if (!name) return false;
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((name) => ({
        name,
        tags: tagsByMovement?.[name] ?? [],
        uses: uses.get(name.toLowerCase()) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return Array.from(spelling.entries())
    .map(([key, name]) => ({
      name,
      tags: tagsByMovement?.[name] ?? [],
      uses: uses.get(key) || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The coach's library with `name` added, or unchanged when it is already
 * there under any spelling.
 *
 * Case-insensitive for the same reason `buildCatalogue` de-duplicates that
 * way: two entries disagreeing about whether it is "Back Squat" or "back
 * squat" are worse than either alone, and the picker filters on the name.
 */
export function addMovement(movements: readonly string[] | undefined, name: string): string[] {
  const clean = String(name || '').trim();
  const list = [...(movements ?? [])];
  if (!clean) return list;
  if (list.some((m) => m.trim().toLowerCase() === clean.toLowerCase())) return list;
  list.push(clean);
  return list;
}

/** How many catalogue entries carry each offered tag. Zero is a real answer. */
export function tagCounts(entries: CatalogueEntry[]): TagCount[] {
  return CATALOGUE_TAGS.map((tag) => ({
    tag,
    count: entries.filter((e) => e.tags.includes(tag)).length,
  }));
}

/**
 * Search AND tags, both narrowing. An empty result is returned as an empty
 * result — never quietly widened back to everything, which would show a coach
 * movements they had just filtered out.
 */
export function filterCatalogue(
  entries: CatalogueEntry[],
  query: string,
  activeTags: string[],
): CatalogueEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (activeTags.length && !activeTags.some((t) => e.tags.includes(t))) return false;
    return true;
  });
}
