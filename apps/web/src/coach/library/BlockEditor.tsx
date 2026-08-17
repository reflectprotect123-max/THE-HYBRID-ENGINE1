import { useRef, useState } from 'react';
import { CON_EFFORTS, CON_FORMATS } from '@hybrid/engine';
import type { EffortKey } from '@hybrid/engine';

/**
 * The block kinds a coach can add.
 *
 * `'Strength/Power'` was deleted from this list on 17 August 2026 along with
 * all strength authoring — see CLAUDE.md's "the fire-sale rebuild". The
 * mockup's own `BLOCK_CATEGORIES`, verbatim and in order, minus that one, plus
 * one the owner asked for on 12 August 2026: `Mixed modal`. It is a
 * conditioning block with no single modality and no interval structure — one
 * continuous effort, heart rate recorded start to finish, against a target
 * duration. Rest is not prescribed; the athlete's rest timer is there if they
 * want it.
 */
export const BLOCK_CATEGORIES = [
  'Conditioning',
  'Mixed modal',
  'Warm-up',
  'Cooldown',
  'Mobility',
] as const;

/** The categories that author a `CondBlock` rather than exercises and sets. */
export const CONDITIONING_CATEGORIES: readonly string[] = ['Conditioning', 'Mixed modal'];

/**
 * Every category that is not conditioning — a free-text description and
 * nothing else, since strength authoring (exercises, sets, supersets) was
 * deleted on 17 August 2026. A warm-up or cooldown is as often "5 min bike,
 * dynamic stretching" as it is a handful of named movements, and this is
 * where the coach writes that down.
 */
export const NOTE_CATEGORIES: readonly string[] = ['Warm-up', 'Cooldown', 'Mobility'];

/**
 * What a conditioning block holds. Every field maps onto one the engine's
 * `CondBlock` already has, so nothing here is a shape this app invented:
 * `minutes` and `targetDistanceM` are strings only because they are text
 * inputs mid-edit — `day-workout.ts` is where they become numbers, and where a
 * value that is not a number is dropped rather than stored as NaN.
 */
export interface CondValue {
  /** `CondFmtKey`. */
  fmt: string;
  /** `Modality`, or '' for mixed / unlabelled — which is what Mixed modal is. */
  modality: string;
  /** `EffortKey`. The engine derives the HR zone from it; the coach never picks a zone directly. */
  effort: string;
  minutes: string;
  targetDistanceM: string;
}

export const CONDITIONING_FORMATS = ['steady', 'intervals', 'tempo', 'free'] as const;
export const CONDITIONING_EFFORTS = ['easy', 'medium', 'hard'] as const;
export const CONDITIONING_MODALITIES = ['', 'row', 'run', 'ski', 'bike', 'air_bike'] as const;

/** A new block's conditioning defaults, which differ by category. */
export function newCondValue(category: string): CondValue {
  return category === 'Mixed modal'
    // Free: one continuous effort, no interval structure. No modality, because
    // "mixed" is precisely the absence of one — `types.ts` calls that
    // "unlabeled/general conditioning".
    ? { fmt: 'free', modality: '', effort: 'medium', minutes: '30', targetDistanceM: '' }
    : { fmt: 'steady', modality: '', effort: 'easy', minutes: '20', targetDistanceM: '' };
}

export interface BlockValue {
  id: string;
  category: string;
  /**
   * What the athlete sees this section called — "STRENGTH INTENSITY 1",
   * "FINISHER". Empty means the category is the name, which is what every
   * block said before templates existed.
   */
  heading?: string;
  /** Present only for a conditioning category; see `CONDITIONING_CATEGORIES`. */
  conditioning?: CondValue;
  /** The coach's free-text description; see `NOTE_CATEGORIES`. */
  note?: string;
}

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const Cross = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const ArrowUp = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const ArrowDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);

/**
 * One block of a session, as the mockup draws it: a head carrying the block's
 * number, its kind and a remove action, over a body holding either a
 * conditioning prescription or a free-text description.
 *
 * The block's number comes from its POSITION, not from stored state — the
 * mockup relabels every block on each change for the same reason. A stored
 * ordinal survives a deletion and starts lying.
 */
export function BlockEditor({
  block,
  index,
  startCollapsed = false,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  block: BlockValue;
  index: number;
  /**
   * Open the block closed. Only the day builder sets this, and only for the
   * blocks a TEMPLATE just laid down.
   */
  startCollapsed?: boolean;
  onChange: (next: BlockValue) => void;
  onRemove: () => void;
  /**
   * Reorder this block against its neighbours. Absent (rather than disabled)
   * at the first/last position — `DayBuilder` only passes the handler when
   * there is somewhere for the block to go, so there is nothing to explain
   * about why the button is greyed out.
   */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [expanded, setExpanded] = useState(!startCollapsed);
  /**
   * Section name / Kind, collapsed behind their own toggle rather than
   * always showing the moment a block is expanded.
   *
   * These are set once and rarely touched again — a coach expanding a block
   * is almost always there for the conditioning fields or the note.
   * Defaults to OPEN for a block the coach just added by hand
   * (`!startCollapsed`, same initial value as `expanded` itself) because that
   * block genuinely has nothing configured yet; defaults CLOSED for a
   * template-seeded block reopened later, since a template already set both.
   */
  const [metaOpen, setMetaOpen] = useState(!startCollapsed);
  const isConditioning = CONDITIONING_CATEGORIES.includes(block.category);
  const headingInputRef = useRef<HTMLInputElement>(null);

  /*
   * EVERY BLOCK'S HEADING IS EDITABLE — the field itself always was (it is
   * not gated on category, only on `expanded`), but a coach had no way to
   * REACH it from the collapsed head row except the unlabelled chevron. This
   * is the second, more direct way in: click the name itself, and land in
   * the field that renames it rather than just an opened block.
   */
  function openHeading() {
    setExpanded(true);
    setMetaOpen(true);
    // The field mounts on this same render; focusing it has to wait one tick.
    requestAnimationFrame(() => headingInputRef.current?.focus());
  }

  return (
    <div className={`cb-block${expanded ? '' : ' collapsed'}`}>
      <div className="cb-block-head">
        <button
          type="button"
          className="cb-block-collapse"
          aria-label={expanded ? 'Collapse block' : 'Expand block'}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown />
        </button>
        <span className="cb-block-eyebrow">BLOCK {String(index + 1).padStart(2, '0')}</span>
        {/*
          * THE HEAD CARRIES THE SECTION'S NAME, and it did not until 16 August
          * 2026 — it carried the kind dropdown, because before templates the
          * kind was the only thing a block had to say for itself. The kind is
          * still one control away, in the row underneath.
          */}
        <button type="button" className="cb-block-name" onClick={openHeading} title="Rename this block">
          {block.heading?.trim() || block.category}
        </button>
        {onMoveUp && (
          <button type="button" className="cb-block-move" aria-label="Move block up" onClick={onMoveUp}>
            <ArrowUp />
          </button>
        )}
        {onMoveDown && (
          <button type="button" className="cb-block-move" aria-label="Move block down" onClick={onMoveDown}>
            <ArrowDown />
          </button>
        )}
        <button type="button" className="cb-block-remove" aria-label="Remove block" onClick={onRemove}>
          <Cross />
        </button>
      </div>

      {/*
        * WHAT A SECTION IS CALLED, AND WHAT KIND IT IS.
        *
        * The name is separate from the kind — see `BlockValue.category` — so a
        * block can read as a section and still be a plain Warm-up block
        * underneath.
        */}
      {expanded && (
        <button
          type="button"
          className="cb-block-meta-toggle"
          aria-expanded={metaOpen}
          onClick={() => setMetaOpen((v) => !v)}
        >
          <ChevronDown />
          Block settings
          {!metaOpen && <span className="cb-block-meta-summary">{block.category}</span>}
        </button>
      )}

      {expanded && metaOpen && (
        <div className="cb-block-meta">
          <label className="cb-field-block">
            <span className="cal-field-label">
              Section name <span className="cb-optional-inline">optional</span>
            </span>
            <input
              ref={headingInputRef}
              type="text"
              className="cb-text-input"
              placeholder={block.category}
              value={block.heading ?? ''}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className="cb-field-block">
            <span className="cal-field-label">Kind</span>
            <select
              className="cb-text-input"
              aria-label="Block kind"
              value={block.category}
              onChange={(e) => {
                const category = e.target.value;
                /* Switching INTO a conditioning category seeds its defaults;
                   switching out drops them. Keeping a stale conditioning value
                   on a note block would round-trip a block the coach can no
                   longer see or edit. */
                const { conditioning: _drop, ...kept } = block;
                onChange(
                  CONDITIONING_CATEGORIES.includes(category)
                    ? { ...block, category, conditioning: block.conditioning ?? newCondValue(category) }
                    : { ...kept, category },
                );
              }}
            >
              {BLOCK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {expanded && isConditioning && (
        <div className="cb-block-body-wrap">
          <CondBlockFields
            value={block.conditioning ?? newCondValue(block.category)}
            mixed={block.category === 'Mixed modal'}
            onChange={(conditioning) => onChange({ ...block, conditioning })}
          />
        </div>
      )}

      {expanded && !isConditioning && (
        <div className="cb-block-body-wrap">
          <div className="cb-strength-body">
            {NOTE_CATEGORIES.includes(block.category) && (
              <label className="cb-field-block cb-block-note">
                <span className="cal-field-label">
                  Description <span className="cb-optional-inline">optional</span>
                </span>
                <textarea
                  className="cb-textarea"
                  placeholder="5 min bike, dynamic stretching…"
                  value={block.note ?? ''}
                  onChange={(e) => onChange({ ...block, note: e.target.value })}
                />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A conditioning block's prescription.
 *
 * Every control maps onto a field the engine's `CondBlock` already has, and
 * the coach picks an EFFORT rather than a heart-rate zone: `CON_EFFORTS` owns
 * that mapping, and letting a coach set a zone directly would make the two
 * disagree the moment either changed.
 *
 * A Mixed modal block hides the format and modality choices rather than
 * showing them greyed out — it IS free format with no single modality, and a
 * disabled control that can never change is a question the coach has to read
 * and dismiss every time.
 */
function CondBlockFields({
  value,
  mixed,
  onChange,
}: {
  value: CondValue;
  mixed: boolean;
  onChange: (next: CondValue) => void;
}) {
  const effort = CON_EFFORTS[(value.effort as EffortKey)] ?? CON_EFFORTS.easy;
  return (
    <div className="cb-cond-body">
      {mixed ? (
        <p className="cb-note">
          One continuous effort, heart rate recorded start to finish. No intervals and no prescribed
          rest — the rest timer is there if the athlete wants it.
        </p>
      ) : (
        <div className="cb-cond-row">
          <label className="cb-cond-field">
            <span className="cal-field-label">Format</span>
            <select
              className="rd-select"
              aria-label="Conditioning format"
              value={value.fmt}
              onChange={(e) => onChange({ ...value, fmt: e.target.value })}
            >
              {CONDITIONING_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {CON_FORMATS[f]?.name ?? f}
                </option>
              ))}
            </select>
          </label>
          <label className="cb-cond-field">
            <span className="cal-field-label">Modality</span>
            <select
              className="rd-select"
              aria-label="Modality"
              value={value.modality}
              onChange={(e) => onChange({ ...value, modality: e.target.value })}
            >
              {CONDITIONING_MODALITIES.map((m) => (
                <option key={m || 'mixed'} value={m}>
                  {m ? MODALITY_LABELS[m] : 'Mixed / any'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="cb-cond-row">
        <label className="cb-cond-field">
          <span className="cal-field-label">Effort</span>
          <select
            className="rd-select"
            aria-label="Effort"
            value={value.effort}
            onChange={(e) => onChange({ ...value, effort: e.target.value })}
          >
            {CONDITIONING_EFFORTS.map((e) => (
              <option key={e} value={e}>
                {CON_EFFORTS[e].name}
              </option>
            ))}
          </select>
        </label>
        <label className="cb-cond-field">
          <span className="cal-field-label">{mixed ? 'Target minutes' : 'Minutes'}</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            aria-label={mixed ? 'Target minutes' : 'Minutes'}
            value={value.minutes}
            onChange={(e) => onChange({ ...value, minutes: e.target.value })}
          />
        </label>
        <label className="cb-cond-field">
          <span className="cal-field-label">Target distance (m)</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            aria-label="Target distance in metres"
            placeholder="optional"
            value={value.targetDistanceM}
            onChange={(e) => onChange({ ...value, targetDistanceM: e.target.value })}
          />
        </label>
      </div>

      {/* The zone is DERIVED, so it is reported rather than offered. */}
      <p className="cb-note">
        {effort.name} · RPE {effort.rpe[0]}–{effort.rpe[1]} · {effort.cue} · heart-rate zone{' '}
        {effort.zone}
      </p>
    </div>
  );
}

const MODALITY_LABELS: Record<string, string> = {
  row: 'Row', run: 'Run', ski: 'Ski', bike: 'Bike', air_bike: 'Air bike',
};
