import {
  SHARED_CORE_SCHEMA_VERSION,
  SYNC_ENVELOPE_SCHEMA_VERSION,
  type AthleteEvent,
  type BodyMetric,
  type CoreProfile,
  type EcosystemSyncNamespace,
  type GoalPriorities,
  type IllnessStatus,
  type LifeLoadObservation,
  type RecoveryObservation,
  type SharedCoreState,
  type SafetyFlags,
  type ProductDomain,
  type WeeklySchedule,
  type VersionedSnapshot,
  type WhoopDailyRecord,
} from './types';

const DEFAULT_GOALS: GoalPriorities = { strength: 0.5, conditioning: 0.3, health: 0.2 };

const finite = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const clamp = (v: number | undefined, lo: number, hi: number): number | undefined =>
  v == null ? undefined : Math.max(lo, Math.min(hi, v));

const text = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const isoDate = (v: unknown): string | undefined => {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

/*
 * A missing id is filled from the record's OWN CONTENT, never from its index
 * in the incoming array. Two devices sanitizing the same legacy blob must
 * arrive at the same id: these ids are the merge keys (`capBy` below), so an
 * index-derived one means the same observation is a different row after any
 * reorder, and — worse — two DIFFERENT observations sitting at index 0 on two
 * devices collide, and the dedupe drops one. That is the record-reachable-on-
 * one-side-only loss this file exists to prevent.
 */
const idFor = (v: unknown, fallback: string): string => text(v) || fallback;

/**
 * Dedupe by merge key, then keep the NEWEST `max` by the record's own time —
 * not by position in the concatenation.
 *
 * A `Map` returns insertion order, so `[...base, ...winner]` puts every base
 * record first. A bare `slice(-max)` therefore evicts by ARRAY POSITION: it
 * keeps the winner's records and deletes the base's, whatever their dates.
 * Two devices each holding a full window then keep opposite halves, push them,
 * and permanently delete each other's history. Sorting by the record's own
 * timestamp first makes the cap a real retention policy and makes the result
 * independent of argument order.
 */
const capBy = <T>(values: T[], key: (v: T) => string, at: (v: T) => number | string, max: number): T[] => {
  const map = new Map<string, T>();
  values.forEach((value) => map.set(key(value), value));
  return Array.from(map.values())
    .sort((a, b) => {
      const av = at(a);
      const bv = at(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
      // A stable, content-free tie-break so the order — and therefore the
      // fingerprint — is the same on both devices.
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    })
    .slice(-max);
};

const normaliseList = (v: unknown, max: number): string[] =>
  Array.from(new Set(array(v).map(text).filter((x): x is string => !!x))).slice(-max);

const normaliseScore = (v: unknown): number | undefined => clamp(finite(v), 0, 10);

const normaliseGoals = (v: unknown): SharedCoreState['goals'] => {
  const raw = record(v);
  const priorities = record(raw.priorities);
  const values = {
    strength: Math.max(0, finite(priorities.strength) ?? DEFAULT_GOALS.strength),
    conditioning: Math.max(0, finite(priorities.conditioning) ?? DEFAULT_GOALS.conditioning),
    health: Math.max(0, finite(priorities.health) ?? DEFAULT_GOALS.health),
  };
  const total = values.strength + values.conditioning + values.health || 1;
  const primary = raw.primary === 'conditioning' || raw.primary === 'hybrid' || raw.primary === 'health'
    ? raw.primary
    : 'strength';
  return {
    primary,
    priorities: {
      strength: values.strength / total,
      conditioning: values.conditioning / total,
      health: values.health / total,
    },
    updatedAt: finite(raw.updatedAt) ?? 0,
  };
};

const normaliseSchedule = (v: unknown): WeeklySchedule => {
  const raw = record(v);
  const days = Array.from(new Set(array(raw.availableDays)
    .map(finite)
    .filter((x): x is number => x != null && Number.isInteger(x) && x >= 1 && x <= 7)))
    .sort((a, b) => a - b);
  return {
    availableDays: days.length ? days : [1, 2, 3, 4, 5, 6, 7],
    preferredSessionMinutes: clamp(finite(raw.preferredSessionMinutes), 10, 240),
    maxSessionsPerWeek: clamp(finite(raw.maxSessionsPerWeek), 1, 14),
    strengthSessionsPerWeek: Math.round(clamp(finite(raw.strengthSessionsPerWeek), 0, 7) ?? 2),
    conditioningSessionsPerWeek: Math.round(clamp(finite(raw.conditioningSessionsPerWeek), 0, 7) ?? 2),
    blockedDates: Array.from(new Set(array(raw.blockedDates).map(isoDate).filter((x): x is string => !!x))).sort(),
    updatedAt: finite(raw.updatedAt) ?? 0,
  };
};

const normaliseProfile = (v: unknown): CoreProfile => {
  const raw = record(v);
  const age = finite(raw.age);
  return {
    displayName: text(raw.displayName),
    age: age != null && age >= 13 && age <= 110 ? Math.round(age) : undefined,
    units: raw.units === 'lb' ? 'lb' : raw.units === 'kg' ? 'kg' : undefined,
    timezone: text(raw.timezone),
  };
};

const normaliseBodyMetric = (v: unknown): BodyMetric | null => {
  const raw = record(v);
  const value = finite(raw.value);
  const measuredAt = text(raw.measuredAt);
  if (value == null || !measuredAt || !['weight', 'resting_hr', 'waist'].includes(String(raw.kind))) return null;
  return {
    id: idFor(raw.id, `metric-${String(raw.kind)}-${measuredAt}-${value}`),
    kind: raw.kind as BodyMetric['kind'],
    value,
    unit: text(raw.unit) || (raw.kind === 'weight' ? 'kg' : raw.kind === 'resting_hr' ? 'bpm' : 'cm'),
    measuredAt,
    source: text(raw.source),
  };
};

const normaliseLifeLoad = (v: unknown): LifeLoadObservation | null => {
  const raw = record(v);
  const date = isoDate(raw.date);
  if (!date) return null;
  const source = raw.source === 'device' || raw.source === 'import' ? raw.source : 'manual';
  return {
    id: idFor(raw.id, `life-${date}-${source}`),
    date,
    stress: normaliseScore(raw.stress),
    physicalLoad: normaliseScore(raw.physicalLoad),
    steps: clamp(finite(raw.steps), 0, 200000),
    availableMinutes: clamp(finite(raw.availableMinutes), 0, 1440),
    source,
  };
};

const normaliseRecovery = (v: unknown): RecoveryObservation | null => {
  const raw = record(v);
  const date = isoDate(raw.date);
  if (!date) return null;
  const illness: IllnessStatus | undefined = ['clear', 'suspected', 'active', 'returning'].includes(String(raw.illnessStatus))
    ? raw.illnessStatus as IllnessStatus
    : undefined;
  const source = raw.source === 'whoop' || raw.source === 'import' ? raw.source : 'manual';
  return {
    id: idFor(raw.id, `recovery-${date}-${source}`),
    date,
    sleepHours: clamp(finite(raw.sleepHours), 0, 24),
    sleepQuality: normaliseScore(raw.sleepQuality),
    energy: normaliseScore(raw.energy),
    soreness: normaliseScore(raw.soreness),
    motivation: normaliseScore(raw.motivation),
    stress: normaliseScore(raw.stress),
    illnessStatus: illness,
    painAreas: normaliseList(raw.painAreas, 12),
    source,
    recordedAt: finite(raw.recordedAt) ?? 0,
  };
};

const normaliseWhoop = (v: unknown): WhoopDailyRecord | null => {
  const raw = record(v);
  const date = isoDate(raw.date);
  if (!date) return null;
  return {
    date,
    recoveryScore: clamp(finite(raw.recoveryScore ?? raw.recovery), 0, 100) ?? null,
    strain: clamp(finite(raw.strain), 0, 30) ?? null,
    hrvMs: clamp(finite(raw.hrvMs ?? raw.hrv), 0, 1000) ?? null,
    restingHr: clamp(finite(raw.restingHr), 20, 240) ?? null,
    sleepPerformance: clamp(finite(raw.sleepPerformance ?? raw.sleep), 0, 100) ?? null,
    capturedAt: text(raw.capturedAt),
    source: text(raw.source) || 'whoop',
  };
};

const normaliseEvent = (v: unknown): AthleteEvent | null => {
  const raw = record(v);
  const type = raw.type;
  const validTypes = ['workout_completed', 'workout_modified', 'training_load_recorded', 'body_weight_recorded', 'readiness_recorded', 'nutrition_target_updated', 'post_session_feedback'];
  if (!validTypes.includes(String(type))) return null;
  const occurredAt = text(raw.occurredAt);
  if (!occurredAt) return null;
  // `${type}:${occurredAt}` is the same fallback `appendSharedCoreEvent` mints,
  // so a legacy event without an id sanitizes to the key the writer would have
  // given it. `event-${index}` collided across devices — the dedupe in `capBy`
  // keys on `idempotencyKey`, so two different events at index 0 became one.
  const derived = `${String(type)}:${occurredAt}`;
  return {
    id: idFor(raw.id, derived),
    type: type as AthleteEvent['type'],
    occurredAt,
    sourceDomain: ['core', 'strength', 'conditioning', 'athlete_state', 'coordinator', 'nutrition'].includes(String(raw.sourceDomain))
      ? raw.sourceDomain as AthleteEvent['sourceDomain']
      : 'core',
    idempotencyKey: idFor(raw.idempotencyKey, idFor(raw.id, derived)),
    payload: record(raw.payload),
  };
};

export function emptySharedCore(now = 0): SharedCoreState {
  return {
    schemaVersion: SHARED_CORE_SCHEMA_VERSION,
    profile: {},
    goals: { primary: 'strength', priorities: { ...DEFAULT_GOALS }, updatedAt: now },
    schedule: {
      availableDays: [1, 2, 3, 4, 5, 6, 7],
      strengthSessionsPerWeek: 2,
      conditioningSessionsPerWeek: 2,
      blockedDates: [],
      updatedAt: now,
    },
    bodyMetrics: [],
    lifeLoad: [],
    recovery: [],
    safety: {},
    whoopDaily: [],
    events: [],
    updatedAt: now,
  };
}

export function sanitizeSharedCore(input: unknown): SharedCoreState {
  const raw = record(input);
  const base = emptySharedCore(finite(raw.updatedAt) ?? 0);
  const safetyRaw = record(raw.safety);
  const painRaw = record(safetyRaw.painHold);
  const illnessRaw = record(safetyRaw.illness);
  const illnessStatus: IllnessStatus = ['clear', 'suspected', 'active', 'returning'].includes(String(illnessRaw.status))
    ? illnessRaw.status as IllnessStatus
    : 'clear';
  return {
    schemaVersion: SHARED_CORE_SCHEMA_VERSION,
    profile: normaliseProfile(raw.profile),
    goals: normaliseGoals(raw.goals),
    schedule: normaliseSchedule(raw.schedule),
    bodyMetrics: capBy(array(raw.bodyMetrics).map(normaliseBodyMetric).filter((x): x is BodyMetric => !!x), (x) => x.id, (x) => x.measuredAt, 500),
    lifeLoad: capBy(array(raw.lifeLoad).map(normaliseLifeLoad).filter((x): x is LifeLoadObservation => !!x), (x) => x.id, (x) => x.date, 120),
    recovery: capBy(array(raw.recovery).map(normaliseRecovery).filter((x): x is RecoveryObservation => !!x), (x) => x.id, (x) => x.date, 120),
    safety: {
      painHold: painRaw.active === true ? {
        active: true,
        areas: normaliseList(painRaw.areas, 12),
        updatedAt: finite(painRaw.updatedAt) ?? 0,
      } : painRaw.updatedAt != null ? {
        active: false,
        areas: normaliseList(painRaw.areas, 12),
        updatedAt: finite(painRaw.updatedAt) ?? 0,
      } : undefined,
      illness: illnessRaw.updatedAt != null || illnessStatus !== 'clear' ? {
        status: illnessStatus,
        updatedAt: finite(illnessRaw.updatedAt) ?? 0,
        note: text(illnessRaw.note),
      } : undefined,
    },
    whoopDaily: capBy(array(raw.whoopDaily).map(normaliseWhoop).filter((x): x is WhoopDailyRecord => !!x), (x) => x.date, (x) => x.date, 365),
    events: capBy(array(raw.events).map(normaliseEvent).filter((x): x is AthleteEvent => !!x), (x) => x.idempotencyKey, (x) => x.occurredAt, 2000),
    updatedAt: base.updatedAt,
  };
}

/**
 * Convert the legacy Settings-shaped record into the new core namespace.
 * Values are copied, never removed from Settings, so old clients remain able
 * to read the same backup while new clients migrate gradually.
 */
export function migrateLegacySettings(settings: unknown, now = 0): SharedCoreState {
  const raw = record(settings);
  const profileRaw = record(raw.profile);
  const whoopRows = array(raw.whoopDaily);
  const core = emptySharedCore(now);
  core.profile = normaliseProfile({
    displayName: profileRaw.displayName,
    age: profileRaw.age,
    units: profileRaw.units,
    timezone: profileRaw.timezone,
  });
  core.whoopDaily = whoopRows.map(normaliseWhoop).filter((x): x is WhoopDailyRecord => !!x).slice(-365);
  core.recovery = core.whoopDaily.map((row) => ({
    // One Whoop row per date, so the date alone is a stable, device-independent
    // id — the index it used to carry was not.
    id: `whoop-${row.date}`,
    date: row.date,
    sleepQuality: row.sleepPerformance == null ? undefined : row.sleepPerformance / 10,
    source: 'whoop' as const,
    recordedAt: now,
  }));
  return core;
}

/**
 * Resolve ONE safety flag on ITS OWN stamp.
 *
 * Safety flags used to be taken wholesale from whichever side had the newer
 * top-level `core.updatedAt`. That stamp moves for reasons that have nothing
 * to do with safety — `appendSharedCoreEvent` sets it from a completed
 * session — so finishing a workout on the web erased a pain hold set on the
 * phone an hour earlier, and the erasure was then pushed. CLAUDE.md puts pain
 * and illness above every other signal; a merge that drops them on an
 * unrelated write puts them below all of them.
 *
 * On an exact tie the ACTIVE flag wins. That is both the safe direction and
 * an order-independent one: `merge(a, b)` and `merge(b, a)` agree.
 */
const pickFlag = <T extends { updatedAt: number }>(
  a: T | undefined,
  b: T | undefined,
  isRaised: (v: T) => boolean,
): T | undefined => {
  if (!a) return b;
  if (!b) return a;
  if (b.updatedAt > a.updatedAt) return b;
  if (a.updatedAt > b.updatedAt) return a;
  if (isRaised(b) && !isRaised(a)) return b;
  return a;
};

export function mergeSharedCore(baseInput: SharedCoreState | undefined, winnerInput: SharedCoreState | undefined): SharedCoreState {
  const base = sanitizeSharedCore(baseInput);
  const winner = sanitizeSharedCore(winnerInput);
  const safety = {
    painHold: pickFlag(base.safety.painHold, winner.safety.painHold, (v) => v.active),
    illness: pickFlag(base.safety.illness, winner.safety.illness, (v) => v.status !== 'clear'),
  };
  return sanitizeSharedCore({
    ...base,
    ...winner,
    profile: winner.updatedAt >= base.updatedAt ? winner.profile : base.profile,
    goals: winner.goals.updatedAt >= base.goals.updatedAt ? winner.goals : base.goals,
    schedule: winner.schedule.updatedAt >= base.schedule.updatedAt ? winner.schedule : base.schedule,
    // The caps are applied by `sanitizeSharedCore` below, over a date-sorted
    // list — see `capBy`. Concatenating here only unions; it does not decide
    // what survives.
    bodyMetrics: [...base.bodyMetrics, ...winner.bodyMetrics],
    lifeLoad: [...base.lifeLoad, ...winner.lifeLoad],
    recovery: [...base.recovery, ...winner.recovery],
    safety,
    whoopDaily: [...base.whoopDaily, ...winner.whoopDaily],
    events: [...base.events, ...winner.events],
    updatedAt: Math.max(base.updatedAt, winner.updatedAt),
  });
}

export function sharedCoreFingerprint(core: SharedCoreState): string {
  return JSON.stringify(sanitizeSharedCore(core));
}

/** Append one integration fact idempotently. The event is an audit/integration
 * record only; it never becomes a second workout-prescription authority. */
export function appendSharedCoreEvent(
  coreInput: SharedCoreState,
  event: Omit<AthleteEvent, 'id'> & { id?: string },
): SharedCoreState {
  const core = sanitizeSharedCore(coreInput);
  const idempotencyKey = event.idempotencyKey || event.id || `${event.type}:${event.occurredAt}`;
  const next: AthleteEvent = {
    ...event,
    id: event.id || idempotencyKey,
    idempotencyKey,
  };
  return sanitizeSharedCore({
    ...core,
    events: [...core.events.filter((x) => x.idempotencyKey !== idempotencyKey), next],
    updatedAt: Date.parse(event.occurredAt) || core.updatedAt,
  });
}

export function emptyEcosystemNamespace(core = emptySharedCore(0)): EcosystemSyncNamespace {
  return {
    schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
    core: sanitizeSharedCore(core),
    partitions: {},
    events: [],
  };
}

export function sanitizeEcosystemNamespace(input: unknown): EcosystemSyncNamespace {
  const raw = record(input);
  const base = emptyEcosystemNamespace();
  const partitionsRaw = record(raw.partitions);
  const snapshot = (v: unknown): VersionedSnapshot<unknown> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const x = record(v);
    const revision = finite(x.revision);
    const updatedAt = finite(x.updatedAt);
    const writer = text(x.writer);
    if (revision == null || updatedAt == null || !writer || x.data === undefined) return undefined;
    return {
      schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
      domain: x.domain as ProductDomain,
      revision: Math.max(0, Math.floor(revision)),
      updatedAt,
      writer,
      data: x.data,
    };
  };
  const partition = (v: unknown, domain: EcosystemSyncNamespace['partitions'][keyof EcosystemSyncNamespace['partitions']]): typeof domain => {
    return snapshot(v) as typeof domain;
  };
  return {
    schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
    core: sanitizeSharedCore(raw.core),
    coreSnapshot: snapshot(raw.coreSnapshot) as EcosystemSyncNamespace['coreSnapshot'],
    partitions: {
      strength: partition(partitionsRaw.strength, undefined),
      conditioning: partition(partitionsRaw.conditioning, undefined),
      athleteState: partition(partitionsRaw.athleteState, undefined),
      weeklyPlan: partition(partitionsRaw.weeklyPlan, undefined),
      // Partitions are whitelisted, so a key missing from this list is not
      // merely untyped — it is deleted from every namespace that passes
      // through here, on both sides of the wire.
      nutrition: partition(partitionsRaw.nutrition, undefined),
    },
    events: array(raw.events).map(normaliseEvent).filter((x): x is AthleteEvent => !!x).slice(-2000),
  };
}

export function mergeEcosystemNamespaces(
  localInput: EcosystemSyncNamespace | undefined,
  remoteInput: EcosystemSyncNamespace | undefined,
): EcosystemSyncNamespace {
  const local = sanitizeEcosystemNamespace(localInput);
  const remote = sanitizeEcosystemNamespace(remoteInput);
  const choosePartition = <T>(a: T | undefined, b: T | undefined): T | undefined => {
    if (!a) return b;
    if (!b) return a;
    const aa = a as T & { revision: number; updatedAt: number; writer: string };
    const bb = b as T & { revision: number; updatedAt: number; writer: string };
    return bb.revision > aa.revision || (bb.revision === aa.revision && (bb.updatedAt > aa.updatedAt || (bb.updatedAt === aa.updatedAt && bb.writer >= aa.writer))) ? b : a;
  };

  /*
   * The weekly plan does not use the rule above alone, and this is the only
   * partition that does not.
   *
   * From 4 August until 13 August `athlete_weekly_plans.writer` was
   * `check (writer = 'coordinator')` — the athlete's own device was the only
   * thing that could write a week, so revision ordering was the whole story
   * here. A coach can now publish a week, and the owner's decision (13 August)
   * is that it WINS for the week it covers.
   *
   * Revision alone gets that wrong on a real device, not in theory: the
   * Coordinator recomputes the week locally on every reconcile and writes it
   * with an incrementing revision of its own. Coach publishes at 51, device
   * recomputes at 52, plain revision hands the week back and the coach's
   * session disappears — with nothing anywhere reporting that it did.
   *
   * SCOPED TO ONE WEEK, deliberately. A coach owns the week they published,
   * not every week forever. If the rule ignored `weekStart`, an athlete who
   * left a roster could never reclaim their own weeks, because no newer coach
   * write would ever arrive to be beaten. Comparing the week first means the
   * fallback needs no unlink event and no special case: the next week the
   * device computes is simply a later week, and it wins on the ordinary rule.
   */
  const weekStartOf = (x: unknown): string | null => {
    const data = (x as { data?: unknown } | undefined)?.data;
    const ws = (data as { weekStart?: unknown } | undefined)?.weekStart;
    return typeof ws === 'string' && ws ? ws : null;
  };
  const chooseWeeklyPlan = <T>(a: T | undefined, b: T | undefined): T | undefined => {
    if (!a) return b;
    if (!b) return a;
    const aw = weekStartOf(a);
    const bw = weekStartOf(b);
    // A week we cannot identify: nothing to arbitrate on, so the ordinary
    // rule applies untouched.
    if (aw === null || bw === null) return choosePartition(a, b);
    /*
     * DIFFERENT WEEKS: the later week wins, and revision is not consulted.
     *
     * Comparing revisions across two different weeks is meaningless — each row
     * carries its own sequence, so a long-lived week can sit at revision 99
     * while next week's first write is revision 1. Falling through to the
     * ordinary rule here handed a stale week to an athlete purely because it
     * had been rewritten more often, which is how the "leaving a roster"
     * fallback silently failed to work. This partition holds THE athlete's
     * current week (the pull takes `order by week_start desc limit 1`), so
     * "which week is this" is the question, and later is the answer.
     */
    if (aw !== bw) return aw > bw ? a : b;
    const aIsCoach = (a as { writer?: string }).writer === 'coach';
    const bIsCoach = (b as { writer?: string }).writer === 'coach';
    if (aIsCoach !== bIsCoach) return aIsCoach ? a : b;
    // Both coach-written, or both device-written: newest publish wins.
    return choosePartition(a, b);
  };
  return {
    schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
    core: mergeSharedCore(local.core, remote.core),
    coreSnapshot: choosePartition(local.coreSnapshot, remote.coreSnapshot) as EcosystemSyncNamespace['coreSnapshot'],
    partitions: {
      strength: choosePartition(local.partitions.strength, remote.partitions.strength),
      conditioning: choosePartition(local.partitions.conditioning, remote.partitions.conditioning),
      athleteState: choosePartition(local.partitions.athleteState, remote.partitions.athleteState),
      weeklyPlan: chooseWeeklyPlan(local.partitions.weeklyPlan, remote.partitions.weeklyPlan),
      nutrition: choosePartition(local.partitions.nutrition, remote.partitions.nutrition),
    },
    events: capBy([...local.events, ...remote.events], (x) => x.idempotencyKey, (x) => x.occurredAt, 2000),
  };
}
