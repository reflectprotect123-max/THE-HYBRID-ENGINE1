import { useState, type KeyboardEvent } from 'react';
import { LIBRARY } from '../model';
import { IconCheck, WELL } from '../ui';

/* Choosing a movement by name. Split out of Editor.tsx. */

/**
 * The movement picker. The sheet is the concept mock's; the option rows are
 * 05-coach-06's `.c-menu`, which is the one place in this app where a
 * menu-shaped list actually exists.
 */
export function Picker({ current, onClose, onPick }: { current: string; onClose: () => void; onPick: (n: string) => void }) {
  const [q, setQ] = useState('');
  const list = LIBRARY.filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()));

  /*
   * Escape closes it. Declaring role="dialog" aria-modal="true" is a promise to
   * anyone using a keyboard or a screen reader that this behaves like a modal,
   * and a modal you can only leave by clicking the backdrop does not. The
   * backdrop click stays for the mouse; this is the other half.
   *
   * Bound on the wrapper rather than the document so it dies with the component
   * — a stray listener that closes a picker that is no longer open is its own
   * small bug.
   */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-3 pt-12"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a movement"
        className="w-full max-w-[460px] rounded-md border border-line2 bg-panel p-2 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-6 font-[800]">Choose a movement</h2>
        <p className="mt-0.5 text-3 text-dim">Search the library, or type any name.</p>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search movements, or type your own"
          aria-label="search movements"
          className={WELL + ' mt-1 h-5 w-full px-1.5 text-4'}
        />
        <ul className="mt-1 max-h-[46vh] overflow-y-auto">
          {q && !list.includes(q) ? (
            <li>
              <button
                onClick={() => onPick(q)}
                className="w-full rounded-sm px-1 py-1 text-left text-4 font-[650] text-gold2 hover:bg-panel2"
              >
                Use “{q}”
                <span className="block text-2 font-[500] text-dim">not in the library — add it anyway</span>
              </button>
            </li>
          ) : null}
          {list.map((n) => {
            const on = n === current;
            return (
              <li key={n}>
                <button
                  onClick={() => onPick(n)}
                  aria-current={on ? 'true' : undefined}
                  className={
                    'flex w-full items-center gap-1 rounded-sm px-1 py-1 text-left text-4 hover:bg-panel2 hover:text-gold2 ' +
                    (on ? 'font-[750] text-gold2' : '')
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{n}</span>
                  {on ? <IconCheck /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* --- small shared bits --- */
