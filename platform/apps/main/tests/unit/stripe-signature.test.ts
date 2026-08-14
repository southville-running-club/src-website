import { describe, expect, it } from 'vitest';
import {
  signStripePayload,
  timingSafeEqual,
  verifyStripeSignature,
  SIGNATURE_TOLERANCE_SECONDS,
} from '../../worker/stripe-signature';

/**
 * The one thing standing between `POST /nn/stripe-webhook` and an anonymous request that marks
 * somebody's entry paid.
 *
 * **Every case here is a negative one except the first**, which is the right ratio for this
 * file: that a correct signature passes proves the algorithm was implemented; that a wrong
 * secret, a tampered body, a missing header and a replayed timestamp all *fail* is what proves
 * it is a control rather than a formality. A verifier that returned `true` unconditionally
 * would pass the happy-path test.
 *
 * No network, no database, no Worker — `crypto.subtle` is available in Node's test environment
 * as it is in `workerd`, and the module is pure by design so it can be exercised exhaustively.
 * The integration is `tests/worker/webhook/`.
 */

/** Deterministic and invented, like every fixture here. Not a real signing secret. */
const SECRET = 'whsec_TEST_NOT_A_REAL_SIGNING_SECRET_000000';

/** A fixed instant, so the tolerance can be walked without sleeping. 2026-09-01T12:00:00Z. */
const NOW_MS = Date.UTC(2026, 8, 1, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

/**
 * A payload shaped like the one Stripe sends.
 *
 * **Pretty-printed with two spaces, because that is what Stripe actually puts on the wire.**
 * That detail is the whole reason the re-serialisation test below has teeth: a compact fixture
 * round-trips through `JSON.parse`/`JSON.stringify` to a byte-identical string, so a test
 * built on one would pass whether or not the handler verified the raw body.
 *
 * **It carries an email address**, deliberately: the assertions at the foot of this file check
 * that nothing here leaks it, and a fixture without one could not prove that.
 */
const PAYLOAD = JSON.stringify(
  {
    id: 'evt_test_00000000000001',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_00000000000001',
        client_reference_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        amount_total: 1700,
        currency: 'gbp',
        payment_intent: 'pi_test_00000000000001',
        payment_status: 'paid',
        customer_email: 'grace@example.com',
      },
    },
  },
  null,
  2,
);

const sign = (payload = PAYLOAD, secret = SECRET, at = NOW_SECONDS) =>
  signStripePayload(payload, secret, at);

const verify = (
  header: string | null,
  payload = PAYLOAD,
  secret = SECRET,
  nowMs = NOW_MS,
) => verifyStripeSignature(payload, header, secret, nowMs);

describe('a signature that should pass', () => {
  it('accepts a correct signature over the exact bytes', async () => {
    expect(await verify(await sign())).toEqual({ ok: true });
  });

  it('accepts it at both edges of the tolerance', async () => {
    // Exactly five minutes late, and exactly five minutes early. `<=` rather than `<` on the
    // boundary is a choice, and a test on the boundary is what stops somebody "tidying" it.
    const late = await sign(PAYLOAD, SECRET, NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS);
    const early = await sign(PAYLOAD, SECRET, NOW_SECONDS + SIGNATURE_TOLERANCE_SECONDS);

    expect(await verify(late)).toEqual({ ok: true });
    expect(await verify(early)).toEqual({ ok: true });
  });

  it('accepts any matching v1 when Stripe sends more than one', async () => {
    // **During a signing-secret rotation Stripe signs with both**, so the correct one is not
    // necessarily first. Taking only the first would make a rotation a coin toss.
    const signed = await sign();
    const digest = signed.slice(signed.indexOf('v1=') + 3);

    const decoyFirst = `t=${NOW_SECONDS},v1=${'0'.repeat(64)},v1=${digest}`;
    const decoyLast = `t=${NOW_SECONDS},v1=${digest},v1=${'0'.repeat(64)}`;

    expect(await verify(decoyFirst)).toEqual({ ok: true });
    expect(await verify(decoyLast)).toEqual({ ok: true });
  });

  it('tolerates the whitespace a proxy might introduce', async () => {
    const signed = await sign();
    expect(await verify(signed.split(',').join(', '))).toEqual({ ok: true });
  });
});

describe('a signature that must not pass', () => {
  it('rejects a signature made with a different secret', async () => {
    const signed = await sign(PAYLOAD, 'whsec_A_COMPLETELY_DIFFERENT_SECRET_00000');

    expect(await verify(signed)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a body that was altered after signing', async () => {
    // **The case that matters most.** The signature is over the bytes, so changing the amount
    // from £17.00 to £0.01 must invalidate it — otherwise anybody who intercepted a delivery
    // could mark an entry paid for a penny.
    const signed = await sign();
    const tampered = PAYLOAD.replace('"amount_total": 1700', '"amount_total": 1');

    expect(tampered).not.toBe(PAYLOAD);
    expect(await verify(signed, tampered)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a body that only differs by re-serialisation', async () => {
    // **Why the handler verifies `await request.text()` and never a parsed object.** The two
    // are the same JSON and different bytes, and a verifier fed the round-tripped copy would
    // reject every genuine delivery — or, worse, a signer fed it would accept a forged one.
    const signed = await sign();
    const reserialised = JSON.stringify(JSON.parse(PAYLOAD));

    expect(reserialised).not.toBe(PAYLOAD);
    expect(await verify(signed, reserialised)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a missing header', async () => {
    expect(await verify(null)).toEqual({ ok: false, reason: 'missing' });
    expect(await verify('')).toEqual({ ok: false, reason: 'missing' });
    expect(await verify('   ')).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a header that is not a signature at all', async () => {
    for (const header of [
      'nonsense',
      't=',
      'v1=abc',
      `t=${NOW_SECONDS}`,
      't=not-a-number,v1=abc',
      // `parseInt` would read this as a timestamp; `Number` does not, which is the point.
      `t=${NOW_SECONDS}abc,v1=abc`,
      `t=-1,v1=abc`,
      `t=${NOW_SECONDS},v1=`,
      // v0 is Stripe's test-mode scheme and is deliberately not accepted.
      `t=${NOW_SECONDS},v0=${'0'.repeat(64)}`,
    ]) {
      expect(await verify(header), header).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('rejects a capture replayed after the tolerance', async () => {
    // **The replay bound.** A genuine Stripe retry is re-signed with a fresh `t`, so this
    // never fires on one — but a body captured off the wire cannot be presented tomorrow.
    const signed = await sign(
      PAYLOAD,
      SECRET,
      NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS - 1,
    );

    expect(await verify(signed)).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a timestamp from the future by the same margin', async () => {
    // A `t` ahead of us is as much a sign of something wrong as one behind, and refusing only
    // the past would let a captured request be given an arbitrarily long life.
    const signed = await sign(
      PAYLOAD,
      SECRET,
      NOW_SECONDS + SIGNATURE_TOLERANCE_SECONDS + 1,
    );

    expect(await verify(signed)).toEqual({ ok: false, reason: 'stale' });
  });

  it('does not let a stale signature be revived by a correct digest', async () => {
    // The timestamp is inside the MAC, so a valid digest for an old `t` stays bound to it.
    // Presenting it with a fresh `t` breaks the digest; keeping the old `t` is out of
    // tolerance. There is no third option, and this asserts both halves.
    const old = NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS - 60;
    const signed = await sign(PAYLOAD, SECRET, old);
    const digest = signed.slice(signed.indexOf('v1=') + 3);

    expect(await verify(signed)).toEqual({ ok: false, reason: 'stale' });
    expect(await verify(`t=${NOW_SECONDS},v1=${digest}`)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects an empty secret rather than signing with nothing', async () => {
    // The handler refuses before it gets here, with a 503. This is the second lock: an empty
    // string is a legal HMAC key, so without the handler's check it would verify happily
    // against a signature anybody could compute.
    const signed = await sign();

    expect(await verify(signed, PAYLOAD, '')).toEqual({ ok: false, reason: 'mismatch' });
  });
});

describe('the digest comparison', () => {
  it('agrees with equality on matching and differing strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    // Differing in the first character rather than the last, which is what a short-circuiting
    // comparison would return fastest on.
    expect(timingSafeEqual('abc', 'zbc')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('is false for different lengths rather than throwing or matching a prefix', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual('abc', '')).toBe(false);
  });
});

describe('what a rejection is allowed to say', () => {
  it('reports a reason and never any part of the payload', async () => {
    // **The payload carries an email address**, and the reason is what the handler logs. Four
    // words, none of which came from the body.
    for (const header of [
      null,
      'nonsense',
      await sign(PAYLOAD, 'whsec_WRONG_00000000000000000000000000'),
    ]) {
      const result = await verify(header);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['missing', 'malformed', 'mismatch', 'stale']).toContain(result.reason);
        expect(result.reason).not.toContain('grace@example.com');
        expect(result.reason).not.toContain('cs_test');
      }
    }
  });
});
