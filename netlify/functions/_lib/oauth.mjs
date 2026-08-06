import { randomBytes } from 'node:crypto';
import { encryptJson, decryptJson } from './crypto.mjs';
import { getJson, setJson, deleteKey } from './store.mjs';
import { sessionFromEvent } from './session.mjs';

/*
 * OAuth state, token storage and the provider index.
 *
 * Every key here is filed under an OWNER (see _lib/identity.mjs) rather than a
 * session id. For a browser the owner IS the sid, so this is a rename and not a
 * migration: existing `token:whoop:<sid>` records keep working untouched. For
 * the native app the owner is the Supabase user id, which is the only identity
 * that survives the hand-off to the system browser.
 */

const PENDING_TTL_MS = 10 * 60 * 1000;

/*
 * The OAuth `state`.
 *
 * It is a one-shot random lookup key, and it carries NOTHING — no user id, no
 * signature, no payload. That is stronger than a signed state, not weaker:
 * there is nothing in it to forge and nothing in it to leak into WHOOP's logs
 * or a browser history. The identity it stands for is held server-side in the
 * pending record below, is written from a verified credential, and is destroyed
 * on first use.
 *
 * The length is fixed by WHOOP (see WHOOP_STATE_LENGTH in _lib/whoop.mjs), so
 * unguessability rests on the record being single-use and short-lived rather
 * than on the key being long.
 */
export function newState(length = 32) {
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error('Invalid OAuth state length');
  return randomBytes(Math.ceil((length * 3) / 4)).toString('base64url').slice(0, length);
}

export async function savePending(provider, state, identity) {
  const owner = typeof identity === 'string' ? identity : identity?.owner;
  if (typeof owner !== 'string' || !owner) throw new Error('Pending OAuth record needs an owner');
  const kind = identity?.kind === 'user' ? 'native' : 'browser';
  const sid = typeof identity?.sid === 'string' ? identity.sid : null;
  await setJson(`oauth:pending:${provider}:${state}`, { owner, kind, sid, createdAt: Date.now() });
}

/*
 * Is this pending record still allowed to complete an authorization?
 *
 * Split out from the store so the rules are testable without a Netlify Blobs
 * context — checks/whoop-contract.mjs exercises them directly.
 *
 * A browser-initiated authorization must come back in the SAME browser: the
 * callback's cookie has to match the one that started it, which is what stops a
 * state stolen from one browser being redeemed in another. A native one cannot
 * make that check — the system browser has no cookie of ours, which is the
 * whole reason mobile was broken — so for those the state itself is the only
 * secret, and it is single-use and expires in ten minutes.
 */
export function pendingIsUsable(pending, expectedSid, now = Date.now()) {
  // Records written before there were two identity kinds carried only a `sid`.
  // Read them so an authorization already in flight survives the deploy.
  const owner = typeof pending?.owner === 'string' && pending.owner ? pending.owner : (typeof pending?.sid === 'string' ? pending.sid : '');
  if (!owner) return null;
  const kind = pending?.kind === 'native' ? 'native' : 'browser';
  const createdAt = Number(pending?.createdAt);
  const age = now - createdAt;
  if (!Number.isFinite(createdAt) || age < 0 || age > PENDING_TTL_MS) return null;
  if (kind === 'browser') {
    if (typeof pending?.sid !== 'string' || !pending.sid) return null;
    if (expectedSid !== undefined && pending.sid !== expectedSid) return null;
  }
  return { owner, kind, sid: pending?.sid ?? null, createdAt };
}

export async function consumePending(provider, state, expectedSid) {
  if (typeof state !== 'string' || !state) return null;
  const key = `oauth:pending:${provider}:${state}`;
  const pending = await getJson(key);
  // Deleted before it is judged, so a rejected record is still spent. A state
  // that can be retried is a state that can be brute-forced.
  await deleteKey(key);
  return pendingIsUsable(pending, expectedSid);
}

/*
 * The provider index maps a WHOOP user id back to the local records that hold a
 * grant for it, and it holds a LIST.
 *
 * One person can legitimately hold two grants for the same WHOOP account — a
 * browser session and the signed-in app are different owners by design. A
 * single-valued index would silently point webhooks at whichever surface
 * connected last and leave the other one stale.
 */
const MAX_OWNERS_PER_PROVIDER_USER = 8;

export async function ownersForProvider(provider, id) {
  const row = await getJson(`provider:${provider}:${id}`);
  if (Array.isArray(row?.owners)) return row.owners.filter((owner) => typeof owner === 'string' && owner);
  // Pre-list records held a single `sid`.
  return typeof row?.sid === 'string' && row.sid ? [row.sid] : [];
}

async function indexProvider(provider, id, owner) {
  const owners = (await ownersForProvider(provider, id)).filter((existing) => existing !== owner);
  owners.push(owner);
  await setJson(`provider:${provider}:${id}`, { owners: owners.slice(-MAX_OWNERS_PER_PROVIDER_USER), updatedAt: new Date().toISOString() });
}

async function unindexProvider(provider, id, owner) {
  const owners = (await ownersForProvider(provider, id)).filter((existing) => existing !== owner);
  if (owners.length) await setJson(`provider:${provider}:${id}`, { owners, updatedAt: new Date().toISOString() });
  else await deleteKey(`provider:${provider}:${id}`);
}

export async function saveToken(provider, owner, token, providerUserId) {
  const key = `token:${provider}:${owner}`;
  const previous = await getJson(key);
  const resolvedProviderUserId = providerUserId ?? previous?.providerUserId ?? null;
  if (previous?.providerUserId != null && String(previous.providerUserId) !== String(resolvedProviderUserId)) {
    await unindexProvider(provider, previous.providerUserId, owner);
  }
  await setJson(key, { encrypted: encryptJson(token), providerUserId: resolvedProviderUserId, updatedAt: new Date().toISOString() });
  if (resolvedProviderUserId != null) await indexProvider(provider, resolvedProviderUserId, owner);
}

export async function loadTokenRecord(provider, owner) {
  const record = await getJson(`token:${provider}:${owner}`);
  return record?.encrypted ? { token: decryptJson(record.encrypted), providerUserId: record.providerUserId ?? null } : null;
}
export async function loadToken(provider, owner) { return (await loadTokenRecord(provider, owner))?.token || null; }

export async function removeToken(provider, owner, providerUserId) {
  const record = await getJson(`token:${provider}:${owner}`);
  const resolvedProviderUserId = providerUserId ?? record?.providerUserId ?? null;
  await deleteKey(`token:${provider}:${owner}`);
  if (resolvedProviderUserId != null) await unindexProvider(provider, resolvedProviderUserId, owner);
  await deleteKey(`data:${provider}:${owner}`);
}

export async function syncRecord(provider, owner, data) {
  const previous = await getJson(`data:${provider}:${owner}`);
  const next = data && typeof data === 'object' ? data : {};
  const merged = previous && typeof previous === 'object' ? { ...previous, ...next } : next;
  await setJson(`data:${provider}:${owner}`, merged);
  return merged;
}
export async function loadData(provider, owner) { return getJson(`data:${provider}:${owner}`); }
export { sessionFromEvent };
