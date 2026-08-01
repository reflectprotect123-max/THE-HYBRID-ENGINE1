import { Card } from '../../ui';

/*
 * Just words. A metcon is one prescription that does not decompose into sets
 * without inventing structure, so the app stores what you wrote and nothing
 * else. The heading is edited on the block itself, one level up — this card
 * is only the body.
 */
export function TextBlockCard({
  body,
  onChange,
}: {
  body: string;
  onChange: (v: string) => void;
}) {
  return (
    <Card>
      <textarea
        value={body || ''}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={'AMRAP 12\n10 burpees\n15 KB swings\n200m run'}
        aria-label="what the block is"
        className="w-full resize-y rounded-md border border-line bg-well px-1 py-1 text-4 leading-relaxed text-text outline-none placeholder:text-dim focus:border-gold-line"
      />
      <p className="mt-0.5 text-2 text-dim">
        Counts as trained when you tick it. No tonnage, no e1RM — there is nothing here to measure.
      </p>
    </Card>
  );
}
