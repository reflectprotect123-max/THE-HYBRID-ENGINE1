/*
 * Adversarial tests for the Supabase access-token verifier.
 *
 * This is the credential that lets the native app claim a WHOOP connection, so
 * every one of these is an attempt to be someone else. They are written as
 * attacks rather than as unit tests because that is the only framing in which
 * "it returned a user id" is a failure.
 *
 * THE ONE THAT MATTERS: the project's anon key is itself a valid JWT signed
 * with the same legacy secret, and it ships publicly in every client bundle
 * (packages/config). A verifier that checked only the signature would hand
 * anyone who copied it out of the bundle a logged-in identity. Four independent
 * claims stop it, and the test below proves at least one still does.
 *
 * The secret here is a local fixture — tokens are minted and attacked in this
 * process. Nothing touches the real project.
 *
 * Run: node checks/supabase-auth.mjs
 */
import { createHmac } from 'node:crypto';

const PROJECT = 'https://orysjncrksmdfabpuftd.supabase.co';
process.env.SUPABASE_URL = PROJECT;
process.env.SUPABASE_JWT_SECRET = 'local-fixture-secret-not-the-real-one';
// The WHOOP config module validates these at import time; they are unrelated
// to what is being tested and are deliberately obvious placeholders.
process.env.APP_BASE_URL = 'https://thehybridengine1.netlify.app';
process.env.WHOOP_CLIENT_ID = 'fixture';
process.env.WHOOP_CLIENT_SECRET = 'fixture';
process.env.APP_SESSION_SECRET = 'fixture';

const { verifySupabaseAccessToken } = await import(
  new URL('../netlify/functions/_lib/supabase.mjs', import.meta.url).href
);

const ISS = `${PROJECT}/auth/v1`;
const USER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const HS256 = { alg: 'HS256', typ: 'JWT' };
const now = () => Math.floor(Date.now() / 1000);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (header, claims, secret = process.env.SUPABASE_JWT_SECRET) => {
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${createHmac('sha256', secret).update(input, 'utf8').digest('base64url')}`;
};
/** A well-formed end-user token, which each attack then spoils in one way. */
const userClaims = (over = {}) => ({
  iss: ISS, aud: 'authenticated', role: 'authenticated', sub: USER,
  iat: now(), exp: now() + 3600, ...over,
});

let failures = 0;
async function expect(label, token, shouldBeAccepted) {
  let acceptedAs = null;
  let reason = '';
  try {
    acceptedAs = (await verifySupabaseAccessToken(token)).userId;
  } catch (e) {
    reason = e.code || e.message;
  }
  const accepted = acceptedAs === USER;
  if (accepted === shouldBeAccepted) {
    console.log(`PASS — ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL — ${label}: ${accepted ? 'ACCEPTED and must not be' : `rejected (${reason}) and should have been accepted`}`);
  }
}

await expect('a real end-user token is accepted', sign(HS256, userClaims()), true);

await expect(
  'the PUBLIC anon key cannot impersonate a user',
  // The real anon key's claim set: correctly signed, right issuer, but no
  // `sub`, no `aud: authenticated`, and role 'anon'.
  sign(HS256, { iss: ISS, ref: 'orysjncrksmdfabpuftd', role: 'anon', iat: now(), exp: now() + 999999 }),
  false,
);

await expect(
  'a service-role key cannot act as a person',
  sign(HS256, userClaims({ role: 'service_role' })),
  false,
);

await expect(
  'alg:none is rejected',
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64(userClaims())}.`,
  false,
);

await expect(
  'a token signed with a different secret is rejected',
  sign(HS256, userClaims(), 'whatever-the-attacker-has'),
  false,
);

await expect('an expired token is rejected', sign(HS256, userClaims({ exp: now() - 3600, iat: now() - 7200 })), false);

await expect(
  'a token issued by a DIFFERENT Supabase project is rejected',
  // Anyone can stand up a project and mint themselves a perfectly valid token.
  // The issuer check is the only thing that makes it not ours.
  sign(HS256, userClaims({ iss: 'https://someone-elses.supabase.co/auth/v1' })),
  false,
);

await expect('a non-UUID subject is rejected', sign(HS256, userClaims({ sub: 'admin' })), false);

await expect(
  'swapping the payload for another user invalidates the signature',
  (() => {
    const parts = sign(HS256, userClaims()).split('.');
    parts[1] = b64(userClaims({ sub: '00000000-0000-0000-0000-000000000001' }));
    return parts.join('.');
  })(),
  false,
);

await expect('a garbage string is rejected', 'not.a.jwt', false);
await expect('an empty token is rejected', '', false);

console.log(failures ? `\n${failures} FAILURE(S) — the token verifier is not safe to deploy.` : '\nAll Supabase auth attacks repelled.');
process.exit(failures ? 1 : 0);
