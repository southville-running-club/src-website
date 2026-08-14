/**
 * Proving a webhook came from Stripe, with Web Crypto and no SDK.
 *
 * ## Why this is its own file
 *
 * It is the only thing standing between `POST /nn/stripe-webhook` and an anonymous request
 * that marks somebody's entry paid. Everything here is pure — bytes in, a verdict out — so it
 * can be tested exhaustively without a network, a database or a Worker, which is what
 * `tests/unit/stripe-signature.test.ts` does.
 *
 * ## The rule that makes or breaks it
 *
 * **The signature covers the exact bytes Stripe sent.** Not the parsed object, not a
 * re-serialised copy of it. `JSON.parse` followed by `JSON.stringify` reorders nothing on most
 * inputs and reorders something eventually — a different number format, a non-ASCII escape, a
 * key order that round-trips differently — and the failure is silent until the day it is not.
 * So the caller reads `await request.text()` **first**, verifies that string, and only then
 * parses it. This module never sees an object, which is the cheapest way to guarantee it.
 *
 * ## Why no SDK
 *
 * The same argument `worker/stripe.ts` makes for the outbound call. `stripe.webhooks
 * .constructEvent` is one function behind several hundred kilobytes, it wants `node:crypto`,
 * and its synchronous variant is unavailable in a Worker anyway. What it does is an HMAC and a
 * comparison, both of which `crypto.subtle` has. **The bundle grew by 0 bytes for this file.**
 *
 * ## What the header looks like
 *
 *     Stripe-Signature: t=1786650000,v1=5257a869e7...,v1=<another>,v0=<ignored>
 *
 * A comma-separated list of `key=value` pairs, in no guaranteed order, with `t` once and `v1`
 * **one or more times** — more than one during a signing-secret rotation, when Stripe signs
 * with both the old and the new. Accepting any matching `v1` is what makes a rotation a
 * non-event rather than an outage; rejecting all but the first would make it a coin toss.
 * `v0` is Stripe's test-mode scheme and is deliberately not accepted.
 *
 * The signed payload is `${t}.${body}` — the timestamp is inside the MAC, which is what stops
 * somebody replaying yesterday's body with today's clock.
 */

/** Five minutes either side, which is Stripe's own documented recommendation. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  /** No `Stripe-Signature` header at all. */
  | 'missing'
  /** A header that is not `t=...,v1=...`, or one with no usable `t` or no `v1` at all. */
  | 'malformed'
  /** Well-formed, in tolerance, and no `v1` matched. A wrong secret, or a tampered body. */
  | 'mismatch'
  /** Well-formed and outside the tolerance. A replay, or a clock that has drifted. */
  | 'stale';

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureFailure };

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

/**
 * Pull `t` and every `v1` out of the header.
 *
 * Returns null rather than throwing on anything it cannot read. **A malformed header is an
 * ordinary thing to receive on a public endpoint** — it is what an internet scanner sends —
 * and it should cost a 400 rather than an exception in a log.
 */
function parseSignatureHeader(header: string): ParsedHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    // Split on the first `=` only. A base-16 digest contains none, but splitting on all of
    // them would silently drop a value from a scheme that did.
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 't') {
      // Deliberately strict. `Number('12 34')` is NaN but `parseInt('12abc')` is 12, and a
      // timestamp that parses out of something that is not one is a tolerance check against a
      // number nobody sent.
      const seconds = Number(value);
      if (Number.isSafeInteger(seconds) && seconds > 0) {
        timestamp = seconds;
      }
    } else if (key === 'v1' && value.length > 0) {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

/**
 * Lowercase hex, because that is what Stripe sends and what `toLowerCase()` on the header
 * makes comparable to it without a second decode.
 */
function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compare two strings without leaking where they diverge through how long it took.
 *
 * **The length check first is not a leak worth closing.** Both operands are fixed-width hex
 * digests, so a length mismatch means the header was not a SHA-256 at all — which is public
 * information about a request the sender already has. What must not leak is *which byte* of a
 * correct-length digest was wrong, and the loop below does not: it visits every character and
 * accumulates, rather than returning at the first difference.
 *
 * `charCodeAt` rather than a byte comparison because both sides are already hex text; encoding
 * them back to bytes would be two allocations to compare the same information.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    // Bitwise, because branching is exactly what must not happen here: `!==` with an early
    // return would leak the position of the first differing character through timing.
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

/**
 * Verify a Stripe webhook signature against the raw body.
 *
 * @param payload  **The raw request body, exactly as it arrived.** Never a re-serialised copy.
 * @param header   The `Stripe-Signature` header, or null if there was not one.
 * @param secret   `STRIPE_WEBHOOK_SECRET` — a Worker secret, never in this repository.
 * @param nowMs    Injected so a test can sit either side of the tolerance without sleeping.
 *
 * **Never throws.** Every way this can fail is one of four reasons, because the caller has to
 * turn the answer into an HTTP status for Stripe and an exception is not one of them.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SignatureResult> {
  if (header === null || header.trim() === '') {
    return { ok: false, reason: 'missing' };
  }

  const parsed = parseSignatureHeader(header);
  if (parsed === null) {
    return { ok: false, reason: 'malformed' };
  }

  // **The tolerance is checked before the HMAC**, which costs nothing and means a flood of
  // stale replays never reaches the key. `Math.abs` so a clock that is *ahead* is refused too:
  // a timestamp from the future is as much a sign of something wrong as one from last week.
  const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp);
  if (skewSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale' };
  }

  // **An empty secret is a mismatch and not an exception.** `crypto.subtle.importKey` throws
  // `DataError: Zero-length key is not supported` on one, which would break this module's
  // "never throws" contract at the exact moment it is holding a real payment. The handler
  // already refuses an unbound secret with a 503 before reaching here; this is the second
  // lock, and it fails in the direction of proving nothing rather than of crashing.
  if (secret.length === 0) {
    return { ok: false, reason: 'mismatch' };
  }

  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // `${t}.${payload}` — the timestamp is inside the MAC, so a captured body cannot be
  // re-presented with a fresh `t`.
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${parsed.timestamp}.${payload}`),
  );

  const expected = toHex(digest);

  // Every `v1`, not the first. See the note about rotation at the head of this file. The loop
  // does not stop at a match, so the work done is the same whichever one matched — and
  // `signatures.length` is a small number Stripe chose, not something a caller can grow into a
  // denial of service, because a header with a thousand `v1`s fails the same way.
  let matched = false;
  for (const candidate of parsed.signatures) {
    if (timingSafeEqual(expected, candidate.toLowerCase())) {
      matched = true;
    }
  }

  return matched ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/**
 * Build a `Stripe-Signature` header for a payload. **Test and local-stub use only.**
 *
 * It lives here rather than in the test because the stub in `platform/scripts/` needs it too,
 * and two implementations of a signing scheme is how a test starts proving that a bug agrees
 * with itself. Signing requires the secret, so nothing that reaches production can call this
 * usefully — and nothing in `worker/` does.
 */
export async function signStripePayload(
  payload: string,
  secret: string,
  timestampSeconds: number,
): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestampSeconds}.${payload}`),
  );

  return `t=${timestampSeconds},v1=${toHex(digest)}`;
}
