import type { StyleProp, ViewStyle } from 'react-native';

/*
 * Pressed feedback and tap area, in one place.
 *
 * Both are things the first port of these screens lost. The prototype is a web
 * page: it can rely on `:hover` and on a pointer being pixel-accurate, and a
 * phone has neither. `apps/mobile/src/ui.tsx`'s own `Tap` primitive already
 * settled what this app does instead — an Android ripple plus an opacity
 * knock-back — and these screens do not get to answer that question
 * differently just because they are styled by hand.
 *
 * Neither helper is visible to the visual parity gate, which is what makes
 * them safe to add to a pixel-specified screen: a shot is taken with nothing
 * pressed, and `hitSlop` extends the touch rectangle without moving a single
 * pixel of layout. That distinction is the whole reason the fix is hitSlop
 * rather than a bigger control — three of these targets are BELOW 44pt because
 * the prototype drew them that way (the block strip's segments are 24 tall,
 * the rotate grip is 28 wide, the skip/add pills are 32), and growing them
 * would be choosing the platform rule over the specification. Extending the
 * touch area chooses both.
 */

export const RIPPLE = { color: 'rgba(255,255,255,.10)', borderless: false } as const;

/** The app's own pressed treatment, from `ui.tsx`. */
export function pressed(style: StyleProp<ViewStyle>) {
  return ({ pressed: down }: { pressed: boolean }): StyleProp<ViewStyle> => [
    style,
    down ? { opacity: 0.65 } : null,
  ];
}

/**
 * Grow a control's touch rectangle to the 44pt floor without moving it.
 *
 * `size` is what the control actually measures; the slop is half the
 * shortfall on each side, so the tappable box is centred on the visible one.
 */
export function slopTo44(width: number, height: number) {
  const x = Math.max(0, Math.ceil((44 - width) / 2));
  const y = Math.max(0, Math.ceil((44 - height) / 2));
  return { top: y, bottom: y, left: x, right: x };
}
