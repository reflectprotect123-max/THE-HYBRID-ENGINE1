import { View } from 'react-native';
import {
  CON_FORMATS, CON_EFFORTS, condEffort, condEffortRpe, type CondBlock, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { Card, Chip, Ltr, T } from '../../ui';

const FORMATS: CondFmtKey[] = ['steady', 'intervals', 'tempo', 'free'];
const EFFORTS: EffortKey[] = ['easy', 'medium', 'hard'];

export function CondBlockCard({
  b,
  readOnly,
  onFmt,
  onEff,
}: {
  b: CondBlock;
  readOnly: boolean;
  onFmt: (f: CondFmtKey) => void;
  onEff: (e: EffortKey) => void;
}) {
  return (
    <Card>
      <View className="flex-row items-center gap-1">
        <Ltr>♥</Ltr>
        <T w="semi" className="flex-1 text-5 text-text">{CON_FORMATS[b.condFmt]?.name ?? b.condFmt}</T>
      </View>
      <T num className="mt-0.5 text-3 text-dim">
        {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {CON_EFFORTS[condEffort(b).key].cue}
      </T>
      {!readOnly ? (
        <>
          <View className="mt-1.5 flex-row flex-wrap gap-0.5">
            {FORMATS.map((f) => (
              <Chip key={f} on={b.condFmt === f} onPress={() => onFmt(f)}>
                {f}
              </Chip>
            ))}
          </View>
          <View className="mt-1 flex-row flex-wrap gap-0.5">
            {EFFORTS.map((e) => (
              <Chip key={e} on={b.effort === e} onPress={() => onEff(e)}>
                {CON_EFFORTS[e].name}
              </Chip>
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}
