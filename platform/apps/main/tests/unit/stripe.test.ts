import { describe, expect, it } from 'vitest';
import {
  checkoutSessionParams,
  describeStripeError,
  entryCompleteUrl,
  stripeConfig,
  STRIPE_API_BASE,
  type CheckoutSessionInput,
} from '../../worker/stripe';
import { nnEntryCompletePath } from '../../worker/routing';

/**
 * What is actually sent to a payment processor, asserted field by field with no network in
 * the way.
 *
 * `worker/routing.ts` is split out from the fetch handler for the same reason: the decision
 * is worth reading on its own, and asserting it through a request would be asserting the
 * request. The integration — that this really is what leaves the Worker, and that the Worker
 * really does 303 to whatever comes back — is `tests/worker/entries-open/` and
 * `tests/e2e/nn-entry.spec.ts`.
 */

const INPUT: CheckoutSessionInput = {
  purchaseId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  eventSlug: 'nn-2026',
  amountPence: 1700,
  description: 'Nightingale Nightmare 2026 — Unaffiliated entry',
  purchaserEmail: 'grace@example.com',
  successUrl:
    'https://new.southvillerunningclub.co.uk/nn/2026/entry/complete/?session={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://new.southvillerunningclub.co.uk/nn/2026/',
  // 12:00:00 UTC on a fixed day. Deterministic and invented, like every fixture here.
  expiresAt: new Date('2026-09-01T12:00:00.000Z'),
};

const params = (overrides: Partial<CheckoutSessionInput> = {}) =>
  checkoutSessionParams({ ...INPUT, ...overrides });

describe('what the Checkout session is built from', () => {
  it('charges exactly the amount it was given, in pence, in sterling', () => {
    // **The amount comes from `entries.create_pending_purchase()`, which read
    // `entries.fees.price_pence` inside the transaction that held the place.** Nothing on the
    // way here may round it, re-derive it, or convert it — a payment is the one number that
    // has to survive untouched.
    const built = params();

    expect(built.get('line_items[0][price_data][unit_amount]')).toBe('1700');
    expect(built.get('line_items[0][price_data][currency]')).toBe('gbp');
    expect(built.get('line_items[0][quantity]')).toBe('1');
    expect(built.get('mode')).toBe('payment');
  });

  it('carries a discounted amount through unchanged as well', () => {
    // 10% off an unaffiliated entry is the 2023 Long Ashton code, and the arithmetic that
    // produced 1530 is the database's. This asserts only that nothing here second-guesses it.
    expect(
      params({ amountPence: 1530 }).get('line_items[0][price_data][unit_amount]'),
    ).toBe('1530');
  });

  it('names no Stripe Product and no Stripe Price', () => {
    // **The price lives in `entries.fees` and nowhere else.** A Stripe Price object is a
    // second copy of a number, and the copy that is wrong will be the one in the dashboard
    // nobody opened. `price_data` is how a session is created without one.
    const built = params();

    expect(built.get('line_items[0][price]')).toBeNull();
    expect(built.get('line_items[0][price_data][product]')).toBeNull();
    expect(built.get('line_items[0][price_data][product_data][name]')).toBe(
      'Nightingale Nightmare 2026 — Unaffiliated entry',
    );
  });

  it('turns adaptive pricing off, so everybody is charged the row', () => {
    // **On by default for this account**, confirmed against the test API. Left on, it
    // presents and charges a converted amount to somebody paying from abroad — a second
    // version of a price this repository keeps in exactly one place, at a rate nobody here
    // chose, and a difference the treasurer would meet at reconciliation.
    expect(params().get('adaptive_pricing[enabled]')).toBe('false');
  });

  it('carries the purchase id as the reference the webhook will match on', () => {
    const built = params();

    expect(built.get('client_reference_id')).toBe(INPUT.purchaseId);
    expect(built.get('metadata[purchase_id]')).toBe(INPUT.purchaseId);
    expect(built.get('metadata[event_slug]')).toBe('nn-2026');
  });

  it('puts nothing in metadata beyond those two keys', () => {
    // Stripe metadata is readable by anybody with dashboard access and is copied onto the
    // payment intent. A name, a date of birth or an emergency contact reaching it would be
    // personal data in a third-party system nobody assessed for it.
    const metadataKeys = [...params().keys()].filter((key) =>
      key.startsWith('metadata['),
    );

    expect(metadataKeys.sort()).toEqual([
      'metadata[event_slug]',
      'metadata[purchase_id]',
    ]);
  });

  it('sends the email address and nothing else about the person', () => {
    const built = params().toString();

    expect(params().get('customer_email')).toBe('grace@example.com');
    // The purchaser's name is on the purchase row and has no business on a payment page that
    // does not need it to take a card.
    expect(built).not.toContain('Hopper');
    expect(built).not.toContain('date_of_birth');
  });

  it('expires the session at the moment the held place expires', () => {
    // **Seconds since the epoch, and the same instant as `hold_expires_at`.** The hosted page
    // and the place it is holding then die together. A session that outlived its hold would
    // let somebody pay for a number that had already gone back into the pool, which is the
    // one failure mode this alignment exists to prevent.
    expect(params().get('expires_at')).toBe('1788264000');
    expect(Number(params().get('expires_at')) * 1000).toBe(INPUT.expiresAt.getTime());
  });

  it('rounds a fractional second down rather than up', () => {
    // Rounding up would put the session a whole second past the hold. Down is the safe
    // direction and `Math.floor` is what does it.
    const built = params({ expiresAt: new Date('2026-09-01T12:00:00.999Z') });

    expect(built.get('expires_at')).toBe('1788264000');
  });

  it('returns somebody to the honest page afterwards, and to the form if they backed out', () => {
    const built = params();

    expect(built.get('success_url')).toBe(INPUT.successUrl);
    expect(built.get('cancel_url')).toBe(
      'https://new.southvillerunningclub.co.uk/nn/2026/',
    );
  });
});

describe('where Stripe sends somebody back to', () => {
  it('keeps Stripe’s own template literal intact', () => {
    // **`{CHECKOUT_SESSION_ID}` is substituted by Stripe and has to survive verbatim.**
    // Building this through `URLSearchParams` would percent-encode the braces into something
    // Stripe does not recognise, and the failure would be a return URL with a literal
    // `%7BCHECKOUT_SESSION_ID%7D` in it that nobody notices until somebody has paid.
    expect(
      entryCompleteUrl(
        'https://new.southvillerunningclub.co.uk',
        nnEntryCompletePath('/nn/2026/'),
      ),
    ).toBe(
      'https://new.southvillerunningclub.co.uk/nn/2026/entry/complete/?session={CHECKOUT_SESSION_ID}',
    );
  });

  it('returns somebody to the running they entered, not to a fixed address', () => {
    // **The return page moved under the year with everything else about one running**, so
    // this path is passed in rather than held in `stripe.ts`. A session created for 2027 that
    // returned to 2026's page would be a payment confirmation for the wrong race, reported to
    // the person who made it.
    expect(
      entryCompleteUrl('https://example.com', nnEntryCompletePath('/nn/2027/')),
    ).toContain('/nn/2027/entry/complete/?');
  });

  it('keeps the trailing slash Astro insists on', () => {
    // `trailingSlash: 'always'`, so there is exactly one address for the page. Without the
    // slash the return is a redirect somebody pays for in latency at the worst moment.
    expect(
      entryCompleteUrl('https://example.com', nnEntryCompletePath('/nn/2026/')),
    ).toContain('/entry/complete/?');
  });
});

describe('whether this Worker can take a payment at all', () => {
  it('says no when there is no secret, which is the deployed state today', () => {
    // **Null is a real answer.** The caller checks it *before* holding a place, so a Worker
    // with no key stores nothing rather than holding a number it can never charge for.
    expect(stripeConfig({})).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: '' })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: '   ' })).toBeNull();
  });

  it('defaults to the real Stripe when nothing overrides it', () => {
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_x' })?.apiBase).toBe(
      STRIPE_API_BASE,
    );
    expect(STRIPE_API_BASE).toBe('https://api.stripe.com');
  });

  it('takes an override, and does not leave a trailing slash on it', () => {
    // The override exists so the local site and the acceptance suite run end to end without a
    // Stripe account. A trailing slash would produce `//v1/checkout/sessions`, which some
    // servers answer and some do not — worth normalising once rather than debugging later.
    const config = stripeConfig({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_API_BASE: 'http://127.0.0.1:8789/',
    });

    expect(config?.apiBase).toBe('http://127.0.0.1:8789');
  });
});

describe('what a Stripe failure is allowed to say', () => {
  it('reports the classification and never the message', () => {
    // **`error.message` quotes what was rejected**, which for a bad address is the address.
    // `type`, `code` and `param` say what went wrong without saying what it went wrong on —
    // the same line this repository draws for Postgres error strings.
    const described = describeStripeError({
      error: {
        type: 'invalid_request_error',
        code: 'email_invalid',
        param: 'customer_email',
        message: 'Invalid email address: grace@example.com',
      },
    });

    expect(described).toBe(
      'type=invalid_request_error code=email_invalid param=customer_email',
    );
    expect(described).not.toContain('grace@example.com');
  });

  it('says something useful when Stripe answered with nothing recognisable', () => {
    expect(describeStripeError(null)).toBe('no error object');
    expect(describeStripeError({ error: {} })).toBe('unclassified');
  });
});
