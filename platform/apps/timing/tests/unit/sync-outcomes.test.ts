import { describe, expect, it } from 'vitest';
import {
  SYNC_DOOR_REFUSED,
  SYNC_MANUAL_REVIEW,
  SYNC_UNAVAILABLE,
  refusalWording,
} from '../../lib/sync-outcomes';

/**
 * What a card says when a sync did not land — [#203](https://github.com/southville-running-club/src-website/issues/203).
 *
 * ⚠️ **The defect this module exists to make impossible is the reason for the last block.** The
 * old application put a `PostgrestError` straight on the card, and a `PostgrestError` is a plain
 * object rather than an `Error` — so one of them rendered `[object Object]`. The version that
 * "works" is no better: a marshal in the cold reading
 * `duplicate key value violates unique constraint` has one decision to make, keep going or
 * fetch somebody, and a Postgres error supports neither.
 */

const REASONS = [
  'not_on_roster',
  'no_such_event',
  'incomplete',
  'invalid_source',
  'refused',
];

describe('every refusal the database can give', () => {
  it.each(REASONS.map((r) => [r]))('%s is answered in prose', (reason) => {
    const wording = refusalWording(reason);

    // ⚠️ **A sentence rather than a token.** The machine-readable reason is the *selector*; it
    // is never itself the message. `refused` is checked as the slug it is — with the underscore
    // spelling for the multi-word ones — rather than as the word, because "refused" is
    // ordinary English and "not_on_roster" is not.
    expect(wording).not.toBe('');
    expect(wording).not.toContain('_');
    expect(wording.slice(-1)).toBe('.');
    expect(wording.slice(0, 1)).toBe(wording.slice(0, 1).toUpperCase());
  });

  /**
   * ⚠️ **Every sentence has to be true of a crossing that is still safe.** A failed card is not
   * a lost crossing — the time is in IndexedDB and will be sent again. So nothing may suggest
   * something has been lost, and nothing may suggest re-tapping: a second tap is a second
   * crossing with a second id, which is the one thing the idempotent insert cannot protect
   * against.
   */
  it.each(REASONS.map((r) => [r]))('%s says the time is still here', (reason) => {
    expect(refusalWording(reason)).toContain('still here');
  });

  it.each(REASONS.map((r) => [r]))('%s never tells anybody to tap again', (reason) => {
    expect(refusalWording(reason).toLowerCase()).not.toContain('tap again');
    expect(refusalWording(reason).toLowerCase()).not.toContain('record it again');
  });

  /**
   * The one a volunteer can actually fix, so it is the one that says how. ADR-036's scope:
   * somebody with the roster page open can add them in a few seconds.
   */
  it('tells an un-rostered marshal who to ask', () => {
    expect(refusalWording('not_on_roster')).toContain('marshal list');
  });
});

describe('a reason nobody has written wording for', () => {
  it('falls through to a sentence that is still true', () => {
    expect(refusalWording('something_invented_in_2027')).toBe(refusalWording('refused'));
  });

  /**
   * ⚠️ **`Object.hasOwn` rather than `REFUSALS[reason] ?? …`.** An object literal inherits from
   * `Object.prototype`, so a bare index for `toString` is a *function* — truthy, so `??` would
   * hand back a function and the card would render `undefined`. `lib/access.ts` carries the same
   * fix, found there as a real defect.
   */
  it.each([['toString'], ['constructor'], ['__proto__'], ['hasOwnProperty']])(
    '%s is a string and not something inherited',
    (reason) => {
      expect(typeof refusalWording(reason)).toBe('string');
      expect(refusalWording(reason)).toBe(refusalWording('refused'));
    },
  );
});

describe('the three sentences that are not about one card', () => {
  it('calls being offline what it is, rather than a problem', () => {
    // The ordinary case on a course. A marshal at Ashton Court with no signal is having a
    // completely normal morning, and the card must not read as an error.
    expect(SYNC_UNAVAILABLE).toContain('no signal');
    expect(SYNC_UNAVAILABLE).toContain('saved on this phone');
  });

  /**
   * ⚠️ **It names two possibilities because the screen genuinely cannot tell them apart.**
   * `middleware.ts` answers a lapsed session and an un-rostered marshal with the same rewrite
   * to an address that matches no route — deliberately, so the door is not an oracle. The cost
   * lands in this sentence, which has to be true of either.
   */
  it('does not guess which of the two refusals the door made', () => {
    expect(SYNC_DOOR_REFUSED).toContain('signed out');
    expect(SYNC_DOOR_REFUSED).toContain('marshal list');
    expect(SYNC_DOOR_REFUSED).toContain('saved on this phone');
  });

  it('tells somebody at the cap what to do with the crossing, not only that it stopped', () => {
    // A card nobody can send still holds a real time for a real runner, and the recoverable
    // outcome is somebody writing it down. That instruction is the whole value of the message.
    expect(SYNC_MANUAL_REVIEW).toContain('Write the bib and the time down');
  });
});
