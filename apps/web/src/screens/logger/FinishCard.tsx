import { useState } from 'react';
import { Card } from '../../ui';

/*
 * The session receipt — the prototype's `finishHtml()`.
 *
 * Every number here is a prop: this file formats what it is handed and
 * derives nothing from a raw `Session` itself. `blocks` and `setsLogged`
 * come from `useSession`'s own `view.blocks` (`BlockView.progress`, already
 * tallied by the package); `bestE1rm` does not — `SessionView` has no field
 * for it today, and deriving one means walking every exercise's logged sets
 * and calling `@hybrid/engine`'s `e1rmOf`, the same file that owns the
 * coaching fold. That is exactly the "weight arithmetic" a screen is told
 * not to do, so this file was NOT given a way to compute it: the caller
 * passes `null` when it has nothing better, and this card renders the same
 * "—" fallback the prototype uses for a day with no rated lift. See the
 * task report for the recommendation that `session-authoring` grow a real
 * stats export instead.
 *
 * The comment box is local, uncontrolled state — the prototype's own
 * `<textarea>` has no save path either; `Session` carries no field for it
 * and `machine.ts` has no action to write one, so there is nothing further
 * for this card to wire up without inventing a place to put it.
 */
export function FinishCard({
  blocks,
  setsLogged,
  bestE1rm,
}: {
  /** `view.blocks.length` — every block the session had, not only strength ones. */
  blocks: number;
  /** Sum of `view.blocks[i].progress.done` — working sets logged, package-tallied. */
  setsLogged: number;
  /** `null` when the view has nothing to report — see the file header. */
  bestE1rm: number | null;
}) {
  const [comment, setComment] = useState('');

  return (
    <Card className="mb-1.5 text-center">
      <p className="text-7 font-[750]">Session done</p>
      <p className="mt-0.25 text-4 text-muted">nice work</p>

      <div className="mt-1.5 divide-y divide-line border-t border-b border-line text-left">
        <Stat label="Blocks" value={String(blocks)} />
        <Stat label="Sets logged" value={String(setsLogged)} />
        <Stat label="Best e1RM today" value={bestE1rm ? `${Math.round(bestE1rm)} kg` : '—'} />
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="How did that go? (optional)"
        aria-label="Session comments"
        className="num mt-1.5 min-h-[68px] w-full resize-none rounded-md border border-line bg-well px-1 py-0.5 text-4 text-text outline-none focus:border-gold-line"
      />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-4">
      <span className="text-dim">{label}</span>
      <b data-parity={`fstat-${label === 'Blocks' ? 'blocks' : label === 'Sets logged' ? 'sets' : 'e1rm'}`} className="num font-mono text-text">
        {value}
      </b>
    </div>
  );
}
