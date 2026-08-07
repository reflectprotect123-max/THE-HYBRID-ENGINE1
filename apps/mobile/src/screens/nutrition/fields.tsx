import { View } from 'react-native';
import { MEALS } from '@hybrid/nutrition-core';
import { Chip, Input, T } from '../../ui';

/*
 * The form pieces every nutrition screen builds out of.
 *
 * Not new UI primitives — each one is a composition of `Input`, `Chip` and `T`
 * from ui.tsx, lifted here out of DailyLog when the four food-entry screens
 * needed the same labelled number field and the same meal row. Five copies of a
 * number field is five places for the keyboard type or the accessibility label
 * to drift apart.
 */

/**
 * A typed number, or 0.
 *
 * Negative and non-finite go to 0 rather than through: the sanitizer clamps
 * them on the next load anyway, and a `NaN` written now is a total that reads
 * `NaN kcal` until then.
 */
export const macro = (s: string): number => {
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A quantity that something will be DIVIDED by, or null when it isn't one. */
export const positiveQty = (s: string): number | null => {
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const round = (n: number): string => String(Math.round(n));

/** Macros as the app writes them everywhere: rounded, in one line. */
export const macroLine = (m: { calories: number; proteinG: number; carbsG: number; fatG: number }): string =>
  `${round(m.calories)} kcal · ${round(m.proteinG)}P ${round(m.carbsG)}C ${round(m.fatG)}F`;

export const titleCase = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function NumField({
  label,
  value,
  onChange,
  /* Decimal for a quantity (1.5 servings, 43.5 g), number-pad for a macro the
     athlete reads off a label as a whole number. Getting this wrong on a
     quantity means the athlete cannot type the number on the packet. */
  decimal,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  decimal?: boolean;
}) {
  return (
    <View className="min-w-0 flex-1">
      <T w="semi" className="text-2 uppercase tracking-widest text-dim">
        {label}
      </T>
      <Input
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        num
        w="semi"
        className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
      />
    </View>
  );
}

/** A single-line text field with its own label above it. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View className="mt-1.5">
      <T w="semi" className="text-2 uppercase tracking-widest text-dim">
        {label}
      </T>
      <Input
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholder={placeholder}
        className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
      />
    </View>
  );
}

/** The meal row. Free text in the model, five suggestions in the UI. */
export function MealChips({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <View className="mt-1.5 flex-row flex-wrap gap-0.5">
      {MEALS.map((m) => (
        <Chip key={m} on={value === m} onPress={() => onChange(m)}>
          {m}
        </Chip>
      ))}
    </View>
  );
}

/**
 * The unit row. Shown even with one option, because "g" beside the quantity is
 * the difference between logging 100 g and logging 100 servings.
 */
export function UnitChips({
  units,
  value,
  onChange,
}: {
  units: readonly string[];
  value: string;
  onChange: (u: string) => void;
}) {
  return (
    <View className="mt-1.5 flex-row flex-wrap gap-0.5">
      {units.map((u) => (
        <Chip key={u} on={value === u} onPress={() => onChange(u)} label={`unit ${u}`}>
          {u}
        </Chip>
      ))}
    </View>
  );
}
