import { createAnonClient, recordTicketCheckoutEvent } from '@src/shared';

import { verifyStripeSignature, type SignatureFailure } from './stripe-signature';

/**
 * `POST /events/stripe-webhook` — **the only thing that writes `paid` for a ticket.**
 *
 * ADR-010's three decisions, applied to `store`:
 *
 *   1. **The redirect back from Stripe is not proof of payment.** A tab can be closed before
 *      it fires and the return URL is one anybody can type, so the return page reports only
 *      what the club has recorded and this endpoint is what records it.
 *   2. **The signature is verified over the raw bytes, before anything parses them.** The
 *      signature covers exactly what Stripe sent; verifying a re-serialised body is a classic
 *      and silent failure.
 *   3. **The transition is idempotent by state guard**, under the social's advisory lock,
 *      inside the database function.
 *
 * ## Its own endpoint, and its own two secrets
 *
 * A Stripe webhook endpoint is configured per URL with its own signing secret, so sharing
 * `/nn/stripe-webhook` would mean one secret covering both the race and the shop — and a
 * rotation of it closing both. `STORE_STRIPE_WEBHOOK_SECRET` proves the delivery came from
 * Stripe; `STORE_WEBHOOK_KEY` is the second factor the database demands, because
 * `store.record_checkout_event()` is granted to the anon role and the anon key is published in
 * page source.
 *
 * ## ⚠️ The failure direction is inverted here, and only here
 *
 * Everything else in this platform fails towards taking no money. By the time this runs the
 * money has gone — so **our** failures answer 5xx and let Stripe retry for three days, and
 * only "this is not Stripe" gets a 400. A 200 on an outage drops a real payment, with no
 * symptom until somebody says they paid and never heard anything.
 */

export interface StoreWebhookEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  /** Stripe's signing secret for **this** endpoint. A Worker secret; never in this repository. */
  STORE_STRIPE_WEBHOOK_SECRET?: string;
  /** The second factor `store.record_checkout_event()` demands. A Worker secret. */
  STORE_WEBHOOK_KEY?: string;
}

interface WebhookResponse {
  status: number;
  /** A short body, so a Stripe dashboard delivery log says something when somebody opens it. */
  body: string;
}

/**
 * The fields this handler reads off a Checkout session, and **the only ones it reads**.
 *
 * Stripe's payload is large and contains a customer email address. Naming the fields
 * explicitly rather than passing the object on is what guarantees nothing else travels —
 * there is no `...rest` to audit and no place for a future field to arrive unnoticed.
 */
interface SessionPayload {
  id: string | null;
  amountTotal: number | null;
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

function readSession(object: unknown): SessionPayload {
  const session = (object ?? {}) as Record<string, unknown>;

  return {
    id: readString(session.id),
    amountTotal: typeof session.amount_total === 'number' ? session.amount_total : null,
    paymentIntent: readPaymentIntent(session.payment_intent),
    paymentStatus: readString(session.payment_status),
  };
}

function signatureRefusal(reason: SignatureFailure): WebhookResponse {
  // **All of them are 400.** The request could not be proved to have come from Stripe, and a
  // retry of an unprovable request is an unprovable request. A real Stripe delivery is signed
  // with a fresh timestamp on every attempt, so a genuine retry never lands here on `stale`.
  console.error(`Store webhook signature rejected — ${reason}`);
  return { status: 400, body: 'signature\n' };
}

export async function handleStoreWebhook(
  request: Request,
  env: StoreWebhookEnv,
): Promise<Response> {
  const outcome = await processStoreWebhook(request, env);

  return new Response(outcome.body, {
    status: outcome.status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Nothing about a payment confirmation belongs in a cache, and Stripe does not read it.
      'cache-control': 'no-store',
    },
  });
}

async function processStoreWebhook(
  request: Request,
  env: StoreWebhookEnv,
): Promise<WebhookResponse> {
  const secret = env.STORE_STRIPE_WEBHOOK_SECRET?.trim();
  const key = env.STORE_WEBHOOK_KEY?.trim();

  // **Both missing secrets are 503, not 400.** This is the club's setup being unfinished, and
  // the payments arriving during it belong in Stripe's retry queue. A 400 would tell Stripe
  // the request was bad and to stop trying, and a real payment would be lost with no symptom.
  if (!secret) {
    console.error('Store webhook received with no STORE_STRIPE_WEBHOOK_SECRET bound');
    return { status: 503, body: 'not configured\n' };
  }

  if (!key) {
    console.error('Store webhook received with no STORE_WEBHOOK_KEY bound');
    return { status: 503, body: 'not configured\n' };
  }

  // **The raw bytes, before anything else touches them.** Nothing below may parse this string
  // until it has been proved.
  let raw: string;

  try {
    raw = await request.text();
  } catch {
    // Nothing about the body is logged, because the part that did arrive carries an address.
    console.error('Store webhook body could not be read');
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
    console.error('Store webhook payload verified but was not JSON');
    return { status: 400, body: 'not json\n' };
  }

  const eventType = readString(event.type) ?? 'unknown';
  const eventId = readString(event.id);
  const session = readSession(event.data?.object);

  // **A completed event does not universally mean paid.** For a delayed-notification method it
  // arrives with `payment_status: 'unpaid'` and is confirmed later by
  // `checkout.session.async_payment_succeeded`. Only cards are enabled, so this should never
  // fire — and if a future change enables anything else, **that event has to be handled before
  // the method is switched on**, or tickets will silently stop being confirmed. Answering 200
  // is right: the event is real and there is nothing to retry.
  if (eventType === 'checkout.session.completed' && session.paymentStatus !== 'paid') {
    console.warn(
      `Store webhook completed session was not paid — ${eventType} ${eventId ?? 'no-id'} ` +
        `payment_status=${session.paymentStatus ?? 'absent'}`,
    );
    return { status: 200, body: 'not paid\n' };
  }

  // Everything except a completed, paid session is acknowledged and ignored. An expiry needs
  // nothing done: `store.expire_pending_holds()` releases the tickets on its own schedule, and
  // acting on Stripe's expiry as well would be two mechanisms racing for one transition.
  if (eventType !== 'checkout.session.completed') {
    return { status: 200, body: 'ignored\n' };
  }

  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  const recorded = await recordTicketCheckoutEvent(client, {
    key,
    sessionId: session.id,
    paymentIntentId: session.paymentIntent,
    amountTotal: session.amountTotal,
    eventType,
  });

  if (!recorded.ok) {
    // **Nothing was written, and Stripe must try again** — this is the case where a 200 loses
    // a payment outright. The key not matching lands here too: it is the club's own
    // configuration, and a retry after somebody installs the digest is exactly what is wanted.
    console.error(`store.record_checkout_event unavailable — ${recorded.result}`);
    return { status: 503, body: 'retry unavailable\n' };
  }

  // **No recipient, no amount, no session id.** A delivery log line is a count and a code.
  console.warn(`store: ${eventType} ${eventId ?? 'no-id'} → ${recorded.result}`);

  if (recorded.result === 'no_such_session') {
    // **200, not 404.** The event is genuinely Stripe's and there is nothing here to match it
    // to — most likely a session created against another environment. Retrying cannot help.
    return { status: 200, body: 'no such session\n' };
  }

  return { status: 200, body: `${recorded.result}\n` };
}
