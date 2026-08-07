import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
/* `uid` and `ymd` only: a random id and "what is today's local date" are
   calendar/identity utilities, not training logic. Re-implementing `ymd` here
   is how the two worlds end up disagreeing about which day it is at 11pm on a
   DST weekend, which would file a meal against the wrong date. */
import { uid, ymd } from '@hybrid/engine';
import {
  MEALS,
  applyManualMacroEdit,
  entriesForDay,
  groupByMeal,
  macroTotals,
  quickAddEntry,
  targetForDay,
  type FoodLogEntry,
  type MacroTotals,
} from '@hybrid/nutrition-core';
import { useNutrition } from '../../store/nutrition';
import { Btn, Card, Empty, Input, Kicker, Meter, Screen, SectionHead, T, Tap, Title } from '../../ui';
import { MealChips, NumField, macro, round, titleCase } from './fields';

/*
 * The nutrition world's home screen: one day of food.
 *
 * Behaviour ported from MacroTrack's DailyLogScreen.kt — day at a time,
 * forward navigation stopped at today, totals above the entries, a destructive
 * confirm on delete. The look is this repository's: the same `Card`, `Chip`,
 * `Meter` and `T` every training screen is built from.
 *
 * Two rules this screen exists to keep:
 *
 *  - SNAPSHOT AT LOG TIME. What is stored on an entry is what the athlete ate.
 *    Every write below copies the numbers in front of the athlete onto the
 *    record; nothing here re-derives a macro from `foodId`, now or on edit.
 *  - DELETE IS A STAMP, NOT A REMOVAL. `mergeNutrition` is additive, so an
 *    entry spliced out of the array comes straight back from the other device
 *    on the next sync. `deletedAt` is how a deletion travels.
 */

/** What the entry sheet is holding. Strings, because they come from TextInputs. */
interface Draft {
  /** Empty for a new entry; the entry's own id when editing one. */
  id: string;
  displayName: string;
  meal: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

const blankDraft = (meal: string): Draft => ({
  id: '',
  displayName: '',
  meal,
  calories: '',
  proteinG: '',
  carbsG: '',
  fatG: '',
});

const draftOf = (e: FoodLogEntry): Draft => ({
  id: e.id,
  displayName: e.displayName,
  meal: e.meal,
  calories: String(e.calories),
  proteinG: String(e.proteinG),
  carbsG: String(e.carbsG),
  fatG: String(e.fatG),
});

/**
 * `YYYY-MM-DD` as a LOCAL calendar date.
 *
 * Parsed field by field rather than by `new Date(date)`, which reads a bare
 * ISO date as UTC midnight and lands on the previous day for every athlete
 * west of Greenwich — a whole day of food filed one day early.
 */
const parseLocal = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** `date` ± whole days, staying on the local calendar `ymd` and `today` use. */
const shiftDay = (date: string, days: number): string => {
  const d = parseLocal(date);
  d.setDate(d.getDate() + days);
  return ymd(d);
};

export function DailyLogScreen() {
  const { nutrition, update, saveFailed, dataRecovered } = useNutrition();
  /* Read once per render, not memoised across one: the screen stays mounted
     as a tab, so a cached "today" would go stale over midnight and start
     filing food against yesterday. */
  const today = ymd(new Date());
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Draft | null>(null);

  const entries = useMemo(() => entriesForDay(nutrition, date), [nutrition, date]);
  const totals = useMemo(() => macroTotals(entries), [entries]);
  const groups = useMemo(() => groupByMeal(entries, MEALS), [entries]);
  const target = targetForDay(nutrition.program, date);

  /* Forward navigation stops at today, as in the reference app: the adaptive
     engine only ever looks BACK from today, so food logged against a future
     date would be invisible to it — and to the athlete, who would never
     navigate forward to find it. */
  const atToday = date >= today;

  const commit = () => {
    if (!draft) return;
    const name = draft.displayName.trim();
    // An entry with no name is unreadable in the list and unfindable later;
    // the button is disabled on this too, this is the guard behind it.
    if (!name) return;
    const at = new Date().toISOString();
    const fields = {
      displayName: name,
      meal: draft.meal,
      calories: macro(draft.calories),
      proteinG: macro(draft.proteinG),
      carbsG: macro(draft.carbsG),
      fatG: macro(draft.fatG),
    };
    update((n) => {
      const existing = draft.id ? n.logEntries.find((e) => e.id === draft.id) : undefined;
      if (existing) {
        // Edited IN PLACE. Rebuilding `logEntries` from a filter here is the
        // shape that drops every OTHER day's entries — reads may scope, writes
        // never filter.
        //
        // Through the one editor rather than a bare `Object.assign`, because
        // this sheet opens on catalogue-sourced entries too and those carry a
        // snapshot that has to move with the numbers. See `applyManualMacroEdit`.
        applyManualMacroEdit(existing, fields, at);
        return;
      }
      /* Built by the one snapshot builder every screen writes through, so the
         provenance rules (a quick add carries no source id, no nutrient map)
         are stated once rather than per screen. `userId` is left blank on
         purpose: ownership of this slice is the sync layer's and RLS's, at the
         namespace level — a client-guessed id would be wrong for everything
         logged before a sign-in, and the merge keys log entries by `id`. */
      n.logEntries.push(
        quickAddEntry(
          { id: uid(), logDate: date, meal: draft.meal, at },
          {
            displayName: name,
            calories: fields.calories,
            proteinG: fields.proteinG,
            carbsG: fields.carbsG,
            fatG: fields.fatG,
          },
        ),
      );
    });
    setDraft(null);
  };

  const remove = (entry: FoodLogEntry) => {
    // Same destructive gate the training worlds use for a workout delete — the
    // native confirm with `style: 'destructive'`, not an inline button pair.
    Alert.alert(`Delete "${entry.displayName}"?`, 'This removes it from every device. It cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          update((n) => {
            const live = n.logEntries.find((e) => e.id === entry.id);
            if (!live) return false;
            const at = new Date().toISOString();
            // Stamped, not spliced: see this file's header.
            live.deletedAt = at;
            live.updatedAt = at;
          }),
      },
    ]);
  };

  return (
    <Screen>
      <Kicker>Nutrition</Kicker>
      <Title>{date === today ? 'Today' : dayLabel(date)}</Title>

      {dataRecovered ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Your food log couldn&apos;t be read and had to be reset. Your training data is unaffected — the two are stored
          separately.
        </T>
      ) : saveFailed ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          The last save failed — usually a full disk. What you just logged may not survive a restart.
        </T>
      ) : null}

      <View className="mt-2 flex-row gap-1">
        <Btn onPress={() => setDate(shiftDay(date, -1))} label="Previous day">
          ‹ Previous
        </Btn>
        <View className="min-w-0 flex-1">
          {/* Named for the action, not the word on it: the screen title also
              reads "Today", and two identically-named things are two things a
              screen reader cannot tell apart. */}
          <Btn onPress={() => setDate(today)} disabled={date === today} label="Jump to today" className="w-full">
            Today
          </Btn>
        </View>
        <Btn onPress={() => setDate(shiftDay(date, 1))} disabled={atToday} label="Next day">
          Next ›
        </Btn>
      </View>

      <TotalsCard totals={totals} target={target} count={entries.length} />

      {draft ? (
        <EntrySheet draft={draft} onChange={setDraft} onSave={commit} onCancel={() => setDraft(null)} />
      ) : (
        <Btn variant="brass" size="lg" className="mt-2" onPress={() => setDraft(blankDraft('breakfast'))}>
          Add food
        </Btn>
      )}

      {groups.length === 0 ? (
        <View className="mt-2">
          <Empty
            title="Nothing logged yet"
            body={
              date === today
                ? 'Add what you have eaten today and the totals fill in above.'
                : 'Nothing was logged against this day.'
            }
          />
        </View>
      ) : (
        groups.map((g) => (
          <View key={g.meal}>
            <SectionHead title={titleCase(g.meal)} right={<T num className="text-3 text-muted">{round(macroTotals(g.entries).calories)} kcal</T>} />
            <Card>
              {g.entries.map((e, i) => (
                <View key={e.id} className={i ? 'mt-1.5 border-t border-line pt-1.5' : ''}>
                  <View className="flex-row items-center gap-1">
                    <Tap
                      box={{ h: 44 }}
                      onPress={() => setDraft(draftOf(e))}
                      label={`edit ${e.displayName}`}
                      className="min-w-0 flex-1"
                    >
                      <T w="med" className="text-5 text-text">
                        {e.displayName}
                      </T>
                      <T num className="mt-0.5 text-3 text-muted">
                        {round(e.calories)} kcal · {round(e.proteinG)}P {round(e.carbsG)}C {round(e.fatG)}F
                      </T>
                    </Tap>
                    <Tap
                      box={{ h: 44, w: 44 }}
                      onPress={() => remove(e)}
                      label={`delete ${e.displayName}`}
                      className="items-center justify-center px-1"
                    >
                      <T className="text-6 text-dim">✕</T>
                    </Tap>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ))
      )}
    </Screen>
  );
}

/** `YYYY-MM-DD` as the athlete's own locale reads it. */
function dayLabel(date: string): string {
  return parseLocal(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function TotalsCard({ totals, target, count }: { totals: MacroTotals; target: MacroTotals | null; count: number }) {
  return (
    <Card tone="quiet" className="mt-2">
      <T w="bold" num className="text-8 text-text">
        {round(totals.calories)}
        <T className="text-5 text-muted"> kcal</T>
        {target ? <T num className="text-5 text-muted"> of {round(target.calories)}</T> : null}
      </T>
      {target ? <View className="mt-1"><Meter pct={(totals.calories / Math.max(1, target.calories)) * 100} /></View> : null}
      <View className="mt-1.5 flex-row">
        <MacroCell label="Protein" got={totals.proteinG} want={target?.proteinG} />
        <MacroCell label="Carbs" got={totals.carbsG} want={target?.carbsG} />
        <MacroCell label="Fat" got={totals.fatG} want={target?.fatG} />
      </View>
      {/* Absent, not zeroed. "0 of 0" would read as a target the athlete had
          been given and missed; the Coach slice is what sets one. */}
      {target ? null : (
        <T className="mt-1.5 text-3 text-dim">
          No target for this day yet — {count === 0 ? 'this is just what you log' : 'these are just your totals'}.
        </T>
      )}
    </Card>
  );
}

function MacroCell({ label, got, want }: { label: string; got: number; want?: number }) {
  return (
    <View className="min-w-0 flex-1">
      <T w="semi" className="text-2 uppercase tracking-widest text-dim">
        {label}
      </T>
      <T w="med" num className="mt-0.5 text-6 text-text">
        {round(got)}
        {want == null ? 'g' : <T className="text-3 text-muted">{` / ${round(want)}g`}</T>}
      </T>
    </View>
  );
}

/** Add or edit. One form for both, because the fields are identical. */
function EntrySheet({
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
      <T w="semi" className="text-6 text-text">
        {draft.id ? 'Edit entry' : 'Add food'}
      </T>
      <Input
        value={draft.displayName}
        onChangeText={(v: string) => set({ displayName: v })}
        placeholder="What did you eat?"
        accessibilityLabel="Food name"
        className="mt-1.5 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
      />
      <MealChips value={draft.meal} onChange={(m) => set({ meal: m })} />
      <View className="mt-1.5 flex-row gap-1">
        <NumField label="kcal" value={draft.calories} onChange={(v) => set({ calories: v })} />
        <NumField label="Protein g" value={draft.proteinG} onChange={(v) => set({ proteinG: v })} />
        <NumField label="Carbs g" value={draft.carbsG} onChange={(v) => set({ carbsG: v })} />
        <NumField label="Fat g" value={draft.fatG} onChange={(v) => set({ fatG: v })} />
      </View>
      <View className="mt-2 flex-row gap-1">
        <View className="min-w-0 flex-1">
          <Btn variant="brass" onPress={onSave} disabled={!draft.displayName.trim()} className="w-full">
            {draft.id ? 'Save' : 'Log it'}
          </Btn>
        </View>
        <View className="min-w-0 flex-1">
          <Btn onPress={onCancel} className="w-full">
            Cancel
          </Btn>
        </View>
      </View>
      <T className="mt-1 text-3 text-dim">
        These numbers are stored as you type them and are never recalculated later.
      </T>
    </Card>
  );
}
