import { describe, expect, it } from 'vitest';

import { recordTicketCheckoutEvent } from '../../src/social-ticket';
import type { DbClient } from '../../src/supabase';

/**
 * How `recordTicketCheckoutEvent()` classifies what the database answered.
 *
 * **This is the half of the `bad_key` defect that lived in TypeScript.** The database returned
 * `(false, 'no_such_session')` for a session it could not find; this function tested `ok`
 * before it looked at `result`, so it reported `bad_key` — and `store-webhook.ts` turns that
 * into a 503 with a log line naming a credential. A volunteer reading it goes and re-checks a
 * digest that is correct. Found on 13 September 2026 against production, on the ticket
 * endpoint's own test event, hours after the endpoint was created.
 *
 * **Both sides of the seam are asserted here on purpose**, because the migration and the
 * deploy are not sequenced: a database either side of `20260913230000` must land in the same
 * branch, or a rollback reintroduces the defect silently.
 */

/** A client that answers one canned row, which is all this classifier reads. */
function clientAnswering(row: unknown): DbClient {
  return {
    schema: () => ({
      rpc: async () => ({ data: [row], error: null }),
    }),
  } as unknown as DbClient;
}

const input = {
  key: 'a-key',
  sessionId: 'cs_test_something',
  paymentIntentId: null,
  amountTotal: 1000,
  eventType: 'checkout.session.completed',
};

describe('an unrecognised session', () => {
  it('is a final answer from a database that has the fix', async () => {
    const outcome = await recordTicketCheckoutEvent(
      clientAnswering({ ok: true, result: 'no_such_session' }),
      input,
    );

    expect(outcome).toEqual({ ok: true, result: 'no_such_session' });
  });

  it('is a final answer from a database that does not, so a rollback is safe', async () => {
    // The shape `20260913230000` replaced. A Worker carrying this file may meet it either
    // because the migration has not landed yet or because the schema was rolled back.
    const outcome = await recordTicketCheckoutEvent(
      clientAnswering({ ok: false, result: 'no_such_session' }),
      input,
    );

    expect(outcome).toEqual({ ok: true, result: 'no_such_session' });
  });

  it('is never reported as a bad key, which is the whole point', async () => {
    for (const ok of [true, false]) {
      const outcome = await recordTicketCheckoutEvent(
        clientAnswering({ ok, result: 'no_such_session' }),
        input,
      );

      expect(outcome.result).not.toBe('bad_key');
    }
  });
});

describe('what `ok = false` is now reserved for', () => {
  it('reports a refused key as a refused key', async () => {
    const outcome = await recordTicketCheckoutEvent(
      clientAnswering({ ok: false, result: 'bad_key' }),
      input,
    );

    expect(outcome).toEqual({ ok: false, result: 'bad_key' });
  });

  it('treats a refusal it does not recognise as the credential case', async () => {
    // **Deliberately not `unavailable`.** `ok = false` has always meant "this caller may not
    // ask", and a 503 is the safe answer either way: Stripe retries, and a retry after somebody
    // installs the digest is exactly what is wanted.
    const outcome = await recordTicketCheckoutEvent(
      clientAnswering({ ok: false, result: 'some_future_refusal' }),
      input,
    );

    expect(outcome).toEqual({ ok: false, result: 'bad_key' });
  });
});

describe('the states that mean a payment was handled', () => {
  it.each(['paid', 'already_paid', 'already_refunded'])(
    'passes %s through',
    async (result) => {
      const outcome = await recordTicketCheckoutEvent(
        clientAnswering({ ok: true, result }),
        input,
      );

      expect(outcome).toEqual({ ok: true, result });
    },
  );

  it('retries an ok result it does not know, rather than dropping a payment', async () => {
    // A database ahead of this Worker. The alternative to retrying is answering 200 to
    // something that was never recorded, which loses a payment silently.
    const outcome = await recordTicketCheckoutEvent(
      clientAnswering({ ok: true, result: 'some_future_state' }),
      input,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.result).toBe('unavailable');
  });
});

describe('a verified event with no session id', () => {
  it('is answered without asking the database at all', async () => {
    const outcome = await recordTicketCheckoutEvent(
      clientAnswering({ ok: true, result: 'paid' }),
      { ...input, sessionId: null },
    );

    // There is nothing to look a purchase up by, so there is nothing to retry.
    expect(outcome).toEqual({ ok: true, result: 'no_such_session' });
  });
});
