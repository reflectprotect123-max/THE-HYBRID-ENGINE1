import { randomBytes } from 'node:crypto';
import { encryptJson, decryptJson } from './crypto.mjs';
import { getJson, setJson, deleteKey } from './store.mjs';
import { sessionFromEvent } from './session.mjs';

export function newState(length = 32) {
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error('Invalid OAuth state length');
  return randomBytes(Math.ceil((length * 3) / 4)).toString('base64url').slice(0, length);
}
export async function savePending(provider, state, sid) { await setJson(`oauth:pending:${provider}:${state}`, { sid, createdAt: Date.now() }); }
export async function consumePending(provider, state, expectedSid) {
  if (typeof state !== 'string' || !state) return null;
  const key = `oauth:pending:${provider}:${state}`;
  const pending = await getJson(key);
  await deleteKey(key);
  const createdAt = Number(pending?.createdAt);
  const age = Date.now() - createdAt;
  if (!pending || typeof pending.sid !== 'string' || !Number.isFinite(createdAt) || age < 0 || age > 10 * 60 * 1000) return null;
  if (expectedSid !== undefined && pending.sid !== expectedSid) return null;
  return pending;
}
export async function saveToken(provider, sid, token, providerUserId) {
  const key = `token:${provider}:${sid}`;
  const previous = await getJson(key);
  const resolvedProviderUserId = providerUserId ?? previous?.providerUserId ?? null;
  if (previous?.providerUserId != null && String(previous.providerUserId) !== String(resolvedProviderUserId)) {
    await deleteKey(`provider:${provider}:${previous.providerUserId}`);
  }
  await setJson(key, { encrypted: encryptJson(token), providerUserId: resolvedProviderUserId, updatedAt: new Date().toISOString() });
  if (resolvedProviderUserId != null) await setJson(`provider:${provider}:${resolvedProviderUserId}`, { sid, updatedAt: new Date().toISOString() });
}
export async function loadTokenRecord(provider, sid) {
  const record = await getJson(`token:${provider}:${sid}`);
  return record?.encrypted ? { token: decryptJson(record.encrypted), providerUserId: record.providerUserId ?? null } : null;
}
export async function loadToken(provider, sid) { return (await loadTokenRecord(provider, sid))?.token || null; }
export async function removeToken(provider, sid, providerUserId) {
  const record = await getJson(`token:${provider}:${sid}`);
  const resolvedProviderUserId = providerUserId ?? record?.providerUserId ?? null;
  await deleteKey(`token:${provider}:${sid}`);
  if (resolvedProviderUserId != null) await deleteKey(`provider:${provider}:${resolvedProviderUserId}`);
  await deleteKey(`data:${provider}:${sid}`);
}
export async function syncRecord(provider, sid, data) {
  const previous = await getJson(`data:${provider}:${sid}`);
  const next = data && typeof data === 'object' ? data : {};
  const merged = previous && typeof previous === 'object' ? { ...previous, ...next } : next;
  await setJson(`data:${provider}:${sid}`, merged);
  return merged;
}
export async function loadData(provider, sid) { return getJson(`data:${provider}:${sid}`); }
export async function sidForProvider(provider, id) { const row = await getJson(`provider:${provider}:${id}`); return row?.sid || null; }
export { sessionFromEvent };
