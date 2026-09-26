import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import {
  QUANTITY_OPTIONS,
  formatSocialDate,
  formatSocialTime,
  formatSocialTimes,
  parseSocialTicket,
  quantityOptionLabel,
  refusalMessage,
  notOnSaleWords,
  socialDateTileParts,
} from '../../worker/events';
import {
  TICKET_PURCHASE_REASONS,
  ticketSaleState,
  ticketsAreOnSale,
  type SocialState,
} from '@src/shared';

/** A social with a price and an open window, so the parser has rules to apply. */
const social: SocialState = {
  slug: 'christmas-party-2026',
  displayName: 'SRC Christmas Party 2026',
  socialDate: '2026-12-05',
  startTime: '19:30:00',
  endTime: '01:00:00',
  venue: 'The Example Rooms',
  minimumAge: 18,
  state: 'open',
  maxTicketsPerPurchase: 6,
  requiredConsents: [],
  consentVersion: 'test-v1',
  capacity: null,
  ticketsRemaining: null,
  ticketTypes: [{ code: 'standard', label: 'Standard ticket', pricePence: 1200 }],
};

const order = {
  purchaserName: 'Alex Example',
  email: 'alex@example.com',
  emailConfirm: 'alex@example.com',
  quantity: '2',
  ticketCode: 'standard',
};

describe('whether tickets are on sale', () => {
  it('sells when the window is open and there is room', () => {
    expect(ticketSaleState(social)).toBe('on_sale');
    expect(ticketsAreOnSale(social)).toBe(true);
  });

  it('sells when there is no capacity at all, because null is no limit', () => {
    // **The case that must not be broken by the sold-out check.** A null `ticketsRemaining`
    // means unlimited; reading it as zero would close a page that was never going to fill.
    expect(ticketSaleState({ ...social, capacity: null, ticketsRemaining: null })).toBe(
      'on_sale',
    );
  });

  it('sells down to the last ticket', () => {
    expect(ticketSaleState({ ...social, capacity: 100, ticketsRemaining: 1 })).toBe(
      'on_sale',
    );
  });

  it('is sold out at nought remaining, not merely refused at the till', () => {
    // Before 14 September 2026 this answered `on_sale`: the page offered a form, somebody
    // filled it in, and only then did the database refuse them.
    const full = { ...social, capacity: 100, ticketsRemaining: 0 };

    expect(ticketSaleState(full)).toBe('sold_out');
    expect(ticketsAreOnSale(full)).toBe(false);
  });

  it('says closed rather than sold out when both are true', () => {
    // Both statements are true and only one sentence can be shown. "Sales have closed" is the
    // one that is still true tomorrow.
    expect(
      ticketSaleState({
        ...social,
        state: 'closed',
        capacity: 100,
        ticketsRemaining: 0,
      }),
    ).toBe('closed');
  });

  it('is pre-open when nobody has confirmed a price', () => {
    // Not `closed`: the club has not finished getting ready, which is what the words say.
    expect(ticketSaleState({ ...social, ticketTypes: [] })).toBe('pre_open');
  });
});

describe('what the page says when it is not selling', () => {
  it('gives each state its own sentence', () => {
    expect(notOnSaleWords('pre_open')).toContain('not on sale yet');
    expect(notOnSaleWords('sold_out')).toContain('Sold out');
    expect(notOnSaleWords('closed')).toContain('closed');
    expect(notOnSaleWords('on_sale')).toBe(null);
  });

  it('never tells somebody to keep watching a page that has finished selling', () => {
    // The defect this replaced: one hardcoded sentence for all three states, which told
    // people to wait for something that had already happened.
    for (const state of ['sold_out', 'closed'] as const) {
      expect(notOnSaleWords(state)).not.toContain('not on sale yet');
      expect(notOnSaleWords(state)).not.toContain('Keep an eye');
    }
  });

  it('promises nothing the club has not built', () => {
    // There is no waiting list and no way to hand a ticket back — `store` has no refund path
    // — so neither sentence may imply one.
    for (const state of ['sold_out', 'closed'] as const) {
      const words = notOnSaleWords(state) ?? '';

      expect(words).not.toMatch(/waiting list|we will let you know|get in touch and we/i);
    }
  });
});

describe('formatSocialDate', () => {
  it('renders the club’s own long form', () => {
    expect(formatSocialDate('2026-12-05')).toBe('Saturday 5 December 2026');
  });

  it('does not shift the day for a reader in another timezone', () => {
    // **The value is a civil date, not an instant.** Parsing it through a local `Date` is how
    // a party on the 5th becomes a party on the 4th for anybody east of London — the exact
    // foot-gun `london-time.ts` exists for, met here in the other direction.
    const original = process.env.TZ;

    try {
      process.env.TZ = 'Pacific/Auckland';
      expect(formatSocialDate('2026-12-05')).toBe('Saturday 5 December 2026');
      process.env.TZ = 'America/Los_Angeles';
      expect(formatSocialDate('2026-12-05')).toBe('Saturday 5 December 2026');
    } finally {
      process.env.TZ = original;
    }
  });

  it('answers null for a date nobody has confirmed', () => {
    // Null in, null out — the page keeps its "To be confirmed" line rather than rendering a
    // blank cell or, far worse, last year's answer.
    expect(formatSocialDate(null)).toBeNull();
    expect(formatSocialDate('')).toBeNull();
    expect(formatSocialDate('not-a-date')).toBeNull();
    expect(formatSocialDate('2026-13-05')).toBeNull();
  });
});

describe('formatSocialTime', () => {
  it('uses the club’s own register, from the 2025 party page', () => {
    // `7:30pm-1am`, lower case, no space before the meridiem.
    expect(formatSocialTime('19:30:00')).toBe('7:30pm');
    expect(formatSocialTime('01:00:00')).toBe('1am');
    expect(formatSocialTime('12:00:00')).toBe('12pm');
    expect(formatSocialTime('00:00:00')).toBe('12am');
  });

  it('renders a range with an en dash, and copes with a missing end', () => {
    expect(formatSocialTimes('19:30:00', '01:00:00')).toBe('7:30pm–1am');
    expect(formatSocialTimes('19:30:00', null)).toBe('7:30pm');
    expect(formatSocialTimes(null, '01:00:00')).toBeNull();
  });
});

describe('quantityOptionLabel', () => {
  it('carries the total for that quantity, formatted once by formatPence', () => {
    expect(quantityOptionLabel(1, 1200)).toBe('1 ticket — £12.00');
    expect(quantityOptionLabel(3, 1200)).toBe('3 tickets — £36.00');
  });

  it('writes exactly one £, and never beside another', () => {
    // ⚠️ A template that adds its own `£` next to `formatPence()` renders `££18.00`. This
    // repository carried that pattern six times over (issue #175, all closed); the guard is here
    // so a seventh cannot arrive in this file unnoticed.
    const label = quantityOptionLabel(2, 1200);
    expect(label.match(/£/gu)).toHaveLength(1);
  });
});

describe('refusalMessage', () => {
  it('maps every reason the database can give', () => {
    // **An unmapped reason renders as nothing at all**, which is the failure mode a bare
    // `if (!ok)` invites and the whole argument for the reason list being closed.
    for (const reason of [...TICKET_PURCHASE_REASONS, 'unavailable' as const]) {
      expect(refusalMessage(reason).length).toBeGreaterThan(10);
    }
  });

  it('gives the three deployment faults one wording, and never names which', () => {
    // A missing key, a misconfigured price and an unreachable database are all "the club
    // cannot sell you this right now" to the person reading. Distinguishing them on the page
    // would disclose which of the club's own pieces is missing.
    const shared = refusalMessage('unavailable');
    expect(refusalMessage('bad_key')).toBe(shared);
    expect(refusalMessage('free_place')).toBe(shared);
    expect(shared).not.toMatch(/key|stripe|database/iu);
  });
});

describe('parseSocialTicket', () => {
  it('accepts a good order', () => {
    const result = parseSocialTicket(order, social);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toMatchObject({
      purchaserName: 'Alex Example',
      email: 'alex@example.com',
      quantity: 2,
      ticketCode: 'standard',
    });
  });

  it('returns every problem at once rather than one at a time', () => {
    // This form is short, but the principle is the entry form's: a submission that comes back
    // with one error at a time is a submission somebody abandons.
    const result = parseSocialTicket(
      {
        purchaserName: '',
        email: 'nope',
        emailConfirm: '',
        quantity: '',
        ticketCode: '',
      },
      social,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && Object.keys(result.errors).sort()).toEqual([
      'email',
      'emailConfirm',
      'purchaserName',
      'quantity',
      'ticketCode',
    ]);
  });

  it('refuses a name with no letter in it', () => {
    // `'...'` passes a length check and is not a name. This is what goes on the door list.
    const result = parseSocialTicket({ ...order, purchaserName: '...' }, social);

    expect(result.ok === false && result.errors.purchaserName).toMatch(
      /ticket should be in/u,
    );
  });

  it('compares the two addresses case-insensitively', () => {
    // The column is `citext`. Telling somebody their two identical addresses do not match
    // because one has a capital letter is a needless refusal at the moment they are paying.
    const result = parseSocialTicket(
      { ...order, email: 'Alex@Example.com', emailConfirm: 'alex@example.com' },
      social,
    );

    expect(result.ok).toBe(true);
  });

  it('catches a genuine typo in the second address', () => {
    const result = parseSocialTicket(
      { ...order, emailConfirm: 'alex@exmaple.com' },
      social,
    );

    expect(result.ok === false && result.errors.emailConfirm).toMatch(/do not match/u);
  });

  it('applies the occasion’s own cap rather than a constant, and says what it is', () => {
    const result = parseSocialTicket({ ...order, quantity: '7' }, social);

    expect(result.ok === false && result.errors.quantity).toBe(
      'You can buy at most 6 tickets in one go.',
    );

    // A different occasion, a different answer — which is what makes a second social a row.
    const smaller = parseSocialTicket(
      { ...order, quantity: '3' },
      { ...social, maxTicketsPerPurchase: 2 },
    );

    expect(smaller.ok === false && smaller.errors.quantity).toBe(
      'You can buy at most 2 tickets in one go.',
    );
  });

  it('refuses a ticket type the occasion does not offer', () => {
    const result = parseSocialTicket({ ...order, ticketCode: 'concession' }, social);

    expect(result.ok === false && result.errors.ticketCode).toMatch(
      /one of the ticket types/u,
    );
  });

  it('asks for no consent when the occasion declares none, which is what ships', () => {
    expect(parseSocialTicket(order, social).ok).toBe(true);
  });

  it('requires each consent the occasion does declare', () => {
    const withTerms = { ...social, requiredConsents: ['terms'] };

    expect(parseSocialTicket(order, withTerms).ok).toBe(false);
    expect(parseSocialTicket({ ...order, consent_terms: 'on' }, withTerms).ok).toBe(true);
  });

  it('never collects a dietary requirement, however one is posted', () => {
    // ⚠️ **The decision, asserted.** An allergy is health data and a religious diet reveals
    // belief; both are Article 9 and neither may reach this database without a committee
    // decision, a retention period and items on two privacy notices. The confirmation email
    // asks by reply instead. See ADR-033.
    const result = parseSocialTicket(
      { ...order, dietary: 'coeliac', dietaryRequirements: 'no nuts' },
      social,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && JSON.stringify(result.value)).not.toMatch(/coeliac|nuts/u);
  });

  it('refuses a body that is not an object at all', () => {
    const result = parseSocialTicket('not a form', social);

    expect(result.ok).toBe(false);
  });
});

describe('the quantity picker', () => {
  it('ships one option per quantity the database would actually accept', () => {
    // **The markup ships the options and the Worker prunes them**, because there is
    // deliberately no `setInnerContent(..., { html: true })` anywhere in this repository to
    // audit — the fee cards and the previous-years pills work the same way.
    //
    // That makes the shipped count load-bearing: ship fewer than
    // `store.socials.max_tickets_per_purchase` permits and an occasion the database would
    // have allowed is silently capped, which nobody notices until somebody cannot buy the
    // seventh ticket. Read out of the migration rather than written twice.
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          '../../../../packages/db/supabase/migrations/20260905100000_create_store_schema.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );

    const bound = /max_tickets_per_purchase between 1 and (\d+)/u.exec(migration);

    expect(bound, 'the check constraint is still spelled this way').not.toBeNull();
    expect(QUANTITY_OPTIONS).toBe(Number(bound![1]));
  });

  it('offers no more than are left when the occasion has a capacity', () => {
    // Not a rendering test — the arithmetic the renderer does. `ticketsRemaining` is null when
    // there is no capacity, in which case the per-purchase cap is the only limit.
    const offered = (
      state: Pick<SocialState, 'maxTicketsPerPurchase' | 'ticketsRemaining'>,
    ) =>
      Math.max(
        1,
        Math.min(
          state.maxTicketsPerPurchase,
          state.ticketsRemaining ?? state.maxTicketsPerPurchase,
        ),
      );

    expect(offered({ maxTicketsPerPurchase: 6, ticketsRemaining: null })).toBe(6);
    expect(offered({ maxTicketsPerPurchase: 6, ticketsRemaining: 2 })).toBe(2);
    expect(offered({ maxTicketsPerPurchase: 6, ticketsRemaining: 99 })).toBe(6);
    // Never zero: a sold-out occasion is refused by the database with `sold_out`, and a picker
    // with no options at all is a form nobody can submit and nobody can understand.
    expect(offered({ maxTicketsPerPurchase: 6, ticketsRemaining: 0 })).toBe(1);
  });
});

/**
 * The date tile on `/events/`, and the failure direction that keeps the page honest.
 *
 * ⚠️ **The row ships saying "TBC" and "Details to be confirmed".** Every one of the nulls
 * below leaves that in place, which is what makes an unreachable database, an unpublished
 * social and a half-filled one all safe. A page that filled the tile with a guess — or with
 * a date typed into the markup — would look exactly the same and be wrong for a year.
 */
describe('the date tile on the events list', () => {
  it('splits a confirmed date into a day and a short month', () => {
    expect(socialDateTileParts('2026-12-12')).toEqual({ day: '12', month: 'Dec' });
    expect(socialDateTileParts('2026-11-01')).toEqual({ day: '1', month: 'Nov' });
  });

  /**
   * ⚠️ **The one that a timezone would break.** A date this late in the day is the same
   * calendar day everywhere only if it is never parsed as an instant; through
   * `new Date('2026-12-12').toLocaleDateString()` in a zone west of London it is the 11th.
   * `formatSocialDate` builds from the civil parts for that reason and this splits its
   * answer rather than re-parsing, so the tile cannot disagree with the sentence under it.
   */
  it('agrees with the sentence it is split from', () => {
    const full = formatSocialDate('2026-12-12');
    const tile = socialDateTileParts('2026-12-12');

    expect(full).toBe('Saturday 12 December 2026');
    expect(full).toContain(` ${tile?.day} `);
    expect(full).toContain(`${tile?.month}ember`);
  });

  it('answers null for every date the club has not confirmed', () => {
    for (const value of [null, '', 'soon', '2026-13-01', '2026-12-32', '12/12/2026']) {
      expect(socialDateTileParts(value), `${String(value)} produced a tile`).toBeNull();
    }
  });
});
