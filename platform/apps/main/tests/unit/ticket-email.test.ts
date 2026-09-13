import { describe, expect, it } from 'vitest';

import { ticketEmailBody, type TicketOutboxMessage } from '@src/shared';
import { formatSocialDate } from '../../worker/events';

const message: TicketOutboxMessage = {
  id: '11111111-2222-3333-4444-555555555555',
  template: 'ticket_confirmed',
  recipient: 'alex@example.com',
  attempts: 1,
  reference: 'CHRISTMASPARTY2026-0007-05092026',
  socialSlug: 'christmas-party-2026',
  socialName: 'SRC Christmas Party 2026',
  socialDate: '2026-12-05',
  venue: 'The Cock & Tail',
  startTime: '19:30:00',
  endTime: '01:00:00',
  amountPence: 2400,
  quantity: 2,
  purchaserName: 'Alex Example',
  replyTo: 'info@southvillerunningclub.co.uk',
};

describe('the confirmation', () => {
  it('names the occasion, the date, the count and the amount', () => {
    const email = ticketEmailBody(message);

    expect(email.subject).toBe('Your ticket to SRC Christmas Party 2026 is confirmed');
    expect(email.text).toContain('2 tickets');
    expect(email.text).toContain('Saturday 5 December 2026');
    expect(email.text).toContain('£24.00');
    expect(email.text).toContain('CHRISTMASPARTY2026-0007-05092026');
  });

  it('agrees with itself about singular and plural', () => {
    const one = ticketEmailBody({ ...message, quantity: 1, amountPence: 1200 });

    expect(one.text).toContain('1 ticket for');
    expect(one.text).toContain('is confirmed');
    expect(one.text).not.toContain('1 tickets');
  });

  it('says the date is still to come rather than rendering a null', () => {
    // ⚠️ **The branch that stops "your ticket to the SRC Christmas Party 2026 on null".** The
    // committee may not have confirmed a date by the time tickets go on sale, and somebody who
    // has just paid needs to be told that rather than shown a template fault.
    const email = ticketEmailBody({ ...message, socialDate: null });

    expect(email.text).not.toMatch(/null|undefined|NaN/u);
    expect(email.text).toContain(
      'We will confirm the date, time and venue nearer the time',
    );
  });

  it('asks for dietary requirements by reply, because they are not collected', () => {
    // The one thing the 2025 form asked for that this platform deliberately does not hold.
    // The ask has to be in the message, because the mailbox is where the answer now lives.
    expect(ticketEmailBody(message).text).toContain('dietary requirements');
  });
});

describe('the cancellation', () => {
  it('names the refund and says how long a bank takes', () => {
    const email = ticketEmailBody({ ...message, template: 'ticket_refunded' });

    expect(email.subject).toBe(
      'Your ticket to SRC Christmas Party 2026 has been cancelled',
    );
    expect(email.text).toContain('refunded £24.00');
    // Stripe reports a card refund as pending for days routinely, and that is the bank rather
    // than the club. Saying so is what stops the reply asking where the money is.
    expect(email.text).toContain('five to ten working days');
  });
});

describe('a template this Worker does not know', () => {
  it('throws rather than sending a blank message', () => {
    // The closed list on `store.email_outbox.template` is what makes this unreachable. It is
    // asserted so that widening that list without widening this one fails loudly — at the
    // expand/migrate/contract seam, where a Worker can legitimately be behind its database.
    expect(() => ticketEmailBody({ ...message, template: 'ticket_reminder' })).toThrow(
      /Unknown ticket email template/u,
    );
  });
});

describe('the two long-date formatters', () => {
  it('agree, so the page and the email can never say different days', () => {
    // **`ticket-outbox.ts` carries its own copy of this, and the duplication is deliberate**:
    // `packages/shared` may not import from `apps/main/worker`, and moving the Worker's copy
    // into shared would put page-rendering concerns in the shared package. This is the guard
    // that makes the pair safe — they cannot drift silently, which is the property that
    // actually matters.
    for (const date of [
      '2026-12-05',
      '2026-01-01',
      '2026-02-28',
      '2026-11-01',
      '2027-06-30',
      '2028-02-29',
    ]) {
      const fromEmail = ticketEmailBody({ ...message, socialDate: date }).text;

      expect(fromEmail).toContain(formatSocialDate(date));
    }
  });
});
