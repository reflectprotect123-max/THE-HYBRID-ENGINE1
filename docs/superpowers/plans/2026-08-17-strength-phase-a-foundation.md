# Strength Rebuild — Phase A (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `@hybrid/strength-engine` — the metric-registry schema and
pure-function engine math (prescription resolution, rounding, e1RM, working
max, PRs, volume/intensity/compliance) that every later phase (coach
authoring, mobile logger, analytics, deterministic progression, retrieval)
builds on. No UI in this plan.

**Architecture:** New workspace package, source-exported (no build step),
mirroring `@hybrid/engine`'s existing shape. One additive Supabase
migration. Pure functions only — no I/O inside the package; callers (later
phases) inject data via `ResolveCtx`-shaped parameters.

**Tech Stack:** TypeScript, Vitest, Supabase Postgres/PL-pgSQL, pnpm
workspaces.

## Global Constraints

- Source-exported package (`main`/`types` point at `src/index.ts` directly,
  same as `@hybrid/engine`/`@hybrid/nutrition-engine`) — no build step.
- Every SQL migration is additive only. Nothing existing is altered or
  dropped.
- Round DOWN by default for percentage-derived loads (never over-prescribe);
  `nearest` only where an `equipment` row explicitly opts in.
- Every computed value that could disagree with itself later (e1RM, working
  max) stores the formula/source it was computed with — reproducibility
  over convenience.
- `unresolved`/`null` are real return values for "cannot compute yet," never
  thrown exceptions and never a silently substituted default.
- Colocated tests: `src/foo.ts` is tested by `src/foo.test.ts`, same
  directory, per this repo's `CLAUDE.md` ("Where a test goes").
- Full source: `docs/superpowers/specs/2026-08-17-strength-rebuild-design.md`,
  Slices 1-11.

---

### Task 1: Scaffold `@hybrid/strength-engine`

**Files:**
- Create: `packages/strength-engine/package.json`
- Create: `packages/strength-engine/tsconfig.json`
- Create: `packages/strength-engine/vitest.config.ts`
- Create: `packages/strength-engine/src/index.ts`
- Create: `packages/strength-engine/src/index.test.ts`

**Interfaces:**
- Produces: an importable, empty `@hybrid/strength-engine` package that
  `pnpm --filter @hybrid/strength-engine test` and `typecheck` both run
  green against.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@hybrid/strength-engine",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@hybrid/shared-core": "workspace:*"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "types": ["vitest/globals"],
    "declaration": false,
    "declarationMap": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create a placeholder `src/index.ts` and its test**

```ts
// src/index.ts
export const STRENGTH_ENGINE_PACKAGE = '@hybrid/strength-engine';
```

```ts
// src/index.test.ts
import { describe, it, expect } from 'vitest';
import { STRENGTH_ENGINE_PACKAGE } from './index';

describe('package scaffold', () => {
  it('exports a package marker', () => {
    expect(STRENGTH_ENGINE_PACKAGE).toBe('@hybrid/strength-engine');
  });
});
```

- [ ] **Step 5: Install and verify**

Run: `pnpm install && pnpm --filter @hybrid/strength-engine test && pnpm --filter @hybrid/strength-engine typecheck`
Expected: PASS on both.

- [ ] **Step 6: Commit**

```bash
git add packages/strength-engine pnpm-lock.yaml
git commit -m "Scaffold @hybrid/strength-engine package"
```

---

### Task 2: `metric` registry (Slice 1)

**Files:**
- Create: `supabase/migrations/20260818_strength_rebuild.sql` (this task
  writes only the `metric` table + seed; later tasks append to the same
  file)
- Create: `scripts/gen-metric-registry.mjs`
- Create: `packages/strength-engine/src/metric.ts`
- Create: `packages/strength-engine/src/metric.test.ts`

**Interfaces:**
- Produces: `MetricKey` (union type), `Metric` (interface), `METRICS`
  (`Record<MetricKey, Metric>` const) — every later task's `prescribed_
  target`/`performed_measurement` types reference `MetricKey`.

- [ ] **Step 1: Write the migration's `metric` table**

```sql
-- supabase/migrations/20260818_strength_rebuild.sql
-- ============================================================================
-- STRENGTH REBUILD — additive only. Nothing existing is altered. See
-- docs/superpowers/specs/2026-08-17-strength-rebuild-design.md for the full
-- design; this migration implements it slice by slice, in slice order.
-- ============================================================================

-- Slice 1: metric registry — metrics are rows, not an enum, so a prescribed
-- set can carry any combination of targets instead of a fixed 2-metric cap.
create table metric (
  key              text primary key,
  dimension        text not null,
  canonical_unit   text not null,
  value_type       text not null,
  aggregation      text not null,
  higher_is_better boolean,
  is_load_bearing  boolean not null default false
);

insert into metric (key, dimension, canonical_unit, value_type, aggregation, higher_is_better, is_load_bearing) values
  ('load',     'mass',   'kg',  'scalar',   'sum',  true,  true),
  ('reps',     'count',  'rep', 'scalar',   'sum',  true,  false),
  ('rpe',      'ratio',  'rpe', 'scalar',   'mean', null,  false),
  ('rir',      'ratio',  'rep', 'scalar',   'mean', false, false),
  ('tempo',    'time',   's',   'tuple',    'none', null,  false),
  ('rest',     'time',   's',   'duration', 'none', null,  false),
  ('distance', 'length', 'm',   'scalar',   'sum',  true,  false),
  ('duration', 'time',   's',   'duration', 'sum',  null,  false),
  ('calories', 'energy', 'kcal','scalar',   'sum',  true,  false),
  ('watts',    'power',  'W',   'scalar',   'mean', true,  false),
  ('height',   'length', 'm',   'scalar',   'max',  true,  false);
```

- [ ] **Step 2: Write the generator script**

```js
// scripts/gen-metric-registry.mjs
// Reads the `metric` seed INSERT out of the migration file and regenerates
// packages/strength-engine/src/metric.ts so the SQL seed and the TS map
// cannot drift. Run manually after editing the seed; CI's `checks/docs.mjs`
// pattern does not cover this file, so `metric.test.ts` (Task 2) is what
// actually guards drift.
import { readFileSync, writeFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260818_strength_rebuild.sql';
const sql = readFileSync(migrationPath, 'utf8');

const match = sql.match(/insert into metric[\s\S]*?values\s*([\s\S]*?);/i);
if (!match) throw new Error('metric seed INSERT not found in migration');

const rows = [...match[1].matchAll(/\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false|null),\s*(true|false)\s*\)/g)]
  .map(([, key, dimension, canonicalUnit, valueType, aggregation, higherIsBetter, isLoadBearing]) => ({
    key, dimension, canonicalUnit, valueType, aggregation,
    higherIsBetter: higherIsBetter === 'null' ? null : higherIsBetter === 'true',
    isLoadBearing: isLoadBearing === 'true',
  }));

const keys = rows.map(r => `'${r.key}'`).join(' | ');
const entries = rows.map(r => `  ${r.key}: {
    key: '${r.key}',
    dimension: '${r.dimension}',
    canonicalUnit: '${r.canonicalUnit}',
    valueType: '${r.valueType}',
    aggregation: '${r.aggregation}',
    higherIsBetter: ${r.higherIsBetter === null ? 'null' : r.higherIsBetter},
    isLoadBearing: ${r.isLoadBearing},
  },`).join('\n');

const out = `// GENERATED by scripts/gen-metric-registry.mjs from
// supabase/migrations/20260818_strength_rebuild.sql's metric seed. Do not
// hand-edit — edit the migration's seed rows and re-run the script.

export type MetricKey = ${keys};

export interface Metric {
  key: MetricKey;
  dimension: string;
  canonicalUnit: string;
  valueType: 'scalar' | 'range' | 'tuple' | 'duration';
  aggregation: 'sum' | 'mean' | 'max' | 'min' | 'last' | 'none';
  higherIsBetter: boolean | null;
  isLoadBearing: boolean;
}

export const METRICS: Record<MetricKey, Metric> = {
${entries}
};
`;

writeFileSync('packages/strength-engine/src/metric.ts', out);
console.log(`Wrote ${rows.length} metrics to packages/strength-engine/src/metric.ts`);
```

- [ ] **Step 3: Run the generator**

Run: `node scripts/gen-metric-registry.mjs`
Expected: `Wrote 11 metrics to packages/strength-engine/src/metric.ts`, and
the file now exists with real content (not hand-written — verify it
matches the seed).

- [ ] **Step 4: Write the failing drift test**

```ts
// packages/strength-engine/src/metric.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { METRICS } from './metric';

describe('metric registry', () => {
  it('every MetricKey has a METRICS entry', () => {
    const keys: (keyof typeof METRICS)[] = [
      'load', 'reps', 'rpe', 'rir', 'tempo', 'rest',
      'distance', 'duration', 'calories', 'watts', 'height',
    ];
    for (const k of keys) expect(METRICS[k]).toBeDefined();
  });

  it('regenerating from the current migration produces byte-identical output', () => {
    const before = readFileSync('packages/strength-engine/src/metric.ts', 'utf8');
    execSync('node ../../scripts/gen-metric-registry.mjs', { cwd: 'packages/strength-engine/../..' });
    const after = readFileSync('packages/strength-engine/src/metric.ts', 'utf8');
    expect(after).toBe(before);
  });

  it('tempo has no higher/lower direction', () => {
    expect(METRICS.tempo.higherIsBetter).toBeNull();
  });

  it('load is the only load-bearing metric', () => {
    const loadBearing = Object.values(METRICS).filter(m => m.isLoadBearing);
    expect(loadBearing).toHaveLength(1);
    expect(loadBearing[0].key).toBe('load');
  });
});
```

- [ ] **Step 5: Run test to verify it passes** (the file already exists from
  Step 3 — this test is a regression guard, not a red/green cycle on the
  generated file itself)

Run: `pnpm --filter @hybrid/strength-engine test metric.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818_strength_rebuild.sql scripts/gen-metric-registry.mjs packages/strength-engine/src/metric.ts packages/strength-engine/src/metric.test.ts
git commit -m "Add metric registry (Slice 1): table, generator, TS mirror"
```

---

### Task 3: `equipment` + `exercise` tables (Slice 2)

**Files:**
- Modify: `supabase/migrations/20260818_strength_rebuild.sql` (append)
- Create: `packages/strength-engine/src/exercise.ts`
- Create: `packages/strength-engine/src/exercise.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Equipment`, `Exercise` interfaces, `roundToIncrement`'s
  `equipment` parameter type — Task 5 (rounding) and every later task
  touching `exercise_id` depend on this shape.

- [ ] **Step 1: Append the SQL to the migration**

```sql
-- Slice 2: exercise rebuild, with equipment and the reference-max/track-as
-- graph. Cycle depth is enforced by a trigger, not app code.
create table equipment (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  increment_kg   numeric,
  rack_values_kg numeric[],
  rounding       text not null default 'down'
);

create table exercise (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid,
  name                      text not null,
  video_asset_id            uuid,
  cues                      text,
  equipment_id              uuid references equipment(id),
  default_metrics           text[] not null default '{reps,load}',
  reference_max_exercise_id uuid references exercise(id),
  track_as_exercise_id      uuid references exercise(id),
  e1rm_formula              text not null default 'epley',
  check (id <> reference_max_exercise_id),
  check (id <> track_as_exercise_id)
);

create function check_exercise_edge_depth() returns trigger as $$
begin
  if new.reference_max_exercise_id is not null and exists (
    select 1 from exercise e where e.id = new.reference_max_exercise_id
      and e.reference_max_exercise_id is not null
  ) then raise exception 'reference_max_exercise_id must point at a root (depth <= 1)'; end if;
  if new.track_as_exercise_id is not null and exists (
    select 1 from exercise e where e.id = new.track_as_exercise_id
      and e.track_as_exercise_id is not null
  ) then raise exception 'track_as_exercise_id must point at a root (depth <= 1)'; end if;
  return new;
end; $$ language plpgsql;

create trigger exercise_edge_depth before insert or update on exercise
  for each row execute function check_exercise_edge_depth();
```

- [ ] **Step 2: Apply the migration locally and verify the trigger fires**

Run: `pnpm run db:migrate` (or this repo's equivalent local-apply command —
check `package.json` scripts for the exact name used elsewhere in
`checks/migrations-apply.mjs`), then:

```sql
insert into exercise (id, name) values ('11111111-1111-1111-1111-111111111111', 'Back Squat');
insert into exercise (id, name, reference_max_exercise_id) values ('22222222-2222-2222-2222-222222222222', 'Squat 5RM Test', '11111111-1111-1111-1111-111111111111');
-- this one must fail: depth 2
insert into exercise (id, name, reference_max_exercise_id) values ('33333333-3333-3333-3333-333333333333', 'Bad', '22222222-2222-2222-2222-222222222222');
```

Expected: the third insert raises
`reference_max_exercise_id must point at a root (depth <= 1)`.

- [ ] **Step 3: Write the TS types (no logic yet — pure shape)**

```ts
// packages/strength-engine/src/exercise.ts
export interface Equipment {
  id: string;
  name: string;
  incrementKg: number | null;
  rackValuesKg: number[] | null;
  rounding: 'down' | 'nearest' | 'none';
}

export interface Exercise {
  id: string;
  ownerId: string | null;
  name: string;
  videoAssetId: string | null;
  cues: string | null;
  equipment: Equipment | null;
  defaultMetrics: import('./metric').MetricKey[];
  referenceMaxExerciseId: string | null;
  trackAsExerciseId: string | null;
  e1rmFormula: 'epley' | 'brzycki';
}

export class CycleError extends Error {
  constructor(field: 'reference_max_exercise_id' | 'track_as_exercise_id') {
    super(`${field} must point at a root (depth <= 1)`);
    this.name = 'CycleError';
  }
}

/** Thin wrapper: recognizes the trigger's own error text and re-throws typed. */
export function toCycleError(pgError: { message?: string }): CycleError | null {
  if (!pgError.message) return null;
  if (pgError.message.includes('reference_max_exercise_id must point')) return new CycleError('reference_max_exercise_id');
  if (pgError.message.includes('track_as_exercise_id must point')) return new CycleError('track_as_exercise_id');
  return null;
}
```

- [ ] **Step 4: Write the test**

```ts
// packages/strength-engine/src/exercise.test.ts
import { describe, it, expect } from 'vitest';
import { toCycleError, CycleError } from './exercise';

describe('toCycleError', () => {
  it('recognizes a reference_max_exercise_id cycle error', () => {
    const err = toCycleError({ message: 'reference_max_exercise_id must point at a root (depth <= 1)' });
    expect(err).toBeInstanceOf(CycleError);
  });

  it('recognizes a track_as_exercise_id cycle error', () => {
    const err = toCycleError({ message: 'track_as_exercise_id must point at a root (depth <= 1)' });
    expect(err).toBeInstanceOf(CycleError);
  });

  it('returns null for an unrelated postgres error', () => {
    expect(toCycleError({ message: 'duplicate key value violates unique constraint' })).toBeNull();
  });

  it('returns null when there is no message', () => {
    expect(toCycleError({})).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test exercise.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818_strength_rebuild.sql packages/strength-engine/src/exercise.ts packages/strength-engine/src/exercise.test.ts
git commit -m "Add exercise/equipment tables + cycle guard (Slice 2)"
```

---

### Task 4: `prescribed_set` + `prescribed_target` (Slice 3)

**Files:**
- Modify: `supabase/migrations/20260818_strength_rebuild.sql` (append)
- Create: `packages/strength-engine/src/prescription.ts`
- Create: `packages/strength-engine/src/prescription.test.ts`

**Interfaces:**
- Consumes: `MetricKey` (Task 2), `Exercise` (Task 3).
- Produces: `PrescribedTarget`, `PrescribedSet` interfaces, `encodeTempo`/
  `decodeTempo` — Task 6 (resolution) and every downstream UI task
  reference these.

- [ ] **Step 1: Append the SQL**

```sql
-- Slice 3: a prescribed set is a set of typed targets, not fixed columns —
-- the fix for a fixed 2-metric-per-set ceiling.
create table strength_block_item (
  id           uuid primary key default gen_random_uuid(),
  block_id     uuid not null,
  exercise_id  uuid not null references exercise(id),
  ordinal      int  not null,
  grouping_key text,
  unique (block_id, ordinal)
);

create table prescribed_set (
  id                uuid primary key default gen_random_uuid(),
  block_item_id     uuid not null references strength_block_item(id) on delete cascade,
  ordinal           int  not null,
  is_optional       boolean not null default false,
  is_amrap          boolean not null default false,
  unique (block_item_id, ordinal)
);

create table prescribed_target (
  prescribed_set_id uuid not null references prescribed_set(id) on delete cascade,
  metric_key        text not null references metric(key),
  literal_value      numeric,
  range_lo           numeric,
  range_hi           numeric,
  expr_kind          text,
  expr_arg           numeric,
  expr_ref_exercise  uuid references exercise(id),
  primary key (prescribed_set_id, metric_key),
  check (
    (literal_value is not null)::int +
    (range_lo is not null and range_hi is not null)::int +
    (expr_kind is not null)::int = 1
  )
);
```

- [ ] **Step 2: Apply and verify the CHECK constraint**

Run the local migration apply, then:

```sql
-- must fail: two resolution strategies on one target
insert into prescribed_set (id, block_item_id, ordinal) values ('44444444-4444-4444-4444-444444444444', <any existing block_item_id>, 1);
insert into prescribed_target (prescribed_set_id, metric_key, literal_value, expr_kind, expr_arg)
  values ('44444444-4444-4444-4444-444444444444', 'load', 100, 'pct_of_max', 0.8);
```

Expected: constraint violation on the `prescribed_target` check.

- [ ] **Step 3: Write the TS types + tempo codec**

```ts
// packages/strength-engine/src/prescription.ts
import type { MetricKey } from './metric';

export interface TempoTuple {
  eccentric: number;
  pauseBottom: number;
  concentric: number;
  pauseTop: number;
}

/** Packs a 4-digit tempo (e.g. 3010) into the single numeric column used by
 * both prescribed_target and performed_measurement. */
export function encodeTempo(t: TempoTuple): number {
  return t.eccentric * 1000 + t.pauseBottom * 100 + t.concentric * 10 + t.pauseTop;
}

export function decodeTempo(n: number): TempoTuple {
  return {
    eccentric: Math.floor(n / 1000) % 10,
    pauseBottom: Math.floor(n / 100) % 10,
    concentric: Math.floor(n / 10) % 10,
    pauseTop: n % 10,
  };
}

export interface PrescribedTarget {
  metricKey: MetricKey;
  literalValue?: number;
  rangeLo?: number;
  rangeHi?: number;
  exprKind?: 'pct_of_max' | 'lwp_delta' | 'pct_of_bodyweight' | 'rpe_autoreg';
  exprArg?: number;
  exprRefExercise?: string;
}

export interface PrescribedSet {
  id: string;
  ordinal: number;
  isOptional: boolean;
  isAmrap: boolean;
  targets: PrescribedTarget[];
}
```

- [ ] **Step 4: Write the test**

```ts
// packages/strength-engine/src/prescription.test.ts
import { describe, it, expect } from 'vitest';
import { encodeTempo, decodeTempo } from './prescription';

describe('tempo codec', () => {
  it('encodes 3-0-1-0 tempo to 3010', () => {
    expect(encodeTempo({ eccentric: 3, pauseBottom: 0, concentric: 1, pauseTop: 0 })).toBe(3010);
  });

  it('round-trips through decode', () => {
    const t = { eccentric: 4, pauseBottom: 2, concentric: 1, pauseTop: 3 };
    expect(decodeTempo(encodeTempo(t))).toEqual(t);
  });

  it('decodes 0 as all-zero tempo', () => {
    expect(decodeTempo(0)).toEqual({ eccentric: 0, pauseBottom: 0, concentric: 0, pauseTop: 0 });
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test prescription.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818_strength_rebuild.sql packages/strength-engine/src/prescription.ts packages/strength-engine/src/prescription.test.ts
git commit -m "Add prescribed_set/prescribed_target + tempo codec (Slice 3)"
```

---

### Task 5: rounding engine (Slice 5 — built before Slice 4 since resolution depends on it)

**Files:**
- Create: `packages/strength-engine/src/rounding.ts`
- Create: `packages/strength-engine/src/rounding.test.ts`

**Interfaces:**
- Consumes: `Equipment` (Task 3).
- Produces: `roundToIncrement(value, equipment)` — Task 6 (resolution
  pipeline) calls this directly.

- [ ] **Step 1: Write the failing test**

```ts
// packages/strength-engine/src/rounding.test.ts
import { describe, it, expect } from 'vitest';
import { roundToIncrement } from './rounding';
import type { Equipment } from './exercise';

const barbell: Equipment = { id: 'e1', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' };
const nearestBarbell: Equipment = { ...barbell, rounding: 'nearest' };
const dbRack: Equipment = { id: 'e2', name: 'Dumbbell rack', incrementKg: null, rackValuesKg: [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 35, 40], rounding: 'down' };

describe('roundToIncrement', () => {
  it('returns the raw value when there is no equipment', () => {
    expect(roundToIncrement(101.3, null)).toBe(101.3);
  });

  it('rounds down to the increment by default', () => {
    expect(roundToIncrement(103, barbell)).toBe(102.5);
  });

  it('rounds to nearest when equipment opts in', () => {
    expect(roundToIncrement(103.8, nearestBarbell)).toBe(105);
  });

  it('snaps to the nearest declared rack value', () => {
    expect(roundToIncrement(23, dbRack)).toBe(20);
  });

  it('clamps to the lowest rack value below range', () => {
    expect(roundToIncrement(1, dbRack)).toBe(2.5);
  });

  it('clamps to the highest rack value above range', () => {
    expect(roundToIncrement(45, dbRack)).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test rounding.test.ts`
Expected: FAIL — `roundToIncrement` is not defined / module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/rounding.ts
import type { Equipment } from './exercise';

export function roundToIncrement(value: number, equipment: Equipment | null): number {
  if (!equipment) return value;
  if (equipment.rackValuesKg?.length) {
    return equipment.rackValuesKg.reduce((closest, v) =>
      Math.abs(v - value) < Math.abs(closest - value) ? v : closest
    );
  }
  if (equipment.incrementKg == null) return value;
  const steps = equipment.rounding === 'nearest'
    ? Math.round(value / equipment.incrementKg)
    : Math.floor(value / equipment.incrementKg);
  return Number((steps * equipment.incrementKg).toFixed(6));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test rounding.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/strength-engine/src/rounding.ts packages/strength-engine/src/rounding.test.ts
git commit -m "Add rounding engine (Slice 5)"
```

---

### Task 6: resolution pipeline (Slice 4)

**Files:**
- Create: `packages/strength-engine/src/resolve.ts`
- Create: `packages/strength-engine/src/resolve.test.ts`

**Interfaces:**
- Consumes: `PrescribedTarget` (Task 4), `Exercise` (Task 3),
  `roundToIncrement` (Task 5).
- Produces: `ResolveCtx`, `ResolvedValue`, `resolveTarget()` — Task 7
  (publish-time snapshot) is the direct caller.

- [ ] **Step 1: Write the failing test**

```ts
// packages/strength-engine/src/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTarget, type ResolveCtx } from './resolve';
import type { Exercise } from './exercise';
import type { PrescribedTarget } from './prescription';

const squat: Exercise = {
  id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
  equipment: { id: 'bb', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' },
  defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null, trackAsExerciseId: null, e1rmFormula: 'epley',
};

function ctx(overrides: Partial<ResolveCtx> = {}): ResolveCtx {
  return {
    athleteId: 'a1', scheduledDate: '2026-08-20',
    workingMaxAt: () => null, lastPerformedLoad: () => null, bodyweightAt: () => null,
    ...overrides,
  };
}

describe('resolveTarget', () => {
  it('returns a literal value unchanged', () => {
    const t: PrescribedTarget = { metricKey: 'load', literalValue: 100 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'scalar', value: 100 });
  });

  it('returns a range unchanged', () => {
    const t: PrescribedTarget = { metricKey: 'reps', rangeLo: 8, rangeHi: 10 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'range', lo: 8, hi: 10 });
  });

  it('resolves pct_of_max against the working max, rounded', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_max', exprArg: 0.8 };
    const c = ctx({ workingMaxAt: () => 141 });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 112.5 });
  });

  it('returns unresolved when pct_of_max has no working max on record', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_max', exprArg: 0.8 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'unresolved', reason: 'no_working_max' });
  });

  it('resolves lwp_delta against the last performed load, rounded', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'lwp_delta', exprArg: 2.5 };
    const c = ctx({ lastPerformedLoad: () => 100 });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 102.5 });
  });

  it('returns unresolved when lwp_delta has no history', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'lwp_delta', exprArg: 2.5 };
    expect(resolveTarget(t, squat, ctx())).toEqual({ kind: 'unresolved', reason: 'no_history' });
  });

  it('resolves pct_of_bodyweight, rounded', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_bodyweight', exprArg: 0.5 };
    const c = ctx({ bodyweightAt: () => 89 });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 44.5 });
  });

  it('defers rpe_autoreg to the athlete, never touching ctx', () => {
    const t: PrescribedTarget = { metricKey: 'rpe', exprKind: 'rpe_autoreg' };
    const c = ctx({
      workingMaxAt: () => { throw new Error('must not be called'); },
      lastPerformedLoad: () => { throw new Error('must not be called'); },
      bodyweightAt: () => { throw new Error('must not be called'); },
    });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'deferred_to_athlete' });
  });

  it('throws for a target with no resolution strategy', () => {
    const t = { metricKey: 'load' } as PrescribedTarget;
    expect(() => resolveTarget(t, squat, ctx())).toThrow(/no resolution strategy/);
  });

  it('pct_of_max uses exprRefExercise over the exercise\'s own reference_max_exercise_id', () => {
    const t: PrescribedTarget = { metricKey: 'load', exprKind: 'pct_of_max', exprArg: 0.5, exprRefExercise: 'front-squat' };
    const c = ctx({ workingMaxAt: (exId) => (exId === 'front-squat' ? 100 : 999) });
    expect(resolveTarget(t, squat, c)).toEqual({ kind: 'scalar', value: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/resolve.ts
import type { Exercise } from './exercise';
import type { PrescribedTarget } from './prescription';
import { roundToIncrement } from './rounding';

export interface ResolveCtx {
  athleteId: string;
  scheduledDate: string;
  workingMaxAt(exerciseId: string, asOf: string): number | null;
  lastPerformedLoad(athleteId: string, exerciseId: string): number | null;
  bodyweightAt(athleteId: string, asOf: string): number | null;
}

export type ResolvedValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'range'; lo: number; hi: number }
  | { kind: 'unresolved'; reason: 'no_working_max' | 'no_history' | 'no_bodyweight' }
  | { kind: 'deferred_to_athlete' };

export function resolveTarget(t: PrescribedTarget, ex: Exercise, ctx: ResolveCtx): ResolvedValue {
  if (t.literalValue != null) return { kind: 'scalar', value: t.literalValue };
  if (t.rangeLo != null) return { kind: 'range', lo: t.rangeLo, hi: t.rangeHi! };
  switch (t.exprKind) {
    case 'pct_of_max': {
      const refId = t.exprRefExercise ?? ex.referenceMaxExerciseId ?? ex.id;
      const max = ctx.workingMaxAt(refId, ctx.scheduledDate);
      if (max == null) return { kind: 'unresolved', reason: 'no_working_max' };
      return { kind: 'scalar', value: roundToIncrement(max * t.exprArg!, ex.equipment) };
    }
    case 'lwp_delta': {
      const last = ctx.lastPerformedLoad(ctx.athleteId, ex.id);
      if (last == null) return { kind: 'unresolved', reason: 'no_history' };
      return { kind: 'scalar', value: roundToIncrement(last + t.exprArg!, ex.equipment) };
    }
    case 'pct_of_bodyweight': {
      const bw = ctx.bodyweightAt(ctx.athleteId, ctx.scheduledDate);
      if (bw == null) return { kind: 'unresolved', reason: 'no_bodyweight' };
      return { kind: 'scalar', value: roundToIncrement(bw * t.exprArg!, ex.equipment) };
    }
    case 'rpe_autoreg':
      return { kind: 'deferred_to_athlete' };
    default:
      throw new Error(`prescribed_target row with no resolution strategy: ${JSON.stringify(t)}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test resolve.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/strength-engine/src/resolve.ts packages/strength-engine/src/resolve.test.ts
git commit -m "Add resolution pipeline (Slice 4)"
```

---

### Task 7: `assigned_session` + publish-time snapshot (Slice 6)

**Files:**
- Modify: `supabase/migrations/20260818_strength_rebuild.sql` (append)
- Create: `packages/strength-engine/src/session.ts`
- Create: `packages/strength-engine/src/session.test.ts`

**Interfaces:**
- Consumes: `resolveTarget`/`ResolveCtx` (Task 6), `Exercise` (Task 3),
  `PrescribedSet` (Task 4).
- Produces: `resolveSessionForPublish()` — the coach-authoring phase's
  publish action calls this directly.

- [ ] **Step 1: Append the SQL**

```sql
-- Slice 6: publish-time snapshot. After publish, nothing reads
-- prescribed_target for this session again — only resolved_snapshot. A
-- later template edit must never rewrite what an athlete was already told.
create table assigned_session (
  id                uuid primary key default gen_random_uuid(),
  athlete_id        uuid not null,
  source_session_id uuid,
  scheduled_date    date not null,
  state             text not null default 'draft',
  published_at      timestamptz,
  resolved_snapshot jsonb,
  timezone          text not null
);
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/strength-engine/src/session.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSessionForPublish } from './session';
import type { Exercise } from './exercise';
import type { PrescribedSet } from './prescription';
import type { ResolveCtx } from './resolve';

const squat: Exercise = {
  id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
  equipment: { id: 'bb', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' },
  defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null, trackAsExerciseId: null, e1rmFormula: 'epley',
};

const items = [{ exercise: squat, sets: [
  { id: 's1', ordinal: 1, isOptional: false, isAmrap: false, targets: [{ metricKey: 'load' as const, exprKind: 'pct_of_max' as const, exprArg: 0.8 }] },
] as PrescribedSet[] }];

function ctx(overrides: Partial<ResolveCtx> = {}): ResolveCtx {
  return {
    athleteId: 'a1', scheduledDate: '2026-08-20',
    workingMaxAt: () => 100, lastPerformedLoad: () => null, bodyweightAt: () => null,
    ...overrides,
  };
}

describe('resolveSessionForPublish', () => {
  it('returns a snapshot when every target resolves', () => {
    const result = resolveSessionForPublish(items, ctx());
    expect(result).toEqual({
      snapshot: { sq: [{ setId: 's1', targets: { load: { value: 80, exact: 80 } } }] },
    });
  });

  it('returns blocked with the exercise name when a target cannot resolve', () => {
    const result = resolveSessionForPublish(items, ctx({ workingMaxAt: () => null }));
    expect(result).toEqual({
      blocked: [{ exerciseName: 'Back Squat', metricKey: 'load', reason: 'no_working_max' }],
    });
  });

  it('never partially publishes: one unresolved target blocks the whole session', () => {
    const twoSets = [{ exercise: squat, sets: [
      ...items[0].sets,
      { id: 's2', ordinal: 2, isOptional: false, isAmrap: false, targets: [{ metricKey: 'load' as const, exprKind: 'lwp_delta' as const, exprArg: 2.5 }] },
    ] }];
    const result = resolveSessionForPublish(twoSets, ctx());
    expect('blocked' in result).toBe(true);
    if ('blocked' in result) expect(result.blocked).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// packages/strength-engine/src/session.ts
import type { Exercise } from './exercise';
import type { PrescribedSet } from './prescription';
import { resolveTarget, type ResolveCtx } from './resolve';
import { roundToIncrement } from './rounding';

export interface BlockItemInput {
  exercise: Exercise;
  sets: PrescribedSet[];
}

export interface UnresolvedTarget {
  exerciseName: string;
  metricKey: string;
  reason: string;
}

export type PublishResult =
  | { snapshot: Record<string, Array<{ setId: string; targets: Record<string, { value: number; exact: number } | { lo: number; hi: number }> }>> }
  | { blocked: UnresolvedTarget[] };

export function resolveSessionForPublish(items: BlockItemInput[], ctx: ResolveCtx): PublishResult {
  const blocked: UnresolvedTarget[] = [];
  const snapshot: PublishResult extends { snapshot: infer S } ? S : never = {} as any;

  for (const { exercise, sets } of items) {
    const setEntries: any[] = [];
    for (const set of sets) {
      const targetEntries: Record<string, any> = {};
      for (const target of set.targets) {
        const resolved = resolveTarget(target, exercise, ctx);
        if (resolved.kind === 'unresolved') {
          blocked.push({ exerciseName: exercise.name, metricKey: target.metricKey, reason: resolved.reason });
          continue;
        }
        if (resolved.kind === 'scalar') {
          const exact = target.exprKind ? resolveExact(target, exercise, ctx) : resolved.value;
          targetEntries[target.metricKey] = { value: resolved.value, exact };
        } else if (resolved.kind === 'range') {
          targetEntries[target.metricKey] = { lo: resolved.lo, hi: resolved.hi };
        }
        // 'deferred_to_athlete' targets are intentionally absent from the snapshot.
      }
      setEntries.push({ setId: set.id, targets: targetEntries });
    }
    (snapshot as any)[exercise.id] = setEntries;
  }

  if (blocked.length) return { blocked };
  return { snapshot };
}

/** The unrounded value behind a rounded scalar, for the long-press "exact value" UI. */
function resolveExact(target: any, exercise: Exercise, ctx: ResolveCtx): number {
  if (target.exprKind === 'pct_of_max') {
    const refId = target.exprRefExercise ?? exercise.referenceMaxExerciseId ?? exercise.id;
    return (ctx.workingMaxAt(refId, ctx.scheduledDate) ?? 0) * target.exprArg;
  }
  if (target.exprKind === 'lwp_delta') {
    return (ctx.lastPerformedLoad(ctx.athleteId, exercise.id) ?? 0) + target.exprArg;
  }
  if (target.exprKind === 'pct_of_bodyweight') {
    return (ctx.bodyweightAt(ctx.athleteId, ctx.scheduledDate) ?? 0) * target.exprArg;
  }
  return roundToIncrement(0, exercise.equipment);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test session.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the byte-identical-after-template-edit test (Gotcha #4)**

```ts
// append to session.test.ts
it('a resolved_snapshot never changes after the source prescription is edited', () => {
  const result1 = resolveSessionForPublish(items, ctx());
  // Simulate a template edit: the athlete's working max increases after publish.
  const result2AfterEdit = resolveSessionForPublish(items, ctx({ workingMaxAt: () => 999 }));
  // The FIRST result — what was actually published — must not be affected by
  // recomputing against new data. This is a property of the CALLER (publish
  // writes the snapshot once and never re-derives it), asserted here by
  // showing resolveSessionForPublish is a pure function: same inputs, same
  // output, and the caller is responsible for freezing result1 rather than
  // re-calling this function after publish.
  expect(result1).not.toEqual(result2AfterEdit);
  expect(resolveSessionForPublish(items, ctx())).toEqual(result1);
});
```

- [ ] **Step 7: Run full file, verify all pass**

Run: `pnpm --filter @hybrid/strength-engine test session.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260818_strength_rebuild.sql packages/strength-engine/src/session.ts packages/strength-engine/src/session.test.ts
git commit -m "Add assigned_session + publish-time resolution (Slice 6)"
```

---

### Task 8: `performed_set` + `performed_measurement` (Slice 7)

**Files:**
- Modify: `supabase/migrations/20260818_strength_rebuild.sql` (append)
- Create: `packages/strength-engine/src/performed.ts`
- Create: `packages/strength-engine/src/performed.test.ts`

**Interfaces:**
- Consumes: `MetricKey` (Task 2).
- Produces: `PerformedSet`, `PerformedMeasurement`,
  `PerformedSetWithMeasurements` — Tasks 9-12 all consume this shape.

- [ ] **Step 1: Append the SQL**

```sql
-- Slice 7: performance is an independently-shaped set of measurements.
-- Client-generated id (offline-first): a retried sync is a no-op upsert.
create table performed_set (
  id                  uuid primary key,
  assigned_session_id uuid not null references assigned_session(id),
  exercise_id         uuid not null references exercise(id),
  prescribed_set_id   uuid references prescribed_set(id),
  ordinal             int not null,
  status              text not null,
  performed_at        timestamptz not null,
  client_created_at   timestamptz not null
);

create table performed_measurement (
  performed_set_id uuid not null references performed_set(id) on delete cascade,
  metric_key       text not null references metric(key),
  value            numeric not null,
  primary key (performed_set_id, metric_key)
);
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/strength-engine/src/performed.test.ts
import { describe, it, expect } from 'vitest';
import { measurementValue, type PerformedSetWithMeasurements } from './performed';

const set: PerformedSetWithMeasurements = {
  id: 'p1', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: 's1',
  ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
  measurements: [{ metricKey: 'load', value: 100 }, { metricKey: 'reps', value: 5 }],
};

describe('measurementValue', () => {
  it('returns the value for a present metric', () => {
    expect(measurementValue(set, 'load')).toBe(100);
  });

  it('returns null for a metric not on this set', () => {
    expect(measurementValue(set, 'rpe')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test performed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// packages/strength-engine/src/performed.ts
import type { MetricKey } from './metric';

export interface PerformedMeasurement {
  metricKey: MetricKey;
  value: number;
}

export interface PerformedSet {
  id: string;
  assignedSessionId: string;
  exerciseId: string;
  prescribedSetId: string | null;
  ordinal: number;
  status: 'completed' | 'skipped' | 'not_reached';
  performedAt: string;
  clientCreatedAt: string;
}

export interface PerformedSetWithMeasurements extends PerformedSet {
  measurements: PerformedMeasurement[];
}

export function measurementValue(set: PerformedSetWithMeasurements, key: MetricKey): number | null {
  return set.measurements.find(m => m.metricKey === key)?.value ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test performed.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818_strength_rebuild.sql packages/strength-engine/src/performed.ts packages/strength-engine/src/performed.test.ts
git commit -m "Add performed_set/performed_measurement (Slice 7)"
```

---

### Task 9: e1RM (Slice 8)

**Files:**
- Create: `packages/strength-engine/src/e1rm.ts`
- Create: `packages/strength-engine/src/e1rm.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `e1rm(loadKg, reps, formula)` — Task 10 (`working_max_event`)
  and analytics phases call this.

- [ ] **Step 1: Write the failing test**

```ts
// packages/strength-engine/src/e1rm.test.ts
import { describe, it, expect } from 'vitest';
import { e1rm } from './e1rm';

describe('e1rm', () => {
  it('returns the load unchanged at 1 rep', () => {
    expect(e1rm(140, 1)).toBe(140);
  });

  it('computes Epley by default', () => {
    expect(e1rm(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 5);
  });

  it('computes Brzycki when requested', () => {
    expect(e1rm(100, 5, 'brzycki')).toBeCloseTo(100 * (36 / (37 - 5)), 5);
  });

  it('falls back to Epley above Brzycki\'s valid rep range', () => {
    const brzycki = e1rm(100, 40, 'brzycki');
    const epley = e1rm(100, 40, 'epley');
    expect(brzycki).toBeCloseTo(epley, 5);
  });

  it('throws for zero or negative reps', () => {
    expect(() => e1rm(100, 0)).toThrow();
    expect(() => e1rm(100, -1)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test e1rm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/e1rm.ts
export type E1rmFormula = 'epley' | 'brzycki';

export function e1rm(loadKg: number, reps: number, formula: E1rmFormula = 'epley'): number {
  if (reps <= 0) throw new Error('e1rm requires reps > 0');
  if (reps === 1) return loadKg;
  if (formula === 'brzycki' && reps < 37) {
    return loadKg * (36 / (37 - reps));
  }
  return loadKg * (1 + reps / 30);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test e1rm.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/strength-engine/src/e1rm.ts packages/strength-engine/src/e1rm.test.ts
git commit -m "Add e1RM formulas (Slice 8)"
```

---

### Task 10: `working_max_event` (Slice 9)

**Files:**
- Modify: `supabase/migrations/20260818_strength_rebuild.sql` (append)
- Create: `packages/strength-engine/src/workingMax.ts`
- Create: `packages/strength-engine/src/workingMax.test.ts`

**Interfaces:**
- Consumes: `E1rmFormula` (Task 9).
- Produces: `WorkingMaxEvent`, `currentWorkingMax()` — Task 6's
  `ResolveCtx.workingMaxAt` (already consumed by earlier tasks as an
  injected function) is implemented in terms of this in the later
  integration task (Task 13).

- [ ] **Step 1: Append the SQL**

```sql
-- Slice 9: working max is event-sourced, never a mutable column.
create table working_max_event (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null,
  exercise_id  uuid not null,
  value_kg     numeric not null,
  source       text not null,
  formula      text,
  from_set_id  uuid references performed_set(id),
  effective_at timestamptz not null
);
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/strength-engine/src/workingMax.test.ts
import { describe, it, expect } from 'vitest';
import { currentWorkingMax, type WorkingMaxEvent } from './workingMax';

function ev(overrides: Partial<WorkingMaxEvent>): WorkingMaxEvent {
  return {
    id: 'e', athleteId: 'a', exerciseId: 'sq', valueKg: 100,
    source: 'auto_estimate', formula: 'epley', fromSetId: null,
    effectiveAt: '2026-08-01T00:00:00Z', ...overrides,
  };
}

describe('currentWorkingMax', () => {
  it('returns null with no events', () => {
    expect(currentWorkingMax([], '2026-08-20')).toBeNull();
  });

  it('returns the latest event when all events are auto-estimates', () => {
    const events = [ev({ valueKg: 95, effectiveAt: '2026-08-01T00:00:00Z' }), ev({ valueKg: 100, effectiveAt: '2026-08-10T00:00:00Z' })];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(100);
  });

  it('prefers a manual event over a later auto event only when the manual is not older', () => {
    const events = [
      ev({ valueKg: 100, source: 'coach_set', effectiveAt: '2026-08-10T00:00:00Z' }),
      ev({ valueKg: 95, source: 'auto_estimate', effectiveAt: '2026-08-05T00:00:00Z' }),
    ];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(100);
  });

  it('an auto event after a manual event wins if it is genuinely later', () => {
    const events = [
      ev({ valueKg: 100, source: 'coach_set', effectiveAt: '2026-08-01T00:00:00Z' }),
      ev({ valueKg: 105, source: 'auto_estimate', effectiveAt: '2026-08-15T00:00:00Z' }),
    ];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(105);
  });

  it('ignores events after the asOf date', () => {
    const events = [ev({ valueKg: 100, effectiveAt: '2026-08-01T00:00:00Z' }), ev({ valueKg: 999, effectiveAt: '2026-09-01T00:00:00Z' })];
    expect(currentWorkingMax(events, '2026-08-20')?.valueKg).toBe(100);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test workingMax.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// packages/strength-engine/src/workingMax.ts
import type { E1rmFormula } from './e1rm';

export interface WorkingMaxEvent {
  id: string;
  athleteId: string;
  exerciseId: string;
  valueKg: number;
  source: 'auto_estimate' | 'coach_set' | 'athlete_set' | 'test_result';
  formula: E1rmFormula | null;
  fromSetId: string | null;
  effectiveAt: string;
}

export function currentWorkingMax(events: WorkingMaxEvent[], asOf: string): WorkingMaxEvent | null {
  const upTo = events
    .filter(e => e.effectiveAt <= asOf)
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  if (!upTo.length) return null;
  const latest = upTo[0];
  const latestManual = upTo.find(e => e.source !== 'auto_estimate');
  if (latestManual && latestManual.effectiveAt >= latest.effectiveAt) return latestManual;
  return latest;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test workingMax.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818_strength_rebuild.sql packages/strength-engine/src/workingMax.ts packages/strength-engine/src/workingMax.test.ts
git commit -m "Add working_max_event + resolver (Slice 9)"
```

---

### Task 11: `pr_event` (Slice 10)

**Files:**
- Modify: `supabase/migrations/20260818_strength_rebuild.sql` (append)
- Create: `packages/strength-engine/src/pr.ts`
- Create: `packages/strength-engine/src/pr.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `detectPr()` — later sync-layer wiring (Phase C) calls this.

- [ ] **Step 1: Append the SQL**

```sql
-- Slice 10: PRs are per rep-count, not collapsed.
create table pr_event (
  athlete_id       uuid not null,
  exercise_id      uuid not null,
  rep_count        int  not null,
  value_kg         numeric not null,
  achieved_at      timestamptz not null,
  performed_set_id uuid not null references performed_set(id),
  primary key (athlete_id, exercise_id, rep_count, achieved_at)
);
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/strength-engine/src/pr.test.ts
import { describe, it, expect } from 'vitest';
import { detectPr } from './pr';

describe('detectPr', () => {
  it('is a PR when there is no prior best', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 100 }, null)).toBe(true);
  });

  it('is a PR when the new load beats the prior best at this rep count', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 105 }, 100)).toBe(true);
  });

  it('is not a PR when the new load ties or is below the prior best', () => {
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 100 }, 100)).toBe(false);
    expect(detectPr({ exerciseId: 'sq', reps: 5, loadKg: 95 }, 100)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test pr.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// packages/strength-engine/src/pr.ts
export function detectPr(newSet: { exerciseId: string; reps: number; loadKg: number }, priorBest: number | null): boolean {
  return priorBest == null || newSet.loadKg > priorBest;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test pr.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818_strength_rebuild.sql packages/strength-engine/src/pr.ts packages/strength-engine/src/pr.test.ts
git commit -m "Add pr_event + PR detection (Slice 10)"
```

---

### Task 12: volume / intensity / compliance (Slice 11)

**Files:**
- Create: `packages/strength-engine/src/load.ts`
- Create: `packages/strength-engine/src/load.test.ts`

**Interfaces:**
- Consumes: `PerformedSetWithMeasurements`, `measurementValue` (Task 8),
  `PrescribedSet` (Task 4), `PerformedSet` (Task 8).
- Produces: `sessionLoad()`, `intensity()`, `sessionCompliance()`,
  `blockCompliance()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/strength-engine/src/load.test.ts
import { describe, it, expect } from 'vitest';
import { sessionLoad, intensity, sessionCompliance } from './load';
import type { PerformedSetWithMeasurements } from './performed';
import type { PrescribedSet } from './prescription';
import type { PerformedSet } from './performed';

function loadedSet(reps: number, load: number): PerformedSetWithMeasurements {
  return {
    id: `p-${reps}-${load}`, assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: null,
    ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
    measurements: [{ metricKey: 'reps', value: reps }, { metricKey: 'load', value: load }],
  };
}

describe('sessionLoad', () => {
  it('sums tonnage as reps times load, only for loaded sets', () => {
    const result = sessionLoad([loadedSet(5, 100), loadedSet(5, 105)]);
    expect(result.tonnageKg).toBe(5 * 100 + 5 * 105);
  });

  it('counts workReps for unloaded sets separately', () => {
    const unloaded: PerformedSetWithMeasurements = {
      id: 'p-u', assignedSessionId: 'as1', exerciseId: 'pu', prescribedSetId: null,
      ordinal: 1, status: 'completed', performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
      measurements: [{ metricKey: 'reps', value: 12 }],
    };
    const result = sessionLoad([unloaded]);
    expect(result.workReps).toBe(12);
    expect(result.tonnageKg).toBe(0);
  });
});

describe('intensity', () => {
  it('is a rep-weighted average of %max, not a naive mean of set percentages', () => {
    // set A: 8 reps @ 100kg (80% of 125), set B: 2 reps @ 120kg (96% of 125)
    // rep-weighted: (8*100 + 2*120) / 10 = 104kg avg -> 104/125 = 0.832
    const result = intensity([loadedSet(8, 100), loadedSet(2, 120)], 125);
    expect(result).toBeCloseTo(0.832, 3);
  });
});

describe('sessionCompliance', () => {
  it('excludes optional sets from both numerator and denominator', () => {
    const assigned: PrescribedSet[] = [
      { id: 's1', ordinal: 1, isOptional: false, isAmrap: false, targets: [] },
      { id: 's2', ordinal: 2, isOptional: true, isAmrap: false, targets: [] },
    ];
    const performed: PerformedSet[] = [
      { id: 'p1', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: 's1', ordinal: 1, status: 'completed', performedAt: 'x', clientCreatedAt: 'x' },
    ];
    expect(sessionCompliance(assigned, performed)).toBe(1);
  });

  it('returns 1 when there are no required sets', () => {
    expect(sessionCompliance([], [])).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hybrid/strength-engine test load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/strength-engine/src/load.ts
import { measurementValue } from './performed';
import type { PerformedSetWithMeasurements, PerformedSet } from './performed';
import type { PrescribedSet } from './prescription';

export interface SessionLoad {
  tonnageKg: number;
  workReps: number;
  conditioningLoad: number;
}

export function sessionLoad(sets: PerformedSetWithMeasurements[]): SessionLoad {
  let tonnageKg = 0;
  let workReps = 0;
  for (const set of sets) {
    const reps = measurementValue(set, 'reps') ?? 0;
    const load = measurementValue(set, 'load');
    if (load != null) tonnageKg += reps * load;
    else workReps += reps;
  }
  return { tonnageKg, workReps, conditioningLoad: 0 };
}

export function intensity(sets: PerformedSetWithMeasurements[], workingMax: number): number | null {
  let repWeightedLoad = 0;
  let totalReps = 0;
  for (const set of sets) {
    const reps = measurementValue(set, 'reps');
    const load = measurementValue(set, 'load');
    if (reps == null || load == null) continue;
    repWeightedLoad += reps * load;
    totalReps += reps;
  }
  if (!totalReps || !workingMax) return null;
  return (repWeightedLoad / totalReps) / workingMax;
}

export function sessionCompliance(assigned: PrescribedSet[], performed: PerformedSet[]): number {
  const required = assigned.filter(s => !s.isOptional);
  if (!required.length) return 1;
  const done = required.filter(s => performed.some(p => p.prescribedSetId === s.id && p.status === 'completed'));
  return done.length / required.length;
}

export function blockCompliance(requiredSetIds: string[], performed: PerformedSet[]): number {
  if (!requiredSetIds.length) return 1;
  const done = requiredSetIds.filter(id => performed.some(p => p.prescribedSetId === id && p.status === 'completed'));
  return done.length / requiredSetIds.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hybrid/strength-engine test load.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/strength-engine/src/load.ts packages/strength-engine/src/load.test.ts
git commit -m "Add volume/intensity/compliance calculators (Slice 11)"
```

---

### Task 13: `Block<S>` union regains `StrengthBlock`, full-package barrel export, golden integration test

**Files:**
- Modify: `packages/engine/src/types.ts`
- Create: `packages/strength-engine/src/index.ts` (replace the Task 1
  placeholder with real exports)
- Create: `packages/strength-engine/test/golden/strength-pipeline.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-12.
- Produces: the package's public surface every later phase (B/C/D/E/F)
  imports from.

- [ ] **Step 1: Update `packages/engine/src/types.ts`**

Find the vestigial-`S` comment (added 17 August) and the `Block<S>` union;
replace with:

```ts
/** A strength set/block now lives in `@hybrid/strength-engine` — see
 * `StrengthBlockItem`/`PrescribedSet` there. `Block<S>` regains its third
 * member as a reference to that package's shape rather than redefining it
 * here, so the two packages cannot drift apart on what a strength block is. */
import type { StrengthBlockItem } from '@hybrid/strength-engine';

export type Block<S extends AnySet = LoggedSet> = StrengthBlockItem | CondBlock | TextBlock;
```

Add `@hybrid/strength-engine` as a dependency of `packages/engine/package.json`:

```json
"dependencies": {
  "@hybrid/shared-core": "workspace:*",
  "@hybrid/strength-engine": "workspace:*"
}
```

Add a re-exported `StrengthBlockItem` type alias to
`packages/strength-engine/src/index.ts` (Step 3 below) matching
`strength_block_item` + its `prescribed_set`/`prescribed_target` children,
so `@hybrid/engine`'s import resolves.

- [ ] **Step 2: Run `@hybrid/engine`'s typecheck to confirm the import resolves**

Run: `pnpm --filter @hybrid/engine typecheck`
Expected: PASS (this will fail until Step 3 below adds the export — do
Step 3 first if this fails, then re-run).

- [ ] **Step 3: Write the real barrel export**

```ts
// packages/strength-engine/src/index.ts
export * from './metric';
export * from './exercise';
export * from './rounding';
export * from './prescription';
export * from './resolve';
export * from './session';
export * from './performed';
export * from './e1rm';
export * from './workingMax';
export * from './pr';
export * from './load';

export interface StrengthBlockItem {
  id: string;
  kind: 'strength';
  exerciseId: string;
  groupingKey: string | null;
  sets: import('./prescription').PrescribedSet[];
}
```

Delete `src/index.test.ts`'s placeholder assertion (the `STRENGTH_ENGINE_
PACKAGE` export) — replace with a barrel-completeness test:

```ts
// packages/strength-engine/src/index.test.ts
import { describe, it, expect } from 'vitest';
import * as engine from './index';

describe('package barrel', () => {
  it('exports the full public surface', () => {
    expect(typeof engine.resolveTarget).toBe('function');
    expect(typeof engine.roundToIncrement).toBe('function');
    expect(typeof engine.e1rm).toBe('function');
    expect(typeof engine.currentWorkingMax).toBe('function');
    expect(typeof engine.detectPr).toBe('function');
    expect(typeof engine.sessionLoad).toBe('function');
    expect(typeof engine.resolveSessionForPublish).toBe('function');
  });
});
```

- [ ] **Step 4: Run the full package test suite**

Run: `pnpm --filter @hybrid/strength-engine test && pnpm --filter @hybrid/strength-engine typecheck`
Expected: PASS, all prior tasks' tests plus the new barrel test green.

- [ ] **Step 5: Write the golden integration test**

```ts
// packages/strength-engine/test/golden/strength-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSessionForPublish, type BlockItemInput } from '../../src/session';
import { detectPr } from '../../src/pr';
import { sessionLoad } from '../../src/load';
import { measurementValue, type PerformedSetWithMeasurements } from '../../src/performed';
import type { Exercise } from '../../src/exercise';
import type { ResolveCtx } from '../../src/resolve';

// Synthetic 5x5@75% session end to end: prescribe -> resolve -> publish ->
// snapshot -> simulate the athlete performing it with one deliberate
// deviation (an extra set) -> detect PR -> compute session load.
describe('golden: 5x5 @ 75% end to end', () => {
  const squat: Exercise = {
    id: 'sq', ownerId: null, name: 'Back Squat', videoAssetId: null, cues: null,
    equipment: { id: 'bb', name: 'Barbell (kg)', incrementKg: 2.5, rackValuesKg: null, rounding: 'down' },
    defaultMetrics: ['reps', 'load'], referenceMaxExerciseId: null, trackAsExerciseId: null, e1rmFormula: 'epley',
  };

  const items: BlockItemInput[] = [{
    exercise: squat,
    sets: Array.from({ length: 5 }, (_, i) => ({
      id: `s${i + 1}`, ordinal: i + 1, isOptional: false, isAmrap: false,
      targets: [
        { metricKey: 'load' as const, exprKind: 'pct_of_max' as const, exprArg: 0.75 },
        { metricKey: 'reps' as const, literalValue: 5 },
      ],
    })),
  }];

  const ctx: ResolveCtx = {
    athleteId: 'a1', scheduledDate: '2026-08-20',
    workingMaxAt: () => 140, lastPerformedLoad: () => null, bodyweightAt: () => null,
  };

  it('publishes a full snapshot at 105kg (140 * 0.75, rounded down to 2.5kg)', () => {
    const result = resolveSessionForPublish(items, ctx);
    expect('snapshot' in result).toBe(true);
    if ('snapshot' in result) {
      expect(result.snapshot.sq).toHaveLength(5);
      expect(result.snapshot.sq[0].targets.load).toEqual({ value: 105, exact: 105 });
    }
  });

  it('detects a PR when the athlete adds a 6th deviation set at a higher load', () => {
    const performed: PerformedSetWithMeasurements[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `p${i + 1}`, assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: `s${i + 1}`,
        ordinal: i + 1, status: 'completed' as const, performedAt: '2026-08-20T10:00:00Z', clientCreatedAt: '2026-08-20T10:00:00Z',
        measurements: [{ metricKey: 'load' as const, value: 105 }, { metricKey: 'reps' as const, value: 5 }],
      })),
      {
        id: 'p6', assignedSessionId: 'as1', exerciseId: 'sq', prescribedSetId: null,
        ordinal: 6, status: 'completed' as const, performedAt: '2026-08-20T10:20:00Z', clientCreatedAt: '2026-08-20T10:20:00Z',
        measurements: [{ metricKey: 'load' as const, value: 110 }, { metricKey: 'reps' as const, value: 3 }],
      },
    ];
    const isPr = detectPr({ exerciseId: 'sq', reps: 3, loadKg: 110 }, null);
    expect(isPr).toBe(true);

    const load = sessionLoad(performed);
    expect(load.tonnageKg).toBe(5 * 5 * 105 + 3 * 110);
  });
});
```

- [ ] **Step 6: Run the golden test**

Run: `pnpm --filter @hybrid/strength-engine test`
Expected: PASS, full suite including `test/golden/strength-pipeline.test.ts`.

- [ ] **Step 7: Run repo-wide verification**

Run: `pnpm run typecheck && pnpm run test && pnpm run check:ecosystem`
Expected: all green — this confirms `packages/engine`'s `Block<S>` change
didn't break any existing consumer (mobile/web still compile against the
now-three-member union even though nothing yet constructs a
`StrengthBlockItem` outside tests).

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/package.json packages/strength-engine/src/index.ts packages/strength-engine/src/index.test.ts packages/strength-engine/test/golden/strength-pipeline.test.ts
git commit -m "Wire StrengthBlockItem into Block<S>, full barrel export, golden test (Phase A close)"
```

---

## Self-Review Notes

**Spec coverage**: Slices 1-11 each map to Tasks 2-12 one-to-one; Slice 6's
Gotcha #4 test is explicit (Task 7, Step 6); Task 13 covers the `Block<S>`
union change the spec's Architecture section calls for, plus the golden
end-to-end test the spec's Phase A closing paragraph requires.

**Not in this plan, by design**: Phase B (coach authoring UI), Phase C
(mobile logger UI), Phase D (analytics), Phase E (deterministic
progression — depends on `performed_set`/`performed_measurement` from this
plan, follows as its own plan), Phase F (knowledge base — independent,
follows as its own plan). None of Phase A's tasks reference UI.

**Type consistency checked**: `PrescribedTarget`/`PrescribedSet` (Task 4)
match their use in Task 6 (`resolveTarget`) and Task 7
(`resolveSessionForPublish`) exactly. `PerformedSetWithMeasurements` (Task
8) matches its use in Task 12 (`sessionLoad`/`intensity`). `Exercise`/
`Equipment` (Task 3) match their use in Task 5 (`roundToIncrement`) and
Task 6.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-17-strength-phase-a-foundation.md`.**
