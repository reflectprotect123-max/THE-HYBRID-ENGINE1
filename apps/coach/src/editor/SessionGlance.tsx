import { isCond, type CoachSession } from '../model';
import { Field, MICRO } from '../ui';

/* The read-only count of what the coach has written. Split out of Editor.tsx. */

/**
 * What the coach has actually written, counted. Read-only and derived — it
 * makes no store call and adds no interaction; it is the kit's `.stat` trio
 * (three tabular numerals over micro-labels) doing the job a desktop tool's
 * sidecar exists for: telling you the shape of the thing without scrolling it.
 */
export function Glance({ sess }: { sess: CoachSession }) {
  let movements = 0;
  let sets = 0;
  let mins = 0;
  let hr = 0;
  for (const b of sess.blocks) {
    if (isCond(b)) {
      hr += 1;
      continue;
    }
    const m = parseInt(b.mins, 10);
    if (Number.isFinite(m)) mins += m;
    movements += b.ex.length;
    for (const e of b.ex) sets += e.sets.length;
  }

  const stat = 'rounded-md border border-line bg-panel3 px-1 py-1 text-center';
  return (
    <Field label="Session">
      <div className="grid grid-cols-3 gap-1">
        <div className={stat}>
          <b className="num block text-7 font-[900]">{movements}</b>
          <span className={MICRO}>Movements</span>
        </div>
        <div className={stat}>
          <b className="num block text-7 font-[900]">{sets}</b>
          <span className={MICRO}>Sets</span>
        </div>
        <div className={stat}>
          <b className="num block text-7 font-[900]">{hr}</b>
          <span className={MICRO}>HR</span>
        </div>
      </div>
      <p className="mt-1 text-2 text-dim">
        {mins
          ? `${sess.blocks.length} blocks · about ${mins} min of programmed work.`
          : `${sess.blocks.length} block${sess.blocks.length === 1 ? '' : 's'}. Give a block a duration and it shows up here.`}
      </p>
    </Field>
  );
}
