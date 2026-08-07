import { useState } from 'react';
import type { CatalogueSearch } from '../../cloud/catalogue';
import { FoodSearchScreen } from './FoodSearch';
import { QuickAddScreen } from './QuickAdd';
import { CustomFoodScreen } from './CustomFood';
import { RecipeBuilderScreen } from './RecipeBuilder';

/*
 * The Food tab: search, and the three things you can create from it.
 *
 * The four screens are panes of one tab rather than four navigation routes.
 * The nutrition world's tab bar is its shape (see App.tsx), and pushing a route
 * per creation flow would either grow that bar or put a back stack over a tab
 * the athlete reached by tapping the bar — the reference app had a navigation
 * graph and a scanner to route to; this slice has neither yet.
 *
 * The pane is state, so leaving Food and coming back returns to search. That is
 * deliberate: a half-typed custom food surviving a trip to the Daily Log and
 * back is a draft the athlete has no way to discard.
 */

type Pane =
  | { kind: 'search' }
  | { kind: 'quickAdd' }
  | { kind: 'customFood'; editId?: string }
  | { kind: 'recipe'; editId?: string };

/** `search` is injected only by tests; the screens default to the real read. */
export function FoodScreen({ search }: { search?: CatalogueSearch } = {}) {
  const [pane, setPane] = useState<Pane>({ kind: 'search' });
  /* Carried back to the search pane so a save confirms itself where the athlete
     ends up, not on the screen they just left. */
  const [notice, setNotice] = useState('');

  const done = (message: string) => {
    setNotice(message);
    setPane({ kind: 'search' });
  };

  if (pane.kind === 'quickAdd') {
    return <QuickAddScreen onDone={done} onCancel={() => setPane({ kind: 'search' })} />;
  }
  if (pane.kind === 'customFood') {
    return (
      <CustomFoodScreen editId={pane.editId} onDone={done} onCancel={() => setPane({ kind: 'search' })} />
    );
  }
  if (pane.kind === 'recipe') {
    return (
      <RecipeBuilderScreen
        editId={pane.editId}
        search={search}
        onDone={done}
        onCancel={() => setPane({ kind: 'search' })}
      />
    );
  }
  return (
    <FoodSearchScreen
      notice={notice}
      search={search}
      onQuickAdd={() => setPane({ kind: 'quickAdd' })}
      onCreateCustomFood={() => setPane({ kind: 'customFood' })}
      onEditCustomFood={(editId) => setPane({ kind: 'customFood', editId })}
      onCreateRecipe={() => setPane({ kind: 'recipe' })}
      onEditRecipe={(editId) => setPane({ kind: 'recipe', editId })}
    />
  );
}
