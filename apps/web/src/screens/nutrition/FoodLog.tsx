import { useMemo, useState } from 'react';
import { uid, ymd } from '@hybrid/engine';
import {
  MEALS,
  entriesForDay,
  groupByMeal,
  macroTotals,
  targetForDay,
  type FoodLogEntry,
  type MacroTotals,
} from '@hybrid/nutrition-core';
import { macroLine, round, titleCase } from '@hybrid/nutrition-adapter';
import { useNutrition } from '../../store/nutrition';
import { Button, Card, Chip, Empty, Field, Kicker, Meter, ScreenTitle, SectionHead, cx } from '../../ui';
import { blankDraft, dayLabel, draftOf, entryFromDraft, draftFields, shiftDay, type Draft } from './entry';

/*
 * One day of food, on the web.
 *
 * The same screen the phone app's Daily Log is, with the same rules, because it
 * is the same athlete's log:
 *
 *  - SNAPSHOT AT LOG TIME. What is stored is what the athlete typed. Nothing
 *    here re-derives a macro, now or on edit — see `entry.ts`.
 *  - DELETE IS A STAMP, NOT A REMOVAL. `mergeNutrition` is additive, so an
 *    entry spliced out of the array comes straight back from the phone on the
 *    next sync. `deletedAt` is how a deletion travels.
 *  - Forward navigation stops at today, as in the phone app and the reference:
 *    the adaptive engine only ever looks BACK from today, so food logged against
 *    a future date would be invisible to it and to the athlete.
 *
 * WHAT IS DELIBERATELY MISSING: barcode and nutrition-label capture. This is a
 * browser; there is no camera behind it, and the mobile scanner screens depend
 * on one. Rather than show a disabled "Scan" the screen says where scanning
 * lives, once, at the bottom — a promise the web cannot keep is worse than an
 * absence it explains.
 */

export function FoodLog() {
  const { nutrition, update, saveFailed, dataRecovered } = useNutrition();
  /* Read once per render, not memoised across one: this screen can sit open
     past midnight, and a cached "today" would start filing food against
     yesterday. */
  const today = ymd(new Date());
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Draft | null>(null);

  const entries = useMemo(() => entriesForDay(nutrition, date), [nutrition, date]);
  const totals = useMemo(() => macroTotals(entries), [entries]);
  const groups = useMemo(() => groupByMeal(entries, MEALS), [entries]);
  const target = targetForDay(nutrition.program, date);
  const atToday = date >= today;

  const commit = () => {
    if (!draft) return;
    const fields = draftFields(draft);
    if (!fields) return;
    const at = new Date().toISOString();
    update((n) => {
      const existing = draft.id ? n.logEntries.find((e) => e.id === draft.id) : undefined;
      if (existing) {
        // Edited IN PLACE. Rebuilding `logEntries` from a filter here is the
        // shape that drops every OTHER day's entries — reads may scope, writes
        // never filter.
        Object.assign(existing, fields, { meal: draft.meal, updatedAt: at });
        return;
      }
      const entry = entryFromDraft(draft, { id: uid(), logDate: date, at });
      if (!entry) return false;
      n.logEntries.push(entry);
    });
    setDraft(null);
  };

  const remove = (entry: FoodLogEntry) => {
    // Destructive, and it reaches every device — so it asks first, the same way
    // Home's workout delete and the phone app's entry delete do.
    if (!window.confirm(`Delete "${entry.displayName}"? This removes it from every device. It cannot be undone.`)) return;
    update((n) => {
      const live = n.logEntries.find((e) => e.id === entry.id);
      if (!live) return false;
      const at = new Date().toISOString();
      // Stamped, not spliced: see this file's header.
      live.deletedAt = at;
      live.updatedAt = at;
    });
  };

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>{date === today ? 'Today' : dayLabel(date)}</ScreenTitle>

      {dataRecovered ? (
        <p className="mt-1 rounded-md border border-bad bg-panel p-1.5 text-4 text-bad">
          Your food log couldn&apos;t be read and had to be reset. Your training data is unaffected — the two are stored
          separately.
        </p>
      ) : saveFailed ? (
        <p className="mt-1 rounded-md border border-bad bg-panel p-1.5 text-4 text-bad">
          The last save failed — usually a full disk. What you just logged may not survive a restart.
        </p>
      ) : null}

      <div className="mt-2 flex gap-1">
        <Button onClick={() => setDate(shiftDay(date, -1, ymd))} aria-label="Previous day">
          ‹ Previous
        </Button>
        {/* Named for the action, not the word on it: the screen title also
            reads "Today", and two identically-named things are two things a
            screen reader cannot tell apart. */}
        <Button className="flex-1" onClick={() => setDate(today)} disabled={date === today} aria-label="Jump to today">
          Today
        </Button>
        <Button onClick={() => setDate(shiftDay(date, 1, ymd))} disabled={atToday} aria-label="Next day">
          Next ›
        </Button>
      </div>

      <TotalsCard totals={totals} target={target} count={entries.length} />

      {draft ? (
        <EntryForm draft={draft} onChange={setDraft} onSave={commit} onCancel={() => setDraft(null)} />
      ) : (
        <Button variant="brass" size="lg" className="mt-2 w-full" onClick={() => setDraft(blankDraft('breakfast'))}>
          Add food
        </Button>
      )}

      {groups.length === 0 ? (
        <div className="mt-2">
          <Empty
            title="Nothing logged yet"
            body={
              date === today
                ? 'Add what you have eaten today and the totals fill in above.'
                : 'Nothing was logged against this day.'
            }
          />
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.meal}>
            <SectionHead
              title={titleCase(g.meal)}
              right={<span className="num text-3 text-muted">{round(macroTotals(g.entries).calories)} kcal</span>}
            />
            <Card>
              {g.entries.map((e, i) => (
                <div key={e.id} className={cx('flex items-center gap-1', i > 0 && 'mt-1.5 border-t border-line pt-1.5')}>
                  <button
                    onClick={() => setDraft(draftOf(e))}
                    aria-label={`Edit ${e.displayName}`}
                    className="min-w-0 flex-1 rounded-sm text-left"
                  >
                    <span className="block truncate text-5 font-[650] text-text">{e.displayName}</span>
                    <span className="num mt-0.5 block text-3 text-muted">{macroLine(e)}</span>
                  </button>
                  <button
                    onClick={() => remove(e)}
                    aria-label={`Delete ${e.displayName}`}
                    className="shrink-0 rounded-md border border-line2 bg-panel2 px-1 py-0.5 text-3 font-[650] text-muted"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </Card>
          </div>
        ))
      )}

      <p className="mt-2 text-3 text-dim">
        Barcode and nutrition-label scanning are on the phone app — they need a camera, and this is a browser.
      </p>
    </>
  );
}

function TotalsCard({ totals, target, count }: { totals: MacroTotals; target: MacroTotals | null; count: number }) {
  return (
    <Card tone="quiet" className="mt-2">
      <b className="num block text-8 font-[900] text-text">
        {round(totals.calories)}
        <span className="text-5 font-[500] text-muted"> kcal</span>
        {target ? <span className="num text-5 font-[500] text-muted"> of {round(target.calories)}</span> : null}
      </b>
      {target ? (
        <div className="mt-1">
          <Meter pct={(totals.calories / Math.max(1, target.calories)) * 100} />
        </div>
      ) : null}
      <div className="mt-1.5 flex">
        <MacroCell label="Protein" got={totals.proteinG} want={target?.proteinG} />
        <MacroCell label="Carbs" got={totals.carbsG} want={target?.carbsG} />
        <MacroCell label="Fat" got={totals.fatG} want={target?.fatG} />
      </div>
      {/* Absent, not zeroed. "0 of 0" would read as a target the athlete had
          been given and missed; the phone app's Coach tab is what sets one. */}
      {target ? null : (
        <p className="mt-1.5 text-3 text-dim">
          No target for this day yet — {count === 0 ? 'this is just what you log' : 'these are just your totals'}.
        </p>
      )}
    </Card>
  );
}

function MacroCell({ label, got, want }: { label: string; got: number; want?: number }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="block text-2 font-[750] uppercase tracking-[.12em] text-dim">{label}</span>
      <b className="num mt-0.5 block text-6 font-[650] text-text">
        {round(got)}
        {want == null ? 'g' : <span className="text-3 font-[500] text-muted">{` / ${round(want)}g`}</span>}
      </b>
    </div>
  );
}

/** Add or edit. One form for both, because the fields are identical. */
function EntryForm({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <Card tone="raised" className="mt-2">
      <p className="text-6 font-[750] text-text">{draft.id ? 'Edit entry' : 'Add food'}</p>
      <Field
        value={draft.displayName}
        onChange={(e) => set({ displayName: e.target.value })}
        placeholder="What did you eat?"
        aria-label="Food name"
        // The primitive is centred and tabular for numbers; a food name is
        // neither, so the two type rules are overridden and nothing else is.
        className="mt-1.5 text-left text-5 [font-variant-numeric:normal]"
      />
      <div className="mt-1.5 flex flex-wrap gap-0.5">
        {MEALS.map((m) => (
          <Chip key={m} on={draft.meal === m} onClick={() => set({ meal: m })}>
            {m}
          </Chip>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1">
        <NumCell label="kcal" value={draft.calories} onChange={(v) => set({ calories: v })} />
        <NumCell label="Protein g" value={draft.proteinG} onChange={(v) => set({ proteinG: v })} />
        <NumCell label="Carbs g" value={draft.carbsG} onChange={(v) => set({ carbsG: v })} />
        <NumCell label="Fat g" value={draft.fatG} onChange={(v) => set({ fatG: v })} />
      </div>
      <div className="mt-2 flex gap-1">
        <Button variant="brass" className="flex-1" onClick={onSave} disabled={!draft.displayName.trim()}>
          {draft.id ? 'Save' : 'Log it'}
        </Button>
        <Button className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="mt-1 text-3 text-dim">
        These numbers are stored as you type them and are never recalculated later.
      </p>
    </Card>
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
