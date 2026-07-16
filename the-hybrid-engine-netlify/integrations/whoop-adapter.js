/**
 * WHOOP boundary contract for the local-first app.
 *
 * This file intentionally does not perform OAuth, hold client secrets, or
 * call the WHOOP API. A future server-side connector can map its response into
 * normalizeWhoopRecovery() and pass only the normalized sample to the app.
 */

const WHOOP_METRICS = ['recoveryScore', 'sleepPerformance', 'hrvMs', 'restingHr', 'strain'];

const finite = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function createWhoopIntegrationState(existing = {}) {
  const source = existing && typeof existing === 'object' ? existing : {};
  return {
    provider: 'whoop',
    enabled: source.enabled === true,
    connected: source.connected === true,
    status: source.status || 'not_connected',
    consentVersion: source.consentVersion || null,
    lastSyncAt: source.lastSyncAt || null,
    lastSampleDate: source.lastSampleDate || source.sampleDate || null,
    lastError: source.lastError || null,
    // Credential-like fields from input are deliberately ignored.
  };
}

export function normalizeWhoopRecovery(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const sample = source.normalized && typeof source.normalized === 'object'
    ? { ...source, ...source.normalized }
    : source;
  return {
    source: 'whoop',
    date: String(sample.date || '').slice(0, 10),
    recoveryScore: finite(sample.recoveryScore),
    sleepPerformance: finite(sample.sleepPerformance),
    hrvMs: finite(sample.hrvMs),
    restingHr: finite(sample.restingHr),
    strain: finite(sample.strain),
    capturedAt: sample.capturedAt || new Date().toISOString(),
  };
}

export function canUseWhoopSample(sample) {
  return Boolean(
    sample &&
    typeof sample === 'object' &&
    sample.date &&
    WHOOP_METRICS.some(field => Number.isFinite(sample[field])),
  );
}
