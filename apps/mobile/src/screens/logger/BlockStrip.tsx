import { Pressable, Text, View } from 'react-native';
import type { BlockView } from '@hybrid/session-authoring';
import { useLoggerStyles } from './styles';

/*
 * The row of segments across the top of the logger — one per block, in the
 * order `useSession`'s view already reports them. This file decides nothing
 * about progress or ordering: `BlockView.progress` is the hook's own tally
 * (working sets only, per `view.ts`'s `blockProgress`), and this component
 * only paints it.
 *
 * The React Native body of `apps/web`'s deleted `BlockStrip.tsx`, hook for
 * hook: `seg-<i>` is the same `data-parity` value, carried as a `testID`.
 */
export function BlockStrip({
  blocks,
  currentIndex,
  onSelect,
}: {
  blocks: BlockView[];
  /** Passed straight through from `SessionView.blockIndex`; the shell keeps
   *  no mirror of it. */
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const st = useLoggerStyles();
  if (!blocks.length) return null;

  return (
    <View style={st.strip}>
      {blocks.map((block, i) => {
        const current = i === currentIndex;
        const pct = block.progress.total > 0 ? Math.round((block.progress.done / block.progress.total) * 100) : 0;
        return (
          <Pressable
            key={block.id}
            testID={`seg-${i}`}
            accessibilityRole="button"
            accessibilityState={{ selected: current }}
            onPress={() => onSelect(i)}
            style={[st.seg, current ? st.segCurrent : st.segIdle]}
          >
            <View style={[st.segFill, { width: `${pct}%` }]} />
            <Text
              numberOfLines={1}
              style={[st.segLabel, current ? st.segLabelCurrent : st.segLabelIdle]}
            >
              {block.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
