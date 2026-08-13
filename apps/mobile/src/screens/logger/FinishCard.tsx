import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useLoggerStyles } from './styles';

/*
 * The session receipt — the prototype's `finishHtml()`.
 *
 * Every number here is a prop: this file formats what it is handed and derives
 * nothing from a raw `Session`. `blocks` and `setsLogged` come from
 * `useSession`'s own `view.blocks` (`BlockView.progress`, already tallied by
 * the package); `bestE1rm` is `view.bestE1rm`, which the package grew for
 * exactly this reason — computing it here would mean walking every logged set
 * and calling `@hybrid/engine`'s `e1rmOf`, which is the weight arithmetic a
 * screen is told not to do.
 *
 * The comment box is local, uncontrolled state. `Session` carries no field for
 * it and `machine.ts` has no action to write one, so there is nothing further
 * to wire up without inventing a place to put it — the prototype's own
 * textarea has no save path either.
 */
export function FinishCard({
  blocks,
  setsLogged,
  bestE1rm,
}: {
  /** `view.blocks.length` — every block the session had. */
  blocks: number;
  /** Sum of `view.blocks[i].progress.done` — working sets logged. */
  setsLogged: number;
  /** `view.bestE1rm`; null when no rated lift was logged today. */
  bestE1rm: number | null;
}) {
  const st = useLoggerStyles();
  const [comment, setComment] = useState('');

  return (
    <View style={st.finish}>
      <Text style={st.finishTitle}>Session done</Text>
      <Text style={st.finishSub}>nice work</Text>

      <View style={st.stats}>
        <Stat hook="blocks" label="Blocks" value={String(blocks)} />
        <Stat hook="sets" label="Sets logged" value={String(setsLogged)} />
        <Stat hook="e1rm" label="Best e1RM today" value={bestE1rm ? `${Math.round(bestE1rm)} kg` : '—'} />
      </View>

      <TextInput
        value={comment}
        onChangeText={setComment}
        multiline
        placeholder="How did that go? (optional)"
        accessibilityLabel="Session comments"
        style={st.comment}
      />
    </View>
  );
}

function Stat({ hook, label, value }: { hook: string; label: string; value: string }) {
  const st = useLoggerStyles();
  return (
    <View style={st.stat}>
      <Text style={st.statLabel}>{label}</Text>
      <Text testID={`fstat-${hook}`} style={st.statValue}>
        {value}
      </Text>
    </View>
  );
}
