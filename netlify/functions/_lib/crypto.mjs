import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config, requireConfig } from './config.mjs';

function key() { requireConfig('sessionSecret'); return createHash('sha256').update(config.sessionSecret).digest(); }
function b64(value) { return Buffer.from(value).toString('base64url'); }
function unb64(value) { return Buffer.from(value, 'base64url'); }

export function encryptJson(value) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(data)}`;
}

export function decryptJson(value) {
  if (!value) return null;
  // Fail closed on anything that isn't a well-formed iv.tag.data GCM blob:
  // a malformed or truncated stored record returns null instead of throwing,
  // so one corrupt record can't 500 the whole function. A wrong key or a
  // tampered ciphertext still lands here (GCM verification fails) and is
  // likewise treated as "no token".
  const parts = String(value).split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  try {
    const [iv, tag, data] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key(), unb64(iv)); decipher.setAuthTag(unb64(tag));
    return JSON.parse(Buffer.concat([decipher.update(unb64(data)), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}
