import { describe, expect, it } from 'vitest';
import { formatEntryReference } from '../../src/entry-reference';

/**
 * The one place an entry reference becomes text.
 *
 * **The reference is quoted back at the club**, so every surface printing one has to print the
 * same characters: `/account/entries/`, four outbox emails, `/admin/nn/entry/` and the attention
 * queue. That is `formatPence()`'s argument, and these are the assertions that make the shape a
 * decision rather than whatever each caller happened to write.
 */

const PURCHASE_ID = '11111111-2222-3333-4444-555555555555';

/** 1 September 2026, 08:15 London — inside British Summer Time. */
const ENTERED = '2026-09-01T07:15:00Z';

describe('formatEntryReference', () => {
  it('reads as the event, the number and the day it was entered', () => {
    expect(
      formatEntryReference({
        eventSlug: 'nn-2026',
        entryNo: 42,
        createdAt: ENTERED,
        purchaseId: PURCHASE_ID,
      }),
    ).toBe('NN2026-0042-01092026');
  });

  it('pads to four digits, so every reference on a page is the same width', () => {
    // A reference that is sometimes eight characters and sometimes ten is harder to read down
    // a column than one that is always the same shape.
    expect(
      formatEntryReference({
        eventSlug: 'nn-2026',
        entryNo: 7,
        createdAt: ENTERED,
        purchaseId: PURCHASE_ID,
      }),
    ).toBe('NN2026-0007-01092026');
  });

  it('does not truncate a number that outgrows the padding', () => {
    // 250 places makes five figures impossible here and the club may not always run this race.
    // Silently dropping a digit would be two entries with one reference.
    expect(
      formatEntryReference({
        eventSlug: 'nn-2026',
        entryNo: 12345,
        createdAt: ENTERED,
        purchaseId: PURCHASE_ID,
      }),
    ).toBe('NN2026-12345-01092026');
  });

  it('flattens the slug rather than carrying its separator into the reference', () => {
    // Otherwise `nn-2026` would give `NN-2026-0042-…`, which is four fields where a reader is
    // being told there are three.
    expect(
      formatEntryReference({
        eventSlug: 'pass-the-buck-2027',
        entryNo: 1,
        createdAt: ENTERED,
        purchaseId: PURCHASE_ID,
      }),
    ).toBe('PASSTHEBUCK2027-0001-01092026');
  });

  it('falls back to the purchase id when there is no number', () => {
    // **The whole of the expand step.** A Worker running against a database that predates
    // `entry_no` must print what it printed before rather than a reference with a hole in it —
    // a reference is a thing somebody quotes, and half of one is worse than the long one.
    expect(
      formatEntryReference({
        eventSlug: 'nn-2026',
        entryNo: null,
        createdAt: ENTERED,
        purchaseId: PURCHASE_ID,
      }),
    ).toBe(PURCHASE_ID);
  });

  it('names the London day, not the UTC one', () => {
    // ⚠️ **00:30 BST on 1 September is 23:30 UTC on 31 August.** A reference built off the UTC
    // date would disagree with the timestamp printed beside it on `/admin/nn/entry/`, which is
    // rendered through `formatLondon`. This repository has one path timezone conversion may
    // take and this is on it.
    expect(
      formatEntryReference({
        eventSlug: 'nn-2026',
        entryNo: 42,
        createdAt: '2026-08-31T23:30:00Z',
        purchaseId: PURCHASE_ID,
      }),
    ).toBe('NN2026-0042-01092026');
  });

  it('names the London day on the clocks-change weekend too', () => {
    // The race is run the weekend *after* the clocks go back on 25 October 2026. 00:30 GMT on
    // the 26th is 00:30 UTC, and an hour earlier — 23:30 UTC on the 25th — is 23:30 GMT, still
    // the 25th. The pair is here because it is the one weekend a year the answer is not
    // obvious.
    expect(
      formatEntryReference({
        eventSlug: 'nn-2026',
        entryNo: 1,
        createdAt: '2026-10-25T23:30:00Z',
        purchaseId: PURCHASE_ID,
      }),
    ).toBe('NN2026-0001-25102026');

    expect(
      formatEntryReference({
        eventSlug: 'nn-2026',
        entryNo: 2,
        createdAt: '2026-10-26T00:30:00Z',
        purchaseId: PURCHASE_ID,
      }),
    ).toBe('NN2026-0002-26102026');
  });
});
