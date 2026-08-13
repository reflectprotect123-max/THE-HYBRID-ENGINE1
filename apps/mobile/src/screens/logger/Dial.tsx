import { View } from 'react-native';
import { useTheme } from '@hybrid/design';

/*
 * The rest dial's ring.
 *
 * The prototype draws it with `conic-gradient`, which has no React Native
 * equivalent and no honest polyfill — and `react-native-svg` is a NATIVE
 * module, so reaching for it would mean a new autolinked dependency and a
 * runtimeVersion bump for a progress ring. This is the standard two-mask
 * construction instead: pure `View`s and a rotation, identical under React
 * Native and react-native-web.
 *
 * How it works, in the clock angles the ring is actually read in — 0° at
 * twelve, increasing clockwise:
 *
 *  - A left-half rectangle rotated clockwise by `deg` about the CIRCLE's
 *    centre (`transformOrigin` at its own right edge) covers the half-plane
 *    from `deg` round to `deg + 180`.
 *  - Clipped to the ring's right half (0°–180°) that intersection is 0°–deg,
 *    which is exactly the first half-turn of fill.
 *  - The SAME rectangle clipped to the left half (180°–360°) intersects at
 *    180°–deg, which is exactly the second half-turn — and is empty on its
 *    own while `deg` is still under 180°, so no branch is needed for it.
 *
 * The one case the single rectangle cannot serve is the right half once the
 * sweep has passed it: past 180° it must stay solid rather than follow the
 * rectangle round. That is the `deg >= 180` fill below, and it is the only
 * conditional here.
 */

const SIZE = 210;
const RING = 5;
const HALF = SIZE / 2;

export function Dial({ frac, children }: { frac: number; children: React.ReactNode }) {
  const { color } = useTheme();
  const deg = Math.max(0, Math.min(1, frac)) * 360;

  const sweep = {
    position: 'absolute' as const,
    top: 0,
    width: HALF,
    height: SIZE,
    backgroundColor: color.gold2,
    transformOrigin: '100% 50%',
    transform: [{ rotate: `${deg}deg` }],
  };

  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: HALF,
        backgroundColor: color.line,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <View style={{ position: 'absolute', left: HALF, top: 0, width: HALF, height: SIZE, overflow: 'hidden' }}>
        {deg >= 180 ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.gold2 }} />
        ) : (
          <View style={[sweep, { left: -HALF }]} />
        )}
      </View>
      <View style={{ position: 'absolute', left: 0, top: 0, width: HALF, height: SIZE, overflow: 'hidden' }}>
        <View style={[sweep, { left: 0 }]} />
      </View>

      {/* The hole. `rgba(7,7,6,.97)` is the takeover's own scrim rather than
          `bg`, so the ring sits on exactly what surrounds it — the prototype
          punches its centre with the same value. */}
      <View
        style={{
          position: 'absolute',
          top: RING,
          left: RING,
          right: RING,
          bottom: RING,
          borderRadius: HALF - RING,
          backgroundColor: 'rgba(7,7,6,0.97)',
        }}
      />
      {children}
    </View>
  );
}
