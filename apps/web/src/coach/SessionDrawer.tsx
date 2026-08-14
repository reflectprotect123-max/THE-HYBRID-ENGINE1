import { useEffect, useRef, useState } from 'react';
import {
  CON_EFFORT_KEYS,
  isCond,
  newBlock,
  newCondBlock,
  newEx,
  newSet,
  type Block,
  type CondBlock,
  type LoggedSet,
  type StrengthBlock,
  type Workout,
  tombstone,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { cx } from '../ui';
import { recordLedger } from './bench-store';
import { occurrenceKind } from './ops';
import type { CellItem } from './projection';

const MODALITIES = ['row', 'run', 'ski', 'bike', 'air_bike'] as const;
const FMTS = ['steady', 'intervals', 'tempo', 'custom', 'free'] as const;

function setSummary(sets: LoggedSet[]): string {
  if (sets.length === 0) return '—';
  return sets
    .map((s) => {
      const recorded = [s.aVal2, s.aVal].filter(Boolean).join('×');
      const base = recorded || s.t || '·';
      return s.rpe ? `${base}@${s.rpe}` : base;
    })
    .join(' · ');
}

function ReadBlock({ block }: { block: Block }) {
  if (isCond(block)) {
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
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </section>
    );
  }
  if (block.exercises === undefined) {
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

/* Compact editing controls — coach density, not the athlete's touch targets.
   These ARE the editor now: the "Full editor" escape hatch to `Planner` went
   with the old authoring chain on 14 August 2026, so anything deeper happens
   here or in `library/DayBuilder`. */
function EditCond({
  block,
  onChange,
  onRemove,
}: {
  block: CondBlock;
  onChange: (fn: (b: CondBlock) => void) => void;
  onRemove: () => void;
}) {
  return (
    <section className="rounded border border-line bg-panel p-1">
      <h3 className="flex items-center gap-1 text-xs font-medium">
        <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-blue" />
        Conditioning
        <button onClick={onRemove} className="ml-auto rounded px-0.5 text-[11px] text-dim hover:text-bad">
          remove
        </button>
      </h3>
      <div className="mt-0.5 flex flex-wrap items-center gap-0.5 text-xs">
        <select
          className="coach-input"
          value={block.modality ?? ''}
          aria-label="Modality"
          onChange={(e) => onChange((b) => { b.modality = (e.target.value || undefined) as CondBlock['modality']; })}
        >
          <option value="">modality…</option>
          {MODALITIES.map((m) => (
            <option key={m} value={m}>{m.replace('_', ' ')}</option>
          ))}
        </select>
        <select
          className="coach-input"
          value={block.condFmt}
          aria-label="Format"
          onChange={(e) => onChange((b) => { b.condFmt = e.target.value as CondBlock['condFmt']; })}
        >
          {FMTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <input
          className="coach-input w-7"
          value={String(block.minutes ?? '')}
          inputMode="numeric"
          aria-label="Minutes"
          placeholder="min"
          onChange={(e) => onChange((b) => { b.minutes = e.target.value; })}
        />
        <select
          className="coach-input"
          value={block.effort ?? 'medium'}
          aria-label="Effort"
          onChange={(e) => onChange((b) => { b.effort = e.target.value as CondBlock['effort']; })}
        >
          {CON_EFFORT_KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

function EditStrength({
  block,
  onChange,
  onRemove,
}: {
  block: StrengthBlock;
  onChange: (fn: (b: StrengthBlock) => void) => void;
  onRemove: () => void;
}) {
  return (
    <section className="rounded border border-line bg-panel p-1">
      <h3 className="flex items-center gap-1 text-xs font-medium">
        <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-gold" />
        {block.warmup ? 'Warm-up' : 'Strength'}
        <button onClick={onRemove} className="ml-auto rounded px-0.5 text-[11px] text-dim hover:text-bad">
          remove
        </button>
      </h3>
      <div className="mt-0.5 space-y-0.5">
        {block.exercises.map((ex, xi) => (
          <div key={ex.id} className="flex flex-wrap items-center gap-0.5">
            <input
              className="coach-input w-[140px]"
              value={ex.name}
              aria-label="Exercise name"
              placeholder="Exercise"
              onChange={(e) => onChange((b) => { b.exercises[xi]!.name = e.target.value; })}
            />
            <span className="flex flex-wrap items-center gap-0.5">
              {ex.sets.map((s, si) => (
                <span
                  key={si}
                  className="inline-flex items-center gap-[2px] rounded-full border border-line bg-well px-0.5 text-[11px] tabular-nums"
                >
                  <input
                    className="w-4 bg-transparent text-center outline-none"
                    value={s.t}
                    aria-label="Target"
                    onChange={(e) => onChange((b) => { b.exercises[xi]!.sets[si]!.t = e.target.value; })}
                  />
                  <span className="text-dim">@</span>
                  <input
                    className="w-3 bg-transparent text-center outline-none"
                    value={s.rpe}
                    aria-label="RPE"
                    onChange={(e) => onChange((b) => { b.exercises[xi]!.sets[si]!.rpe = e.target.value; })}
                  />
                  <button
                    aria-label="Remove set"
                    className="px-[2px] text-dim hover:text-bad"
                    onClick={() => onChange((b) => { b.exercises[xi]!.sets.splice(si, 1); })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                className="rounded px-0.5 text-[11px] text-dim outline outline-1 outline-line hover:text-gold2"
                onClick={() => onChange((b) => {
                  const sets = b.exercises[xi]!.sets;
                  const last = sets[sets.length - 1];
                  sets.push(last ? { ...last } : newSet());
                })}
              >
                + set
              </button>
            </span>
            <button
              aria-label="Remove exercise"
              className="rounded px-0.5 text-[11px] text-dim hover:text-bad"
              onClick={() => onChange((b) => { b.exercises.splice(xi, 1); })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="rounded px-0.5 text-[11px] text-dim outline outline-1 outline-line hover:text-gold2"
          onClick={() => onChange((b) => { b.exercises.push(newEx()); })}
        >
          + exercise
        </button>
      </div>
    </section>
  );
}

/**
 * Session peek and, for planned workouts, the phase-2 editor. Logged
 * sessions stay read-only: history is evidence. Edits write through the
 * same db.update path the athlete Planner uses.
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
  const { workouts, sessions, update } = useDb();
  const [renaming, setRenaming] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* One ledger entry per editing visit, not one per keystroke. */
  useEffect(
    () => () => {
      if (dirty.current) recordLedger('coach', `Edited “${item.name}” (${date})`);
    },
    [item.name, date],
  );

  const workout = item.source === 'planned' ? workouts.find((w) => w.id === item.id) : undefined;
  const session = item.source === 'logged' ? sessions.find((s) => s.id === item.id) : undefined;
  const editable = !!workout;
  const blocks = workout?.blocks ?? session?.blocks;
  const recurring = workout ? occurrenceKind(workout, date) === 'recurring' : false;

  const edit = (fn: (draft: Workout) => void) => {
    dirty.current = true;
    update((draft) => {
      const t = draft.workouts.find((x) => x.id === item.id);
      if (!t) return false;
      fn(t);
      t.updatedAt = Date.now();
    });
  };

  const removeFromDate = () => {
    update((draft) => {
      const t = draft.workouts.find((x) => x.id === item.id);
      if (!t) return false;
      if (occurrenceKind(t, date) === 'oneoff') {
        t.dates = (t.dates ?? []).filter((d) => d !== date);
        t.updatedAt = Date.now();
        if (!t.dates.length && !t.days?.length && t.blocks.length === 0) {
          draft.workouts.splice(draft.workouts.indexOf(t), 1);
          tombstone(draft, t.id);
        }
      } else {
        // Recurring: there is no per-date exclusion in the schema (deferred
        // design), so the honest operation is removing the whole slot.
        draft.workouts.splice(draft.workouts.indexOf(t), 1);
        tombstone(draft, t.id);
      }
    });
    dirty.current = false;
    recordLedger('coach', recurring ? `Deleted “${item.name}” (all occurrences)` : `Removed “${item.name}” from ${date}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label={item.name}>
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-line2 bg-panel3 shadow-2xl">
        <header className="flex items-start gap-1 border-b border-line px-2 py-1">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-dim">
              {date} · {item.source === 'logged' ? (item.status ?? 'logged') : recurring ? 'planned — repeats weekly' : 'planned'}
            </div>
            {editable ? (
              <input
                className="coach-input mt-[1px] w-full max-w-[280px] text-sm font-semibold"
                value={renaming ?? workout!.name ?? ''}
                aria-label="Session name"
                placeholder="Session name"
                onChange={(e) => setRenaming(e.target.value)}
                onBlur={() => {
                  if (renaming !== null && renaming !== workout!.name) edit((w) => { w.name = renaming; });
                  setRenaming(null);
                }}
              />
            ) : (
              <h2 className="truncate text-sm font-semibold">{item.name}</h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded px-1 py-0.5 text-xs text-muted hover:text-text"
          >
            Esc
          </button>
        </header>

        {recurring && (
          <p className="border-b border-line bg-panel px-2 py-0.5 text-[11px] text-warn">
            This workout repeats weekly — edits here change every future occurrence.
          </p>
        )}

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
          {blocks && blocks.length > 0 ? (
            blocks.map((b, bi) =>
              editable ? (
                isCond(b) ? (
                  <EditCond
                    key={b.id}
                    block={b}
                    onChange={(fn) => edit((w) => { const t = w.blocks[bi]; if (t && isCond(t)) fn(t); })}
                    onRemove={() => edit((w) => { w.blocks.splice(bi, 1); })}
                  />
                ) : b.exercises !== undefined ? (
                  <EditStrength
                    key={b.id}
                    block={b}
                    onChange={(fn) => edit((w) => { const t = w.blocks[bi]; if (t && t.exercises !== undefined) fn(t); })}
                    onRemove={() => edit((w) => { w.blocks.splice(bi, 1); })}
                  />
                ) : (
                  <ReadBlock key={b.id} block={b} />
                )
              ) : (
                <ReadBlock key={b.id} block={b} />
              ),
            )
          ) : (
            <p className="p-1 text-xs text-muted">
              This {item.source === 'logged' ? 'session' : 'workout'} has no blocks yet.
            </p>
          )}
          {editable && (
            <div className="flex gap-1">
              <button
                className="rounded px-1 py-0.5 text-[11px] text-dim outline outline-1 outline-line hover:text-gold2"
                onClick={() => {
                  // A strength workout's blocks may never contain a CondBlock —
                  // the engine splits mixed workouts. Respect that boundary here.
                  edit((w) => { w.blocks.push(newBlock()); if (!w.kind) w.kind = 'strength'; });
                }}
                disabled={workout?.kind === 'conditioning'}
                title={workout?.kind === 'conditioning' ? 'This is a conditioning workout' : undefined}
              >
                + strength block
              </button>
              <button
                className="rounded px-1 py-0.5 text-[11px] text-dim outline outline-1 outline-line hover:text-gold2"
                onClick={() => edit((w) => { w.blocks.push(newCondBlock()); if (!w.kind) w.kind = 'conditioning'; })}
                disabled={workout?.kind === 'strength'}
                title={workout?.kind === 'strength' ? 'This is a strength workout' : undefined}
              >
                + conditioning block
              </button>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-2 py-1 text-[10px] text-dim">
          {editable ? (
            <>
              <button onClick={removeFromDate} className="hover:text-bad">
                {recurring ? 'Delete workout (all occurrences)' : 'Remove from this day'}
              </button>
              {/* "Full editor" opened `/coach/planner/:id`, deleted with the
                  rest of the old authoring chain on 14 August 2026. This
                  drawer edits blocks inline and saves as you type, so the
                  button was an escape hatch to a second editor rather than the
                  only way to do the work. */}
              <span className="ml-auto">Edits save as you type.</span>
            </>
          ) : (
            'Logged history is evidence — it is not editable from the bench.'
          )}
        </footer>
      </aside>
    </div>
  );
}
