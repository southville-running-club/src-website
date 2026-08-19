import { describe, expect, it } from 'vitest';
import {
  fetchEntryCompletionState,
  recordCheckoutEvent,
  type CheckoutEventInput,
} from '../../src/entry-confirmation';
import { failingRpcClient, ok, pgError, rpcClient } from './support/rpc-client';

/**
 * The payment path's classification, on the replies a working database cannot produce.
 *
 * `packages/db/tests/entries-webhook.test.ts` proves `record_checkout_event()` against a real
 * Postgres, and `apps/main/tests/worker/webhook/` drives the endpoint through the real runtime
 * with a signed body. Nothing here repeats either.
 *
 * ## The one place in this repository where failure is inverted
 *
 * Everything else here fails towards taking no money. By the time this code runs **the money
 * has already gone** — so this Worker's own failures have to answer 5xx and let Stripe retry
 * for three days, and only "this is not Stripe" gets a 400. A 200 on an outage drops a real
 * payment on the floor. See ADR-010.
 *
 * That makes the distinction below the whole point of the module, and it is not obvious from
 * either side:
 *
 *   `recorded` with `ok: false`  — the database answered. The question was asked and settled.
 *   `unavailable`                — the question could **not** be asked. Nothing was written,
 *                                  and the caller owes Stripe a retry.
 *
 * A parse that quietly collapsed the second into the first would answer 200 to a payment
 * nobody recorded, and nothing downstream could tell.
 */

const KEY = 'zz-webhook-key-not-a-real-one';
const PURCHASE_ID = '44444444-4444-4444-8444-444444444444';

const INPUT: CheckoutEventInput = {
  key: KEY,
  eventType: 'checkout.session.completed',
  sessionId: 'cs_test_notreal',
  clientReferenceId: PURCHASE_ID,
  amountTotal: 1500,
  currency: 'gbp',
  paymentIntentId: 'pi_test_notreal',
  eventId: 'evt_test_notreal',
};

/** What the function answers when it applied a payment. */
const APPLIED = {
  ok: true,
  outcome: 'applied',
  applied: true,
  revived: false,
  over_capacity: false,
};

describe('recording one checkout event', () => {
  it('reports a payment it applied', async () => {
    const { client } = rpcClient(ok(APPLIED));

    await expect(recordCheckoutEvent(client, INPUT)).resolves.toEqual({
      status: 'recorded',
      result: {
        ok: true,
        outcome: 'applied',
        applied: true,
        revived: false,
        overCapacity: false,
      },
    });
  });

  it('omits an argument it does not have, rather than sending null', async () => {
    // **`exactOptionalPropertyTypes` and the function's own `default null`.** Stripe sends a
    // session with no `client_reference_id` for a payment this code never created — an ordinary
    // thing for this endpoint to receive. Sending an explicit null instead of omitting the
    // argument would be a different call to a function with defaults.
    const { client, calls } = rpcClient(ok({ ...APPLIED, outcome: 'not_ours' }));

    await recordCheckoutEvent(client, {
      ...INPUT,
      sessionId: null,
      clientReferenceId: null,
      amountTotal: null,
      currency: null,
      paymentIntentId: null,
      eventId: null,
    });

    expect(calls[0]?.args).toEqual({
      p_key: KEY,
      p_event_type: 'checkout.session.completed',
    });
  });

  it('sends every argument it does have', async () => {
    const { client, calls } = rpcClient(ok(APPLIED));
    await recordCheckoutEvent(client, INPUT);

    expect(calls[0]).toEqual({
      schema: 'entries',
      fn: 'record_checkout_event',
      args: {
        p_key: KEY,
        p_event_type: 'checkout.session.completed',
        p_session_id: 'cs_test_notreal',
        p_client_reference_id: PURCHASE_ID,
        p_amount_total: 1500,
        p_currency: 'gbp',
        p_payment_intent_id: 'pi_test_notreal',
        p_stripe_event_id: 'evt_test_notreal',
      },
    });
  });

  it('carries both numbers when Stripe and the purchase disagreed', async () => {
    // The only outcome that sets them, and they exist so the mismatch can be logged with both
    // figures — a purchase whose amount was tampered with is a thing somebody has to look at.
    const { client } = rpcClient(
      ok({
        ok: true,
        outcome: 'amount_mismatch',
        applied: false,
        revived: false,
        over_capacity: false,
        expected_pence: 1500,
        stripe_pence: 100,
      }),
    );

    const result = await recordCheckoutEvent(client, INPUT);

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.result.expectedPence).toBe(1500);
    expect(result.result.stripePence).toBe(100);
  });

  it('leaves both numbers off every other outcome', async () => {
    // Omitted rather than set to undefined. A log line that printed `expectedPence: undefined`
    // on every ordinary duplicate delivery would be noise on the one channel that matters.
    const { client } = rpcClient(ok(APPLIED));
    const result = await recordCheckoutEvent(client, INPUT);

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect('expectedPence' in result.result).toBe(false);
    expect('stripePence' in result.result).toBe(false);
  });

  it('reports a place taken when there was no room, rather than refusing it', async () => {
    // A payment that arrives after the hold lapsed is **still paid** and is never refused. It
    // consumes a place, it is flagged, and the cron shouts until a human clears it — because
    // the money has gone and refusing the record would not bring it back.
    const { client } = rpcClient(
      ok({
        ok: true,
        outcome: 'applied',
        applied: true,
        revived: true,
        over_capacity: true,
      }),
    );

    const result = await recordCheckoutEvent(client, INPUT);

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.result).toMatchObject({ revived: true, overCapacity: true });
  });

  it('degrades an outcome it has never heard of to unknown', async () => {
    // **`z.enum(...).catch('unknown')`, and no database that is behaving can reach it.** An
    // outcome added by a later migration reaching an older Worker has to become something the
    // caller can still turn into an HTTP status. `ok` is carried through untouched, so the
    // retry decision is still the database's.
    const { client } = rpcClient(
      ok({
        ok: true,
        outcome: 'partially_refunded',
        applied: false,
        revived: false,
        over_capacity: false,
      }),
    );

    const result = await recordCheckoutEvent(client, INPUT);

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.result.outcome).toBe('unknown');
    expect(result.result.ok).toBe(true);
  });

  it('reads three missing flags as false rather than refusing the answer', async () => {
    // `applied`, `revived` and `over_capacity` are each `.catch(false)`. The conservative
    // reading in every case: nothing changed, nothing was revived, nothing overflowed.
    const { client } = rpcClient(ok({ ok: true, outcome: 'already_paid' }));

    const result = await recordCheckoutEvent(client, INPUT);

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.result).toEqual({
      ok: true,
      outcome: 'already_paid',
      applied: false,
      revived: false,
      overCapacity: false,
    });
  });

  it('keeps a refusal as a recorded answer, not as an outage', async () => {
    // **The distinction this module exists for.** `ok: false` means the database answered and
    // said no — the key was refused. That is a settled question, and the caller may act on it.
    // It must not be reported as `unavailable`, which would make the caller ask Stripe to
    // retry something that will be refused identically for three days.
    const { client } = rpcClient(
      ok({
        ok: false,
        outcome: 'unauthorised',
        applied: false,
        revived: false,
        over_capacity: false,
      }),
    );

    const result = await recordCheckoutEvent(client, INPUT);

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.result.ok).toBe(false);
    expect(result.result.outcome).toBe('unauthorised');
  });

  it('reports a database that has not got the function yet as unavailable', async () => {
    // `PGRST202` is the migration not having landed — a deployment state, and the one the
    // caller must answer with a retry rather than a 200. The money has already gone.
    const { client } = rpcClient(pgError('PGRST202', 'Could not find the function'));

    await expect(recordCheckoutEvent(client, INPUT)).resolves.toEqual({
      status: 'unavailable',
      error: 'PGRST202: Could not find the function',
    });
  });

  it('reports an unparseable answer as unavailable rather than guessing', async () => {
    const { client } = rpcClient(ok('applied'));

    await expect(recordCheckoutEvent(client, INPUT)).resolves.toEqual({
      status: 'unavailable',
      error: 'record_checkout_event returned an unexpected shape',
    });
  });

  it('never throws, and never carries the payload into the error', async () => {
    // The payload this was built from carries an email address. A caught failure reports the
    // error's *name* and nothing else — and it comes back as a value, because an exception
    // here becomes a 500 that says nothing about whether a retry would help.
    const client = failingRpcClient(new TypeError('fetch failed: ines@example.com'));

    await expect(recordCheckoutEvent(client, INPUT)).resolves.toEqual({
      status: 'unavailable',
      error: 'TypeError',
    });
  });

  it('survives something thrown that is not an Error', async () => {
    const client = failingRpcClient({ nope: true });

    await expect(recordCheckoutEvent(client, INPUT)).resolves.toEqual({
      status: 'unavailable',
      error: 'unknown',
    });
  });
});

describe('what the return page is told', () => {
  it('reports a payment the webhook has recorded', async () => {
    const { client, calls } = rpcClient(ok({ state: 'paid' }));

    await expect(fetchEntryCompletionState(client, 'cs_test_notreal')).resolves.toEqual({
      ok: true,
      state: 'paid',
    });

    // No key. This one discloses a single word about one session id somebody already holds.
    expect(calls[0]).toEqual({
      schema: 'entries',
      fn: 'entry_completion_state',
      args: { p_session_id: 'cs_test_notreal' },
    });
  });

  it('reads every state the club can be in', async () => {
    for (const state of ['paid', 'pending', 'lapsed', 'refunded', 'unknown'] as const) {
      const { client } = rpcClient(ok({ state }));
      await expect(fetchEntryCompletionState(client, 'cs_test_notreal')).resolves.toEqual(
        {
          ok: true,
          state,
        },
      );
    }
  });

  it('degrades a state it has never heard of to unknown', async () => {
    // **`.catch('unknown')`, and it is the state that claims least.** A state added by a later
    // migration reaching an older Worker must render the page that says nothing, not a 500 at
    // somebody who has just paid.
    const { client } = rpcClient(ok({ state: 'transferred' }));

    await expect(fetchEntryCompletionState(client, 'cs_test_notreal')).resolves.toEqual({
      ok: true,
      state: 'unknown',
    });
  });

  it('degrades an answer with no state in it at all to unknown', async () => {
    // **Where `.catch()` sits changes what a missing key means, and it is worth being exact.**
    // It is on the enum rather than on the object, so a reply that is an object but carries no
    // `state` is caught the same way an unrecognised state is — the parse *succeeds*, at
    // `unknown`. Only a reply that is not an object at all fails the shape.
    //
    // That is the right way round for this page, and not obviously so: both readings claim
    // nothing, and the caller cannot tell them apart anyway. It is pinned here because moving
    // the `.catch()` up to the object would silently make this an error instead, and nothing
    // else in the suite would notice.
    const { client } = rpcClient(ok({ paid: true }));

    await expect(fetchEntryCompletionState(client, 'cs_test_notreal')).resolves.toEqual({
      ok: true,
      state: 'unknown',
    });
  });

  it('never answers paid when it could not ask', async () => {
    // **The invariant the whole page rests on**, and the one worth stating over every failure
    // rather than one at a time. A page that cannot reach the database must not tell somebody
    // they are entered — and it must equally never tell them nothing was charged, because the
    // webhook may simply be late and somebody who believes it pays twice.
    const clients = [
      rpcClient(pgError('PGRST202', 'Could not find the function')).client,
      rpcClient(pgError(null, 'connection refused')).client,
      rpcClient(ok({ paid: true })).client,
      rpcClient(ok(null)).client,
      rpcClient(ok('paid')).client,
      rpcClient(ok([{ state: 'paid' }])).client,
      failingRpcClient(new TypeError('fetch failed')),
      failingRpcClient('not an Error'),
    ];

    for (const client of clients) {
      const result = await fetchEntryCompletionState(client, 'cs_test_notreal');
      expect(result).not.toMatchObject({ ok: true, state: 'paid' });
    }
  });

  it('says which function disagreed, and how', async () => {
    // A reply that is not an object at all — a bare string where the envelope should be — is
    // the shape failure, and it is reported by name so a log line says which of the thirteen
    // functions disagreed.
    const { client } = rpcClient(ok('paid'));

    await expect(fetchEntryCompletionState(client, 'cs_test_notreal')).resolves.toEqual({
      ok: false,
      error: 'entry_completion_state returned an unexpected shape',
    });

    const { client: broken } = rpcClient(pgError(null, 'connection refused'));

    await expect(fetchEntryCompletionState(broken, 'cs_test_notreal')).resolves.toEqual({
      ok: false,
      error: 'unknown: connection refused',
    });
  });
});
