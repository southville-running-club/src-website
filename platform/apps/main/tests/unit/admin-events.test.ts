import { describe, expect, it } from 'vitest';

import { figures, statusWords, type TicketRow } from '../../worker/admin-events';

/**
 * The arithmetic and the wording on `/admin/events/`.
 *
 * **This layer carries more than it usually would**, because the acceptance layer cannot reach
 * that page: getting there needs a signed-in person holding `src-admin`, and every spec that
 * signs somebody up is blocked on this machine by an unset `SUPABASE_AUTH_CAPTCHA_SECRET`.
 * The permission gate itself is covered where it is enforced —
 * `packages/db/tests/store.test.ts` asserts that a signed-in person holding nothing gets no
 * rows and a `src-admin` gets the buyer.
 */

const row = (over: Partial<TicketRow>): TicketRow => ({
  ticket_no: 1,
  social_slug: 'christmas-party-2026',
  social_name: 'SRC Christmas Party 2026',
  purchaser_name: 'Alex Example',
  purchaser_email: 'alex@example.com',
  quantity: 1,
  amount_pence: 1000,
  status: 'paid',
  attention: null,
  created_at: '2026-09-06T12:00:00Z',
  paid_at: '2026-09-06T12:01:00Z',
  purchase_id: '11111111-2222-3333-4444-555555555555',
  ...over,
});

describe('the figures', () => {
  it('counts tickets and orders separately, because they are different numbers', () => {
    // The distinction the club actually needs: how many people are coming, and how many
    // payments to reconcile. A purchase of four is one order and four at the door.
    const totals = figures([
      row({ quantity: 4, amount_pence: 4000 }),
      row({ quantity: 1, amount_pence: 1000 }),
    ]);

    expect(totals).toMatchObject({ paidTickets: 5, paidOrders: 2, takenPence: 5000 });
  });

  it('counts only what was actually paid into the total taken', () => {
    // ⚠️ A held or abandoned checkout is not money. Counting one would overstate the takings
    // on the page a volunteer reconciles against Stripe.
    const totals = figures([
      row({ quantity: 2, amount_pence: 2000, status: 'paid' }),
      row({ quantity: 3, amount_pence: 3000, status: 'pending' }),
      row({ quantity: 1, amount_pence: 1000, status: 'expired' }),
      row({ quantity: 5, amount_pence: 5000, status: 'refunded' }),
    ]);

    expect(totals).toEqual({
      paidTickets: 2,
      paidOrders: 1,
      takenPence: 2000,
      // Held is its own number and is deliberately not added to the paid one: those tickets
      // are neither sold nor available, which is a state a volunteer needs to see as itself.
      heldTickets: 3,
    });
  });

  it('is all zeroes on an empty list rather than anything cleverer', () => {
    expect(figures([])).toEqual({
      paidTickets: 0,
      paidOrders: 0,
      takenPence: 0,
      heldTickets: 0,
    });
  });
});

describe('the status wording', () => {
  it('says what a volunteer needs rather than what the column says', () => {
    expect(statusWords('paid')).toBe('Paid');
    expect(statusWords('pending')).toBe('Not paid yet');
    expect(statusWords('expired')).toBe('Not completed');
    expect(statusWords('refunded')).toBe('Refunded');
  });

  it('never claims a lapsed hold was cancelled', () => {
    // The distinction `/account/entries/` pays for at length: a hold that lapsed is "not
    // completed", and a payment may still arrive. Calling it cancelled is a claim about a
    // record, and the runner may have been charged.
    expect(statusWords('expired')).not.toMatch(/cancel/iu);
  });

  it('shows a status it does not recognise rather than hiding the row', () => {
    // A database ahead of this Worker — the expand/migrate/contract seam. A row nobody can
    // read is better than a row nobody can see.
    expect(statusWords('part_refunded')).toBe('part_refunded');
  });
});
