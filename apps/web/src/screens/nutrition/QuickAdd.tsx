import { useState } from 'react';
import { MEALS, type IsoDate } from '@hybrid/nutrition-core';
import { uid, ymd } from '@hybrid/engine';
import { useNutrition } from '../../store/nutrition';
import { Button, Card, Chip, Field, Kicker, ScreenTitle } from '../../ui';
import { blankDraft, entryFromDraft, type Draft } from './entry';

/*
 * Quick add: macros with no food record behind them. The web counterpart to
 * mobile's `QuickAddScreen.tsx` — same rule (`entry_kind = 'quick_add'`, all
 * three provenance ids null), same "this is what still works with no
 * connection and no catalogue" role, but built from this app's own draft
 * pipeline (`entry.ts`'s `blankDraft`/`entryFromDraft`) rather than calling
 * `quickAddEntry` a second time, so a web quick add and a `FoodLog.tsx` quick
 * add stay the same write path.
 *
 * Takes `onDone`/`onCancel` rather than owning navigation itself: `Food.tsx`
 * is the composer that decides what "done" means (return to Search), the
 * same division mobile's `Food.tsx` uses when it opens this pane.
 */

export function QuickAdd({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { update } = useNutrition();
  const [draft, setDraft] = useState<Draft>(blankDraft('other'));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const trimmed = draft.displayName.trim();

  const save = () => {
    // An entry with no name is unreadable in the day's list and unfindable
    // later; the button is disabled on this too, this is the guard behind it.
    if (!trimmed) return;
    const at = new Date().toISOString();
    const logDate = ymd(new Date()) as IsoDate;
    const entry = entryFromDraft(draft, { id: uid(), logDate, at });
    if (!entry) return;
    update((n) => {
      n.logEntries.push(entry);
    });
    onDone();
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Quick add</ScreenTitle>
      <p className="mt-0.5 text-3 text-muted">
        Straight onto today, with no food record. Nothing here needs a connection.
      </p>

      <Card tone="raised" className="mt-2">
        <Field
          value={draft.displayName}
          onChange={(e) => set({ displayName: e.target.value })}
          placeholder="What did you eat?"
          aria-label="Name"
          className="text-left text-5 [font-variant-numeric:normal]"
        />
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {MEALS.map((m) => (
            <Chip key={m} on={draft.meal === m} onClick={() => set({ meal: m })}>
              {m}
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          <NumCell label="Calories" value={draft.calories} onChange={(v) => set({ calories: v })} />
          <NumCell label="Protein g" value={draft.proteinG} onChange={(v) => set({ proteinG: v })} />
          <NumCell label="Carbs g" value={draft.carbsG} onChange={(v) => set({ carbsG: v })} />
          <NumCell label="Fat g" value={draft.fatG} onChange={(v) => set({ fatG: v })} />
        </div>
        <div className="mt-2 flex gap-1">
          <Button variant="brass" className="flex-1" onClick={save} disabled={!trimmed}>
            Add to log
          </Button>
          <Button className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="mt-1 text-3 text-dim">
          These numbers are stored as you type them and are never recalculated later.
        </p>
      </Card>
    </>
  );
}

function NumCell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0">
      <span className="block text-2 font-[750] uppercase tracking-[.1em] text-dim">{label}</span>
      <Field
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        inputMode="decimal"
        className="mt-0.5 h-5 text-5"
      />
    </div>
  );
}
