import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createExecutionContext,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import worker from '../../../worker/index';
import { signStripePayload } from '../../../worker/stripe-signature';
import {
  FIXTURE_AMOUNT_PENCE,
  FIXTURE_EMAIL,
  FIXTURE_FIRST_NAME,
  LAPSED_PURCHASE_ID,
  LAPSED_SESSION_ID,
  PAID_PURCHASE_ID,
  PAID_SESSION_ID,
  PENDING_PURCHASE_ID,
  PENDING_SESSION_ID,
  SECOND_PURCHASE_ID,
  SECOND_SESSION_ID,
  UNKNOWN_SESSION_ID,
  WEBHOOK_KEY,
  WEBHOOK_SECRET,
} from '../../webhook-fixtures';

/**
 * `POST /nn/stripe-webhook` in the real Workers runtime, against the real build output.
 *
 * `tests/unit/stripe-signature.test.ts` proves the verifier and
 * `packages/db/tests/entries-webhook.test.ts` proves the transition. **Neither can prove that
 * any of it is wired up**: that depends on the route being matched before `env.ASSETS.fetch`
 * (the assets binding will not answer a POST at all), on the secrets being read off `env`, on
 * the raw body reaching the verifier unparsed, and on the outcome becoming the right HTTP
 * status for Stripe. A mistake in any of those leaves every other suite green and every
 * payment unconfirmed.
 *
 * **The status codes are the point of this file.** Getting one wrong is not a cosmetic bug: a
 * 400 where a 503 belongs tells Stripe to stop retrying a payment that has already been taken,
 * and the runner finds out rather than the club.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';
const ENDPOINT = `${SITE}/nn/stripe-webhook`;

/**
 * The opening tag carrying a marker, whole.
 *
 * **Matching `marker hidden` as adjacent text does not work and it is worth saying why.**
 * `HTMLRewriter.setAttribute` appends, so hiding `<div data-complete-confirming role="status">`
 * produces `... role="status" hidden="">` with the two ends apart; and `removeAttribute` leaves
 * the surrounding order alone, so a revealed block reads `data-complete="paid" role="status"`.
 * An adjacency regex therefore passes or fails on the order attributes happen to be written in
 * the Astro file, which is exactly the sort of test that goes green for the wrong reason the
 * day somebody reorders them.
 */
function tagFor(html: string, marker: string): string | null {
  const index = html.indexOf(marker);
  if (index === -1) {
    return null;
  }

  return html.slice(html.lastIndexOf('<', index), html.indexOf('>', index) + 1);
}

const isHidden = (tag: string | null): boolean => tag !== null && /\bhidden\b/.test(tag);

/** Which of the page's four blocks is actually showing. */
export function revealed(html: string): string {
  if (!isHidden(tagFor(html, 'data-complete-confirming'))) {
    return 'confirming';
  }

  for (const view of ['paid', 'no-record', 'refunded']) {
    if (!isHidden(tagFor(html, `data-complete="${view}"`))) {
      return view;
    }
  }

  return 'none-revealed';
}

const completePage = (session?: string): Promise<string> =>
  SELF.fetch(
    session === undefined
      ? `${SITE}/nn/2026/entry/complete/`
      : `${SITE}/nn/2026/entry/complete/?session=${encodeURIComponent(session)}`,
  ).then((response) => response.text());

/**
 * The database is out of reach from here — `pg` cannot run inside `workerd` — so what a test
 * asserts about the row is asserted through the **page** the person would see, which is the
 * only view of it this layer has. That is not a compromise: it is the same fact the runner
 * gets, which is the one that matters.
 */
const completionState = (session: string): Promise<string> =>
  completePage(session).then(revealed);

interface EventOptions {
  type?: string;
  sessionId?: string;
  reference?: string | null;
  amountTotal?: number | null;
  currency?: string;
  paymentStatus?: string;
  paymentIntent?: string | null;
  eventId?: string;
}

/**
 * A payload shaped like Stripe's, **pretty-printed the way Stripe actually sends it** — which
 * is what makes "the signature is verified over the raw bytes" a real assertion rather than one
 * that would pass either way.
 *
 * **It carries `customer_email`**, deliberately. The last describe in this file asserts that no
 * response body and no console line contains it, and a fixture without an address could not
 * prove the absence of one.
 */
function payload(options: EventOptions = {}): string {
  const {
    type = 'checkout.session.completed',
    sessionId = PENDING_SESSION_ID,
    reference = PENDING_PURCHASE_ID,
    amountTotal = FIXTURE_AMOUNT_PENCE,
    currency = 'gbp',
    paymentStatus = 'paid',
    paymentIntent = 'pi_test_worker_0001',
    eventId = 'evt_test_worker_0001',
  } = options;

  return JSON.stringify(
    {
      id: eventId,
      object: 'event',
      type,
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          client_reference_id: reference,
          amount_total: amountTotal,
          currency,
          payment_status: paymentStatus,
          payment_intent: paymentIntent,
          customer_email: FIXTURE_EMAIL,
          metadata: { purchase_id: reference, event_slug: 'nn-2026' },
        },
      },
    },
    null,
    2,
  );
}

/** Post a correctly-signed delivery, as Stripe would. */
async function deliver(
  options: EventOptions = {},
  { secret = WEBHOOK_SECRET, body = payload(options) } = {},
): Promise<Response> {
  const signature = await signStripePayload(body, secret, Math.floor(Date.now() / 1000));

  return SELF.fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  });
}

/** Post whatever, with whatever header. */
function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('a delivery this Worker cannot prove came from Stripe', () => {
  // **Every one of these is a 400 and changes nothing.** They are what an internet scanner
  // sends to a public endpoint, and they must cost a refusal rather than an exception.

  it('refuses a request with no signature header at all', async () => {
    const response = await post(payload());

    expect(response.status).toBe(400);
    expect(await completionState(PENDING_SESSION_ID)).toBe('confirming');
  });

  it('refuses a signature made with a different secret', async () => {
    const response = await deliver(
      {},
      { secret: 'whsec_A_DIFFERENT_SECRET_00000000000000' },
    );

    expect(response.status).toBe(400);
    expect(await completionState(PENDING_SESSION_ID)).toBe('confirming');
  });

  it('refuses a body altered after it was signed', async () => {
    // **The assertion that says the raw bytes are what is verified.** The signature is computed
    // over an honest payload and the body sent is a cheaper one.
    const honest = payload();
    const tampered = honest.replace(
      `"amount_total": ${FIXTURE_AMOUNT_PENCE}`,
      '"amount_total": 1',
    );
    expect(tampered).not.toBe(honest);

    const signature = await signStripePayload(
      honest,
      WEBHOOK_SECRET,
      Math.floor(Date.now() / 1000),
    );
    const response = await post(tampered, { 'stripe-signature': signature });

    expect(response.status).toBe(400);
    expect(await completionState(PENDING_SESSION_ID)).toBe('confirming');
  });

  it('refuses a malformed header', async () => {
    const response = await post(payload(), { 'stripe-signature': 'nonsense' });

    expect(response.status).toBe(400);
  });

  it('refuses a signature from outside the tolerance', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const body = payload();
    const signature = await signStripePayload(body, WEBHOOK_SECRET, stale);

    const response = await post(body, { 'stripe-signature': signature });

    expect(response.status).toBe(400);
    expect(await completionState(PENDING_SESSION_ID)).toBe('confirming');
  });
});

describe('the secrets not being set, which is a real deployed state', () => {
  // **Both are 5xx and never 4xx**, and this is the mapping that is easiest to get wrong. The
  // Stripe endpoint is created *after* the Worker is deployed, so there is a real window in
  // which deliveries arrive with nothing to check them against. A 400 would tell Stripe the
  // request was bad and to give up, and a payment that has already been taken would be lost.
  //
  // The bindings are mutated and restored, as `nn-entry-open.test.ts` does with the Stripe key
  // — a file's tests run in order and this is the only file in its run.

  afterEach(() => {
    (env as Record<string, unknown>).STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    (env as Record<string, unknown>).ENTRIES_WEBHOOK_KEY = WEBHOOK_KEY;
  });

  it('asks Stripe to retry when no signing secret is bound', async () => {
    delete (env as Record<string, unknown>).STRIPE_WEBHOOK_SECRET;

    const response = await deliver();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.status).toBeLessThan(600);
  });

  it('asks Stripe to retry when no database key is bound', async () => {
    delete (env as Record<string, unknown>).ENTRIES_WEBHOOK_KEY;

    const response = await deliver();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await completionState(PENDING_SESSION_ID)).toBe('confirming');
  });

  it('asks Stripe to retry when the key does not match the installed digest', async () => {
    // The rotation hazard: somebody set the Worker secret and not the digest. Every delivery
    // 5xxs and Stripe holds them for three days, which is what makes that survivable.
    (env as Record<string, unknown>).ENTRIES_WEBHOOK_KEY = 'not-the-key';

    const response = await deliver();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await completionState(PENDING_SESSION_ID)).toBe('confirming');
  });
});

describe('a verified completed event', () => {
  it('marks the purchase paid and answers 200', async () => {
    expect(await completionState(PENDING_SESSION_ID)).toBe('confirming');

    const response = await deliver();

    expect(response.status).toBe(200);
    expect(await completionState(PENDING_SESSION_ID)).toBe('paid');
  });

  it('changes nothing the second time and still answers 200', async () => {
    // **Stripe retries on any non-2xx and can duplicate regardless.** A second delivery that
    // answered anything but 200 would be retried forever; one that re-applied would be a
    // second confirmation for one payment.
    const first = await deliver({
      sessionId: SECOND_SESSION_ID,
      reference: SECOND_PURCHASE_ID,
      eventId: 'evt_test_worker_dup',
    });
    expect(first.status).toBe(200);
    expect(await completionState(SECOND_SESSION_ID)).toBe('paid');

    const second = await deliver({
      sessionId: SECOND_SESSION_ID,
      reference: SECOND_PURCHASE_ID,
      eventId: 'evt_test_worker_dup',
    });

    expect(second.status).toBe(200);
    expect(await completionState(SECOND_SESSION_ID)).toBe('paid');
  });
});

describe('events this endpoint should not act on', () => {
  // **Every one is a 200.** This Stripe account may also carry the club's England Athletics
  // portal payments, so events will arrive for sessions this code never created — and an error
  // would make Stripe retry forever on somebody else's money.

  it('answers 200 to an event whose client_reference_id names nothing of ours', async () => {
    const response = await deliver({
      sessionId: 'cs_test_somebody_else',
      reference: 'ea-portal-98765',
      eventId: 'evt_test_worker_other',
    });

    expect(response.status).toBe(200);
  });

  it('answers 200 to an event type it does not handle', async () => {
    const response = await deliver({
      type: 'payment_intent.succeeded',
      eventId: 'evt_test_worker_pi',
    });

    expect(response.status).toBe(200);
  });

  it('answers 200 and pays nothing when the amount disagrees', async () => {
    // **This should never fire.** If it ever does, something happened nobody anticipated, and
    // a retry would deliver the same wrong number forever — so 200 and a human.
    const response = await deliver({
      sessionId: LAPSED_SESSION_ID,
      reference: LAPSED_PURCHASE_ID,
      amountTotal: 1,
      eventId: 'evt_test_worker_amount',
    });

    expect(response.status).toBe(200);
    expect(await completionState(LAPSED_SESSION_ID)).toBe('no-record');
  });

  it('answers 200 and pays nothing when the session says it was not paid', async () => {
    // A delayed-notification method arrives `payment_status: 'unpaid'` and is confirmed later
    // by a different event. Only cards are enabled, so this should never fire — and if it ever
    // does, an entry must not be confirmed by it.
    const response = await deliver({
      sessionId: LAPSED_SESSION_ID,
      reference: LAPSED_PURCHASE_ID,
      paymentStatus: 'unpaid',
      eventId: 'evt_test_worker_unpaid',
    });

    expect(response.status).toBe(200);
    expect(await completionState(LAPSED_SESSION_ID)).toBe('no-record');
  });
});

describe('the endpoint itself', () => {
  it('is not a page, and a GET falls through to a 404', async () => {
    // Nothing in `dist/` sits at this address. It exists only as a POST handled before the
    // assets binding, which is what makes "no HTML, no rewriting, no redirect" true.
    const response = await SELF.fetch(ENDPOINT);

    expect(response.status).toBe(404);
  });

  it('answers with a tiny plain-text body and never HTML', async () => {
    const response = await deliver({
      sessionId: 'cs_test_body',
      reference: 'not-ours-at-all',
      eventId: 'evt_test_worker_body',
    });
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body.length).toBeLessThan(64);
    expect(body).not.toContain('<');
  });

  it('does not become a sign-up submission', async () => {
    // The webhook path is matched before `isNnSignupPath`, and the two cannot collide today.
    // This is what would notice if a future predicate widened one of them: a sign-up would
    // answer with a page, and a page is the one thing this endpoint must never return.
    const response = await deliver({
      sessionId: 'cs_test_route',
      reference: 'not-ours-at-all',
      eventId: 'evt_test_worker_route',
    });

    expect(response.headers.get('content-type')).not.toContain('text/html');
  });
});

describe('the page Stripe sends somebody back to', () => {
  it('says the club is confirming when there is no session in the URL', async () => {
    // Somebody who typed the bare address has asked nothing. "We have no record of your
    // payment" would be alarming and meaningless.
    const html = await completePage();

    expect(revealed(html)).toBe('confirming');
    expect(html).toContain('confirming your payment');
  });

  it('confirms a paid entry', async () => {
    expect(await completionState(PAID_SESSION_ID)).toBe('paid');
  });

  it('never claims nothing was charged for a lapsed hold', async () => {
    // **The sentence this whole slice exists to prevent.** Somebody pays, the webhook is slow,
    // their hold lapses, they refresh. If the page says nothing was charged they pay twice.
    const html = await completePage(LAPSED_SESSION_ID);

    expect(revealed(html)).toBe('no-record');
    expect(html).toContain('do not enter again');
    expect(html).not.toMatch(/[Nn]othing has been charged/);
  });

  it('reveals nothing about anybody for a made-up session id', async () => {
    const html = await completePage(UNKNOWN_SESSION_ID);

    expect(revealed(html)).toBe('no-record');
    expect(html).not.toContain(FIXTURE_EMAIL);
    expect(html).not.toContain(FIXTURE_FIRST_NAME);
    expect(html).not.toContain('Margaret Hamilton');
    expect(html).not.toContain(PENDING_PURCHASE_ID);
  });

  it('does not carry a meta refresh, which would fail WCAG 2.2.1', async () => {
    // A delayed refresh under twenty hours is an axe `meta-refresh` violation under `wcag2a`,
    // and zero violations is not a threshold here. `nn-entry-complete.spec.ts` runs axe; this
    // is the cheaper guard that fails the moment somebody adds one back.
    for (const session of [PAID_SESSION_ID, LAPSED_SESSION_ID, UNKNOWN_SESSION_ID]) {
      expect(await completePage(session)).not.toMatch(/http-equiv=["']?refresh/i);
    }
  });

  it('never puts a purchase id on the page, whatever the state', async () => {
    // The purchase id is `record_checkout_event`'s key. The read path and the write path are
    // keyed on different identifiers precisely so the first cannot hand anybody the second.
    for (const session of [PAID_SESSION_ID, PENDING_SESSION_ID, LAPSED_SESSION_ID]) {
      const html = await completePage(session);

      for (const id of [PAID_PURCHASE_ID, PENDING_PURCHASE_ID, LAPSED_PURCHASE_ID]) {
        expect(html).not.toContain(id);
      }
    }
  });
});

describe('what reaches a log, and what must never', () => {
  // **These rows carry a name, a date of birth and an emergency contact, and the payload
  // carries an email address.** An observability tool that was never assessed to hold those is
  // exactly where they must not end up, and the error paths are where a "log the whole request
  // to debug it" would go in.

  const lines: string[] = [];
  const spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(() => {
    lines.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) {
      spies.push(
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        }),
      );
    }
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

  it('logs nothing personal on any path through the handler', async () => {
    await post(payload());
    await post(payload(), { 'stripe-signature': 'nonsense' });
    await deliver({}, { secret: 'whsec_WRONG_000000000000000000000000000' });
    await deliver({
      sessionId: 'cs_test_log',
      reference: 'not-ours',
      eventId: 'evt_log_1',
    });
    await deliver({
      sessionId: LAPSED_SESSION_ID,
      reference: LAPSED_PURCHASE_ID,
      amountTotal: 3,
      eventId: 'evt_log_2',
    });
    await deliver({
      sessionId: PENDING_SESSION_ID,
      reference: PENDING_PURCHASE_ID,
      eventId: 'evt_log_3',
    });

    const everything = lines.join('\n');

    expect(everything).not.toContain(FIXTURE_EMAIL);
    expect(everything).not.toContain('@example.com');
    expect(everything).not.toContain(FIXTURE_FIRST_NAME);
    expect(everything).not.toContain('Margaret Hamilton');
    expect(everything).not.toContain('0117 496 0000');
    expect(everything).not.toContain('1986-12-09');
    // Neither secret, in either direction.
    expect(everything).not.toContain(WEBHOOK_SECRET);
    expect(everything).not.toContain(WEBHOOK_KEY);
    expect(everything).not.toContain('whsec_');
  });

  it('logs the mismatch with both numbers, because that is the whole report', async () => {
    await deliver({
      sessionId: LAPSED_SESSION_ID,
      reference: LAPSED_PURCHASE_ID,
      amountTotal: 42,
      eventId: 'evt_log_amount',
    });

    const everything = lines.join('\n');

    expect(everything).toContain('amount mismatch');
    expect(everything).toContain('42');
    expect(everything).toContain(String(FIXTURE_AMOUNT_PENCE));
    expect(everything).not.toContain(FIXTURE_EMAIL);
  });
});

describe('the five-minute sweep, which is the alarm channel', () => {
  it('runs and reports without saying anything about anybody', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      }),
    );

    try {
      const context = createExecutionContext();
      await worker.scheduled?.(
        // The controller's fields are unused by this handler.
        {} as ScheduledController,
        env as Parameters<NonNullable<typeof worker.scheduled>>[1],
        context,
      );
      await waitOnExecutionContext(context);
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }

    const everything = lines.join('\n');

    expect(everything).not.toContain(FIXTURE_EMAIL);
    expect(everything).not.toContain(FIXTURE_FIRST_NAME);

    // An earlier test in this file left an amount mismatch flagged, so the alarm has something
    // to say — and what it says must name the runbook, because a line nobody knows how to act
    // on is a line that gets scrolled past.
    if (everything.includes('need a human')) {
      expect(everything).toContain('entries-attention');
    }
  });
});

describe('the send is nudged rather than left for the cron - ADR-032', () => {
  /**
   * **`SELF.fetch` cannot see this and `worker.fetch` can.** The nudge is a call to
   * `ctx.waitUntil()`, which changes nothing about the response - so the only way to assert it
   * happened is to hand the handler a context of our own and watch what it does with one. That
   * is why these three call `worker.fetch` directly rather than going through `SELF` like
   * every other test in this file.
   *
   * A hand-made context rather than `createExecutionContext()`, because a spy is the whole
   * assertion. The drain promise is created eagerly either way, and with no `RESEND_API_KEY`
   * bound in this run `drainEmailOutbox()` returns before it claims anything at all - so
   * nothing is sent, nothing is claimed, and no fixture moves.
   */
  async function waitUntilCallsFor(request: Request): Promise<number> {
    const waitUntil = vi.fn();

    await worker.fetch?.(
      request,
      env as Parameters<NonNullable<typeof worker.fetch>>[1],
      { waitUntil, passThroughOnException: () => {} } as unknown as ExecutionContext,
    );

    return waitUntil.mock.calls.length;
  }

  it('nudges the outbox once a signed delivery has been handled', async () => {
    const body = payload({
      sessionId: 'cs_test_worker_nudge_0001',
      eventId: 'evt_test_worker_nudge_0001',
    });
    const signature = await signStripePayload(
      body,
      WEBHOOK_SECRET,
      Math.floor(Date.now() / 1000),
    );

    const calls = await waitUntilCallsFor(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        body,
      }),
    );

    expect(calls).toBe(1);
  });

  // **Unconditional, and deliberately so.** The nudge fires after the handler whatever the
  // handler decided, because "did that transition actually enqueue anything?" is a question
  // the outbox answers for itself in one query that comes back empty. A refused delivery costs
  // that query; getting the condition wrong would cost somebody their confirmation.
  it('nudges even when the delivery was refused, because the queue decides', async () => {
    const calls = await waitUntilCallsFor(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload(),
      }),
    );

    expect(calls).toBe(1);
  });

  it('does not nudge on a GET, which can never owe anybody a message', async () => {
    expect(await waitUntilCallsFor(new Request(SITE + '/nn/'))).toBe(0);
  });
});
