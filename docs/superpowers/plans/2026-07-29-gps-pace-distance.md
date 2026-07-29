# GPS-tracked pace and distance for conditioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record and display real distance/pace for outdoor conditioning sessions, tracked live via GPS on the mobile app, without touching the existing HR-zone progression system.

**Architecture:** A new pure `geo.ts` module in `packages/engine` (haversine distance, jitter-filtered distance summing, route downsampling — mirroring `hr.ts`'s existing `conDownsample` pattern exactly) backs three optional fields on `CondResult` and one on `CondBlock`. Mobile wires a new `GeoTracker` capability (shaped exactly like the existing `HeartRateMonitor` in `capabilities.ts`) into the Conditioning screen, and a new `RouteMap` component renders the result. Web and coach only read and display the resulting numbers — no map, no tracking, on either of them.

**Tech Stack:** `expo-location` + `expo-task-manager` (background GPS), `react-native-maps` (route display) — all mobile-only, all new dependencies to this repo.

## Global Constraints

- Informational only — `conAdapt`/`conProgLevel` are NOT touched; distance/pace never earn or cost a progression level.
- GPS tracking and the map are mobile-only. Web and coach never import `react-native-maps` and never track location.
- `CondResult`'s new fields (`distanceM`, `avgPaceSecPerKm`, `route`) are all optional — absent means "not tracked this session," same degrade-not-throw philosophy as a missing HR strap.
- `CondBlock.targetDistanceM` is optional, coach-authored, purely a display target — no pace band, no zone system, no progression tie-in.
- The route is capped at `CON_MAX_POINTS` (from `packages/engine/src/constants.ts`), same cap the HR trace already uses.
- Group 2 (Tasks 7–11, the native slice) requires a `GOOGLE_MAPS_API_KEY` (Android) that only the repo owner can create via Google Cloud Console, and a `runtimeVersion`/`versionCode` bump — it ships as a new store build, NOT an OTA update. Group 1 (Tasks 1–6) is JS-only and ships over the air exactly like every prior change this session.
- Nothing in Group 2 is exercised by `checks/react-smoke.mjs` (headless Chromium — no GPS, no native map). Say so in each Group-2 task's verification step rather than imply automated coverage that does not exist.

---

### Task 1: Engine — geo types and pure distance/downsampling functions

**Files:**
- Modify: `packages/engine/src/types.ts` (add `GeoSample`, `GeoDownsampled`)
- Create: `packages/engine/src/geo.ts`
- Modify: `packages/engine/src/index.ts` (add `export * from './geo';`)
- Test: `packages/engine/test/geo.test.ts`

**Interfaces:**
- Consumes: `CON_MAX_POINTS` from `packages/engine/src/constants.ts` (existing).
- Produces: `GeoSample { t: number; lat: number; lon: number }`, `GeoDownsampled { every: number; pts: ({lat:number;lon:number}|null)[] }`, `haversineM(a: {lat,lon}, b: {lat,lon}): number`, `totalDistanceM(samples: GeoSample[]): number`, `geoDownsample(samples: GeoSample[], durSec: number): GeoDownsampled`, `paceSecPerKm(distanceM: number, durSec: number): number | null` — all consumed by Task 2 (CondResult fields), Task 9 (mobile Conditioning screen wiring).

- [ ] **Step 1: Add the two new types to `types.ts`**

Add just above `export interface CondBlock {` (currently line 88):

```ts
/** One GPS fix during a tracked conditioning session. */
export interface GeoSample {
  /** seconds since session start, matching HrSample's `t` */
  t: number;
  lat: number;
  lon: number;
}

/**
 * A downsampled route, stored the same spirit as `Downsampled` (the HR
 * trace) but carrying coordinate pairs instead of a single number.
 */
export interface GeoDownsampled {
  every: number;
  pts: ({ lat: number; lon: number } | null)[];
}

```

- [ ] **Step 2: Write the failing tests**

Create `packages/engine/test/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { geoDownsample, haversineM, paceSecPerKm, totalDistanceM } from '../src/geo';

describe('haversineM', () => {
  it('is zero for the same point', () => {
    expect(haversineM({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBe(0);
  });

  it('matches the known ~111.3km-per-degree scale at the equator', () => {
    const d = haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });
});

describe('totalDistanceM', () => {
  it('sums a plausible run', () => {
    const d = totalDistanceM([
      { t: 0, lat: 0, lon: 0 },
      { t: 10, lat: 0.00027, lon: 0 },
    ]);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });

  it('drops a hop implying a speed above the plausible ceiling (~10 m/s)', () => {
    const d = totalDistanceM([
      { t: 0, lat: 0, lon: 0 },
      { t: 10, lat: 0.00027, lon: 0 }, // ~30m over 10s — plausible, ~3 m/s
      { t: 20, lat: 0.00027, lon: 0.01 }, // ~1112m over 10s — ~111 m/s, dropped
    ]);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });

  it('is zero for fewer than two samples', () => {
    expect(totalDistanceM([])).toBe(0);
    expect(totalDistanceM([{ t: 0, lat: 0, lon: 0 }])).toBe(0);
  });
});

describe('geoDownsample', () => {
  it('buckets samples and leaves empty buckets null, mirroring conDownsample', () => {
    const ds = geoDownsample(
      [
        { t: 0, lat: 1, lon: 2 },
        { t: 1, lat: 3, lon: 4 },
        { t: 5, lat: 10, lon: 20 },
      ],
      10,
    );
    expect(ds.every).toBe(2);
    expect(ds.pts).toHaveLength(6);
    expect(ds.pts[0]).toEqual({ lat: 2, lon: 3 });
    expect(ds.pts[1]).toBeNull();
    expect(ds.pts[2]).toEqual({ lat: 10, lon: 20 });
    expect(ds.pts[3]).toBeNull();
  });
});

describe('paceSecPerKm', () => {
  it('is null for zero or negative distance', () => {
    expect(paceSecPerKm(0, 100)).toBeNull();
    expect(paceSecPerKm(-5, 100)).toBeNull();
  });

  it('computes seconds per kilometre', () => {
    expect(paceSecPerKm(1000, 300)).toBe(300);
    expect(paceSecPerKm(500, 300)).toBe(600);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/engine test -- geo.test.ts`
Expected: FAIL — `Cannot find module '../src/geo'` (the file does not exist yet).

- [ ] **Step 4: Write `packages/engine/src/geo.ts`**

```ts
import { CON_MAX_POINTS } from './constants';
import type { GeoDownsampled, GeoSample } from './types';

/*
 * Distance and route math for GPS-tracked conditioning, mirroring hr.ts's
 * conDownsample/zoneSeconds exactly — same bucketing shape, same cap — so a
 * route is stored with the same discipline as an HR trace.
 */

const EARTH_RADIUS_M = 6371000;

/**
 * Above this speed a "movement" between two fixes is GPS drift, not the
 * athlete — no outdoor conditioning format in this app is run faster than
 * ~10 m/s (36km/h), and a jittering fix parked still can otherwise
 * accumulate fake distance one metre at a time all session.
 */
const MAX_PLAUSIBLE_MPS = 10;

/** Great-circle distance between two points, in metres. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/**
 * Sums consecutive haversine distances across a session's raw fixes,
 * dropping any single hop whose implied speed exceeds MAX_PLAUSIBLE_MPS —
 * see the constant's comment for why.
 */
export function totalDistanceM(samples: GeoSample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const dt = cur.t - prev.t;
    if (dt <= 0) continue;
    const d = haversineM(prev, cur);
    if (d / dt > MAX_PLAUSIBLE_MPS) continue;
    total += d;
  }
  return total;
}

/**
 * Compress a session's GPS fixes to a storable route. Same bin-widens-to-fit
 * bucketing as conDownsample, for the same reason: fixing the bin width at
 * session start means a long session's later fixes all fold into the final
 * bin once CON_MAX_POINTS is reached.
 */
export function geoDownsample(samples: GeoSample[], durSec: number): GeoDownsampled {
  const every = Math.max(2, Math.ceil(Math.max(0, durSec) / (CON_MAX_POINTS - 1)));
  const n = Math.max(1, Math.min(Math.ceil(durSec / every) + 1, CON_MAX_POINTS));
  const sumLat = new Array<number>(n).fill(0);
  const sumLon = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  samples.forEach((s) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(s.t / every)));
    sumLat[i] += s.lat;
    sumLon[i] += s.lon;
    cnt[i] += 1;
  });
  return {
    every,
    pts: sumLat.map((v, i) => (cnt[i] ? { lat: v / cnt[i], lon: sumLon[i] / cnt[i] } : null)),
  };
}

/** Average pace, in seconds per kilometre. Null when there is no distance to divide by. */
export function paceSecPerKm(distanceM: number, durSec: number): number | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  return durSec / (distanceM / 1000);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/engine test -- geo.test.ts`
Expected: PASS — all 8 cases.

- [ ] **Step 6: Export the new module and typecheck the whole engine**

Add to `packages/engine/src/index.ts`, after `export * from './hr';`:

```ts
export * from './geo';
```

Run: `pnpm --filter @hybrid/engine typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/geo.ts packages/engine/src/index.ts packages/engine/test/geo.test.ts
git commit -m "Engine: GPS distance math (haversine, jitter filter, route downsampling)"
```

---

### Task 2: Engine — CondResult/CondBlock fields and pace/distance formatters

**Files:**
- Modify: `packages/engine/src/types.ts` (CondResult, CondBlock)
- Modify: `packages/engine/src/num.ts` (fmtPace, fmtDistance)
- Test: `packages/engine/test/geo.test.ts` (append)

**Interfaces:**
- Consumes: nothing new (pure additions to existing types/files).
- Produces: `CondResult.distanceM?: number`, `CondResult.avgPaceSecPerKm?: number`, `CondResult.route?: GeoDownsampled`, `CondBlock.targetDistanceM?: number`, `fmtPace(secPerKm: number): string`, `fmtDistance(m: number): string` — consumed by Task 3 (coach authoring), Task 4/5 (web/mobile display), Task 9 (mobile Conditioning screen).

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/geo.test.ts`:

```ts
import { fmtDistance, fmtPace } from '../src/num';

describe('fmtPace', () => {
  it('formats seconds-per-km as m:ss/km', () => {
    expect(fmtPace(312)).toBe('5:12/km');
    expect(fmtPace(60)).toBe('1:00/km');
  });

  it('is blank for a non-positive or non-finite input', () => {
    expect(fmtPace(0)).toBe('');
    expect(fmtPace(-10)).toBe('');
    expect(fmtPace(NaN)).toBe('');
  });
});

describe('fmtDistance', () => {
  it('shows metres under a kilometre', () => {
    expect(fmtDistance(850)).toBe('850 m');
  });

  it('shows one decimal of kilometres at or above a kilometre', () => {
    expect(fmtDistance(5200)).toBe('5.2 km');
    expect(fmtDistance(1000)).toBe('1.0 km');
  });

  it('is blank for a non-positive or non-finite input', () => {
    expect(fmtDistance(0)).toBe('');
    expect(fmtDistance(NaN)).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hybrid/engine test -- geo.test.ts`
Expected: FAIL — `fmtPace`/`fmtDistance` not exported from `../src/num`.

- [ ] **Step 3: Add the fields to `types.ts`**

In `CondResult` (currently lines 161–178), add after `trace?: Downsampled;`:

```ts
  /** total metres covered, jitter-filtered — absent means not GPS-tracked */
  distanceM?: number;
  /** dur / (distanceM/1000), only ever set alongside distanceM */
  avgPaceSecPerKm?: number;
  /** downsampled GPS route, capped like the HR trace */
  route?: GeoDownsampled;
```

In `CondBlock` (currently lines 88–100), add after `minutes?: number | string;`:

```ts
  /** coach-authored target, purely a display chip — no progression tie-in */
  targetDistanceM?: number;
```

- [ ] **Step 4: Add the formatters to `num.ts`**

Add after `fmtRest` (currently lines 53–56):

```ts
/** "5:12/km" from seconds-per-km. Mirrors fmtRpe/fmtRest's plainness. */
export function fmtPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return m + ':' + String(s).padStart(2, '0') + '/km';
}

/** "5.2 km" from metres, or "850 m" under a kilometre. */
export function fmtDistance(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(1) + ' km';
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @hybrid/engine test -- geo.test.ts`
Expected: PASS — all cases from both tasks (14 total).

- [ ] **Step 6: Typecheck and run the full engine suite**

Run: `pnpm --filter @hybrid/engine typecheck && pnpm --filter @hybrid/engine test`
Expected: PASS, no regressions — these are additive optional fields, nothing existing reads or requires them.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/num.ts packages/engine/test/geo.test.ts
git commit -m "Engine: CondResult distance/pace/route fields, CondBlock target distance, fmtPace/fmtDistance"
```

---

### Task 3: Coach — author a target distance on a conditioning block

**Files:**
- Modify: `apps/coach/src/editor/ConditioningCard.tsx`
- Modify: `apps/coach/src/Editor.tsx`
- Test: `apps/coach/test/model.test.ts` (append, via `assertPublishable`)

**Interfaces:**
- Consumes: `fmtDistance` (Task 2), `CondCard`'s existing props (`fmt`, `eff`, `open`, `onToggle`, `onFmt`, `onEff`).
- Produces: `CondCard`'s two new props `targetDistanceM?: number` and `onTargetDistance: (v: number | undefined) => void`, consumed by `Editor.tsx`'s call site.

- [ ] **Step 1: Write the failing test**

Append to `apps/coach/test/model.test.ts` (uses the existing `assertPublishable`/`newSession`-style setup already in that file — follow its existing imports):

```ts
it('a conditioning block carries an authored target distance through assertPublishable', () => {
  const sess = newSession('Row day');
  sess.blocks = [
    { id: 'b1', kind: 'conditioning', heading: 'Row', condFmt: 'steady', effort: 'medium', targetZone: 'mod', minutes: 20, targetDistanceM: 5000 },
  ];
  const w = assertPublishable(sess);
  expect((w.blocks[0] as { targetDistanceM?: number }).targetDistanceM).toBe(5000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hybrid/coach test -- model.test.ts`
Expected: FAIL if `assertPublishable`/`emit.assertWorkout` strips or rejects the field — but per Task 2's Step 3, `assertWorkout` validates `condFmt`/`targetZone`/`effort` on a conditioning block and returns the object unchanged (see `packages/engine/src/emit.ts` lines 190–201, 220 — it never reconstructs the block), so this is expected to PASS immediately. Run it anyway to confirm — an unexpected FAIL here means `assertWorkout`'s behavior changed and needs investigating before continuing, not silently patching around it.

- [ ] **Step 3: Add the authoring UI to `ConditioningCard.tsx`**

Modify the props type and destructuring (currently lines 10–24):

```ts
export function CondCard({
  fmt,
  eff,
  targetDistanceM,
  open,
  onToggle,
  onFmt,
  onEff,
  onTargetDistance,
}: {
  fmt: CondFmtKey;
  eff: EffortKey;
  targetDistanceM?: number;
  open: boolean;
  onToggle: () => void;
  onFmt: (v: CondFmtKey) => void;
  onEff: (v: EffortKey) => void;
  onTargetDistance: (v: number | undefined) => void;
}) {
```

Add the import at the top of the file (currently line 1):

```ts
import { CON_EFFORTS, CON_EFFORT_KEYS, CON_FORMATS, CON_FORMAT_KEYS, condEffortRpe, fmtDistance, type CondFmtKey, type EffortKey } from '@hybrid/engine';
```

Update the collapsed summary line (currently line 26) to show the target when set:

```ts
  const sum = `${CON_EFFORTS[eff].name} · ${CON_EFFORTS[eff].cue} · runs by heart rate${targetDistanceM ? ` · Target ${fmtDistance(targetDistanceM)}` : ''}`;
```

Add a target-distance field inside the open panel, after the Effort block (currently ends at line 67, just before the closing `</div>` at line 68):

```tsx
          <div>
            <div className={MICRO + ' mb-1'}>Target distance (optional)</div>
            <input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={targetDistanceM ? String(targetDistanceM / 1000) : ''}
              onChange={(e) => {
                const km = parseFloat(e.target.value);
                onTargetDistance(Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : undefined);
              }}
              placeholder="5"
              aria-label="target distance in kilometres"
              className="h-4 w-20 rounded-sm border border-line2 bg-panel3 px-1 text-3 outline-none focus:border-gold-line"
            />
            <span className="ml-1 text-2 text-dim">km</span>
          </div>
```

- [ ] **Step 4: Wire the new props at the call site in `Editor.tsx`**

Modify the `CondCard` call (currently lines 276–290):

```tsx
              ) : isCond(b) ? (
                <CondCard
                  fmt={b.condFmt}
                  eff={condEffort(b).key}
                  targetDistanceM={b.targetDistanceM}
                  open={open?.b === bi}
                  onToggle={() => setOpen(open?.b === bi ? null : { b: bi, e: 0 })}
                  onFmt={(v) => edit((d) => void ((d.blocks[bi] as never as { condFmt: CondFmtKey }).condFmt = v))}
                  onEff={(v) =>
                    edit((d) => {
                      const cb = d.blocks[bi] as never as { effort: EffortKey; targetZone: string };
                      cb.effort = v;
                      cb.targetZone = CON_EFFORTS[v].zone;
                    })
                  }
                  onTargetDistance={(v) =>
                    edit((d) => void ((d.blocks[bi] as never as { targetDistanceM?: number }).targetDistanceM = v))
                  }
                />
              ) : (
```

- [ ] **Step 5: Run coach's tests and typecheck**

Run: `pnpm --filter @hybrid/coach test && pnpm --filter @hybrid/coach typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/coach/src/editor/ConditioningCard.tsx apps/coach/src/Editor.tsx apps/coach/test/model.test.ts
git commit -m "Coach: author an optional target distance on a conditioning block"
```

---

### Task 4: Web — display distance/pace wherever a conditioning result is shown

**Files:**
- Modify: `apps/web/src/screens/Recap.tsx`
- Modify: `apps/web/src/screens/History.tsx`
- Modify: `apps/web/src/screens/Progress.tsx`

**Interfaces:**
- Consumes: `fmtDistance`, `fmtPace` (Task 2), `CondResult.distanceM`/`avgPaceSecPerKm` (Task 2).
- Produces: nothing new for later tasks — this is a display-only leaf.

- [ ] **Step 1: Recap — show distance/pace next to the existing HR line**

In `apps/web/src/screens/Recap.tsx`, add `fmtDistance, fmtPace` to the existing `@hybrid/engine` import (currently lines 3–15), and modify the conditioning summary (currently lines 137–142):

```tsx
            {isCond(b) ? (
              <p className="num mt-0.5 text-4 text-muted">
                {b.condFmt}
                {b.condResult?.dur ? ` · ${fmtClock(b.condResult.dur)}` : ''}
                {b.condResult?.distanceM ? ` · ${fmtDistance(b.condResult.distanceM)}` : ''}
                {b.condResult?.avgPaceSecPerKm ? ` · ${fmtPace(b.condResult.avgPaceSecPerKm)}` : ''}
                {b.condResult?.hrr != null ? ` · HRR ${b.condResult.hrr}bpm` : ''}
              </p>
            ) : (
```

- [ ] **Step 2: History — same, on the session detail line**

In `apps/web/src/screens/History.tsx`, add `fmtDistance` to the existing `@hybrid/engine` import (currently lines 2–13), and modify the conditioning summary (currently lines 155–160):

```tsx
          {isCond(b) ? (
            <p className="num mt-0.5 text-4 text-muted">
              {b.condFmt}
              {b.condResult?.dur ? ` · ${Math.round(b.condResult.dur / 60)} min` : ''}
              {b.condResult?.distanceM ? ` · ${fmtDistance(b.condResult.distanceM)}` : ''}
              {b.condResult?.felt ? ` · felt RPE ${b.condResult.felt}` : ''}
            </p>
          ) : (
```

- [ ] **Step 3: Progress — a weekly distance tally next to the existing zone-time tally**

In `apps/web/src/screens/Progress.tsx`, add `fmtDistance` to the existing `@hybrid/engine` import (currently line 14 area), and add a new function right after `zoneSecondsThisWeek` (currently ends at line 443):

```ts
function distanceThisWeek(sessions: Session[], settings: { conditioning?: CondResult[] }): number {
  const since = Date.now() - 7 * 864e5;
  return condEfforts(sessions, settings)
    .filter((r) => (r.startedAt || 0) >= since)
    .reduce((sum, r) => sum + (r.distanceM || 0), 0);
}
```

Compute it alongside `zoneWeek` (currently line 59):

```ts
  const zoneWeek = useMemo(() => zoneSecondsThisWeek(sessions, settings), [sessions, settings]);
  const distWeek = useMemo(() => distanceThisWeek(sessions, settings), [sessions, settings]);
```

Render it inside the existing "Zone time · this week" card, right after the `<ul>` closes (currently line 220, just before `</Card>` on line 221):

```tsx
            {distWeek > 0 ? (
              <p className="num mt-1 border-t border-line pt-1 text-3 text-dim">{fmtDistance(distWeek)} this week</p>
            ) : null}
```

- [ ] **Step 4: Typecheck and run web's tests**

Run: `pnpm --filter @hybrid/web typecheck && pnpm --filter @hybrid/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/Recap.tsx apps/web/src/screens/History.tsx apps/web/src/screens/Progress.tsx
git commit -m "Web: show GPS distance/pace on Recap, History, and Progress"
```

---

### Task 5: Mobile — display distance/pace wherever a conditioning result is shown

**Files:**
- Modify: `apps/mobile/src/screens/Recap.tsx`
- Modify: `apps/mobile/src/screens/History.tsx`
- Modify: `apps/mobile/src/screens/Progress.tsx`

**Interfaces:**
- Consumes: same as Task 4, mobile side. Mirrors Task 4 exactly.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Recap — mirror Task 4 Step 1**

In `apps/mobile/src/screens/Recap.tsx`, add `fmtDistance, fmtPace` to the `@hybrid/engine` import (currently lines 5–17), and modify the conditioning summary (currently lines 131–136):

```tsx
          {isCond(b) ? (
            <T num className="mt-0.5 text-4 text-muted">
              {b.condFmt}
              {b.condResult?.dur ? ` · ${fmtClock(b.condResult.dur)}` : ''}
              {b.condResult?.distanceM ? ` · ${fmtDistance(b.condResult.distanceM)}` : ''}
              {b.condResult?.avgPaceSecPerKm ? ` · ${fmtPace(b.condResult.avgPaceSecPerKm)}` : ''}
              {b.condResult?.hrr != null ? ` · HRR ${b.condResult.hrr}bpm` : ''}
            </T>
          ) : (
```

- [ ] **Step 2: History — mirror Task 4 Step 2**

In `apps/mobile/src/screens/History.tsx`, add `fmtDistance` to the `@hybrid/engine` import (currently line 3), and modify the conditioning summary (currently lines 80–84):

```tsx
          {isCond(b) ? (
            <T num className="text-4 text-muted">
              {b.condFmt}
              {b.condResult?.dur ? ` · ${Math.round(b.condResult.dur / 60)} min` : ''}
              {b.condResult?.distanceM ? ` · ${fmtDistance(b.condResult.distanceM)}` : ''}
            </T>
          ) : (
```

- [ ] **Step 3: Progress — mirror Task 4 Step 3**

In `apps/mobile/src/screens/Progress.tsx`, add `fmtDistance` to the `@hybrid/engine` import (currently line 16 area), and add the same `distanceThisWeek` function right after `thisWeek` (currently ends at line 483):

```ts
function distanceThisWeek(sessions: Session[], settings: { conditioning?: CondResult[] }): number {
  const since = Date.now() - 7 * 864e5;
  return condEfforts(sessions, settings)
    .filter((r) => (r.startedAt || 0) >= since)
    .reduce((sum, r) => sum + (r.distanceM || 0), 0);
}
```

Compute it alongside `zoneWeek` (currently line 41):

```ts
  const zoneWeek = useMemo(() => thisWeek(db.sessions, db.settings), [db.sessions, db.settings]);
  const distWeek = useMemo(() => distanceThisWeek(db.sessions, db.settings), [db.sessions, db.settings]);
```

Render it inside the "Zone time · this week" card, right after the zone `<Row>` list closes (currently line 282, just before `</Card>` on line 283):

```tsx
            {distWeek > 0 ? (
              <T num className="mt-1 border-t border-line pt-1 text-3 text-dim">{fmtDistance(distWeek)} this week</T>
            ) : null}
```

- [ ] **Step 4: Typecheck and run mobile's tests**

Run: `pnpm --filter @hybrid/mobile typecheck && pnpm --filter @hybrid/mobile test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/Recap.tsx apps/mobile/src/screens/History.tsx apps/mobile/src/screens/Progress.tsx
git commit -m "Mobile: show GPS distance/pace on Recap, History, and Progress"
```

---

### Task 6: Verify and push Group 1 (JS-only, OTA-shippable)

**Files:** none (verification only)

This closes out everything that can ship the same way sub-project C did — no native change yet.

- [ ] **Step 1: Run every test suite**

Run: `pnpm run test`
Expected: PASS — `packages/engine` (with the new `geo.test.ts`), `apps/coach` (with the new `model.test.ts` case), `apps/web`, `apps/mobile`.

- [ ] **Step 2: Run the full verify chain**

Run: `pnpm run verify`
Expected: PASS — typecheck, test, `build:site`, `check:csp`, `smoke` (react-smoke), `smoke:deploy`. None of Tasks 1–5 touch UI structure or aria-labels react-smoke asserts on, so no existing assertion should need updating — if one fails unexpectedly, that is new information to root-cause before patching, not something to wave through.

- [ ] **Step 3: Run the checks `verify` doesn't cover**

```bash
node checks/contrast.mjs
node checks/web-touch.mjs
node checks/docs.mjs
```

Expected: all PASS.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Confirm CI**

Poll `GET /repos/reflectprotect123-max/THE-HYBRID-ENGINE1/actions/runs` for the new commits' SHAs. Confirm CI reaches `completed`/`success` for each. Since Tasks 1–5 only touch `packages/engine`, `apps/coach`, `apps/web`, and `apps/mobile`'s JS/TSX (no `app.json`, no native deps), `mobile-ota.yml` firing and its `Publish EAS Update` step succeeding means this is live to phones immediately — same confirmation discipline as every prior push this session.

---

### Task 7: Mobile native config — dependencies, permissions, runtimeVersion bump

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `expo-location`, `expo-task-manager`, `react-native-maps` as installed dependencies; the native permissions/plugins Task 8 (`GeoTracker`) and Task 10 (`RouteMap`) need at runtime.

This is the first Group 2 task — everything from here through Task 11 requires a new native build, not an OTA update, and needs a `GOOGLE_MAPS_API_KEY` you create yourself. **Stop and get that key from Google Cloud Console (a Maps SDK for Android key, restricted to this app's package name `com.hybridengine.app`) before Step 3** — the rest of this task can proceed without it, but Task 11's build cannot.

- [ ] **Step 1: Install the packages at versions matched to this Expo SDK**

Run, from `apps/mobile`:

```bash
cd apps/mobile
npx expo install expo-location expo-task-manager react-native-maps
```

`expo install` (not a plain `pnpm add`) is deliberate — it resolves each package to the version this project's `expo` (`~54.0.36`) actually supports, the same reasoning `runtimeVersion`'s own comment in `app.json` gives for avoiding ad-hoc dependency resolution.

- [ ] **Step 2: Verify the install**

Run: `cat apps/mobile/package.json | grep -E "expo-location|expo-task-manager|react-native-maps"`
Expected: all three present with real version numbers (not `latest` or a `workspace:*` placeholder).

- [ ] **Step 3: Add an EAS secret for the Maps API key**

This is a one-time account-level action you do yourself (not scriptable from here — it needs your Google Cloud and Expo account access):

```bash
eas secret:create --scope project --name GOOGLE_MAPS_API_KEY --value <your-key> --type string
```

- [ ] **Step 4: Update `apps/mobile/app.json`**

Add to `plugins` (currently lines 44–56), alongside the existing `react-native-ble-plx` entry:

```json
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Tracks your route and pace during outdoor conditioning, including with the screen locked.",
          "locationWhenInUsePermission": "Tracks your route and pace during outdoor conditioning.",
          "isAndroidBackgroundLocationEnabled": true,
          "isIosBackgroundLocationEnabled": true
        }
      ],
      "expo-task-manager",
      [
        "react-native-maps",
        {
          "googleMapsApiKey": "$GOOGLE_MAPS_API_KEY"
        }
      ],
```

Add to `android.permissions` (currently lines 24–30):

```json
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
```

Add to `ios.infoPlist` (currently lines 32–35):

```json
        "NSLocationWhenInUseUsageDescription": "Tracks your route and pace during outdoor conditioning.",
        "NSLocationAlwaysAndWhenInUseUsageDescription": "Tracks your route and pace during outdoor conditioning, including with the screen locked.",
        "UIBackgroundModes": ["location"]
```

Bump the two version markers (currently `"runtimeVersion": "1"` and `"versionCode": 30`):

```json
    "runtimeVersion": "2",
```
```json
      "versionCode": 31,
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: PASS — this task only touches config and dependencies, no application code yet, so nothing should reference the new packages until Task 8.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml apps/mobile/app.json
git commit -m "Mobile: add expo-location/expo-task-manager/react-native-maps, native config, runtimeVersion bump"
```

Do not push yet — Task 11 pushes everything in Group 2 together, after on-device testing.

---

### Task 8: Mobile — the GeoTracker capability

**Files:**
- Modify: `apps/mobile/src/native/capabilities.ts`

**Interfaces:**
- Consumes: `GeoSample` (Task 1), `expo-location`/`expo-task-manager` (Task 7).
- Produces: `GeoState`, `GeoTracker { start, stop }`, `createGeoTracker(): GeoTracker` — consumed by Task 9.

**Not automatable:** this task has no unit test. `capabilities.ts` has none today either — `createHeartRateMonitor` is exercised only by running the app on a real device with real hardware, and the same is true here for a real GPS fix. Typecheck is the only automated gate.

- [ ] **Step 1: Add the type and interface**

Add after `export type HrState = 'scanning' | 'connected' | 'error';` (currently line 21):

```ts
export type GeoState = 'tracking' | 'error';

export interface GeoTracker {
  /**
   * Resolves once tracking has begun — or, on a failure, once `onState` has
   * been told why it did not. Samples arrive on `onSample`. Degrades like
   * the HR monitor: a denied permission means no samples, never a thrown
   * error mid-session.
   */
  start(onSample: (s: GeoSample) => void, onState?: (state: GeoState, msg: string) => void): Promise<void>;
  stop(): void;
}
```

Add `GeoSample` to the file's imports — it needs one, since this file currently has none from `@hybrid/engine`:

```ts
import type { GeoSample } from '@hybrid/engine';
```

- [ ] **Step 2: Add the background task registration and `createGeoTracker`**

Add at the end of the file, after `setKeepAwake` (currently ends at line 299) and before the removed-`stepsToday` comment block:

```ts
const GEO_TASK = 'hybrid-geo-tracking';
let taskRegistered = false;

/**
 * Foreground permission first, background only if the athlete accepts it —
 * both platforms gate background location behind a second, explicit prompt,
 * and bundling the two into one ask is the surest way to get both denied.
 */
async function ensureLocationPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  const Location = await import('expo-location');
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bg.granted };
}

export function createGeoTracker(): GeoTracker {
  let stopped = false;
  let onSampleRef: ((s: GeoSample) => void) | null = null;
  let startedAt = 0;
  let subscription: { remove(): void } | null = null;

  return {
    async start(onSample, onState) {
      stopped = false;
      onSampleRef = onSample;
      startedAt = Date.now();
      const say = (state: GeoState, msg = '') => {
        if (!stopped) onState?.(state, msg);
      };
      try {
        const perms = await ensureLocationPermissions();
        if (!perms.foreground) {
          say('error', 'Location permission was refused — the route and distance will not be recorded.');
          return;
        }

        const Location = await import('expo-location');
        const TaskManager = await import('expo-task-manager');

        if (!taskRegistered && !TaskManager.isTaskDefined(GEO_TASK)) {
          TaskManager.defineTask(GEO_TASK, ({ data, error }: { data?: unknown; error?: unknown }) => {
            if (error || !data) return;
            const { locations } = data as { locations: { coords: { latitude: number; longitude: number }; timestamp: number }[] };
            locations.forEach((loc) => {
              onSampleRef?.({
                t: Math.floor((loc.timestamp - startedAt) / 1000),
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
              });
            });
          });
          taskRegistered = true;
        }

        if (perms.background) {
          await Location.startLocationUpdatesAsync(GEO_TASK, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 0,
            foregroundService: {
              notificationTitle: 'Tracking your session',
              notificationBody: 'Recording your route and pace.',
            },
          });
        } else {
          subscription = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
            (loc) => {
              onSampleRef?.({
                t: Math.floor((loc.timestamp - startedAt) / 1000),
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
              });
            },
          );
        }
        say('tracking');
      } catch (e) {
        say('error', String((e as Error)?.message || 'GPS is not available on this build.'));
      }
    },
    stop() {
      stopped = true;
      onSampleRef = null;
      try {
        subscription?.remove();
        subscription = null;
        void (async () => {
          const Location = await import('expo-location');
          const TaskManager = await import('expo-task-manager');
          if (await TaskManager.isTaskRegisteredAsync(GEO_TASK)) {
            await Location.stopLocationUpdatesAsync(GEO_TASK);
          }
        })();
      } catch {
        /* already stopped, or never started */
      }
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/native/capabilities.ts
git commit -m "Mobile: GeoTracker capability (foreground + background GPS)"
```

---

### Task 9: Mobile — wire GPS into the Conditioning screen

**Files:**
- Modify: `apps/mobile/src/screens/Conditioning.tsx`

**Interfaces:**
- Consumes: `createGeoTracker` (Task 8), `totalDistanceM`, `geoDownsample`, `paceSecPerKm` (Task 1), `GeoSample` (Task 1).
- Produces: `CondResult.distanceM`/`avgPaceSecPerKm`/`route` populated at session finish — consumed by Task 10 (`RouteMap`, live inset) and already consumed by Task 5's display code.

**Not automatable:** whether a real fix arrives, whether background tracking survives a lock screen, and battery/behavior on a real device all need on-device testing — this task's verification step says so explicitly rather than claiming coverage `react-smoke.mjs` cannot provide.

- [ ] **Step 1: Add the geo samples ref and tracker, alongside the existing HR ones**

Add to the imports (currently lines 4–22):

```ts
  geoDownsample,
  paceSecPerKm,
  totalDistanceM,
  type GeoSample,
```

Add to the `native/capabilities` import (currently line 24):

```ts
import { buzz, createGeoTracker, createHeartRateMonitor, setKeepAwake } from '../native/capabilities';
```

Add a ref alongside `samples` (currently line 57):

```ts
  const geoSamples = useRef<GeoSample[]>([]);
  const geoTracker = useRef<ReturnType<typeof createGeoTracker> | null>(null);
  const [geoMsg, setGeoMsg] = useState('');
```

- [ ] **Step 2: Start and stop tracking alongside the HR monitor**

In `start` (currently lines 130–146), add after `monitor.current = createHeartRateMonitor();`:

```ts
    geoSamples.current = [];
    geoTracker.current = createGeoTracker();
    setGeoMsg('');
    await geoTracker.current.start(
      (s) => geoSamples.current.push(s),
      (state, msg) => setGeoMsg(state === 'tracking' ? '' : msg),
    );
```

In the cleanup effect that stops the HR monitor (currently lines 122–126), also stop the tracker:

```ts
  useEffect(() => () => {
    monitor.current?.stop();
    geoTracker.current?.stop();
    void setKeepAwake(false);
  }, []);
```

In `finish` (currently lines 148–163), stop the tracker alongside the monitor:

```ts
  const finish = () => {
    setLive(false);
    monitor.current?.stop();
    geoTracker.current?.stop();
    void setKeepAwake(false);
```

- [ ] **Step 3: Fold distance/pace into the `CondResult`**

Modify the `rec` construction (currently lines 165–177):

```ts
    const dur = Math.max(1, elapsed);
    const trace = conDownsample(samples.current, dur);
    const distanceM = totalDistanceM(geoSamples.current);
    const rec: CondResult = {
      id: uid(),
      fmt,
      effort: fmt === 'steady' ? 'easy' : 'hard',
      zsec: zoneSeconds(trace, zones),
      dur,
      rec: zones.rec,
      startedAt: startedAt.current,
      hrr: conHrr(trace).hrr,
      trace,
      ...(distanceM > 0
        ? {
            distanceM,
            avgPaceSecPerKm: paceSecPerKm(distanceM, dur) ?? undefined,
            route: geoDownsample(geoSamples.current, dur),
          }
        : {}),
    };
```

- [ ] **Step 4: Show the GPS message when there is one, next to the existing HR message**

In the live-session card (currently line 288, right after the `{bpm == null && hrMsg ? ... }` line):

```tsx
              {geoMsg ? <T className="mt-1 text-3 text-muted">{geoMsg}</T> : null}
```

- [ ] **Step 5: Show distance/pace in the Banked result, next to the zone tally**

In the "Banked" result card (currently lines 314–319), add after the existing `View`'s closing text:

```tsx
            <View className="mt-1.5 border-t border-line pt-1">
              <T num className="text-3 text-dim">
                {fmtClock(result.dur ?? 0)} total
                {result.hrr != null ? ` · HR dropped ${result.hrr}bpm in the minute after peak` : ''}
              </T>
              {result.distanceM ? (
                <T num className="mt-0.5 text-3 text-dim">
                  {fmtDistance(result.distanceM)}
                  {result.avgPaceSecPerKm ? ` · ${fmtPace(result.avgPaceSecPerKm)}` : ''}
                </T>
              ) : null}
            </View>
```

Add `fmtDistance, fmtPace` to the existing `@hybrid/engine` import.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: PASS.

- [ ] **Step 7: Verification note — real device required**

There is no automated test for this step. Before Task 11's push, run the app on a real device (via a dev build, since `expo-location`/`expo-task-manager` are native modules Expo Go does not include) and confirm: a permission prompt appears, samples arrive while running, distance/pace appear in the Banked result, and — separately — that tracking survives the screen locking for at least a minute during a session.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/screens/Conditioning.tsx
git commit -m "Mobile: wire GPS tracking into the Conditioning screen"
```

---

### Task 10: Mobile — RouteMap component (live inset + static history)

**Files:**
- Create: `apps/mobile/src/ui/RouteMap.tsx`
- Modify: `apps/mobile/src/screens/Conditioning.tsx`
- Modify: `apps/mobile/src/screens/Recap.tsx`
- Modify: `apps/mobile/src/screens/History.tsx`

**Interfaces:**
- Consumes: `GeoDownsampled` (Task 1), `CondResult.route` (Task 2).
- Produces: `RouteMap({ route, live }: { route: GeoDownsampled; live?: boolean })`, a React component.

**Not automatable:** map rendering cannot be checked by `react-smoke.mjs` (headless Chromium, and this component never runs on web at all). Verification here is visual, on a real device.

- [ ] **Step 1: Write `RouteMap.tsx`**

```tsx
import MapView, { Polyline } from 'react-native-maps';
import type { GeoDownsampled } from '@hybrid/engine';

/**
 * Draws a session's GPS route. `live` gets a small inset sized for the
 * Conditioning screen; the static form (Recap, History) gets the full width
 * it's given by its container.
 */
export function RouteMap({ route, live }: { route: GeoDownsampled; live?: boolean }) {
  const points = route.pts.filter((p): p is { lat: number; lon: number } => p != null);
  if (points.length < 2) return null;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
    latitudeDelta: Math.max(0.003, Math.max(...lats) - Math.min(...lats)) * 1.4,
    longitudeDelta: Math.max(0.003, Math.max(...lons) - Math.min(...lons)) * 1.4,
  };

  return (
    <MapView
      style={{ width: '100%', height: live ? 140 : 220, borderRadius: 8 }}
      initialRegion={region}
      region={region}
      scrollEnabled={!live}
      zoomEnabled={!live}
      pitchEnabled={false}
      rotateEnabled={false}
    >
      <Polyline coordinates={points.map((p) => ({ latitude: p.lat, longitude: p.lon }))} strokeWidth={3} />
    </MapView>
  );
}
```

- [ ] **Step 2: Show the live inset during a tracked session**

In `apps/mobile/src/screens/Conditioning.tsx`, import `RouteMap` and render it in the live card, right after the geo message added in Task 9 Step 4:

```tsx
              {geoMsg ? <T className="mt-1 text-3 text-muted">{geoMsg}</T> : null}
              {geoSamples.current.length > 1 ? (
                <View className="mt-1">
                  <RouteMap route={geoDownsample(geoSamples.current, elapsed)} live />
                </View>
              ) : null}
```

Add the import:

```ts
import { RouteMap } from '../ui/RouteMap';
```

- [ ] **Step 3: Show the static route on Recap**

In `apps/mobile/src/screens/Recap.tsx`, inside the conditioning block's card (right after the `<T>` block Task 5 Step 1 modified), add:

```tsx
              {b.condResult?.route ? (
                <View className="mt-1">
                  <RouteMap route={b.condResult.route} />
                </View>
              ) : null}
```

Add the import: `import { RouteMap } from '../ui/RouteMap';`

- [ ] **Step 4: Show the static route on History's session detail**

In `apps/mobile/src/screens/History.tsx`, inside the conditioning block's detail (right after the `<T>` block Task 5 Step 2 modified), add:

```tsx
          {isCond(b) && b.condResult?.route ? (
            <View className="mt-1">
              <RouteMap route={b.condResult.route} />
            </View>
          ) : null}
```

Add the import: `import { RouteMap } from '../ui/RouteMap';`

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hybrid/mobile typecheck`
Expected: PASS.

- [ ] **Step 6: Verification note — real device required**

Confirm visually on a real device (or a simulator with a simulated GPS route): the live inset appears and updates during a session, and Recap/History show the full route afterward, correctly framed (not zoomed to the whole world or clipped to one point).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/ui/RouteMap.tsx apps/mobile/src/screens/Conditioning.tsx apps/mobile/src/screens/Recap.tsx apps/mobile/src/screens/History.tsx
git commit -m "Mobile: RouteMap — live inset during tracking, static route on Recap/History"
```

---

### Task 11: Final verification and push (Group 2 — new native build)

**Files:** none (verification only)

- [ ] **Step 1: Confirm on-device testing from Tasks 9 and 10 is done**

Do not proceed to Step 2 until you have personally confirmed, on a real device running a dev build with the new native modules: GPS permission prompts appear and work, samples are recorded, tracking survives a locked screen for at least a minute, distance/pace appear correctly in the Banked result, and the live and static route maps render correctly.

- [ ] **Step 2: Run the JS-level checks that do apply**

Run: `pnpm run typecheck && pnpm run test && pnpm --filter @hybrid/mobile bundle`
Expected: PASS. This confirms the JS/TS is sound; it does NOT confirm the GPS/map behavior — that's Step 1.

- [ ] **Step 3: Run the full web/coach verify chain**

Run: `pnpm run verify`
Expected: PASS. This exercises web and coach in a real browser (react-smoke, deploy-smoke) — neither app changed in Group 2, so this is confirming no regression, not new coverage.

- [ ] **Step 4: Commit any config changes from Step 1's real-device fixes, then push**

```bash
git push origin main
```

- [ ] **Step 5: Build and submit the new native binary**

This is the step that actually ships Group 2 — an OTA publish alone will NOT reach any phone, because `runtimeVersion` changed. Per this repo's existing EAS setup:

```bash
cd apps/mobile
eas build --platform android --profile production
```

Submit the resulting build to its usual distribution channel (Play track / TestFlight, whichever this project already uses) the same way every prior native build here has been shipped.

- [ ] **Step 6: Confirm CI, and confirm the OTA workflow behaves as expected for a native-version bump**

Poll `GET /repos/reflectprotect123-max/THE-HYBRID-ENGINE1/actions/runs` for the push's commit SHA. Confirm CI reaches `completed`/`success`. Check whether `mobile-ota.yml` fired: because this commit changes `packages/engine/src/types.ts` (a shared file), it likely will — confirm its `Publish EAS Update` step executed and succeeded, and separately understand that this OTA publish targets the OLD `runtimeVersion` compatibility group, so it will NOT reach anyone until they've installed the new native build from Step 5. This is exactly the kind of distinction this repo's own OTA documentation warns "a skipped run and a real publish report identically" — the analogous trap here is "a successful OTA publish and 'nobody received this update' look identical" until you check which runtime version it targeted.

---

## Where this sits

Five sub-projects total, from this session's roadmap:

- **A — this one.** Pace/distance in the data model.
- **B — coach as multi-athlete product.** Designed, explicitly deferred until other athletes exist.
- **C — coach authors engine types.** Shipped (2026-07-29).
- **D — insights maturation.** Move the three untested Dashboard note rules into the engine.
- **E — widen the stored WHOOP row.**
