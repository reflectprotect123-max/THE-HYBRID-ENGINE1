import { NavLink } from 'react-router-dom';
import type { NavLinkRenderProps } from 'react-router-dom';
import { cx } from '../ui';

/*
 * The nutrition world's own five tabs. Structurally identical to
 * `BottomNav.tsx` — same wrapper markup, same `NavLink` active-state classes,
 * same inline-SVG icon technique — so switching discipline worlds swaps which
 * tabs are lit, not how the bar itself looks or behaves. See `discipline.ts`
 * for the `WorldId` this bar renders under.
 */
const TABS = [
  { to: '/nutrition/log', label: 'Log', icon: LogIcon },
  { to: '/nutrition/food', label: 'Food', icon: FoodIcon },
  { to: '/nutrition/weight', label: 'Weight', icon: WeightIcon },
  { to: '/nutrition/coach', label: 'Coach', icon: CoachIcon },
  { to: '/nutrition/settings', label: 'Settings', icon: SettingsIcon },
];

export function NutritionBottomNav() {
  return (
    <nav
      aria-label="Nutrition"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[560px] border-t border-line bg-panel3/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="grid grid-cols-5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
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

function LogIcon({ lit }: { lit?: boolean }) {
  return S('M5 4.5h14v15H5zM8 8.5h8M8 12h8M8 15.5h5', lit);
}
function FoodIcon({ lit }: { lit?: boolean }) {
  return S('M6 3v8a3 3 0 0 0 3 3v7M6 3v5M9 3v5M12 3v8M18 3c-2 1-3 3-3 6s1 5 3 6v6', lit);
}
function WeightIcon({ lit }: { lit?: boolean }) {
  return S('M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM6.5 8.5 5 5h3l1 3.5M17.5 8.5 19 5h-3l-1 3.5', lit);
}
function CoachIcon({ lit }: { lit?: boolean }) {
  return S('M12 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM5 20.5c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5', lit);
}
function SettingsIcon({ lit }: { lit?: boolean }) {
  return S(
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 12a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2-1.2l-.3-2.5h-4l-.3 2.5c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.3 2.5h4l.3-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
    lit,
  );
}
