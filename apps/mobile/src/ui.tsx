import {
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput as RNTextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { useTheme } from '@hybrid/design';
import { color as fallbackColor } from '@hybrid/design';

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
 * Three Android-only fixes, and it takes all three — the reps/RPE boxes were
 * still rendering clipped with only the first two:
 *
 *  includeFontPadding  drops the padding Android derives from Inter's own
 *                      ascent/descent metrics.
 *  textAlignVertical   centres the line in the box rather than sitting it on
 *                      the top edge.
 *  paddingVertical     drops the EditText's DEFAULT view padding, which the
 *                      two above do not touch. That default is what actually
 *                      broke it: the per-set boxes are h-4 (32px), and once
 *                      Android's own padding is added to a 13px line there is
 *                      no room left, so the glyphs are pushed out of the
 *                      visible box. The taller Movement field absorbed it,
 *                      which is exactly why that one always looked fine and
 *                      the short ones next to it did not.
 *
 * Only the VERTICAL padding is zeroed — horizontal padding comes from each
 * field's own px-* class and must survive. */
export function Input({ w = 'reg', num, style, ...rest }: TextInputProps & { w?: Fw; num?: boolean }) {
  const { color } = useTheme();
  return (
    <RNTextInput
      placeholderTextColor={color.dim}
      textAlignVertical="center"
      {...rest}
      /*
       * `color` FIRST, and it is not optional.
       *
       * React Native's TextInput defaults its text to BLACK on Android. This
       * app is black. So an <Input> that named no colour rendered what you
       * typed invisibly — the placeholder showed, because
       * `placeholderTextColor` was set right above, and then typing appeared
       * to erase it. Reported from the guided builder, but it was 32 of the
       * 33 <Input> uses in the app, including the Logger's weight and reps
       * fields.
       *
       * It belongs here rather than at each call site: a default that is
       * invisible is not a default anyone should have to remember to
       * override. It sits first in the array so a caller's own `style` — or a
       * NativeWind className, which compiles to one — still wins when a
       * screen genuinely wants a different colour.
       */
      style={[
        { color: color.text, fontFamily: font[w], includeFontPadding: false, paddingVertical: 0 },
        num ? tabular : null,
        style,
      ]}
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

/**
 * Android's floor for a touch target. iOS asks for 44; taking the larger of the
 * two means one number for both platforms and no per-platform branching.
 */
const MIN_TAP = 48;

/**
 * Every tappable thing in the app.
 *
 * Three properties were missing almost everywhere and were never going to be
 * remembered per call site: thirteen controls sat under the 44pt minimum (one
 * at 24px), and of thirty Pressables exactly none gave any press feedback. A
 * tap that produces no acknowledgement until the screen changes reads as "did
 * that register?" and invites a second tap — which, on a logger, means a set
 * confirmed twice.
 *
 * `box` is what the caller RENDERS, and the slop is computed from it to reach
 * MIN_TAP. Expanding the touch area rather than the visual is deliberate: the
 * design does not move, so this is a behavioural fix with a byte-identical
 * layout. Pass the height/width you set in `className` and it does the maths.
 */
export function Tap({
  children,
  onPress,
  box,
  disabled,
  className,
  style,
  label,
  role = 'button',
  selected,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  /** the rendered size in px; omit when the control is already comfortably big */
  box?: number | { h?: number; w?: number };
  className?: string;
  style?: ViewProps['style'];
  /** required when the child is a glyph rather than words — see the test */
  label?: string;
  /* 'radio' is for a row of view switches: it is what a screen reader
     announces selected/unselected state on, and RN's 'tab' role carries no
     tablist semantics to sit inside. */
  role?: 'button' | 'link' | 'radio';
  selected?: boolean;
}) {
  const h = typeof box === 'number' ? box : box?.h;
  const w = typeof box === 'number' ? box : box?.w;
  /* Half the shortfall on each side, so the expansion is symmetric about the
     control. hitSlop grows the touch rect only — nothing reflows. */
  const slop = {
    top: Math.max(0, Math.ceil((MIN_TAP - (h ?? MIN_TAP)) / 2)),
    bottom: Math.max(0, Math.ceil((MIN_TAP - (h ?? MIN_TAP)) / 2)),
    left: Math.max(0, Math.ceil((MIN_TAP - (w ?? MIN_TAP)) / 2)),
    right: Math.max(0, Math.ceil((MIN_TAP - (w ?? MIN_TAP)) / 2)),
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={slop}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, ...(selected == null ? {} : { selected }) }}
      /* Android draws a real ripple; on iOS it is a no-op, so the opacity step
         below is what gives that platform its feedback. Both land inside the
         80–150ms window a press needs to be acknowledged in. */
      android_ripple={disabled ? undefined : { color: 'rgba(255,255,255,.10)', borderless: false }}
      className={className}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: 0.65 } : null]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/** The small gold text-link that rides on a SectionHead — "History ›". These
 * are the doors to the screens that have no tab of their own. */
export function Link({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Tap onPress={onPress} box={{ h: 20 }} role="link">
      <T w="med" className="text-3 text-gold2">
        {children}
      </T>
    </Tap>
  );
}

/* Elevations from the tokens' shadow.card and shadow.lift — written in the
   inset-first order RN's boxShadow parser expects. */
const cardShadow = 'inset 0 1px 0 rgba(255,255,255,.028), 0 14px 34px -18px rgba(0,0,0,.9)';
const liftShadow =
  'inset 0 1px 0 rgba(255,255,255,.045), 0 22px 48px -20px rgba(0,0,0,.9), 0 0 0 1px rgba(224,188,135,.16)';

/**
 * Three card weights, matching the web app's `Card`.
 *
 * One surface for every card is a list, not a hierarchy: "Resume session" —
 * the single thing Home exists to offer — carried exactly the same border,
 * panel and shadow as the week's kg total, so the eye had to read each card to
 * find the important one.
 *
 * `raised` is the card holding the screen's primary action. `quiet` is
 * reference material, which drops the shadow and sinks to the recessed panel.
 * A screen should use `raised` at most once; nothing enforces that, and it is
 * the point of the tone existing.
 */
export function Card({
  className,
  style,
  tone,
  children,
  ...rest
}: ViewProps & { className?: string; tone?: 'raised' | 'quiet'; children: ReactNode }) {
  const skin =
    tone === 'raised' ? 'border-gold-line bg-panel' : tone === 'quiet' ? 'border-line bg-panel3' : 'border-line bg-panel';
  return (
    <View
      className={`rounded-lg border p-2 ${skin} ${className || ''}`}
      style={[{ boxShadow: tone === 'raised' ? liftShadow : tone === 'quiet' ? undefined : cardShadow }, style]}
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
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: 'brass' | 'ghost';
  size?: 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  /** Spoken name, when the visible child is a glyph (‹, ›) rather than words. */
  label?: string;
}) {
  const brass = variant === 'brass';
  const { color } = useTheme();
  /* py-1.5 + a 14px line box came to ~42px — under the bar by a hair, and the
     reason seven Settings buttons failed the audit. Declared rather than
     measured so Tap can make up the difference in slop. */
  const boxH = size === 'lg' ? 52 : 42;
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      box={{ h: boxH }}
      label={label ?? (typeof children === 'string' ? children : undefined)}
      className={`items-center justify-center rounded-md ${size === 'lg' ? 'px-3 py-2' : 'px-2 py-1.5'} ${
        brass ? 'bg-gold' : 'border border-line2 bg-panel2'
      } ${disabled ? 'opacity-40' : ''} ${className || ''}`}
      /* The brass edge from the tokens: a light top hairline and a dark seat,
         which is what makes the CTA read as a machined button, not a fill. */
      style={brass ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14), 0 1px 0 rgba(0,0,0,.35)' } : undefined}
    >
      <T w="med" className={size === 'lg' ? 'text-6' : 'text-5'} style={{ color: brass ? color.onAccent : color.text }}>
        {children}
      </T>
    </Tap>
  );
}

/** Selection chip per 03-shared-02: selected is the gold wash, never green. */
export function Chip({
  on,
  children,
  onPress,
  label,
}: {
  on?: boolean;
  children: ReactNode;
  onPress?: () => void;
  /** Spoken name, when the visible text is an abbreviation. */
  label?: string;
}) {
  return (
    /* The day chips are the smallest repeated control in the app — py-0.5
       around 10px type is ~22px tall — and they sit in a row of seven, so a
       mis-tap schedules the wrong day. The slop does not overlap neighbours:
       hitSlop is clipped by the parent, and the row has gap-0.5 between them. */
    <Tap
      onPress={onPress}
      box={{ h: 22 }}
      selected={!!on}
      label={label ?? (typeof children === 'string' ? children : undefined)}
      className={`items-center justify-center rounded-pill border px-1.5 py-0.5 ${
        on ? 'border-gold-line bg-gold-wash' : 'border-line2 bg-panel2'
      }`}
    >
      <T w="bold" className={`text-1 uppercase ${on ? 'text-gold2' : 'text-muted'}`} style={{ letterSpacing: 1 }}>
        {children}
      </T>
    </Tap>
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
  track,
  hole,
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
  const { color } = useTheme();
  const trackColor = track ?? color.trackSoft;
  const holeColor = hole ?? color.panel;
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
          borderColor: trackColor,
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
          backgroundColor: holeColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Band inks for data read AGAINST TEXT (zone tables, banked seconds).
 * `fallbackColor` is safe here specifically because these two functions only
 * ever touch SHARED keys — identical in both palettes — so a non-reactive
 * import can't return a value the active theme would have overridden. */
export const zoneInk = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? fallbackColor.zLow : k === 'mod' ? fallbackColor.zMod : fallbackColor.zHigh;

/** Emissive zone colours for lit dots, bars and rings (01-foundations-colour-06):
 * glow brighter than the band inks, never used for text. */
export const zoneNeon = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? fallbackColor.neonStrain : k === 'mod' ? fallbackColor.neonOk : fallbackColor.neonBad;

/**
 * A row of view switches — the web app's `Tabs`, for a phone.
 *
 * Not navigation: every tab is the same screen showing a different slice, so
 * these are `radio` for accessibility rather than links, and `selected` is
 * announced. Sized to fit three across without shrink-0, because with it three
 * labels plus counts clipped the last tab off the right edge on web.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View className="mt-2 flex-row gap-0.5">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <View key={t.key} className="min-w-0 flex-1">
            <Tap
              onPress={() => onChange(t.key)}
              role="radio"
              selected={on}
              label={`${t.label}${t.count != null ? `, ${t.count}` : ''}`}
              box={{ h: 34 }}
              className={`items-center justify-center rounded-md border px-1 py-1 ${
                on ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel3'
              }`}
            >
              <T w="semi" className={`text-2 uppercase ${on ? 'text-gold2' : 'text-dim'}`} style={{ letterSpacing: 0.6 }}>
                {t.label}
                {t.count != null ? ` ${t.count}` : ''}
              </T>
            </Tap>
          </View>
        );
      })}
    </View>
  );
}
