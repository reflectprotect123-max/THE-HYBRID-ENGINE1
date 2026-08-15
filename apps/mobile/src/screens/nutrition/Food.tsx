import { useState } from 'react';
import type { CachedFood, ParsedNutritionLabel } from '@hybrid/nutrition-core';
import type { CatalogueBarcodeLookup, CatalogueSearch } from '../../cloud/catalogue';
import type { LabelRecogniser } from '../../native/labelOcr';
import { FoodSearchScreen } from './FoodSearch';
import { QuickAddScreen } from './QuickAdd';
import { CustomFoodScreen, type CustomFoodPrefill } from './CustomFood';
import { RecipeBuilderScreen } from './RecipeBuilder';
import { BarcodeScannerScreen } from './BarcodeScanner';
import { LabelReaderScreen } from './LabelReader';

/*
 * The Food tab: search, and the things you can create or scan from it.
 *
 * The screens are panes of one tab rather than navigation routes. The nutrition
 * world's tab bar is its shape (see App.tsx), and pushing a route per flow
 * would either grow that bar or put a back stack over a tab the athlete reached
 * by tapping the bar — the reference app had a navigation graph and a scanner
 * to route to; this tab has the panes instead.
 *
 * The pane is state, so leaving Food and coming back returns to search. That is
 * deliberate: a half-typed custom food surviving a trip to the Daily Log and
 * back is a draft the athlete has no way to discard. It also means the camera
 * cannot survive a tab change, which is the behaviour you want from a camera.
 */

type Pane =
  | { kind: 'search' }
  | { kind: 'quickAdd' }
  | { kind: 'customFood'; editId?: string; prefill?: CustomFoodPrefill }
  | { kind: 'recipe'; editId?: string }
  | { kind: 'scan' }
  | { kind: 'label' };

interface Props {
  /** Injected only by tests; the screens default to the real reads. */
  search?: CatalogueSearch;
  lookupBarcode?: CatalogueBarcodeLookup;
  /** The on-device OCR pass. Injected only by tests; there is no device in node. */
  recogniseLabel?: LabelRecogniser;
}

export function FoodScreen({ search, lookupBarcode, recogniseLabel }: Props = {}) {
  const [pane, setPane] = useState<Pane>({ kind: 'search' });
  /* Carried back to the search pane so a save confirms itself where the athlete
     ends up, not on the screen they just left. */
  const [notice, setNotice] = useState('');
  /* A food resolved from a scanned barcode, handed to the search pane so the
     scan ends in the SAME log sheet a tapped search result opens. A second
     sheet built into the scanner would be a second place for the snapshot
     rules to drift. */
  const [scanned, setScanned] = useState<CachedFood | null>(null);
  const done = (message: string) => {
    setNotice(message);
    setPane({ kind: 'search' });
  };

  const toSearch = () => setPane({ kind: 'search' });

  if (pane.kind === 'quickAdd') {
    return <QuickAddScreen onDone={done} onCancel={toSearch} />;
  }
  if (pane.kind === 'customFood') {
    return (
      <CustomFoodScreen
        editId={pane.editId}
        prefill={pane.prefill}
        onDone={done}
        onCancel={toSearch}
      />
    );
  }
  if (pane.kind === 'recipe') {
    return <RecipeBuilderScreen editId={pane.editId} search={search} onDone={done} onCancel={toSearch} />;
  }
  if (pane.kind === 'scan') {
    return (
      <BarcodeScannerScreen
        lookup={lookupBarcode}
        onFound={(food) => {
          setScanned(food);
          setNotice('');
          setPane({ kind: 'search' });
        }}
        onCreateFood={(barcode) =>
          setPane({
            kind: 'customFood',
            prefill: { barcode, note: `Scanned ${barcode}. Nothing else was filled in — the catalogue had no entry.` },
          })
        }
        onCancel={toSearch}
      />
    );
  }
  if (pane.kind === 'label') {
    return (
      <LabelReaderScreen
        recognise={recogniseLabel}
        onUse={(parsed) => setPane({ kind: 'customFood', prefill: fromLabel(parsed) })}
        onCancel={toSearch}
      />
    );
  }
  return (
    <FoodSearchScreen
      notice={notice}
      search={search}
      scanned={scanned}
      onScannedConsumed={() => setScanned(null)}
      onQuickAdd={() => setPane({ kind: 'quickAdd' })}
      onCreateCustomFood={() => setPane({ kind: 'customFood' })}
      onEditCustomFood={(editId) => setPane({ kind: 'customFood', editId })}
      onCreateRecipe={() => setPane({ kind: 'recipe' })}
      onEditRecipe={(editId) => setPane({ kind: 'recipe', editId })}
      onScanBarcode={() => setPane({ kind: 'scan' })}
      onReadLabel={() => setPane({ kind: 'label' })}
    />
  );
}

/**
 * A parsed panel as Create-a-food's prefill.
 *
 * A per-100 panel is the one shape that needs a decision rather than a copy:
 * its macros are for 100 g/ml, so the serving denominator MUST be set to 100
 * of the same unit or the food gets saved as if a whole serving were those
 * numbers. The parser reports the basis instead of assuming one, which is what
 * makes this decision possible here rather than invisible.
 */
function fromLabel(p: ParsedNutritionLabel): CustomFoodPrefill {
  const per100 = p.basis === 'per_100';
  /* A per-100 column is per 100 g or per 100 ml — never 100 kg, mg or L. The
     serving-size LINE may legitimately print "0.25 kg", and taking its unit
     verbatim wrote a food whose denominator claimed 100 kg and whose note said
     so, while the reader screen had already told the athlete "per 100 g". Only
     the volume/mass DISTINCTION carries over from that line; the magnitude
     comes from the column. */
  const volumetric = (p.servingUnit ?? '').toLowerCase() === 'ml' || (p.servingUnit ?? '').toLowerCase() === 'l';
  const unit = per100 ? (volumetric ? 'ml' : 'g') : p.servingUnit;
  return {
    calories: p.calories,
    proteinG: p.proteinG,
    carbsG: p.carbsG,
    fatG: p.fatG,
    servingQty: per100 ? 100 : p.servingQty,
    servingUnit: unit,
    note: per100
      ? `Read from the nutrition panel. It only prints a per-100 column, so the serving is set to 100 ${unit ?? 'g'} to match.`
      : 'Read from the nutrition panel. Check it against the packet — anything blank was not recognised.',
  };
}
