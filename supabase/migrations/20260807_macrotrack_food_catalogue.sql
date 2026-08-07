-- MacroTrack food catalogue and nutrition records (Phase 2)
--
-- This is the relational half of the nutrition world. 20260807_nutrition_domain
-- admitted `nutrition` to the opaque-snapshot ecosystem contract; this migration
-- adds the tables that deliberately do NOT belong in a synced JSON blob: a
-- shared 5,000-food catalogue plus the per-athlete records that reference it.
--
-- PORT NOTE — consolidation
--
-- The source repository (reflectprotect123-max/thehybridsystem) shipped this as
-- five files, 001_macro_foundation .. 005_checkin_program_provenance. Four and
-- five exist only to repair one and two: 004 replaces three policies from 001
-- verbatim, 005 drops a unique constraint 001 created and replaces a fourth
-- policy, 002/003 add unique indexes 001 omitted. None of those five files has
-- ever run against this project's database, so replaying the repair history
-- would mean creating objects for the sole purpose of dropping them in the same
-- transaction. They are consolidated here into the single END STATE: every
-- policy is the 004/005 version, every unique index from 002/003/005 is created
-- directly, and the superseded `unique (user_id, week_start)` on
-- weekly_check_ins is simply never created. Nothing else was changed, and the
-- 001 block that upgraded a pre-existing eleven-column prototype `foods` table
-- in place is dropped as dead code — there is no prototype table here.
--
-- NAME COLLISIONS: none. Checked against public.app_state, coach_library,
-- coach_athletes, programs, assignments, athlete_feed (supabase-schema.sql) and
-- athlete_core, athlete_domain_snapshots, athlete_events, athlete_weekly_plans
-- (20260804). `programs` and `macro_programs` are distinct names; no function,
-- policy, index, view or type name is shared. Nothing here is renamed.
--
-- ADDITIVE ONLY: every statement is create-if-not-exists or a drop/create of a
-- policy this migration itself owns. No existing table, column, constraint or
-- policy is touched.
--
-- OWNERSHIP BOUNDARY (the thing that must not be got wrong):
--   * public.foods and public.food_servings are the SHARED catalogue —
--     every authenticated athlete reads all rows; nobody writes through the
--     API. Seeding is a service-role/admin job (see docs/NUTRITION_CATALOGUE.md).
--   * every other table is OWNER-ONLY. Custom foods, recipes, log entries,
--     weights, programs, check-ins, measurements and photos are visible and
--     writable only to the athlete whose auth.uid() owns them, and a row that
--     carries a foreign key to another owned table must also prove the athlete
--     owns the referenced row — otherwise a guessed UUID becomes a bridge into
--     someone else's account.
--
-- ROLLBACK is at the foot of this file.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.foods (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    brand text,
    barcode text,
    serving_qty numeric not null default 100,
    serving_unit text not null default 'g',
    calories numeric not null default 0,
    protein_g numeric not null default 0,
    carbs_g numeric not null default 0,
    fat_g numeric not null default 0,
    source text not null default 'custom',
    external_id text,
    nutrition_basis_qty numeric not null default 100,
    nutrition_basis_unit text not null default 'g',
    serving_size_text text,
    nutrients jsonb not null default '{}'::jsonb,
    ingredients_text text,
    allergens text[],
    categories text[],
    countries text[],
    image_url text,
    source_url text,
    source_updated_at timestamptz,
    data_quality text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists foods_source_external_id_uidx
    on public.foods (source, external_id)
    where source is not null and external_id is not null;
create index if not exists foods_barcode_idx on public.foods (barcode) where barcode is not null;
create index if not exists foods_name_search_idx on public.foods (lower(name));
create index if not exists foods_brand_search_idx on public.foods (lower(brand)) where brand is not null;

create table if not exists public.food_servings (
    id uuid primary key default gen_random_uuid(),
    food_id uuid not null references public.foods(id) on delete cascade,
    label text not null,
    quantity numeric not null,
    unit text not null,
    grams numeric,
    millilitres numeric,
    is_default boolean not null default false,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique (food_id, label)
);

-- ---------------------------------------------------------------------------
-- Athlete-owned records
-- ---------------------------------------------------------------------------

create table if not exists public.nutrition_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    sex text check (sex in ('female', 'male', 'other', 'unspecified')),
    birth_date date,
    height_cm numeric check (height_cm is null or height_cm between 50 and 260),
    current_weight_kg numeric check (current_weight_kg is null or current_weight_kg between 20 and 500),
    body_fat_pct numeric check (body_fat_pct is null or body_fat_pct between 2 and 70),
    activity_level text not null default 'moderate',
    timezone text not null default 'Australia/Sydney',
    unit_system text not null default 'metric' check (unit_system in ('metric', 'imperial')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.custom_foods (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    brand text,
    barcode text,
    serving_qty numeric not null default 100,
    serving_unit text not null default 'g',
    calories numeric not null default 0,
    protein_g numeric not null default 0,
    carbs_g numeric not null default 0,
    fat_g numeric not null default 0,
    nutrients jsonb not null default '{}'::jsonb,
    ingredients_text text,
    allergens text[],
    source text not null default 'user_custom',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists custom_foods_user_name_idx on public.custom_foods (user_id, lower(name));
create index if not exists custom_foods_barcode_idx on public.custom_foods (user_id, barcode) where barcode is not null;

create table if not exists public.recipes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    instructions text,
    servings numeric not null default 1 check (servings > 0),
    image_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.recipe_items (
    id uuid primary key default gen_random_uuid(),
    recipe_id uuid not null references public.recipes(id) on delete cascade,
    food_id uuid references public.foods(id) on delete restrict,
    custom_food_id uuid references public.custom_foods(id) on delete restrict,
    quantity numeric not null check (quantity > 0),
    unit text not null default 'g',
    sort_order integer not null default 0,
    check ((food_id is not null) <> (custom_food_id is not null))
);
create index if not exists recipe_items_recipe_idx on public.recipe_items (recipe_id, sort_order);

create table if not exists public.food_log_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    log_date date not null,
    meal text not null default 'other',
    entry_kind text not null check (entry_kind in ('food', 'custom_food', 'recipe', 'quick_add')),
    food_id uuid references public.foods(id) on delete restrict,
    custom_food_id uuid references public.custom_foods(id) on delete restrict,
    recipe_id uuid references public.recipes(id) on delete restrict,
    quantity numeric not null default 1 check (quantity > 0),
    unit text not null default 'serving',
    calories numeric not null default 0,
    protein_g numeric not null default 0,
    carbs_g numeric not null default 0,
    fat_g numeric not null default 0,
    nutrients jsonb not null default '{}'::jsonb,
    display_name text not null,
    source_snapshot jsonb not null default '{}'::jsonb,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    check (
        (entry_kind = 'food' and food_id is not null and custom_food_id is null and recipe_id is null)
        or (entry_kind = 'custom_food' and food_id is null and custom_food_id is not null and recipe_id is null)
        or (entry_kind = 'recipe' and food_id is null and custom_food_id is null and recipe_id is not null)
        or (entry_kind = 'quick_add' and food_id is null and custom_food_id is null and recipe_id is null)
    )
);
create index if not exists food_log_user_date_idx on public.food_log_entries (user_id, log_date);
create index if not exists food_log_user_created_idx on public.food_log_entries (user_id, created_at desc);

-- Explicit day state prevents the expenditure engine from treating an
-- unlogged day as a normal low-calorie day. 'fasted' is a user declaration,
-- not an inference from missing entries.
create table if not exists public.daily_log_status (
    user_id uuid not null references auth.users(id) on delete cascade,
    log_date date not null,
    status text not null check (status in ('complete', 'partial', 'fasted', 'unlogged')),
    note text,
    updated_at timestamptz not null default now(),
    primary key (user_id, log_date)
);

create table if not exists public.weight_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    measured_at timestamptz not null,
    weight_kg numeric not null check (weight_kg between 20 and 500),
    source text not null default 'manual',
    note text,
    created_at timestamptz not null default now()
);
create index if not exists weight_entries_user_time_idx on public.weight_entries (user_id, measured_at);

create table if not exists public.weight_trend_points (
    user_id uuid not null references auth.users(id) on delete cascade,
    trend_date date not null,
    trend_weight_kg numeric not null,
    method text not null default 'ewma_reference',
    source_window_days integer not null default 14,
    created_at timestamptz not null default now(),
    primary key (user_id, trend_date)
);

create table if not exists public.macro_programs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null default 'Macro program',
    mode text not null check (mode in ('coached', 'collaborative', 'manual')),
    goal text not null check (goal in ('lose', 'gain', 'maintain')),
    target_rate_kg_per_week numeric not null default 0,
    start_date date not null,
    end_date date,
    weekly_calorie_budget numeric,
    protein_preference text,
    fat_preference text,
    status text not null default 'active' check (status in ('draft', 'active', 'paused', 'completed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((goal = 'lose' and target_rate_kg_per_week <= 0)
        or (goal = 'gain' and target_rate_kg_per_week >= 0)
        or (goal = 'maintain' and target_rate_kg_per_week = 0))
);
create index if not exists macro_programs_user_status_idx on public.macro_programs (user_id, status);

-- From source 002: one active goal per athlete. The client keeps the active
-- goal durable and links weekly check-ins to it.
create unique index if not exists macro_programs_one_active_per_user_uidx
    on public.macro_programs (user_id)
    where status = 'active';

create table if not exists public.macro_program_days (
    program_id uuid not null references public.macro_programs(id) on delete cascade,
    target_date date not null,
    calories numeric not null,
    protein_g numeric not null,
    carbs_g numeric not null,
    fat_g numeric not null,
    source text not null default 'engine',
    created_at timestamptz not null default now(),
    primary key (program_id, target_date)
);

create table if not exists public.expenditure_estimates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    window_start date not null,
    window_end date not null,
    estimate_kcal numeric not null,
    previous_estimate_kcal numeric,
    raw_estimate_kcal numeric,
    trend_slope_kg_per_week numeric,
    nutrition_days integer not null default 0,
    weight_days integer not null default 0,
    confidence text not null check (confidence in ('holding', 'low', 'medium', 'high')),
    state text not null check (state in ('holding', 'updating')),
    method text not null default 'intake_minus_trend_energy',
    inputs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists expenditure_user_created_idx on public.expenditure_estimates (user_id, created_at desc);

-- From source 003: a same-day recompute of derived expenditure must replace
-- the existing row atomically (ON CONFLICT), never delete-then-insert.
create unique index if not exists expenditure_estimates_user_window_end_uidx
    on public.expenditure_estimates (user_id, window_end);

create table if not exists public.weekly_check_ins (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid references public.macro_programs(id) on delete set null,
    week_start date not null,
    week_end date not null,
    status text not null check (status in ('pending', 'held', 'accepted', 'declined')),
    previous_expenditure_kcal numeric,
    observed_expenditure_kcal numeric,
    proposed_expenditure_kcal numeric,
    proposed_calories numeric,
    proposed_protein_g numeric,
    proposed_carbs_g numeric,
    proposed_fat_g numeric,
    modules jsonb not null default '[]'::jsonb,
    explanation text not null,
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

-- From source 005. The natural key is (user_id, program_id, week_start), NOT
-- (user_id, week_start): a goal change mid-week would otherwise let the new
-- program's proposal overwrite the previous program's, destroying provenance.
-- program_id is nullable and Postgres treats NULLs as distinct by default, so
-- without NULLS NOT DISTINCT a program-less row would get no uniqueness at all
-- and `on conflict (user_id, program_id, week_start)` could never match it —
-- every recompute would append instead of update. NULLS NOT DISTINCT needs
-- Postgres 15+, which Supabase provides.
create unique index if not exists weekly_check_ins_user_program_week_uidx
    on public.weekly_check_ins (user_id, program_id, week_start)
    nulls not distinct;

create table if not exists public.user_nutrient_targets (
    user_id uuid not null references auth.users(id) on delete cascade,
    nutrient_key text not null,
    target_amount numeric not null,
    unit text not null,
    target_type text not null default 'custom' check (target_type in ('system', 'custom')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, nutrient_key)
);

create table if not exists public.food_favorites (
    user_id uuid not null references auth.users(id) on delete cascade,
    food_id uuid references public.foods(id) on delete cascade,
    custom_food_id uuid references public.custom_foods(id) on delete cascade,
    recipe_id uuid references public.recipes(id) on delete cascade,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    check (((food_id is not null)::integer + (custom_food_id is not null)::integer + (recipe_id is not null)::integer) = 1)
);
create unique index if not exists food_favorites_food_uidx on public.food_favorites (user_id, food_id) where food_id is not null;
create unique index if not exists food_favorites_custom_uidx on public.food_favorites (user_id, custom_food_id) where custom_food_id is not null;
create unique index if not exists food_favorites_recipe_uidx on public.food_favorites (user_id, recipe_id) where recipe_id is not null;

create table if not exists public.body_measurements (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    measured_on date not null,
    waist_cm numeric,
    chest_cm numeric,
    hip_cm numeric,
    arm_cm numeric,
    thigh_cm numeric,
    note text,
    created_at timestamptz not null default now()
);

create table if not exists public.progress_photos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    captured_on date not null,
    storage_path text not null,
    view_name text,
    note text,
    created_at timestamptz not null default now()
);

-- security_invoker keeps the caller's RLS on food_log_entries in force; a
-- default (definer) view would hand every athlete's daily totals to everyone.
create or replace view public.daily_nutrition_totals
with (security_invoker = true)
as
select
    user_id,
    log_date,
    coalesce(sum(calories) filter (where deleted_at is null), 0) as calories,
    coalesce(sum(protein_g) filter (where deleted_at is null), 0) as protein_g,
    coalesce(sum(carbs_g) filter (where deleted_at is null), 0) as carbs_g,
    coalesce(sum(fat_g) filter (where deleted_at is null), 0) as fat_g,
    count(*) filter (where deleted_at is null) as entry_count
from public.food_log_entries
group by user_id, log_date;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.foods enable row level security;
alter table public.food_servings enable row level security;
alter table public.nutrition_profiles enable row level security;
alter table public.custom_foods enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.food_log_entries enable row level security;
alter table public.daily_log_status enable row level security;
alter table public.weight_entries enable row level security;
alter table public.weight_trend_points enable row level security;
alter table public.macro_programs enable row level security;
alter table public.macro_program_days enable row level security;
alter table public.expenditure_estimates enable row level security;
alter table public.weekly_check_ins enable row level security;
alter table public.user_nutrient_targets enable row level security;
alter table public.food_favorites enable row level security;
alter table public.body_measurements enable row level security;
alter table public.progress_photos enable row level security;

-- Table privileges. The source migrations relied on Supabase's project-level
-- default ACL, which grants ALL on every public table to both `anon` and
-- `authenticated` and leaves RLS as the only gate. This repository states the
-- grants explicitly instead, so the file is self-describing and applies the
-- same way to a bare Postgres: `anon` gets nothing at all, and `authenticated`
-- gets only what its policies could ever allow — read-only on the shared
-- catalogue, full CRUD on owned tables. This is strictly narrower than the
-- Supabase default; it removes no capability the policies granted.
grant select on public.foods, public.food_servings, public.daily_nutrition_totals to authenticated;
grant select, insert, update, delete on
    public.nutrition_profiles,
    public.custom_foods,
    public.recipes,
    public.recipe_items,
    public.food_log_entries,
    public.daily_log_status,
    public.weight_entries,
    public.weight_trend_points,
    public.macro_programs,
    public.macro_program_days,
    public.expenditure_estimates,
    public.weekly_check_ins,
    public.user_nutrient_targets,
    public.food_favorites,
    public.body_measurements,
    public.progress_photos
to authenticated;

-- Shared catalogue: read for every signed-in athlete, write for nobody. There
-- is deliberately no insert/update/delete policy — seeding is a service-role
-- job (service_role bypasses RLS), so no client can poison the catalogue that
-- every other athlete reads.
drop policy if exists "foods_read_authenticated" on public.foods;
create policy "foods_read_authenticated" on public.foods
    for select to authenticated using (true);
drop policy if exists "food_servings_read_authenticated" on public.food_servings;
create policy "food_servings_read_authenticated" on public.food_servings
    for select to authenticated using (true);

-- Owner-only tables keyed directly by user_id.
drop policy if exists "profile_owner_all" on public.nutrition_profiles;
create policy "profile_owner_all" on public.nutrition_profiles for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "custom_food_owner_all" on public.custom_foods;
create policy "custom_food_owner_all" on public.custom_foods for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "recipe_owner_all" on public.recipes;
create policy "recipe_owner_all" on public.recipes for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "day_status_owner_all" on public.daily_log_status;
create policy "day_status_owner_all" on public.daily_log_status for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "weight_owner_all" on public.weight_entries;
create policy "weight_owner_all" on public.weight_entries for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "trend_owner_all" on public.weight_trend_points;
create policy "trend_owner_all" on public.weight_trend_points for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "program_owner_all" on public.macro_programs;
create policy "program_owner_all" on public.macro_programs for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "expenditure_owner_all" on public.expenditure_estimates;
create policy "expenditure_owner_all" on public.expenditure_estimates for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "nutrient_target_owner_all" on public.user_nutrient_targets;
create policy "nutrient_target_owner_all" on public.user_nutrient_targets for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "measurement_owner_all" on public.body_measurements;
create policy "measurement_owner_all" on public.body_measurements for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "photo_owner_all" on public.progress_photos;
create policy "photo_owner_all" on public.progress_photos for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Tables owned through a parent row rather than their own user_id.
drop policy if exists "program_day_owner_all" on public.macro_program_days;
create policy "program_day_owner_all" on public.macro_program_days for all to authenticated
    using (exists (select 1 from public.macro_programs p
                    where p.id = macro_program_days.program_id and p.user_id = auth.uid()))
    with check (exists (select 1 from public.macro_programs p
                    where p.id = macro_program_days.program_id and p.user_id = auth.uid()));

-- OWNER-REFERENCE POLICIES (source 004 and the tail of 005).
--
-- This is the part the whole port turns on. Scoping a row by its own user_id is
-- necessary but not sufficient: a row that CARRIES a foreign key to another
-- owned table is a bridge. Nothing stops an athlete from inserting a row they
-- own that points at a UUID belonging to somebody else — and a foreign key
-- check does not consult RLS, so the FK will happily accept it. The reference
-- itself must therefore be re-checked against auth.uid() in `with check`.
--
-- Reads stay simple (`using (user_id = auth.uid())`) because a row you do not
-- own is already invisible; it is the WRITE side that needs the extra proof.
-- Catalogue references (food_id) need no ownership check by design: the
-- catalogue is shared, and pointing at a public food reveals nothing.

drop policy if exists "recipe_item_owner_all" on public.recipe_items;
create policy "recipe_item_owner_all" on public.recipe_items for all to authenticated
    using (
        exists (
            select 1
            from public.recipes r
            where r.id = recipe_items.recipe_id
              and r.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1
            from public.recipes r
            where r.id = recipe_items.recipe_id
              and r.user_id = auth.uid()
        )
        and (
            recipe_items.custom_food_id is null
            or exists (
                select 1
                from public.custom_foods cf
                where cf.id = recipe_items.custom_food_id
                  and cf.user_id = auth.uid()
            )
        )
    );

drop policy if exists "food_log_owner_all" on public.food_log_entries;
create policy "food_log_owner_all" on public.food_log_entries for all to authenticated
    using (user_id = auth.uid())
    with check (
        user_id = auth.uid()
        and (
            food_log_entries.custom_food_id is null
            or exists (
                select 1
                from public.custom_foods cf
                where cf.id = food_log_entries.custom_food_id
                  and cf.user_id = auth.uid()
            )
        )
        and (
            food_log_entries.recipe_id is null
            or exists (
                select 1
                from public.recipes r
                where r.id = food_log_entries.recipe_id
                  and r.user_id = auth.uid()
            )
        )
    );

drop policy if exists "favorite_owner_all" on public.food_favorites;
create policy "favorite_owner_all" on public.food_favorites for all to authenticated
    using (user_id = auth.uid())
    with check (
        user_id = auth.uid()
        and (
            food_favorites.custom_food_id is null
            or exists (
                select 1
                from public.custom_foods cf
                where cf.id = food_favorites.custom_food_id
                  and cf.user_id = auth.uid()
            )
        )
        and (
            food_favorites.recipe_id is null
            or exists (
                select 1
                from public.recipes r
                where r.id = food_favorites.recipe_id
                  and r.user_id = auth.uid()
            )
        )
    );

drop policy if exists "checkin_owner_all" on public.weekly_check_ins;
create policy "checkin_owner_all" on public.weekly_check_ins for all to authenticated
    using (user_id = auth.uid())
    with check (
        user_id = auth.uid()
        and (
            program_id is null
            or exists (
                select 1
                from public.macro_programs p
                where p.id = weekly_check_ins.program_id
                  and p.user_id = auth.uid()
            )
        )
    );

-- ROLLBACK
--
-- These tables are new and independent: nothing in app_state, athlete_core,
-- athlete_domain_snapshots, athlete_events or athlete_weekly_plans references
-- them, so dropping them cannot break the training domains. It DOES destroy
-- every athlete's food log, so take a backup first and confirm no client build
-- in the field still reads the nutrition world.
--
--   drop view if exists public.daily_nutrition_totals;
--   drop table if exists public.progress_photos, public.body_measurements,
--     public.food_favorites, public.user_nutrient_targets,
--     public.weekly_check_ins, public.expenditure_estimates,
--     public.macro_program_days, public.macro_programs,
--     public.weight_trend_points, public.weight_entries,
--     public.daily_log_status, public.food_log_entries, public.recipe_items,
--     public.recipes, public.custom_foods, public.nutrition_profiles,
--     public.food_servings, public.foods cascade;
--
-- The pgcrypto extension is left in place; other migrations may rely on it.
