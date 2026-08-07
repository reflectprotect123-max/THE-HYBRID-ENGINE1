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

const idFor = (v: unknown, fallback: string): string => text(v) || fallback;

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

const normaliseBodyMetric = (v: unknown, i: number): BodyMetric | null => {
  const raw = record(v);
  const value = finite(raw.value);
  const measuredAt = text(raw.measuredAt);
  if (value == null || !measuredAt || !['weight', 'resting_hr', 'waist'].includes(String(raw.kind))) return null;
  return {
    id: idFor(raw.id, `metric-${measuredAt}-${i}`),
    kind: raw.kind as BodyMetric['kind'],
    value,
    unit: text(raw.unit) || (raw.kind === 'weight' ? 'kg' : raw.kind === 'resting_hr' ? 'bpm' : 'cm'),
    measuredAt,
    source: text(raw.source),
  };
};

const normaliseLifeLoad = (v: unknown, i: number): LifeLoadObservation | null => {
  const raw = record(v);
  const date = isoDate(raw.date);
  if (!date) return null;
  return {
    id: idFor(raw.id, `life-${date}-${i}`),
    date,
    stress: normaliseScore(raw.stress),
    physicalLoad: normaliseScore(raw.physicalLoad),
    steps: clamp(finite(raw.steps), 0, 200000),
    availableMinutes: clamp(finite(raw.availableMinutes), 0, 1440),
    source: raw.source === 'device' || raw.source === 'import' ? raw.source : 'manual',
  };
};

const normaliseRecovery = (v: unknown, i: number): RecoveryObservation | null => {
  const raw = record(v);
  const date = isoDate(raw.date);
  if (!date) return null;
  const illness: IllnessStatus | undefined = ['clear', 'suspected', 'active', 'returning'].includes(String(raw.illnessStatus))
    ? raw.illnessStatus as IllnessStatus
    : undefined;
  return {
    id: idFor(raw.id, `recovery-${date}-${i}`),
    date,
    sleepHours: clamp(finite(raw.sleepHours), 0, 24),
    sleepQuality: normaliseScore(raw.sleepQuality),
    energy: normaliseScore(raw.energy),
    soreness: normaliseScore(raw.soreness),
    motivation: normaliseScore(raw.motivation),
    stress: normaliseScore(raw.stress),
    illnessStatus: illness,
    painAreas: normaliseList(raw.painAreas, 12),
    source: raw.source === 'whoop' || raw.source === 'import' ? raw.source : 'manual',
    recordedAt: finite(raw.recordedAt) ?? 0,
  };
};

const normaliseWhoop = (v: unknown, i: number): WhoopDailyRecord | null => {
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

const normaliseEvent = (v: unknown, i: number): AthleteEvent | null => {
  const raw = record(v);
  const type = raw.type;
  const validTypes = ['workout_completed', 'workout_modified', 'training_load_recorded', 'body_weight_recorded', 'readiness_recorded', 'nutrition_target_updated', 'post_session_feedback'];
  if (!validTypes.includes(String(type))) return null;
  const occurredAt = text(raw.occurredAt);
  if (!occurredAt) return null;
  return {
    id: idFor(raw.id, `event-${i}`),
    type: type as AthleteEvent['type'],
    occurredAt,
    sourceDomain: ['core', 'strength', 'conditioning', 'athlete_state', 'coordinator', 'nutrition'].includes(String(raw.sourceDomain))
      ? raw.sourceDomain as AthleteEvent['sourceDomain']
      : 'core',
    idempotencyKey: idFor(raw.idempotencyKey, idFor(raw.id, `event-${i}`)),
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
    bodyMetrics: array(raw.bodyMetrics).map(normaliseBodyMetric).filter((x): x is BodyMetric => !!x).slice(-500),
    lifeLoad: array(raw.lifeLoad).map(normaliseLifeLoad).filter((x): x is LifeLoadObservation => !!x).slice(-120),
    recovery: array(raw.recovery).map(normaliseRecovery).filter((x): x is RecoveryObservation => !!x).slice(-120),
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
    whoopDaily: array(raw.whoopDaily).map(normaliseWhoop).filter((x): x is WhoopDailyRecord => !!x).slice(-365),
    events: array(raw.events).map(normaliseEvent).filter((x): x is AthleteEvent => !!x).slice(-2000),
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
  core.recovery = core.whoopDaily.map((row, i) => ({
    id: `whoop-${row.date}-${i}`,
    date: row.date,
    sleepQuality: row.sleepPerformance == null ? undefined : row.sleepPerformance / 10,
    source: 'whoop' as const,
    recordedAt: now,
  }));
  return core;
}

const byKey = <T>(values: T[], key: (value: T) => string): T[] => {
  const map = new Map<string, T>();
  values.forEach((value) => map.set(key(value), value));
  return Array.from(map.values());
};

export function mergeSharedCore(baseInput: SharedCoreState | undefined, winnerInput: SharedCoreState | undefined): SharedCoreState {
  const base = sanitizeSharedCore(baseInput);
  const winner = sanitizeSharedCore(winnerInput);
  const safety = (winner.updatedAt >= base.updatedAt ? winner.safety : base.safety);
  return sanitizeSharedCore({
    ...base,
    ...winner,
    profile: winner.updatedAt >= base.updatedAt ? winner.profile : base.profile,
    goals: winner.goals.updatedAt >= base.goals.updatedAt ? winner.goals : base.goals,
    schedule: winner.schedule.updatedAt >= base.schedule.updatedAt ? winner.schedule : base.schedule,
    bodyMetrics: byKey([...base.bodyMetrics, ...winner.bodyMetrics], (x) => x.id).slice(-500),
    lifeLoad: byKey([...base.lifeLoad, ...winner.lifeLoad], (x) => x.id).slice(-120),
    recovery: byKey([...base.recovery, ...winner.recovery], (x) => x.id).slice(-120),
    safety,
    whoopDaily: byKey([...base.whoopDaily, ...winner.whoopDaily], (x) => x.date).slice(-365),
    events: byKey([...base.events, ...winner.events], (x) => x.idempotencyKey).slice(-2000),
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
  return {
    schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
    core: mergeSharedCore(local.core, remote.core),
    coreSnapshot: choosePartition(local.coreSnapshot, remote.coreSnapshot) as EcosystemSyncNamespace['coreSnapshot'],
    partitions: {
      strength: choosePartition(local.partitions.strength, remote.partitions.strength),
      conditioning: choosePartition(local.partitions.conditioning, remote.partitions.conditioning),
      athleteState: choosePartition(local.partitions.athleteState, remote.partitions.athleteState),
      weeklyPlan: choosePartition(local.partitions.weeklyPlan, remote.partitions.weeklyPlan),
      nutrition: choosePartition(local.partitions.nutrition, remote.partitions.nutrition),
    },
    events: byKey([...local.events, ...remote.events], (x) => x.idempotencyKey).slice(-2000),
  };
}
