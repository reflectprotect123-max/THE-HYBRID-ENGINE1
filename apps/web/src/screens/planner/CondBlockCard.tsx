import { CON_EFFORTS, condEffort, condEffortRpe, type CondBlock, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { Card, Chip, LetterChip } from '../../ui';

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
      <div className="flex items-center gap-1">
        <LetterChip letter="♥" />
        <span className="flex-1 text-5 font-[750]">{b.condFmt}</span>
      </div>
      <p className="mt-0.5 text-3 text-dim">
        {condEffort(b).name} · RPE {condEffortRpe(condEffort(b))} · {CON_EFFORTS[condEffort(b).key].cue}
      </p>
      {!readOnly ? (
        <>
          <div className="mt-1.5 flex flex-wrap gap-0.5">
            {FORMATS.map((f) => (
              <Chip key={f} on={b.condFmt === f} onClick={() => onFmt(f)}>
                {f}
              </Chip>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-0.5">
            {EFFORTS.map((e) => (
              <Chip key={e} on={b.effort === e} onClick={() => onEff(e)}>
                {CON_EFFORTS[e].name}
              </Chip>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}
