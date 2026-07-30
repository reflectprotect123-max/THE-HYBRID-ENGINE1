import { MODE_KEYS, MODES, type ModeKey } from '@hybrid/engine';
import { BRASS, MICRO, WELL } from '../../ui';
import { fmtRest } from '../../model';

export function MoreStep({
  rest,
  tempo,
  mode,
  note,
  metcon = false,
  onChange,
  onDone,
}: {
  rest: number;
  tempo: string;
  mode: ModeKey;
  note: string;
  /** A metcon is a TextBlock — its body text is the ONLY thing it stores, so
   *  the rest/mode/tempo fields (which have nowhere to go) are not shown. */
  metcon?: boolean;
  onChange: (patch: { rest?: number; tempo?: string; mode?: ModeKey; note?: string }) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 p-3">
      <h1 className="text-8 font-[800]">Anything else? (optional)</h1>
      <div className="flex w-full max-w-[360px] flex-col gap-2">
        {metcon ? null : (<>
        <label className="flex flex-col gap-0.5">
          <span className={MICRO + ' flex items-center justify-between'}>
            Rest (seconds)
            <span className="num text-3 text-dim">{fmtRest(rest)}</span>
          </span>
          <input
            type="number"
            value={rest || ''}
            onChange={(e) => onChange({ rest: parseInt(e.target.value, 10) || 0 })}
            className={WELL + ' px-1 py-1 text-4'}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={MICRO}>Mode</span>
          <select value={mode} onChange={(e) => onChange({ mode: e.target.value as ModeKey })} className={WELL + ' px-1 py-1 text-4'}>
            {MODE_KEYS.map((m) => (
              <option key={m} value={m}>{MODES[m].label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={MICRO}>Tempo</span>
          <input value={tempo} onChange={(e) => onChange({ tempo: e.target.value })} placeholder="3-1-1-0" className={WELL + ' px-1 py-1 text-4'} />
        </label>
        </>)}
        <label className="flex flex-col gap-0.5">
          <span className={MICRO}>{metcon ? 'The session, as the athlete reads it' : 'Note for the athlete'}</span>
          <textarea value={note} onChange={(e) => onChange({ note: e.target.value })} rows={3} className={WELL + ' resize-y px-1 py-1 text-4'} />
        </label>
      </div>
      <button onClick={onDone} disabled={metcon && !note.trim()} className={BRASS + ' mt-2'}>
        Done
      </button>
    </div>
  );
}
