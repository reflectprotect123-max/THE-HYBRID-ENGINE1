import { WELL } from '../ui';

/*
 * Just words. A metcon is one prescription that does not decompose into sets
 * of a movement without inventing structure — see packages/engine/src/types.ts's
 * TextBlock doc. The coach types it, the athlete ticks it, and neither side
 * pretends it produced tonnage or an e1RM.
 *
 * No shared Card component exists in this app (see ExerciseCard.tsx and
 * ConditioningCard.tsx — both style their own section directly), so this one
 * does too, matching the same border/shadow treatment.
 */
export function TextBlockCard({ body, onChange }: { body: string; onChange: (v: string) => void }) {
  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel p-2 shadow-card">
      <textarea
        value={body}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={'AMRAP 12\n10 burpees\n15 KB swings\n200m run'}
        aria-label="what the block is"
        className={WELL + ' w-full resize-y px-1 py-1 text-4 leading-relaxed'}
      />
      <p className="mt-1 text-2 text-dim">
        The athlete ticks this when done. No tonnage, no e1RM — there is nothing here to measure.
      </p>
    </section>
  );
}
