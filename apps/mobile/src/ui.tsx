import {
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput as RNTextInput,
  View,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { color } from '@hybrid/design';

/*
 * Mobile primitives.
 *
 * Same names and same visual language as apps/web/src/ui — the two apps are one
 * product, and a card should not be subtly different depending on which one you
 * opened. Spacing resolves through the same 8px scale (NativeWind's config
 * mirrors the web theme), so `p-2` is 16px in both.
 *
 * TYPE. Every piece of text in the app goes through <T> (or a primitive built
 * on it), because React Native does not inherit fontFamily and the app must
 * never fall back to system Roboto — that fallback is exactly what made the
 * first APK look like a draft. The design system's weights are 500/650/750/
 * 800/900 on a variable font; Inter's static files have no 650/750, so the
 * scale maps to the honest nearest: reg→500, med→600, semi→700, bold→800,
 * black→900. `fontWeight` is deliberately never set alongside these families —
 * each weight IS its own family here, and adding fontWeight invites Android to
 * fake-bold an already-bold face.
 */
export const font = {
  reg: 'Inter_500Medium',
  med: 'Inter_600SemiBold',
  semi: 'Inter_700Bold',
  bold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
} as const;
export type Fw = keyof typeof font;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** The one Text. `w` picks the design weight; `num` turns on tabular numerals
 * for figures that get compared down a column — weights, reps, bpm, clocks. */
export function T({ w = 'reg', num, style, ...rest }: TextProps & { w?: Fw; num?: boolean }) {
  return <RNText {...rest} style={[{ fontFamily: font[w] }, num ? tabular : null, style]} />;
}

/** The one TextInput, for the same reason: a typed weight rendered in Roboto
 * next to an Inter label reads as a bug. Numeric slots pass `num`.
 *
 * textAlignVertical + includeFontPadding are Android-only and exist to stop a
 * real Android bug: without them, Android sizes the text box using Inter's
 * font metrics rather than the box's own height, so in a short, centered
 * input (the per-set reps/RPE boxes) the glyphs render clipped and shoved
 * toward one edge — legible on iOS, garbled on Android. */
export function Input({ w = 'reg', num, style, ...rest }: TextInputProps & { w?: Fw; num?: boolean }) {
  return (
    <RNTextInput
      placeholderTextColor={color.dim}
      textAlignVertical="center"
      {...rest}
      style={[{ fontFamily: font[w], includeFontPadding: false }, num ? tabular : null, style]}
    />
  );
}

export function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-bg"
      /* A ScrollView swallows the first tap outside a focused input to dismiss
         the keyboard, so with the keypad up every button needed pressing
         TWICE. 'handled' lets the press through and still dismisses on a tap
         that hits nothing. */
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 16,
      }}
    >
      {children}
    </ScrollView>
  );
}

/** The uppercase tracked micro-label in brand gold — the shipped app's
 * `.kicker` / `.sc-kicker` (design card 04-athlete-01/02). Pass a text- class
 * to retint where a quieter label is wanted. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <T w="bold" className={`text-2 uppercase text-gold ${className || ''}`} style={{ letterSpacing: 2 }}>
      {children}
    </T>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <T w="bold" className="text-8 text-text" style={{ letterSpacing: -0.5 }}>
      {children}
    </T>
  );
}

/** Section label between cards — the vanilla app's `.sec-head`: an uppercase
 * tracked micro-line in muted gold, so screen title > card titles > sections
 * read as three distinct levels rather than a flat stack of bold. */
export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="mt-3 mb-1 flex-row items-end justify-between gap-1">
      <T w="semi" className="text-2 uppercase" style={{ letterSpacing: 1.6, color: 'rgba(224,188,135,.8)' }}>
        {title}
      </T>
      {right}
    </View>
  );
}

/** The small gold text-link that rides on a SectionHead — "History ›". These
 * are the doors to the screens that have no tab of their own. */
export function Link({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <T w="med" className="text-3 text-gold2">
        {children}
      </T>
    </Pressable>
  );
}

/* One elevation for every card, from the tokens' shadow.card — written in the
   inset-first order RN's boxShadow parser expects. */
const cardShadow = 'inset 0 1px 0 rgba(255,255,255,.028), 0 14px 34px -18px rgba(0,0,0,.9)';

export function Card({
  className,
  style,
  children,
  ...rest
}: ViewProps & { className?: string; children: ReactNode }) {
  return (
    <View
      className={`rounded-lg border border-line bg-panel p-2 ${className || ''}`}
      style={[{ boxShadow: cardShadow }, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Btn({
  children,
  onPress,
  variant = 'ghost',
  size = 'md',
  className,
  disabled,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: 'brass' | 'ghost';
  size?: 'md' | 'lg';
  className?: string;
  disabled?: boolean;
}) {
  const brass = variant === 'brass';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center justify-center rounded-md ${size === 'lg' ? 'px-3 py-2' : 'px-2 py-1.5'} ${
        brass ? 'bg-gold' : 'border border-line2 bg-panel2'
      } ${disabled ? 'opacity-40' : ''} ${className || ''}`}
      /* The brass edge from the tokens: a light top hairline and a dark seat,
         which is what makes the CTA read as a machined button, not a fill. */
      style={brass ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14), 0 1px 0 rgba(0,0,0,.35)' } : undefined}
    >
      <T w="med" className={size === 'lg' ? 'text-6' : 'text-5'} style={{ color: brass ? '#1b1509' : color.text }}>
        {children}
      </T>
    </Pressable>
  );
}

/** Selection chip per 03-shared-02: selected is the gold wash, never green. */
export function Chip({ on, children, onPress }: { on?: boolean; children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: !!on }}
      className={`items-center justify-center rounded-pill border px-1.5 py-0.5 ${
        on ? 'border-gold-line bg-gold-wash' : 'border-line2 bg-panel2'
      }`}
    >
      <T w="bold" className={`text-1 uppercase ${on ? 'text-gold2' : 'text-muted'}`} style={{ letterSpacing: 1 }}>
        {children}
      </T>
    </Pressable>
  );
}

/** The superset/exercise letter marker: A1, A2. */
export function Ltr({ children }: { children: ReactNode }) {
  return (
    <View
      className="items-center justify-center rounded-sm border border-gold-line bg-gold-wash px-0.5"
      style={{ minWidth: 26, minHeight: 26 }}
    >
      <T w="bold" num className="text-3 text-gold2">
        {children}
      </T>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card className="items-center py-4">
      <T w="semi" className="text-6 text-text">
        {title}
      </T>
      {body ? <T className="mt-1 max-w-[280px] text-center text-4 text-muted">{body}</T> : null}
      {action ? <View className="mt-2">{action}</View> : null}
    </Card>
  );
}

/** Horizontal completion bar. */
export function Meter({ pct }: { pct: number }) {
  return (
    <View className="h-0.5 overflow-hidden rounded-pill bg-track">
      <View className="h-full rounded-pill bg-gold2" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </View>
  );
}

/** A labelled row of two numbers, used everywhere zone times are shown.
 * `glow` gives the dot the neon treatment from 01-foundations-colour-06 —
 * pass it with a neon ink, never with a band ink. */
export function Row({ label, value, dot, glow }: { label: string; value: string; dot?: string; glow?: boolean }) {
  return (
    <View className="mt-0.5 flex-row items-center">
      {dot ? (
        <View
          className="mr-1 h-1 w-1 rounded-pill"
          style={{ backgroundColor: dot, boxShadow: glow ? `0 0 6px ${dot}` : undefined }}
        />
      ) : null}
      <T w="med" className="flex-1 text-4 text-text">
        {label}
      </T>
      <T num className="text-4 text-muted">
        {value}
      </T>
    </View>
  );
}

/*
 * A progress arc with no chart library and no SVG.
 *
 * Two half-discs, each clipped by an overflow-hidden half-window and rotated
 * about the circle's centre, then an inner disc to cut the donut hole. The
 * first window is the right half: its disc starts hidden on the left and
 * rotates clockwise up to 180°, painting the arc from 12 o'clock. Past 180°
 * the right window is left fully painted and the left window's disc carries
 * on to 360°. Deterministic, cheap, and exactly as accurate as the maths.
 *
 * The glow is the neon treatment from 01-foundations-colour-06: a colored
 * boxShadow on the track circle, so the whole ring sits in a soft pool of the
 * band's light. Static light, not motion — reduced-motion safe.
 */
export function Ring({
  frac,
  size = 104,
  stroke = 8,
  color: ink,
  track = color.trackSoft,
  hole = color.panel,
  glow,
  children,
}: {
  frac: number;
  size?: number;
  stroke?: number;
  color: string;
  track?: string;
  /** The fill behind `children` — match it to the surface the ring sits on. */
  hole?: string;
  glow?: boolean;
  children?: ReactNode;
}) {
  const half = size / 2;
  const a = 360 * Math.max(0, Math.min(1, frac));
  const disc = (deg: number) => (
    <View
      style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ rotate: `${deg}deg` }] }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: half,
          height: size,
          borderTopLeftRadius: half,
          borderBottomLeftRadius: half,
          backgroundColor: ink,
        }}
      />
    </View>
  );
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: half,
          borderWidth: stroke,
          borderColor: track,
          boxShadow: glow ? `0 0 12px ${ink}` : undefined,
        }}
      />
      {a > 0 ? (
        <View style={{ position: 'absolute', left: half, top: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: -half, top: 0, width: size, height: size }}>
            {disc(Math.min(a, 180))}
          </View>
        </View>
      ) : null}
      {a > 180 ? (
        <View style={{ position: 'absolute', left: 0, top: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}>{disc(a)}</View>
        </View>
      ) : null}
      <View
        style={{
          position: 'absolute',
          width: size - stroke * 2,
          height: size - stroke * 2,
          borderRadius: half,
          backgroundColor: hole,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Band inks for data read AGAINST TEXT (zone tables, banked seconds). */
export const zoneInk = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? color.zLow : k === 'mod' ? color.zMod : color.zHigh;

/** Emissive zone colours for lit dots, bars and rings (01-foundations-colour-06):
 * glow brighter than the band inks, never used for text. */
export const zoneNeon = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? color.neonStrain : k === 'mod' ? color.neonOk : color.neonBad;
