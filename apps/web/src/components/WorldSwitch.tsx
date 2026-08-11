import { setDiscipline, useDiscipline, type WorldId } from '../discipline';
import { Button } from '../ui';

/*
 * The only way between web's two worlds, ported from mobile's `WorldSwitch`
 * (`apps/mobile/src/ui/WorldSwitch.tsx`).
 *
 * Mobile's version is a chooser across `WORLDS` (strength, conditioning,
 * nutrition) because a single mobile install can carry an athlete through
 * either training product at runtime. Web's `WorldId`
 * (`apps/web/src/discipline.ts`) has only two values — each deployed web
 * build is permanently one training product, fixed at build time via
 * `VITE_HYBRID_PRODUCT` — so there is nothing to choose between but the one
 * world you are not currently in. That collapses mobile's row of world
 * buttons to a single button, but it is still the SAME component in both
 * directions, reading `useDiscipline()` to work out its own target rather
 * than being told one: rendered on the training `Settings` screen it reads
 * "Go to Nutrition"; rendered on `NutritionSettings` it reads "Back to
 * training" — no separate hardcoded component needed for each direction.
 *
 * A sealed world with no door is a trap, not a seal — this is why it renders
 * on both worlds' Settings screens, the same reasoning mobile's comment gives
 * for why its own `WorldSwitch` renders on every world's Settings.
 */

const LABEL: Record<WorldId, string> = {
  training: '← Back to training',
  nutrition: 'Go to Nutrition →',
};

export function WorldSwitch() {
  const world = useDiscipline();
  const target: WorldId = world === 'training' ? 'nutrition' : 'training';
  return (
    <Button variant="ghost" className="mt-2" onClick={() => setDiscipline(target)}>
      {LABEL[target]}
    </Button>
  );
}
