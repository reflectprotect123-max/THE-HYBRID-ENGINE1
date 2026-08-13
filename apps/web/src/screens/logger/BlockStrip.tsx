import type { BlockView } from '@hybrid/session-authoring';
import { cx } from '../../ui';

/*
 * The row of segments across the top of the logger — one per block in the
 * session, in the order `useSession`'s view already reports them. This file
 * decides nothing about progress or ordering: `BlockView.progress` is the
 * hook's own tally (working sets only, per `view.ts`'s `blockProgress`), and
 * this component only paints it.
 *
 * Mirrors `checks/fixtures/prototype/rolling-logger.html`'s `.strip`/`.seg`:
 * a fixed-height row of equal-width buttons, each an uppercase mono title
 * over a left-to-right fill.
 */
export function BlockStrip({
  blocks,
  currentIndex,
  onSelect,
}: {
  blocks: BlockView[];
  /** Index of the block currently on screen — passed straight through from
   *  `SessionView.blockIndex`; the shell keeps no mirror of it. */
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  if (!blocks.length) return null;

  return (
    <div className="flex gap-0.5 border-b border-line pb-1.5">
      {blocks.map((block, i) => {
        const current = i === currentIndex;
        const pct = block.progress.total > 0 ? Math.round((block.progress.done / block.progress.total) * 100) : 0;
        return (
          <button
            key={block.id}
            type="button"
            data-parity={`seg-${i}`}
            aria-current={current ? 'step' : undefined}
            onClick={() => onSelect(i)}
            className={cx(
              'relative h-3 flex-1 overflow-hidden rounded-sm border bg-panel px-0',
              current ? 'border-done-line' : 'border-line2',
            )}
          >
            <i
              aria-hidden
              className="absolute inset-y-0 left-0 border-r border-gold-line bg-gold-wash"
              style={{ width: `${pct}%` }}
            />
            <b
              className={cx(
                'num relative block truncate px-0.5 font-mono text-1 leading-3 font-[500] uppercase tracking-[.06em] not-italic',
                current ? 'text-gold2' : 'text-dim',
              )}
            >
              {block.title}
            </b>
          </button>
        );
      })}
    </div>
  );
}
