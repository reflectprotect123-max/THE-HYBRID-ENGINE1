# Nutrition food catalogue — apply and seed

The nutrition world stores athlete records in the ecosystem's opaque `nutrition`
snapshot, but the **food catalogue is relational and shared**. A 5,000-food
catalogue does not belong in a per-athlete JSON blob, so it lives in Postgres
tables created by
`supabase/migrations/20260807_macrotrack_food_catalogue.sql`.

This document is the human runbook. Nothing here is automated, and nothing here
runs against production without an explicit approval and a rollback plan (see
the repository's storage and release rules).

## What the migration creates

Two shared tables and sixteen athlete-owned ones.

| Ownership | Tables |
| --- | --- |
| **Shared catalogue** — every signed-in athlete reads, no client writes | `foods`, `food_servings` |
| **Owner-only** — visible and writable to one `auth.uid()` | `nutrition_profiles`, `custom_foods`, `recipes`, `recipe_items`, `food_log_entries`, `daily_log_status`, `weight_entries`, `weight_trend_points`, `macro_programs`, `macro_program_days`, `expenditure_estimates`, `weekly_check_ins`, `user_nutrient_targets`, `food_favorites`, `body_measurements`, `progress_photos` |

Plus the `daily_nutrition_totals` view, which is `security_invoker` so it
inherits the caller's RLS rather than the definer's.

Owned rows that carry a foreign key to another owned table (a log entry citing a
custom food, a favourite citing a recipe, a check-in citing a macro program)
must also prove the athlete owns the **referenced** row. A foreign-key check
does not consult RLS, so without that second test a guessed UUID would be a
bridge into someone else's account. `checks/migrations-apply.mjs` proves the
whole boundary empirically with two distinct athlete ids.

## 1. Apply the migration

Staging first, always.

```bash
supabase db push          # or your normal migration runner
```

It is additive: it creates only new objects and touches no existing table.
Rollback SQL is written at the foot of the migration file. Rolling back drops
every athlete's food log, so take a backup and confirm no field build still
reads the nutrition world.

Before pushing anywhere, prove it locally — this builds and destroys its own
Postgres cluster and never points at a real project:

```bash
node checks/migrations-apply.mjs
```

## 2. Generate seed SQL

The importers live in `scripts/nutrition-catalogue/` and are the same
reproducible pipeline the MacroTrack reference used. Python 3.10+; `requests`
is needed only for Open Food Facts **API** mode. No pandas, no Excel package.

```bash
cd scripts/nutrition-catalogue
python3 -m venv .venv && source .venv/bin/activate
python -m pip install requests    # API mode only
```

**Open Food Facts** (Australian products, barcodes). API mode filters for
Australia, then post-filters on the country tag, retries transient HTTP
responses, and writes batches of at most 500 rows:

```bash
python import_openfoodfacts.py --output seed_foods_off.sql
```

For a reproducible run from a local dump instead of the live API:

```bash
python import_openfoodfacts.py \
  --input openfoodfacts-products.jsonl.gz \
  --output seed_foods_off.sql
```

**AUSNUT / AFCD / NUTTAB** (generic Australian foods, no barcodes — the FSANZ
food id becomes `external_id`):

```bash
python import_ausnut.py \
  --nutrients "AUSNUT 2023 - Food nutrient profiles.xlsx" \
  --foods "AUSNUT 2023 - Food details.xlsx" \
  --measures "AUSNUT 2023 - Food measures.xlsx" \
  --output seed_foods_ausnut.sql
```

```bash
python import_ausnut.py --source nuttab \
  --nutrients NUTTAB_Nutrient_File.csv \
  --foods NUTTAB_Food_File.csv \
  --output seed_foods_nuttab.sql
```

`seed_foods_off.py` and `seed_foods_ausnut.py` are thin aliases for the two
importers, kept because the reference repo's docs and history refer to them.

Verify the pipeline still behaves before trusting its output:

```bash
cd scripts/nutrition-catalogue && python3 -m unittest discover -s tests -v
```

The `--legacy-schema` flag emits only the original eleven `foods` columns. It
exists for the pre-migration prototype table and is **not** what this repo
wants; omit it.

Generated `seed_foods_*.sql` is disposable build output. Do not commit large
food dumps.

## 3. Load the seed SQL

`foods` and `food_servings` have a read policy and no write policy on purpose:
no client can poison the catalogue every other athlete reads. Seeding therefore
needs a **service-role / admin connection**, which bypasses RLS.

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f seed_foods_off.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f seed_foods_ausnut.sql
```

The service-role key must never reach a client build. Mobile and web use the
publishable/anon key and rely on RLS.

## Current state: 471 of 5,000 foods

The reference project harvested **471 of a 5,000-product target** from Open
Food Facts Australia (10 API pages) plus AUSNUT. Those rows live in the
retired MacroTrack Supabase project, **not** in this one.

So the catalogue here starts empty, and someone must decide:

- **Re-run the importers** against this project — reproducible, and the natural
  choice since the pipeline is deterministic and the target Supabase project is
  different; or
- **Export and re-import** the 471 existing rows from the MacroTrack project.
  `foods_source_external_id_uidx` makes that idempotent, so a later re-run of
  the importers will not duplicate them.

Either way the catalogue is **529 foods short of the 5,000 target** and needs
more OFF API pages (`--max-pages`) or a local dump run to close the gap.

### What an empty catalogue looks like in the app

Phases 3 and 4 shipped the screens that read these tables, so the emptiness is
now visible rather than theoretical. `apps/mobile/src/cloud/catalogue.ts` is the
only reader: `foods` by name, `foods` by exact barcode, and `food_servings` for
a chosen food.

- **Food Search** finds only the athlete's own custom foods, recipes and
  favourites. That is a working screen with a thin result list, not an error.
- **The barcode scanner** will essentially always miss, because the lookup is
  exact and only exact — no leading zero added, no UPC-A widened to EAN-13, no
  fallback to a name search. A barcode that nearly matches is a different
  product, and logging the wrong product's macros is silent. A miss routes to
  Create-a-food carrying the barcode, which is the ordinary path rather than a
  dead end.
- **Nothing else degrades.** Quick Add, the Daily Log, weigh-ins, the engine and
  the weekly check-in never touch the catalogue.

## Rules the importers keep

Carried over from the reference project and still binding:

1. Never invent nutrition numbers, barcodes, serving weights, densities, or
   nutrient units. The OFF importer converts kJ to kcal only when kcal is
   absent, and refuses to guess a gram↔millilitre density.
2. Preserve source provenance and the original nutrient profile
   (`source`, `external_id`, `source_url`, `nutrients`, `data_quality`).
3. Barcode products and generic foods stay separate: AUSNUT/NUTTAB rows have a
   null `barcode` and use the source food id as `external_id`.
4. SQL batches stay at 500 rows or fewer.
5. Generated seed SQL is disposable output.
