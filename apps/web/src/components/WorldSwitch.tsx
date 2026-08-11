import { setDiscipline } from '../discipline';
import { Button } from '../ui';

/*
 * The only way out of the nutrition world on web, ported from mobile's
 * `WorldSwitch` (`apps/mobile/src/ui/WorldSwitch.tsx`).
 *
 * Mobile's version is a chooser across `WORLDS` (strength, conditioning,
 * nutrition) because a single mobile install can carry an athlete through
 * either training product at runtime. Web's `WorldId`
 * (`apps/web/src/discipline.ts`) has no third value to choose between — each
 * deployed web build is permanently one training product, fixed at build
 * time via `VITE_HYBRID_PRODUCT` — so there is nothing to render but the one
 * door back to it. That collapses mobile's row of world buttons to a single
 * button; the destination is unambiguous.
 *
 * A sealed world with no door is a trap, not a seal — this is why it renders
 * on `NutritionSettings`, the same reasoning mobile's comment gives for why
 * its own `WorldSwitch` renders on the nutrition Settings screen.
 */
export function WorldSwitch() {
  return (
    <Button variant="ghost" className="mt-2" onClick={() => setDiscipline('training')}>
      ← Back to training
    </Button>
  );
}
