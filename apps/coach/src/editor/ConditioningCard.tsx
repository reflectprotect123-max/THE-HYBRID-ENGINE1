import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, condEffortRpe, fmtDistance, type CondFmtKey, type EffortKey } from '@hybrid/engine';
import { IconRight, IconUp, Ltr, MICRO } from '../ui';

/*
 * One conditioning block, as a card. Split out of Editor.tsx.
 *
 * `Pill` lives here because this card is its only caller.
 */

export function CondCard({
  fmt,
  eff,
  targetDistanceM,
  open,
  onToggle,
  onFmt,
  onEff,
  onTargetDistance,
}: {
  fmt: CondFmtKey;
  eff: EffortKey;
  targetDistanceM?: number;
  open: boolean;
  onToggle: () => void;
  onFmt: (v: CondFmtKey) => void;
  onEff: (v: EffortKey) => void;
  onTargetDistance: (v: number | undefined) => void;
}) {
  const label = CON_FORMATS[fmt].name;
  const sum = `${CON_EFFORTS[eff].name} · ${CON_EFFORTS[eff].cue} · runs by heart rate${targetDistanceM ? ` · Target ${fmtDistance(targetDistanceM)}` : ''}`;

  return (
    <section
      className={
        'overflow-hidden rounded-md border bg-panel shadow-card ' + (open ? 'border-zone-green/40' : 'border-line')
      }
    >
      <button onClick={onToggle} className="flex w-full items-center gap-1 bg-panel2 px-1.5 py-1 text-left">
        <Ltr cond>♥</Ltr>
        <span className="min-w-0 flex-1">
          <b className="block text-5 font-[750]">{label}</b>
          <span className="block truncate text-3 text-muted">{sum}</span>
        </span>
        <span className="shrink-0 text-dim" aria-hidden="true">
          {open ? <IconUp /> : <IconRight />}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-line p-2">
          <div>
            <div className={MICRO + ' mb-1'}>Format</div>
            <div className="flex flex-wrap gap-1">
              {CON_FORMAT_KEYS.map((k) => (
                <Pill key={k} on={k === fmt} onClick={() => onFmt(k)}>
                  {CON_FORMATS[k].name}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <div className={MICRO + ' mb-1'}>Effort</div>
            <div className="flex flex-wrap gap-1">
              {CON_EFFORT_KEYS.map((k) => (
                <Pill key={k} on={k === eff} onClick={() => onEff(k)} zone={k}>
                  {CON_EFFORTS[k].name}
                  <i className="ml-0.5 text-1 font-[650] not-italic opacity-70">RPE {condEffortRpe(CON_EFFORTS[k])}</i>
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <div className={MICRO + ' mb-1'}>Target distance (optional)</div>
            <input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={targetDistanceM ? String(targetDistanceM / 1000) : ''}
              onChange={(e) => {
                const km = parseFloat(e.target.value);
                onTargetDistance(Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : undefined);
              }}
              placeholder="5"
              aria-label="target distance in kilometres"
              className="h-4 w-20 rounded-sm border border-line2 bg-panel3 px-1 text-3 outline-none focus:border-gold-line"
            />
            <span className="ml-1 text-2 text-dim">km</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 03-shared-02's chip. The effort variants take the HR zone inks the concept
 * mock gives them — those colours are meaning-bearing, so easy/medium/hard read
 * the same here as they do on the athlete's zone bars.
 */
function Pill({
  on,
  onClick,
  children,
  zone,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  zone?: EffortKey;
}) {
  const lit =
    zone === 'easy'
      ? 'border-zone-blue bg-zone-blue/10 text-zone-blue'
      : zone === 'medium'
        ? 'border-zone-green bg-zone-green/10 text-zone-green'
        : zone === 'hard'
          ? 'border-zone-red bg-zone-red/10 text-zone-red'
          : 'border-done-line bg-done-bg text-done-ink';
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={
        'inline-flex h-4 items-center rounded-pill border px-1.5 text-2 font-[750] tracking-[.06em] uppercase transition-colors duration-150 ' +
        (on ? lit : 'border-line2 bg-panel2 text-muted hover:border-gold-line hover:text-gold2')
      }
    >
      {children}
    </button>
  );
}
