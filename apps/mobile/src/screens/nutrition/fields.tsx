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

/* The five pure ones now live in `@hybrid/nutrition-adapter/format`, because
   web logs into the same slice and had to parse and print a macro identically.
   Re-exported rather than re-imported at every call site: four screens already
   import them from here, and moving the import is churn that would show up in
   a diff as if the behaviour had changed. */
export { macro, macroLine, positiveQty, round, titleCase } from '@hybrid/nutrition-adapter';

export function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View className="min-w-0 flex-1">
      <T w="semi" className="text-2 uppercase tracking-widest text-dim">
        {label}
      </T>
      {/*
        Decimal-pad on EVERY numeric field. This used to switch to `number-pad`
        for macros, on the reasoning that a macro is a whole number read off a
        label. AU panels routinely print one decimal place, and our own label
        reader hands the athlete a value rounded to 1 dp — so Create-a-food
        prefilled "3.2" onto a keypad with no decimal key, and the athlete
        could delete the point but never type it back.
      */}
      <Input
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType="decimal-pad"
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
