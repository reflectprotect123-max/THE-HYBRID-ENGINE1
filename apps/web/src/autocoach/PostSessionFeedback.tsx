import { useState } from 'react';
import { ensureSharedCore } from '@hybrid/engine';
import { appendSharedCoreEvent } from '@hybrid/shared-core';
import { useDb } from '../store/db';
import { Button, Card, Chip } from '../ui';

/**
 * The short post-session moment: how hard it felt, a few honest tags, an
 * optional note. Same shared-core event pattern the pre-session check-in
 * uses — one fact per session, keyed so re-opening Recap never double-counts
 * it. This is deliberately not a survey: one slider, a handful of toggles,
 * one line of free text.
 */

const TAGS = [
  { key: 'too_hard', label: 'Too hard' },
  { key: 'too_easy', label: 'Too easy' },
  { key: 'low_energy', label: 'Low energy' },
  { key: 'time_limited', label: 'Time limited' },
  { key: 'loved_session', label: 'Loved it' },
] as const;

export type FeedbackTag = (typeof TAGS)[number]['key'];

const TAG_LABEL: Record<string, string> = Object.fromEntries(TAGS.map((t) => [t.key, t.label]));

export function PostSessionFeedback({ sessionId, kind }: { sessionId: string; kind?: 'strength' | 'conditioning' }) {
  const { db, update } = useDb();
  const migrated = ensureSharedCore(db);
  const existing = migrated.core?.events.find(
    (e) => e.type === 'post_session_feedback' && e.idempotencyKey === `feedback:${sessionId}`,
  );

  const [effort, setEffort] = useState(5);
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [note, setNote] = useState('');

  if (existing) {
    const p = existing.payload as { effort?: number; tags?: string[] };
    return (
      <Card className="flex items-baseline gap-1">
        <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">Feedback noted</span>
        <span className="text-3 text-muted">
          {p.effort != null ? `effort ${p.effort}` : 'saved'}
          {p.tags?.length ? ` · ${p.tags.map((t) => TAG_LABEL[t] ?? t).join(', ')}` : ''}
        </span>
      </Card>
    );
  }

  const toggleTag = (key: FeedbackTag) =>
    setTags((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]));

  const save = () => {
    const at = Date.now();
    update((draft) => {
      const core = ensureSharedCore(draft, at).core!;
      draft.core = appendSharedCoreEvent(core, {
        type: 'post_session_feedback',
        occurredAt: new Date(at).toISOString(),
        sourceDomain: kind || 'strength',
        idempotencyKey: `feedback:${sessionId}`,
        payload: { sessionId, effort, tags, note: note.trim() || undefined },
      });
    });
  };

  return (
    <Card className="flex flex-col gap-1">
      <span className="text-2 font-[750] uppercase tracking-[.14em] text-dim">How did it go?</span>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-3 text-text">Effort</span>
          <span className="num text-4 font-[750] text-gold2">{effort.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={effort}
          onChange={(e) => setEffort(Number(e.target.value))}
          aria-label="Session effort from 1 to 10"
          className="mt-0.5 w-full accent-[color:var(--color-gold2)]"
        />
      </div>

      <div className="flex flex-wrap gap-0.5">
        {TAGS.map((t) => (
          <Chip key={t.key} on={tags.includes(t.key)} onClick={() => toggleTag(t.key)}>
            {t.label}
          </Chip>
        ))}
      </div>

      <label className="block">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything else? Optional."
          className="h-5 w-full rounded-md border border-line bg-well px-1 text-4 outline-none focus:border-gold-line"
        />
      </label>

      <Button variant="brass" className="ml-auto" onClick={save}>
        Save feedback
      </Button>
    </Card>
  );
}
