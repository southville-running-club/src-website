/**
 * Stripe Checkout, over `fetch`, with no SDK.
 *
 * ## Why no SDK
 *
 * This slice makes exactly one Stripe call — `POST /v1/checkout/sessions` — and reads two
 * fields off the answer. `stripe` the npm package is several hundred kilobytes, carries its
 * own HTTP client, and would have to be told to use `fetch` because a Worker has no
 * `node:http`. **The bundle grew by 0 bytes for this file**, and the measured figures either
 * side are in `apps/main/README.md`. Boring beats optimal, and here boring is also smaller.
 *
 * The cost is that the request is form-encoded by hand and the response is validated by
 * hand, which is what `checkoutSessionParams` and the narrow parse below are for. If a later
 * slice needs a dozen Stripe calls, that is the moment to revisit this — not this one.
 *
 * ## What must never leak
 *
 * Two things, and they are different kinds of secret:
 *
 *   * **The secret key.** It is a Worker secret, it is never in this repository, and it
 *     appears in exactly one place here: the `Authorization` header. It is never logged,
 *     never rendered, and never put in an error message.
 *   * **The request body.** It carries the purchaser's email address, because Checkout needs
 *     one. So the body is never logged either — not on success, and especially not on
 *     failure, which is where a "log the whole request to debug it" would go in.
 *
 * A failure is logged as its HTTP status and Stripe's own `type`, `code` and `param`, and
 * **never as Stripe's `message`**: an error message can quote the value that was rejected,
 * which is how an email address ends up in an observability tool that was never assessed to
 * hold one. That is the same rule `worker/nn-signup.ts` follows for Postgres error strings.
 *
 * ## The price is not here
 *
 * `price_data` is built from the amount `entries.create_pending_purchase()` computed. There
 * is deliberately **no Stripe Product and no Stripe Price object**: a price held in two
 * systems is a price that will disagree with itself, and the copy that is wrong will be the
 * one in the dashboard nobody opened. `entries.fees.price_pence` is the only definition, and
 * it is read inside the same transaction that held the place.
 */

/** What the Worker needs before it can take a payment at all. */
export interface StripeConfig {
  /**
   * `STRIPE_SECRET_KEY` — a **Worker secret**, set with `wrangler secret put`. Never in
   * `wrangler.jsonc`, never in a `vars` block, never in this repository.
   */
  secretKey: string;
  /**
   * Where the API is. `https://api.stripe.com` everywhere that matters.
   *
   * **Overridable only so that the local site and the acceptance suite can run end to end
   * without a Stripe account.** `npm run preview` points it at `scripts/stripe-stub.mjs`,
   * which answers one route with a canned session. It is passed on the `wrangler dev`
   * command line rather than living in `wrangler.jsonc`, so there is no path by which it
   * reaches a deployed Worker — `tests/unit/worker-config.test.ts` asserts that neither
   * config block mentions Stripe at all.
   */
  apiBase: string;
}

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_API_BASE?: string;
}

export const STRIPE_API_BASE = 'https://api.stripe.com';

/**
 * Whether this Worker can take a payment, and with what.
 *
 * **Null is a real answer and the deployed state today**: the secret has not been set, and a
 * Worker that cannot take a payment must say so rather than hold a place it can never
 * charge for. The caller checks this *before* creating a purchase, so nothing is written.
 */
export function stripeConfig(env: StripeEnv): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    return null;
  }

  return {
    secretKey,
    apiBase: (env.STRIPE_API_BASE?.trim() || STRIPE_API_BASE).replace(/\/+$/, ''),
  };
}

export interface CheckoutSessionInput {
  /** The purchase row's id. Becomes `client_reference_id` and one metadata key. */
  purchaseId: string;
  /** The slug of the event, so a Stripe dashboard row can be read without a join. */
  eventSlug: string;
  /** What to charge, in pence, exactly as the database computed it. */
  amountPence: number;
  /** What the line reads as on the hosted page — the event and the fee, in words. */
  description: string;
  /** So Checkout does not ask somebody to type an address they have just typed twice. */
  purchaserEmail: string;
  /** Where Stripe sends somebody who paid, and where it sends somebody who backed out. */
  successUrl: string;
  cancelUrl: string;
  /** When the session dies. Set to the held place's own expiry — see below. */
  expiresAt: Date;
}

/**
 * The Checkout session, as form-encoded parameters. **Pure, so it can be read in a test.**
 *
 * Split out from the call for the same reason `worker/routing.ts` is split out from the
 * fetch handler: what is sent to a payment processor is worth asserting field by field,
 * and asserting it through a network call would be asserting the network.
 */
export function checkoutSessionParams(input: CheckoutSessionInput): URLSearchParams {
  const params = new URLSearchParams();

  params.set('mode', 'payment');

  // **How Slice C's webhook finds the purchase**, and the reason the purchase has to exist
  // before the session does. It is a random uuid: it identifies a row and discloses nothing.
  params.set('client_reference_id', input.purchaseId);

  // Kept to two keys. Stripe metadata is readable by anyone with dashboard access and is
  // copied onto the payment intent, so it is not a place for personal data — the email below
  // is there because Checkout needs it to send a receipt, not because it is metadata.
  params.set('metadata[purchase_id]', input.purchaseId);
  params.set('metadata[event_slug]', input.eventSlug);

  params.set('customer_email', input.purchaserEmail);

  // **`price_data`, never a `price` id.** See the note at the head of this file.
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'gbp');
  params.set('line_items[0][price_data][unit_amount]', String(input.amountPence));
  params.set('line_items[0][price_data][product_data][name]', input.description);

  // **Adaptive pricing off, and this is a decision rather than a default.** It is *on* for
  // this account — confirmed against the test API — and what it does is present and charge a
  // converted amount to somebody paying from abroad. That is a second version of a price
  // this repository keeps in exactly one place, set by an exchange rate nobody here chose,
  // and it is the treasurer who would find the difference at reconciliation. Off means
  // everybody is charged the `entries.fees` row, in sterling.
  //
  // Reversible in this one line if the club decides it would rather take an entry in a
  // runner's own currency than quote one price. Flagged in apps/main/README.md.
  params.set('adaptive_pricing[enabled]', 'false');

  // **Aligned with `entries.entry_purchases.hold_expires_at`, to the second.** The hosted
  // page and the place it is holding then die together, instead of the session outliving the
  // hold — which is the direction that lets somebody pay for a number that has been given to
  // the next person.
  //
  // The hold is thirty-one minutes and not thirty because Stripe documents a floor of thirty
  // minutes here. **Measured against the test API, that floor is not currently enforced** —
  // twenty-nine minutes was accepted — but the club's only way of taking an entry is not the
  // place to depend on a documented limit going unenforced. If it were tightened, every
  // submission would fail at once. One extra minute of a held place is the cheaper side of
  // that trade by a wide margin.
  params.set('expires_at', String(Math.floor(input.expiresAt.getTime() / 1000)));

  params.set('success_url', input.successUrl);
  params.set('cancel_url', input.cancelUrl);

  return params;
}

/**
 * Where Stripe sends somebody afterwards.
 *
 * **`{CHECKOUT_SESSION_ID}` is Stripe's own template and has to survive verbatim**, so this
 * is built by concatenation rather than through `URLSearchParams` — which would percent-
 * encode the braces into something Stripe does not substitute. The trailing slash is
 * deliberate: Astro is `trailingSlash: 'always'`, so `/nn/entry/complete/` is the page's only
 * address and a return without the slash would be a redirect somebody pays for in latency at
 * the worst possible moment.
 */
export const ENTRY_COMPLETE_PATH = '/nn/entry/complete/';

export function entryCompleteUrl(origin: string): string {
  return `${origin}${ENTRY_COMPLETE_PATH}?session={CHECKOUT_SESSION_ID}`;
}

export type CheckoutSessionOutcome =
  { ok: true; sessionId: string; url: string } | { ok: false; error: string };

/**
 * Create the session, and hand back where to send somebody.
 *
 * **Never throws, and never returns a URL it did not get from Stripe.** A caller that gets
 * `ok: false` has a place held and nothing to charge against it; it should say so honestly
 * and let the hold lapse rather than invent a destination.
 */
export async function createCheckoutSession(
  config: StripeConfig,
  input: CheckoutSessionInput,
): Promise<CheckoutSessionOutcome> {
  let response: Response;

  try {
    response = await fetch(`${config.apiBase}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        // **The purchase id, so a retry cannot create a second session for one place.**
        // Somebody on bad signal pressing the button twice, or a Worker retried by the
        // platform, gets the same session back rather than a second hosted page against the
        // same held place. Stripe keeps an idempotency key for 24 hours, which comfortably
        // outlives a thirty-one minute hold.
        'idempotency-key': `purchase:${input.purchaseId}`,
      },
      body: checkoutSessionParams(input).toString(),
      // A hung subrequest holds the whole response open while somebody stares at a spinner.
      // Ten seconds is long for an API call and short for a person who has just pressed a
      // button; past it, an honest failure with their input preserved is the better answer.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    // The name only. A fetch failure cannot carry personal data, but the body it was sending
    // can, and `cause.message` on some runtimes quotes the request.
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }

  // Read once, whatever the status: Stripe answers errors as JSON too, and the fields worth
  // reporting are on that object.
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, error: `${response.status} ${describeStripeError(body)}` };
  }

  const session = body as { id?: unknown; url?: unknown } | null;

  if (typeof session?.id !== 'string' || typeof session.url !== 'string') {
    // A 200 with no `url` is not something to paper over. It would mean sending somebody to
    // `undefined` with a place held against their name.
    return { ok: false, error: 'checkout session had no id or url' };
  }

  return { ok: true, sessionId: session.id, url: session.url };
}

/**
 * Stripe's own classification of a failure, and **not its message**.
 *
 * `error.message` is written for a developer and quotes what was rejected — including, for a
 * bad address, the address. `type`, `code` and `param` say what went wrong without saying
 * what it went wrong *on*, which is exactly the line this repository draws for Postgres
 * error strings as well.
 */
export function describeStripeError(body: unknown): string {
  const error = (body as { error?: Record<string, unknown> } | null)?.error;

  if (!error) {
    return 'no error object';
  }

  const parts = ['type', 'code', 'param']
    .map((key) => (typeof error[key] === 'string' ? `${key}=${error[key]}` : null))
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' ') : 'unclassified';
}
