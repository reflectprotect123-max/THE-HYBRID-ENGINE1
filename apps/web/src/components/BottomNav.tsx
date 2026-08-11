import { NavLink } from 'react-router-dom';
import type { NavLinkRenderProps } from 'react-router-dom';
import type { ProductId } from '@hybrid/product-scope';
import { athleteHomePath, IS_SCOPED_BUILD, PRODUCT_ID } from '../product';
import { cx } from '../ui';

/*
 * Settings sits in the bar rather than behind a gear in a header because on a
 * phone in a gym the header is the one place a thumb cannot reach.
 *
 * The training slot is where the three builds diverge, and they diverge in two
 * different ways:
 *
 * A BRANDED build owns one discipline, so it gets ONE training tab — /training
 * on strength, /conditioning on conditioning. That is a swap, and it is correct
 * for a single-purpose product: a conditioning build has no lifting to train.
 *
 * The UNSCOPED build is the hybrid, and it gets BOTH. This used to take the
 * strength arm of that same swap, which meant the one build that owns both
 * disciplines was the one build where conditioning had no tab — reachable only
 * through Home's zones card, a single text link inside one card. An app whose
 * whole claim is that it runs the two halves together cannot hide half of
 * itself behind a link; the swap is a product decision about a branded build
 * and was never a statement about the hybrid.
 *
 * So this returns 6 tabs unscoped and 5 scoped, and callers must not assume a
 * fixed length — `BottomNav` reads it off the array rather than hard-coding a
 * column count.
 */
export function navTabs(productId: ProductId, isScopedBuild: boolean) {
  const trainingTabs = !isScopedBuild
    ? [
        { to: '/training', label: 'Train', icon: TrainIcon },
        { to: '/conditioning', label: 'Cond', icon: CondIcon },
      ]
    : productId === 'conditioning'
      ? [{ to: '/conditioning', label: 'Cond', icon: CondIcon }]
      : [{ to: '/training', label: 'Train', icon: TrainIcon }];
  /* The FIRST tab is scoped too, for the mirror-image reason. `/` is Home on
     a branded build and the coach bench on the unscoped dashboard, so pointing
     Home at `/` there would eject the athlete out of their own app.
     `athleteHomePath` is shared with the training tree's catch-all and the way
     back out of the nutrition world — all three mean the same thing. */
  const homeTab = { to: athleteHomePath(isScopedBuild), label: 'Home', icon: HomeIcon };
  return [
    homeTab,
    ...trainingTabs,
    { to: '/library', label: 'Library', icon: LibIcon },
    { to: '/progress', label: 'Progress', icon: ChartIcon },
    { to: '/settings', label: 'Settings', icon: CogIcon },
  ];
}

const TABS = navTabs(PRODUCT_ID, IS_SCOPED_BUILD);

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[560px] border-t border-line bg-panel3/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      {/* Written out rather than composed into `grid-cols-${n}`: Tailwind scans
          source for literal class names, so an interpolated one is never
          generated and the bar would silently fall back to a single column. */}
      <ul className={cx('grid', TABS.length === 6 ? 'grid-cols-6' : 'grid-cols-5')}>
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }: NavLinkRenderProps) =>
                cx(
                  // Active tab per 04-athlete-03: a gold wash falling away below
                  // a centred hairline of light, not just a text tint.
                  'relative flex h-7 flex-col items-center justify-center gap-0.5 text-1 font-[750] uppercase tracking-[.1em] transition-colors duration-120',
                  isActive
                    ? 'bg-gradient-to-b from-gold-wash to-transparent text-gold2 before:absolute before:inset-x-[22%] before:top-0 before:h-[2px] before:rounded-pill before:bg-gradient-to-r before:from-transparent before:via-gold2 before:to-transparent before:content-[""]'
                    : 'text-dim hover:text-muted',
                )
              }
            >
              {({ isActive }: NavLinkRenderProps) => (
                <>
                  <Icon lit={isActive} />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const S = (d: string, lit?: boolean) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d={d}
      stroke="currentColor"
      strokeWidth={lit ? 2 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function HomeIcon({ lit }: { lit?: boolean }) {
  return S('M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z', lit);
}
function TrainIcon({ lit }: { lit?: boolean }) {
  return S('M3 12h2M19 12h2M7 8v8M17 8v8M9.5 12h5M7 8h2.5v8H7zM14.5 8H17v8h-2.5z', lit);
}
function CondIcon({ lit }: { lit?: boolean }) {
  return S('M3 12h3l1.5-4L11 17l2.5-10L15 12h6', lit);
}
function LibIcon({ lit }: { lit?: boolean }) {
  return S('M5 4.5h3.4v15H5zM10.2 4.5h3.4v15h-3.4zM16.2 5.4l3.1.8-3.6 13.9-3.1-.8z', lit);
}
function ChartIcon({ lit }: { lit?: boolean }) {
  return S('M4 19.5h16M7 16V9.5M12 16V5.5M17 16v-4', lit);
}
function CogIcon({ lit }: { lit?: boolean }) {
  return S(
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 12a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2-1.2l-.3-2.5h-4l-.3 2.5c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.3 2.5h4l.3-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
    lit,
  );
}
