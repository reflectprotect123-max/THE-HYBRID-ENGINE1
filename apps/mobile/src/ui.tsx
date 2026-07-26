import { Pressable, ScrollView, Text, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

/*
 * Mobile primitives.
 *
 * Same names and same visual language as apps/web/src/ui — the two apps are one
 * product, and a card should not be subtly different depending on which one you
 * opened. Spacing resolves through the same 8px scale (NativeWind's config
 * mirrors the web theme), so `p-2` is 16px in both.
 *
 * Font weights are the one place they legitimately differ: React Native only
 * accepts the nine standard weights, so the design system's 650/750 steps round
 * to bold/black here while the web keeps them via a variable font.
 */

export function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-bg"
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

export function Kicker({ children }: { children: ReactNode }) {
  return <Text className="text-2 font-bold uppercase tracking-widest text-dim">{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-8 font-black text-text">{children}</Text>;
}

export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="mt-3 mb-1 flex-row items-end justify-between">
      <Text className="text-6 font-bold text-text">{title}</Text>
      {right}
    </View>
  );
}

export function Card({ className, children, ...rest }: ViewProps & { className?: string; children: ReactNode }) {
  return (
    <View className={`rounded-lg border border-line bg-panel p-2 ${className || ''}`} {...rest}>
      {children}
    </View>
  );
}

export function Btn({
  children,
  onPress,
  variant = 'ghost',
  className,
  disabled,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: 'brass' | 'ghost';
  className?: string;
  disabled?: boolean;
}) {
  const brass = variant === 'brass';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center justify-center rounded-md px-2 py-1.5 ${
        brass ? 'bg-gold' : 'border border-line2 bg-panel2'
      } ${disabled ? 'opacity-40' : ''} ${className || ''}`}
    >
      <Text className={`text-5 font-bold ${brass ? 'text-bg' : 'text-text'}`}>{children}</Text>
    </Pressable>
  );
}

export function Chip({ on, children, onPress }: { on?: boolean; children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-pill border px-1.5 py-0.5 ${
        on ? 'border-done-line bg-done-bg' : 'border-line2 bg-panel2'
      }`}
    >
      <Text className={`text-3 font-bold ${on ? 'text-done-ink' : 'text-muted'}`}>{children}</Text>
    </Pressable>
  );
}

export function Ltr({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-sm border border-gold-line bg-gold-wash px-0.5">
      <Text className="text-3 font-black text-gold2">{children}</Text>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card className="items-center py-4">
      <Text className="text-6 font-bold text-text">{title}</Text>
      {body ? <Text className="mt-1 text-center text-4 text-muted">{body}</Text> : null}
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

/** A labelled row of two numbers, used everywhere zone times are shown. */
export function Row({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <View className="mt-0.5 flex-row items-center">
      {dot ? <View className="mr-1 h-1 w-1 rounded-pill" style={{ backgroundColor: dot }} /> : null}
      <Text className="flex-1 text-4 text-text">{label}</Text>
      <Text className="text-4 text-muted">{value}</Text>
    </View>
  );
}

export const zoneInk = (k: 'low' | 'mod' | 'high') =>
  k === 'low' ? '#5b8def' : k === 'mod' ? '#cf9d4f' : '#e0524d';
