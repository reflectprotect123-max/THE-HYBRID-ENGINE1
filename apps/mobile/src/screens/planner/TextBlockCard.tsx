import { Card, Input, T } from '../../ui';

/** Just words — see the web Planner's twin for why a metcon is not sets. */
export function TextBlockCard({
  body,
  readOnly,
  onChange,
}: {
  body: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Card>
      <Input
        value={body || ''}
        editable={!readOnly}
        multiline
        numberOfLines={5}
        onChangeText={onChange}
        placeholder={'AMRAP 12\n10 burpees\n15 KB swings\n200m run'}
        accessibilityLabel="what the block is"
        className="min-h-[96px] rounded-md border border-line bg-well px-1 py-1 text-4 text-text"
        style={{ textAlignVertical: 'top' }}
      />
      <T className="mt-0.5 text-2 text-dim">
        Counts as trained when you tick it. No tonnage, no e1RM — there is nothing here to measure.
      </T>
    </Card>
  );
}
