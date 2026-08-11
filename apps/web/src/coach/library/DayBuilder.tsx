import { useState } from 'react';
import type { CatalogueEntry } from '@hybrid/engine';
import { BlockEditor, type BlockValue } from './BlockEditor';

export interface DayBuilderValue {
  instructions: string;
  blocks: BlockValue[];
}

/** "Tuesday, August 11" — the mockup's `formatTitle`. */
function formatTitle(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const ChevronLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

/**
 * The coach's authoring screen for one session, in two modes.
 *
 * ONE component rather than two, so the half that matters — coach instructions
 * and the blocks — is built and fixed once. `mode` decides only what wraps it:
 * a date, a published status and Publish, or neither and Save to library.
 *
 * THE HONESTY RULE. `publishWorkoutDraft` takes a PREFERRED start date and
 * PREFERRED weekdays and routes through the same Coordinator-placement path as
 * assigning a template. So a heading reading "Tuesday, August 11" beside a
 * Publish button implies a placement the coach has not made. `CoachAuthoring`
 * already refuses to blur this — it labels its day toggles "PREFERRED DAYS ·
 * INPUT, NOT PLACEMENT" — and the Calendar may not contradict its sibling
 * screen. The dated mode says so, in words, every time.
 */
export function DayBuilder({
  mode,
  date,
  published,
  entries,
  onPublish,
  onSave,
  onBack,
}: {
  mode: 'dated' | 'library';
  date?: string;
  published: boolean;
  entries: CatalogueEntry[];
  onPublish: (value: DayBuilderValue) => void;
  onSave: (value: DayBuilderValue) => void;
  onBack: () => void;
}) {
  const [instructions, setInstructions] = useState('');
  const [blocks, setBlocks] = useState<BlockValue[]>([]);

  const value: DayBuilderValue = { instructions, blocks };
  const dated = mode === 'dated' && !!date;

  function addBlock() {
    setBlocks((prev) => [
      ...prev,
      { id: `b${prev.length}-${prev.length ? prev[prev.length - 1].id : 'first'}`, category: 'Strength/Power', exercises: [] },
    ]);
  }

  return (
    <div id="cal-session-builder" className="rd-content">
      <div className="cb-head">
        <button type="button" className="rd-back" onClick={onBack}>
          <ChevronLeft />
          {dated ? 'Back to calendar' : 'Back to library'}
        </button>
        <div className="cb-head-actions">
          {dated ? (
            <button type="button" className="lib-cta" onClick={() => onPublish(value)}>
              Publish session
            </button>
          ) : (
            <button type="button" className="lib-cta" onClick={() => onSave(value)}>
              Save to library
            </button>
          )}
        </div>
      </div>

      {dated && (
        <>
          <h2 className="cb-title">{formatTitle(date)}</h2>
          <div className="cb-meta">
            <span>{date}</span>
            <span className={`cb-status${published ? ' published' : ''}`}>
              <span className="dot" />
              {published ? 'Published' : 'Unpublished'}
            </span>
          </div>
          <p className="cb-note">
            This is a <strong>preferred day</strong>, not a placement — the Coordinator resolves where
            the session actually lands in the week.
          </p>
        </>
      )}

      <label className="cb-instructions">
        <span className="cal-field-label">Coach instructions</span>
        <textarea
          aria-label="Coach instructions"
          placeholder="Use this area to help the athlete understand goals for today's session."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>

      <div className="cb-blocks">
        {blocks.length === 0 ? (
          <p className="cb-note">Nothing on this day yet — add a block to start.</p>
        ) : (
          blocks.map((b, i) => (
            <BlockEditor
              key={b.id}
              block={b}
              entries={entries}
              index={i}
              onChange={(next) => setBlocks((prev) => prev.map((x) => (x.id === b.id ? next : x)))}
              onRemove={() => setBlocks((prev) => prev.filter((x) => x.id !== b.id))}
            />
          ))
        )}
      </div>

      <div className="cb-add-row">
        <button type="button" className="cb-add-btn primary" onClick={addBlock}>
          + Add block
        </button>
        {/* The mockup defers this itself; the note is its own wording. */}
        <button
          type="button"
          className="cb-add-btn ghost"
          disabled
          title="Multiple sessions in one day are not supported yet"
        >
          + Add new session
        </button>
        <p className="cb-note">
          Multiple sessions in one day is next on the list — for now this day holds one.
        </p>
      </div>
    </div>
  );
}
