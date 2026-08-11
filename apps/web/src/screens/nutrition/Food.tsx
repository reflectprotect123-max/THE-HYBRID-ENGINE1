import { useState } from 'react';
import { Kicker, ScreenTitle, Tabs } from '../../ui';
import { FoodSearch } from './FoodSearch';
import { QuickAdd } from './QuickAdd';
// TODO: Task 2.7 builds this screen.
import { CustomFood } from './CustomFood';
// TODO: Task 2.8 builds this screen.
import { RecipeBuilder } from './RecipeBuilder';
// TODO: Task 2.11 builds this screen.
import { BarcodeScanner } from './BarcodeScanner';
// TODO: Task 2.12 builds this screen.
import { LabelReader } from './LabelReader';

/*
 * The Food tab: search, and the things you can create or scan from it.
 *
 * Mirrors mobile's `Food.tsx` composer role (`apps/mobile/src/screens/nutrition/Food.tsx`):
 * one screen, one set of panes — search, quick add, custom food, recipe,
 * scan, label — switched by local state rather than routed, so leaving the
 * tab and coming back always lands on search. Mobile switches panes through
 * buttons inside its search pane (there is no persistent tab bar there); the
 * web idiom for "one screen, several slices" already established in this
 * codebase (`Library.tsx`, `FoodLog.tsx`) is the `Tabs` row, so that is the
 * mechanism used here — the set of panes is what has to match mobile, not
 * the exact control that switches between them.
 *
 * Quick add (Task 2.4b) and Search (Task 2.6) are real; the other three panes
 * are still placeholders. Each remaining TODO above names the task that
 * replaces its placeholder with the real screen.
 */

type Pane = 'search' | 'quickAdd' | 'customFood' | 'recipe' | 'scan' | 'label';

const PANES: readonly { key: Pane; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'quickAdd', label: 'Quick add' },
  { key: 'customFood', label: 'Custom food' },
  { key: 'recipe', label: 'Recipe' },
  { key: 'scan', label: 'Scan barcode' },
  { key: 'label', label: 'Read label' },
];

export function Food() {
  const [pane, setPane] = useState<Pane>('search');

  return (
    <>
      <Kicker>Nutrition</Kicker>
      <ScreenTitle>Food</ScreenTitle>

      <Tabs label="Food composer" value={pane} onChange={setPane} tabs={PANES} />

      <div role="tabpanel" className="mt-2">
        {pane === 'search' ? <FoodSearch /> : null}
        {pane === 'quickAdd' ? <QuickAdd onDone={() => setPane('search')} onCancel={() => setPane('search')} /> : null}
        {pane === 'customFood' ? <CustomFood /> : null}
        {pane === 'recipe' ? <RecipeBuilder /> : null}
        {pane === 'scan' ? <BarcodeScanner /> : null}
        {pane === 'label' ? <LabelReader /> : null}
      </div>
    </>
  );
}
