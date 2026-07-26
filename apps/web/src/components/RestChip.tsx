import { useRest } from '../store/rest';
import { fmtRest } from '@hybrid/engine';
import { Ring } from '../ui';

/**
 * The floating rest clock.
 *
 * It follows you off the logger stage so leaving the exercise to check
 * something doesn't cost you the timer. It is deliberately NOT shown while the
 * stage is already showing its own in-place rest panel — two clocks counting
 * the same rest is how you end up not trusting either.
 */
export function RestChip({ hidden = false }: { hidden?: boolean }) {
  const { running, left, frac, add, stop } = useRest();
  if (!running || hidden) return null;

  return (
    <div className="pointer-events-auto fixed bottom-[calc(72px+env(safe-area-inset-bottom)+8px)] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-pill border border-gold-line bg-panel2/95 py-0.5 pr-1 pl-0.5 shadow-lift backdrop-blur">
      <Ring frac={frac} size={40} stroke={4} color="var(--color-gold2)">
        <span className="num text-2 font-[800] text-gold2">{fmtRest(left)}</span>
      </Ring>
      <button
        onClick={() => add(15)}
        className="h-4 rounded-pill border border-line2 px-1 text-3 font-[650] text-muted hover:text-text"
      >
        +15s
      </button>
      <button
        onClick={stop}
        className="h-4 rounded-pill px-1 text-3 font-[650] text-dim hover:text-text"
      >
        Skip
      </button>
    </div>
  );
}
