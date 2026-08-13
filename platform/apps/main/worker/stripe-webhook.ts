import {
  createAnonClient,
  recordCheckoutEvent,
  type CheckoutEventResult,
} from '@src/shared';
import { verifyStripeSignature, type SignatureFailure } from './stripe-signature';

/**
 * `POST /nn/stripe-webhook` — the only thing in this platform that may record a payment.
 *
 * ## The governing rule
 *
 * **This is the only source of truth for payment state, and the redirect back from Stripe is
 * not evidence and never becomes evidence.** A runner can close the tab, lose signal, or never
 * come back; the webhook still arrives, retries on failure, and can arrive more than once.
 * Every line here is written as though `/nn/entry/complete/` did not exist.
 *
 * ## The failure direction is inverted here, and that is the thing to understand
 *
 * `worker/nn-signup.ts` and `worker/nn-entry.ts` fail **towards taking no money**: every doubt
 * resolves to storing nothing and charging nothing, because nothing had been charged yet. By
 * the time this handler runs, **the money has already left somebody's account**. So the only
 * safe failure here is one that is retried:
 *
 *   * **200** — the question was answered, whatever the answer. A retry would produce the
 *     identical result, so there is nothing to gain from one. That includes "this is somebody
 *     else's payment" and "the amount disagreed": both are permanent, and a non-2xx would make
 *     Stripe retry them until it gave up and disabled the endpoint — which would silently stop
 *     every *future* confirmation.
 *   * **400** — this is not Stripe, or it cannot be proved to be. No signature, a malformed
 *     one, a stale one, one that does not verify. Nothing is parsed for meaning.
 *   * **5xx** — *our* configuration or *our* outage: no signing secret bound, no webhook key,
 *     the migration not landed, the network down. Stripe retries for roughly three days, which
 *     comfortably outlives any deploy, and every payment in that window lands the moment the
 *     problem is fixed. **A 200 here would drop a real payment on the floor.**
 *
 * That last mapping is the one that is easy to get wrong. An unconfigured signing secret looks
 * like a client problem and is not: the club has not finished setting the endpoint up, and the
 * payments arriving meanwhile belong in Stripe's retry queue rather than in a 400.
 *
 * ## What is never logged
 *
 * **The body, on any path — including the parse-failure path.** It carries the purchaser's
 * email address, because Checkout needs one. Every line below carries a uuid, an integer, an
 * event type, an event id or a classification, and nothing else. That is the same rule
 * `worker/stripe.ts` follows for Stripe's error messages and `worker/nn-signup.ts` for
 * Postgres error strings, and it is the rule with the fewest exceptions in this repository.
 */

export interface StripeWebhookEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  /**
   * **A Worker secret**, set with `wrangler secret put`. Never in `wrangler.jsonc`, never in a
   * `vars` block, never in this repository. Optional here because its absence is a real state
   * — the endpoint is created in Stripe after the Worker is deployed — and that state must be
   * a retriable 5xx rather than a silent success.
   */
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * **A second Worker secret, and the reason it exists is not obvious.** The database function
   * that writes `paid` is granted to the anon role like every other one, and the anon key is
   * published in page source — so without a second factor, two ordinary PostgREST calls would
   * buy a free race entry. See the migration. The database holds only its SHA-256 digest.
   */
  ENTRIES_WEBHOOK_KEY?: string;
}

/** The two events this endpoint acts on. Everything else is answered 200 and ignored. */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
] as const;

export interface WebhookResponse {
  status: number;
  /** A short body, so a Stripe dashboard delivery log says something when somebody opens it. */
  body: string;
}

/**
 * The fields this handler reads off a Checkout session, and **the only ones it reads**.
 *
 * Stripe's payload is large and contains a customer email address. Naming the six fields
 * explicitly rather than passing the object on is what guarantees nothing else travels — there
 * is no `...rest` to audit and no place for a future field to arrive unnoticed.
 */
interface CheckoutSessionPayload {
  id: string | null;
  clientReferenceId: string | null;
  amountTotal: number | null;
  currency: string | null;
  paymentIntent: string | null;
  paymentStatus: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * `payment_intent` is a string when the session is not expanded and an object when it is.
 * This code never expands it, so the string is what arrives — but reading the object's `id`
 * as well costs one line and means a future `expand` cannot silently drop the treasurer's only
 * reconciliation key.
 */
function readPaymentIntent(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }

  if (typeof value === 'object' && value !== null) {
    return readString((value as { id?: unknown }).id);
  }

  return null;
}

function readSession(object: unknown): CheckoutSessionPayload {
  const session = (object ?? {}) as Record<string, unknown>;

  return {
    id: readString(session.id),
    clientReferenceId: readString(session.client_reference_id),
    amountTotal: typeof session.amount_total === 'number' ? session.amount_total : null,
    currency: readString(session.currency),
    paymentIntent: readPaymentIntent(session.payment_intent),
    paymentStatus: readString(session.payment_status),
  };
}

/** Which HTTP status a signature failure earns, and why it differs by reason. */
function signatureRefusal(reason: SignatureFailure): WebhookResponse {
  // All four are 400. **The request could not be proved to have come from Stripe**, and a
  // retry of an unprovable request is an unprovable request. A real Stripe delivery is signed
  // with a fresh timestamp on every attempt, so a genuine retry never lands here on `stale`.
  console.error(`Stripe webhook signature rejected — ${reason}`);
  return { status: 400, body: 'signature\n' };
}

/**
 * Turn what the database did into what Stripe is told.
 *
 * Split out and pure so `tests/unit/stripe-webhook.test.ts` can walk every outcome without a
 * database — and so the one dangerous mapping, `ok: false` to 5xx, is a line somebody can read
 * rather than a branch buried in a handler.
 */
export function describeCheckoutOutcome(result: CheckoutEventResult): WebhookResponse {
  if (!result.ok) {
    // `unauthorised` — the key did not match, or nobody has installed the digest yet. Ours to
    // fix, so Stripe must keep the payment in its retry queue until we have.
    return { status: 503, body: `retry ${result.outcome}\n` };
  }

  return { status: 200, body: `${result.outcome}\n` };
}

/**
 * Everything worth writing down about one delivery, and nothing that identifies a person.
 *
 * A uuid, a classification and two integers. **No email address, no name, no body.** The
 * purchase id is deliberately included: it is the only thing that makes a line actionable, it
 * is a random uuid, and it discloses nothing on its own.
 */
function logOutcome(
  eventType: string,
  eventId: string | null,
  purchaseId: string | null,
  result: CheckoutEventResult,
): void {
  const reference = `${eventType} ${eventId ?? 'no-id'}`;

  if (result.outcome === 'amount_mismatch') {
    // **This should never fire, and if it does it needs a human.** Both numbers, because the
    // difference is the whole content of the report. Neither is personal data.
    console.error(
      `Stripe webhook amount mismatch — ${reference} purchase=${purchaseId ?? 'none'} ` +
        `expected=${result.expectedPence ?? 'unknown'} stripe=${result.stripePence ?? 'unknown'}`,
    );
    return;
  }

  if (result.overCapacity) {
    console.error(
      `Stripe webhook paid OVER CAPACITY — ${reference} purchase=${purchaseId ?? 'none'}. ` +
        'Somebody has paid for a place the race did not have. See the entries-attention runbook.',
    );
    return;
  }

  if (result.outcome === 'paid_after_refund' || result.outcome === 'session_conflict') {
    console.error(`Stripe webhook needs a human — ${reference} ${result.outcome}`);
    return;
  }

  if (result.applied) {
    // `console.warn` rather than the casual one, which the lint rule bans outright.
    console.warn(
      `Stripe webhook ${result.outcome}${result.revived ? ' (revived a lapsed hold)' : ''} — ${reference}`,
    );
  }

  // `already_paid`, `not_ours` and `ignored` are silent. They are the common cases — Stripe
  // duplicates deliveries and this account may carry the club's England Athletics payments —
  // and a line each would spend a free-tier observability allowance on nothing.
}

/**
 * Handle one delivery.
 *
 * **Never throws.** A thrown error would become a 500 that happens to be the right status for
 * the wrong reason, and would carry a stack trace built from a body containing an email
 * address into an observability tool that was never assessed to hold one.
 */
export async function handleStripeWebhook(
  request: Request,
  env: StripeWebhookEnv,
): Promise<Response> {
  const outcome = await processStripeWebhook(request, env);

  return new Response(outcome.body, {
    status: outcome.status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Nothing about a payment confirmation belongs in a cache, and Stripe does not read it.
      'cache-control': 'no-store',
    },
  });
}

async function processStripeWebhook(
  request: Request,
  env: StripeWebhookEnv,
): Promise<WebhookResponse> {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const key = env.ENTRIES_WEBHOOK_KEY?.trim();

  // **Both missing secrets are 503, not 400.** This is the club's setup being unfinished, and
  // the payments arriving during it belong in Stripe's retry queue. A 400 would tell Stripe
  // the request was bad and to stop trying, and a real payment would be lost with no symptom.
  if (!secret) {
    console.error('Stripe webhook received with no STRIPE_WEBHOOK_SECRET bound');
    return { status: 503, body: 'not configured\n' };
  }

  if (!key) {
    console.error('Stripe webhook received with no ENTRIES_WEBHOOK_KEY bound');
    return { status: 503, body: 'not configured\n' };
  }

  // **The raw bytes, before anything else touches them.** The signature covers exactly what
  // Stripe sent; verifying a re-serialised body is a classic and silent failure. Nothing below
  // may parse this string until it has been proved.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    // A body that could not be read at all. Nothing about it is logged, because the part that
    // did arrive is the part that carries an address.
    console.error('Stripe webhook body could not be read');
    return { status: 400, body: 'unreadable\n' };
  }

  const verified = await verifyStripeSignature(
    raw,
    request.headers.get('stripe-signature'),
    secret,
  );

  if (!verified.ok) {
    return signatureRefusal(verified.reason);
  }

  // Proved. Only now is it worth reading.
  let event: { type?: unknown; id?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    // A body that verified and is not JSON should be impossible. It is still not logged.
    console.error('Stripe webhook payload verified but was not JSON');
    return { status: 400, body: 'not json\n' };
  }

  const eventType = readString(event.type) ?? 'unknown';
  const eventId = readString(event.id);
  const session = readSession(event.data?.object);

  // **A completed event does not universally mean paid.** For a delayed-notification method it
  // arrives with `payment_status: 'unpaid'` and is confirmed later by
  // `checkout.session.async_payment_succeeded`. Only cards are enabled, so this should never
  // fire — and if a future change enables anything else, **that event has to be handled before
  // the method is switched on**, or entries will silently stop being confirmed. Answering 200
  // is right: the event is real and there is nothing to retry.
  if (eventType === 'checkout.session.completed' && session.paymentStatus !== 'paid') {
    console.warn(
      `Stripe webhook completed session was not paid — ${eventType} ${eventId ?? 'no-id'} ` +
        `payment_status=${session.paymentStatus ?? 'absent'}`,
    );
    return { status: 200, body: 'not paid\n' };
  }

  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  const recorded = await recordCheckoutEvent(client, {
    key,
    eventType,
    sessionId: session.id,
    clientReferenceId: session.clientReferenceId,
    amountTotal: session.amountTotal,
    currency: session.currency,
    paymentIntentId: session.paymentIntent,
    eventId,
  });

  if (recorded.status === 'unavailable') {
    // The migration has not landed, or Postgres could not be reached. **Nothing was written**,
    // and Stripe must try again — this is the case where a 200 loses a payment outright.
    console.error(`entries.record_checkout_event unavailable — ${recorded.error}`);
    return { status: 503, body: 'retry unavailable\n' };
  }

  logOutcome(eventType, eventId, session.clientReferenceId, recorded.result);

  return describeCheckoutOutcome(recorded.result);
}
