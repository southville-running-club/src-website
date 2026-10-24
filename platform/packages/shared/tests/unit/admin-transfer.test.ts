import { describe, expect, it } from 'vitest';
import { TRANSFER_REASONS, transferEntry, type TransferTo } from '../../src/admin';

/**
 * What `transferEntry` makes of `entries.transfer_entry()`'s answer.
 *
 * ## Why this file exists
 *
 * **Every refusal used to come back as `not-found`, and the page rendered that as a 404.**
 * `transferEntry` went through `readCancelEnvelope`, which keeps `unauthorised` and folds
 * every other reason into one — so a volunteer who typed a new runner whose email address
 * already held a place was told _"Not found. There is nothing at this address."_ on the form
 * they had just filled in. The database was right throughout and its tests were green; the
 * reason was lost in this parse, which nothing exercised. These put the function's real
 * envelopes through the real reader.
 */

/** A stub of the one call `transferEntry` makes, so the envelope is the only variable. */
function clientAnswering(
  data: unknown,
  error: { code: string; message: string } | null = null,
): Parameters<typeof transferEntry>[0] {
  return {
    schema: () => ({
      rpc: () => Promise.resolve({ data, error }),
    }),
  } as unknown as Parameters<typeof transferEntry>[0];
}

const PURCHASE_ID = '0b0b0b0b-0000-4000-8000-000000000042';

const NEW_RUNNER: TransferTo = {
  email: 'rosalind@example.com',
  firstName: 'Rosalind',
  lastName: 'Nakamura',
  dateOfBirth: '1990-02-17',
  gender: 'female',
  club: null,
  emergencyContactName: 'Ada Okonkwo',
  emergencyContactPhone: '07700 900123',
  phone: '07700 900555',
};

describe('transferEntry', () => {
  it('reports the previous runner on success', async () => {
    const outcome = await transferEntry(
      clientAnswering({ ok: true, previous_runner: 'Petra Lindqvist' }),
      PURCHASE_ID,
      NEW_RUNNER,
    );

    expect(outcome).toEqual({ status: 'ok', previousRunner: 'Petra Lindqvist' });
  });

  it('falls back to words when the previous runner is not named', async () => {
    const outcome = await transferEntry(
      clientAnswering({ ok: true, previous_runner: null }),
      PURCHASE_ID,
      NEW_RUNNER,
    );

    expect(outcome).toEqual({ status: 'ok', previousRunner: 'the previous runner' });
  });

  /**
   * **Every reason the function can give, carried through as itself.** The list is the
   * function's own, read from its body in `20260831170000_entries_results_placement.sql`;
   * `unknown` is this module's, so it is the one the database never sends.
   */
  it.each(TRANSFER_REASONS.filter((reason) => reason !== 'unknown'))(
    'keeps the reason %s rather than folding it into not-found',
    async (reason) => {
      const outcome = await transferEntry(
        clientAnswering({ ok: false, reason }),
        PURCHASE_ID,
        NEW_RUNNER,
      );

      expect(outcome).toEqual({ status: 'refused', reason });
    },
  );

  it('reads a reason it has never heard of as unknown, not as an outage', async () => {
    const outcome = await transferEntry(
      clientAnswering({ ok: false, reason: 'a_rule_added_later' }),
      PURCHASE_ID,
      NEW_RUNNER,
    );

    expect(outcome).toEqual({ status: 'refused', reason: 'unknown' });
  });

  it('reads a refusal with no reason as unknown', async () => {
    const outcome = await transferEntry(
      clientAnswering({ ok: false }),
      PURCHASE_ID,
      NEW_RUNNER,
    );

    expect(outcome).toEqual({ status: 'refused', reason: 'unknown' });
  });

  it('names a missing function rather than calling it an outage', async () => {
    const outcome = await transferEntry(
      clientAnswering(null, { code: 'PGRST202', message: 'Could not find the function' }),
      PURCHASE_ID,
      NEW_RUNNER,
    );

    expect(outcome.status).toBe('unavailable');
    expect(outcome).toHaveProperty('cause', 'missing-function');
  });

  it('calls a shape it cannot read unavailable', async () => {
    const outcome = await transferEntry(
      clientAnswering('nonsense'),
      PURCHASE_ID,
      NEW_RUNNER,
    );

    expect(outcome).toEqual({
      status: 'unavailable',
      error: 'transfer_entry returned an unexpected shape',
    });
  });
});
