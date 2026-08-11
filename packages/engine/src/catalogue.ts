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

  return Array.from(spelling.entries())
    .map(([key, name]) => ({
      name,
      tags: tagsByMovement?.[name] ?? [],
      uses: uses.get(key) || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
