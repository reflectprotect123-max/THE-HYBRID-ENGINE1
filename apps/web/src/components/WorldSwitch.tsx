import { useNavigate } from 'react-router-dom';
import { setDiscipline, useDiscipline, type WorldId } from '../discipline';
import { ATHLETE_HOME } from '../product';
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

/*
 * Where each world is ENTERED. Flipping the world is only half a door: the two
 * route trees share no paths, so whatever address the athlete was on when they
 * switched does not exist on the other side and falls to that tree's catch-all.
 *
 * Leaving that to the catch-all is what made this a trap. Switching back from
 * nutrition kept the hash at `/nutrition/settings`, which the training tree
 * does not have, so it fell to `*` → `/` — and on the unscoped hybrid build `/`
 * redirects to the COACH BENCH. The one door out of the nutrition world put the
 * athlete in the coach workspace.
 *
 * That catch-all is fixed at the root now (App.tsx), so this navigation is no
 * longer the only thing standing between the athlete and the coach bench. It
 * stays because a door should name where it goes: relying on a catch-all to
 * land somewhere sensible is how the trap happened in the first place.
 */
const ENTRY: Record<WorldId, string> = {
  training: ATHLETE_HOME,
  nutrition: '/nutrition/log',
};

export function WorldSwitch() {
  const world = useDiscipline();
  const navigate = useNavigate();
  const target: WorldId = world === 'training' ? 'nutrition' : 'training';
  return (
    <Button
      variant="ghost"
      className="mt-2"
      onClick={() => {
        setDiscipline(target);
        /* `replace`, not a push: the address being left belongs to a route tree
           that is about to be unmounted, so a Back button onto it would land on
           the other world's catch-all rather than where the athlete came from. */
        navigate(ENTRY[target], { replace: true });
      }}
    >
      {LABEL[target]}
    </Button>
  );
}
