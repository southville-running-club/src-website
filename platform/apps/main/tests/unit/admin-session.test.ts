import { describe, expect, it } from 'vitest';
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminSessionCookie,
  clearedAdminSessionCookie,
  cookieValue,
  mintAdminSession,
  readAdminSession,
} from '../../worker/admin-session';

/**
 * The signed cookie that carries who is signed in.
 *
 * **Every assertion below is a way in that must not exist.** The cookie is the only thing
 * standing between somebody on the internet and a list of names, ages, emergency contacts and
 * — one deliberate act further on — medical notes; a forged one, an expired one accepted, or a
 * signature checked against the wrong secret is the whole of the admin surface's security gone.
 *
 * The clock is an argument rather than `Date.now()` precisely so these can be pinned. A session
 * test that waited twelve hours would be a test nobody runs.
 */

const SECRET = 'a-worker-secret-for-tests-only-not-a-real-one';
const NOW = 1_800_000_000;

describe('minting and reading a session', () => {
  it('round-trips the handle', async () => {
    const cookie = `${ADMIN_COOKIE}=${await mintAdminSession(SECRET, 'membership', NOW)}`;

    expect(await readAdminSession(SECRET, cookie, NOW)).toBe('membership');
  });

  it('carries the handle and an expiry, and nothing that would open the door again', async () => {
    // **The person's own key is not in here.** They present it once, to
    // `entries.admin_sign_in()`; a cookie carrying a live credential would put one in browser
    // storage, in a screenshot and in whatever a phone syncs.
    const value = await mintAdminSession(SECRET, 'membership', NOW);
    const [handle, expiry, signature] = value.split('.');

    expect(handle).toBe('membership');
    expect(Number(expiry)).toBe(NOW + ADMIN_SESSION_SECONDS);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(value).not.toContain(SECRET);
  });

  it('is still valid one second before it expires, and not one second after', async () => {
    const cookie = `${ADMIN_COOKIE}=${await mintAdminSession(SECRET, 'membership', NOW)}`;

    expect(await readAdminSession(SECRET, cookie, NOW + ADMIN_SESSION_SECONDS - 1)).toBe(
      'membership',
    );
    expect(
      await readAdminSession(SECRET, cookie, NOW + ADMIN_SESSION_SECONDS + 1),
    ).toBeNull();
  });

  it('lasts twelve hours — long enough for race day, short enough for a lost phone', () => {
    expect(ADMIN_SESSION_SECONDS).toBe(12 * 60 * 60);
  });
});

describe('what it refuses', () => {
  it('refuses a cookie signed with a different secret', async () => {
    // The case that matters after a key rotation, and the case that matters if somebody works
    // out the payload format — which is trivial and is meant to be.
    const cookie = `${ADMIN_COOKIE}=${await mintAdminSession('some-other-secret', 'membership', NOW)}`;

    expect(await readAdminSession(SECRET, cookie, NOW)).toBeNull();
  });

  it('refuses a hand-built cookie with no signature at all', async () => {
    expect(
      await readAdminSession(SECRET, `${ADMIN_COOKIE}=membership.9999999999.`, NOW),
    ).toBeNull();
    expect(
      await readAdminSession(SECRET, `${ADMIN_COOKIE}=membership.9999999999.AAAA`, NOW),
    ).toBeNull();
  });

  it('refuses a cookie whose expiry has been edited', async () => {
    // The expiry is inside the signed payload, so extending it invalidates the signature.
    const value = await mintAdminSession(SECRET, 'membership', NOW);
    const [handle, , signature] = value.split('.');
    const extended = `${ADMIN_COOKIE}=${handle}.${NOW + 999_999}.${signature}`;

    expect(await readAdminSession(SECRET, extended, NOW)).toBeNull();
  });

  it('refuses a cookie whose handle has been edited', async () => {
    const value = await mintAdminSession(SECRET, 'membership', NOW);
    const [, expiry, signature] = value.split('.');
    const swapped = `${ADMIN_COOKIE}=someone-else.${expiry}.${signature}`;

    expect(await readAdminSession(SECRET, swapped, NOW)).toBeNull();
  });

  it('refuses a handle that is not the shape admin_keys allows', async () => {
    // Belt and braces against a handle that got past the table's own check constraint: the
    // handle lands in the audit trail, and this is the second lock on what may be in it.
    const forged = await mintAdminSession(SECRET, 'Bindal Shah', NOW);

    expect(await readAdminSession(SECRET, `${ADMIN_COOKIE}=${forged}`, NOW)).toBeNull();
  });

  it('refuses no cookie header at all, and one without this cookie in it', async () => {
    expect(await readAdminSession(SECRET, null, NOW)).toBeNull();
    expect(await readAdminSession(SECRET, 'other=1; another=2', NOW)).toBeNull();
  });

  it('refuses a value that is not three parts', async () => {
    expect(await readAdminSession(SECRET, `${ADMIN_COOKIE}=nonsense`, NOW)).toBeNull();
    expect(await readAdminSession(SECRET, `${ADMIN_COOKIE}=a.b`, NOW)).toBeNull();
    expect(await readAdminSession(SECRET, `${ADMIN_COOKIE}=a.b.c.d`, NOW)).toBeNull();
  });

  it('refuses an expiry that is not a number', async () => {
    expect(
      await readAdminSession(SECRET, `${ADMIN_COOKIE}=membership.later.AAAA`, NOW),
    ).toBeNull();
  });
});

describe('the cookie attributes', () => {
  it('is HttpOnly, Strict and scoped to the admin path', async () => {
    const header = adminSessionCookie('value', true);

    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/nn/admin');
    expect(header).toContain(`Max-Age=${ADMIN_SESSION_SECONDS}`);
  });

  it('is Secure over HTTPS and not over the laptop’s HTTP', () => {
    // **Not unconditional, deliberately.** A `Secure` cookie is dropped at
    // `http://localhost:8787`, so the acceptance suite would exercise a sign-in that never
    // signs anybody in — a test that passes by never reaching the thing it is testing.
    expect(adminSessionCookie('value', true)).toContain('; Secure');
    expect(adminSessionCookie('value', false)).not.toContain('; Secure');
  });

  it('clears with the same path, or the browser keeps the old one', () => {
    // A `Set-Cookie` that clears has to match on name **and** path, or the browser is left
    // holding a live session it will keep sending.
    const cleared = clearedAdminSessionCookie(false);

    expect(cleared).toContain(`${ADMIN_COOKIE}=`);
    expect(cleared).toContain('Path=/nn/admin');
    expect(cleared).toContain('Max-Age=0');
  });
});

describe('cookieValue', () => {
  it('finds one cookie among several, however the header is spaced', () => {
    expect(cookieValue('a=1; nn_admin=xyz; b=2', 'nn_admin')).toBe('xyz');
    expect(cookieValue('a=1;nn_admin=xyz;b=2', 'nn_admin')).toBe('xyz');
  });

  it('does not match a cookie whose name merely ends with the one asked for', () => {
    expect(cookieValue('not_nn_admin=xyz', 'nn_admin')).toBeNull();
  });

  it('keeps a value containing an equals sign', () => {
    // Only the first `=` separates name from value. Base64url has no padding so this should
    // never arise, and a parser that got it wrong would fail in a way nobody could read.
    expect(cookieValue('nn_admin=a=b=c', 'nn_admin')).toBe('a=b=c');
  });
});
