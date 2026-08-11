/*
 * The form-field helpers every nutrition screen needs, ported from mobile's
 * `apps/mobile/src/screens/nutrition/fields.tsx`.
 *
 * Mobile's file is two things: five PURE parse/format helpers, and four RN
 * components (`NumField`, `TextField`, `MealChips`, `UnitChips`) built on
 * React Native's `View`/`Input` from mobile's own `ui.tsx`. Only the pure half
 * ports here — the RN components are React Native, not web, and web already
 * has its own field primitives (`Field`, `Chip` in `../../ui`) that
 * `CustomFood.tsx` and `FoodSearch.tsx` already use. Porting `NumField` et al.
 * verbatim would mean two competing "the labelled number field" components on
 * web; matching FoodSearch/QuickAdd's existing convention is the one this repo
 * has already settled on, so that half of mobile's file is intentionally left
 * behind.
 *
 * The five pure helpers already live in `@hybrid/nutrition-adapter` (web and
 * mobile share the same package) — mobile's file only re-exports them under
 * this name so its four food-entry screens have one import line. Doing the
 * same here means `CustomFood.tsx` and, later, `RecipeBuilder.tsx` (Task 2.8)
 * import macro parsing from `./fields` exactly as mobile's screens do, rather
 * than each reaching into `@hybrid/nutrition-adapter` on its own.
 */
export { macro, macroLine, positiveQty, round, titleCase } from '@hybrid/nutrition-adapter';
