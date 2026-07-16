import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, requireConfig } from './config.mjs';

const COOKIE = 'hybrid_sid';
function sign(value) { requireConfig('sessionSecret'); return createHmac('sha256', config.sessionSecret).update(value).digest('base64url'); }
function valid(raw) {
  const [sid, sig] = String(raw || '').split('.');
  if (!sid || !sig) return null;
  const expected = sign(sid); const a = Buffer.from(sig); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? sid : null;
}
export function sessionFromEvent(event) {
  const header = event.headers?.cookie || event.headers?.Cookie || '';
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  return valid(match?.slice(COOKIE.length + 1)) || randomUUID();
}
export function sessionCookie(sid) { return `${COOKIE}=${sid}.${sign(sid)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`; }
