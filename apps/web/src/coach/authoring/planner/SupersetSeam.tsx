import { cx } from '../../../ui';

/**
 * The chain BETWEEN two movements, not a row inside one: a superset is a
 * relationship, and drawing it as a property of the first exercise never said
 * which two. Dashed and quiet when they are separate, solid brass when they
 * flow on — the coach builder's Seam, same gesture on the athlete side.
 */
export function SupersetSeam({
  on,
  exName,
  nextName,
  onClick,
}: {
  on: boolean;
  exName: string;
  nextName: string;
  onClick: () => void;
}) {
  return (
    <div className="relative flex items-center justify-center py-0.5">
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line2" />
      <button
        onClick={onClick}
        role="switch"
        aria-checked={on}
        aria-label={on ? `Split the superset between ${exName} and ${nextName}` : `Superset ${exName} with ${nextName}`}
        title={on ? 'split them apart' : 'chain into a superset'}
        className={cx(
          'relative grid h-3 w-6 place-items-center rounded-pill border transition-colors duration-150',
          on
            ? 'border-gold text-on-accent [background:var(--brass)]'
            : 'border-dashed border-line2 bg-panel2 text-muted hover:border-gold-line hover:text-gold2',
        )}
      >
        <ChainIcon />
      </button>
    </div>
  );
}

/** Two interlocking links — the same gesture the coach builder uses for a chain. */
function ChainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M9.5 12h5" />
      <path d="M10 8.5H8a3.5 3.5 0 0 0 0 7h2" />
      <path d="M14 8.5h2a3.5 3.5 0 0 1 0 7h-2" />
    </svg>
  );
}
