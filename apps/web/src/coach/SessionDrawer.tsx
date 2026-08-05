import { useEffect } from 'react';
import type { Block, LoggedSet } from '@hybrid/engine';
import { useDb } from '../store/db';
import { cx } from '../ui';
import type { CellItem } from './projection';

function setSummary(sets: LoggedSet[]): string {
  if (sets.length === 0) return '—';
  const parts = sets.map((s) => {
    // Recorded values win; the authored target `t` is the fallback.
    const recorded = [s.aVal2, s.aVal].filter(Boolean).join('×');
    const base = recorded || s.t || '·';
    return s.rpe ? `${base}@${s.rpe}` : base;
  });
  return parts.join(' · ');
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'conditioning') {
    return (
      <section className="rounded border border-line bg-panel p-1">
        <h3 className="flex items-center gap-1 text-xs font-medium">
          <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-blue" />
          {block.heading || 'Conditioning'}
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          {[
            block.modality?.replace('_', ' '),
            String(block.condFmt ?? ''),
            block.effort && `effort: ${block.effort}`,
            block.minutes && `${block.minutes} min`,
            block.targetDistanceM && `${block.targetDistanceM} m`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </section>
    );
  }
  if (block.exercises === undefined) {
    // TextBlock — coach notes travel with the session.
    return (
      <section className="rounded border border-line bg-panel p-1 text-xs text-muted">
        {'text' in block ? String((block as { text?: string }).text ?? '') : null}
      </section>
    );
  }
  return (
    <section className="rounded border border-line bg-panel p-1">
      <h3 className="flex items-center gap-1 text-xs font-medium">
        <span
          aria-hidden
          className={cx('inline-block h-1 w-1 rounded-full', block.warmup ? 'bg-dim' : 'bg-gold')}
        />
        {block.heading || (block.warmup ? 'Warm-up' : 'Strength')}
        {block.superset && <span className="text-[10px] text-muted">superset</span>}
      </h3>
      <ul className="mt-0.5 space-y-0.5">
        {block.exercises.map((ex) => (
          <li key={ex.id} className="text-xs">
            <span className="text-text">{ex.name}</span>
            <span className="ml-1 tabular-nums text-muted">{setSummary(ex.sets)}</span>
            {ex.rest ? <span className="ml-1 text-[10px] text-dim">{ex.rest}s rest</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Read-only session peek. Opens over the grid — never navigates away from it.
 * Editing lands here in phase 2; the drawer's job in phase 1 is context.
 */
export function SessionDrawer({
  item,
  date,
  onClose,
}: {
  item: CellItem;
  date: string;
  onClose: () => void;
}) {
  const { workouts, sessions } = useDb();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const blocks: Block[] | undefined =
    item.source === 'logged'
      ? sessions.find((s) => s.id === item.id)?.blocks
      : workouts.find((w) => w.id === item.id)?.blocks;

  return (
    <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label={item.name}>
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[380px] flex-col border-l border-line2 bg-panel3 shadow-2xl">
        <header className="flex items-start gap-1 border-b border-line px-2 py-1">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-dim">
              {date} · {item.source === 'logged' ? (item.status ?? 'logged') : 'planned'}
            </div>
            <h2 className="truncate text-sm font-semibold">{item.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded px-1 py-0.5 text-xs text-muted hover:text-text"
          >
            Esc
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
          {blocks && blocks.length > 0 ? (
            blocks.map((b) => <BlockView key={b.id} block={b} />)
          ) : (
            <p className="p-1 text-xs text-muted">
              This {item.source === 'logged' ? 'session' : 'workout'} has no blocks yet.
            </p>
          )}
        </div>
        <footer className="border-t border-line px-2 py-1 text-[10px] text-dim">
          Read-only peek — editing arrives in phase 2.
        </footer>
      </aside>
    </div>
  );
}
