import { useState } from 'react';
import { BLOCK_CATEGORIES, BlockEditor, type BlockValue } from './BlockEditor';
import { SESSION_TEMPLATES, templateToBlocks } from './session-templates';

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
 * ONE component rather than three, so the half that matters — coach
 * instructions and the blocks — is built and fixed once. `mode` decides only
 * what wraps it: a date, a published status and Publish; a date and a Done
 * button; or neither and Save to library.
 *
 * THE HONESTY RULE. `publishWorkoutDraft` takes a PREFERRED start date and
 * PREFERRED weekdays and routes through the same Coordinator-placement path as
 * assigning a template. So a heading reading "Tuesday, August 11" beside a
 * Publish button implies a placement the coach has not made. `CoachAuthoring`
 * already refuses to blur this — it labels its day toggles "PREFERRED DAYS ·
 * INPUT, NOT PLACEMENT" — and the Calendar may not contradict its sibling
 * screen. The dated mode says so, in words, every time.
 *
 * `week` MODE IS THE ONE PLACE THAT NOTE WOULD BE FALSE, which is why it is a
 * mode rather than a flag on `dated`. It edits one day of a week the coach
 * PUBLISHES with `publish_coach_week` — a command that writes dated sessions
 * straight into the athlete's own weekly-plan row with `writer = 'coach'`, no
 * Coordinator in the path (see the coach-publishes-the-week design, and
 * CoachWeekBuilder.tsx). There the day IS the placement, so repeating "the
 * Coordinator resolves where this lands" would be the inaccurate half. It also
 * does not publish anything by itself: this editor hands the day back to the
 * week, and the week is published once, as a whole.
 */
export function DayBuilder({
  mode,
  date,
  published,
  initialValue,
  onPublish,
  onSave,
  onBack,
}: {
  mode: 'dated' | 'library' | 'week';
  date?: string;
  published: boolean;
  /**
   * The session already stored for this day, if there is one. Seeds the editor
   * ONCE, on mount — after that the coach's own edits are the truth, and
   * re-seeding from a prop would overwrite what they are typing. The store
   * hydrates synchronously (`store/db.tsx` reads it in a `useState`
   * initialiser), so there is no later arrival to wait for.
   */
  initialValue?: DayBuilderValue;
  /** Only `dated` mode has a Publish button, so only `dated` mode needs this. */
  onPublish?: (value: DayBuilderValue) => void;
  onSave: (value: DayBuilderValue) => void;
  onBack: () => void;
}) {
  const [instructions, setInstructions] = useState(initialValue?.instructions ?? '');
  const [blocks, setBlocks] = useState<BlockValue[]>(initialValue?.blocks ?? []);
  /* The ids a template just laid down, so those blocks open closed — see
     `BlockEditor`'s `startCollapsed`. Ids rather than an index, because
     removing a block renumbers every one after it. */
  const [fromTemplate, setFromTemplate] = useState<readonly string[]>([]);

  const value: DayBuilderValue = { instructions, blocks };
  const dated = mode === 'dated' && !!date;
  const weekly = mode === 'week' && !!date;

  /*
   * A TEMPLATE APPENDS. It never replaces what is already on the day.
   *
   * The alternative — clearing the day first — is one misclick away from
   * destroying a session a coach has been building, with no undo on this
   * screen. Appending is recoverable by removing blocks, which is a control
   * that already exists. The picker is only offered on an EMPTY day anyway,
   * so in practice the two behave the same; this is what happens when they
   * do not.
   */
  function applyTemplate(id: string) {
    const template = SESSION_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    setBlocks((prev) => {
      const added = templateToBlocks(template, prev.map((b) => b.id));
      setFromTemplate((ids) => [...ids, ...added.map((b) => b.id)]);
      return [...prev, ...added];
    });
  }

  function addBlock() {
    setBlocks((prev) => [
      ...prev,
      { id: `b${prev.length}-${prev.length ? prev[prev.length - 1].id : 'first'}`, category: BLOCK_CATEGORIES[0] },
    ]);
  }

  /*
   * REORDERING, UP OR DOWN ONE SLOT AT A TIME — a swap with the neighbour in
   * that direction.
   */
  function moveBlock(i: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div id="cal-session-builder" className="rd-content">
      <div className="cb-head">
        <button type="button" className="rd-back" onClick={onBack}>
          <ChevronLeft />
          {dated ? 'Back to calendar' : weekly ? 'Back to the week' : 'Back to library'}
        </button>
        <div className="cb-head-actions">
          {dated ? (
            <button type="button" className="lib-cta" onClick={() => onPublish?.(value)}>
              Publish session
            </button>
          ) : (
            <button type="button" className="lib-cta" onClick={() => onSave(value)}>
              {weekly ? 'Save this day' : 'Save to library'}
            </button>
          )}
        </div>
      </div>

      {weekly && (
        <>
          <h2 className="cb-title">{formatTitle(date)}</h2>
          <div className="cb-meta">
            <span>{date}</span>
            <span className={`cb-status${published ? ' published' : ''}`}>
              <span className="dot" />
              {published ? 'Published' : 'Not published'}
            </span>
          </div>
          {/* No "preferred day" note here, deliberately — see this component's
              header. A week published by `publish_coach_week` places its
              sessions on the dates the coach chose. */}
          <p className="cb-note">
            This day lands on <strong>{date}</strong> when the week is published. Saving it here
            changes the week you are building; it sends nothing on its own.
          </p>
        </>
      )}

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
          /*
            * The empty day is the only place a template is offered, because it
            * is the only place it is unambiguous. Once there are blocks, "start
            * from a template" is a question about what happens to them, and the
            * answer a coach expects is not one this screen can guess.
            */
          <div className="cb-templates">
            <p className="cb-note">Nothing on this day yet — start from a template, or add a block.</p>
            <ul className="cb-template-list">
              {SESSION_TEMPLATES.map((t) => (
                <li key={t.id}>
                  <button type="button" className="cb-template" onClick={() => applyTemplate(t.id)}>
                    <span className="cb-template-name">{t.name}</span>
                    <span className="cb-template-summary">{t.summary}</span>
                    <span className="cb-template-sections">
                      {t.sections.length} sections · {t.sections.reduce((a, s) => a + (Number(s.minutes) || 0), 0)} min
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="cb-note">
              A template lays out the sections. A conditioning section comes with defaults you can
              adjust; a Warm-up, Cooldown or Mobility section is yours to describe.
            </p>
          </div>
        ) : (
          blocks.map((b, i) => (
            <BlockEditor
              key={b.id}
              block={b}
              index={i}
              startCollapsed={fromTemplate.includes(b.id)}
              onChange={(next) => setBlocks((prev) => prev.map((x) => (x.id === b.id ? next : x)))}
              onRemove={() => setBlocks((prev) => prev.filter((x) => x.id !== b.id))}
              onMoveUp={i > 0 ? () => moveBlock(i, -1) : undefined}
              onMoveDown={i < blocks.length - 1 ? () => moveBlock(i, 1) : undefined}
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
