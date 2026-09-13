import { describe, expect, it } from 'vitest';
import { anomalyOutcomeFor } from '../../lib/anomaly-outcomes';

/**
 * What the two resolution surfaces say afterwards — [#252](https://github.com/southville-running-club/src-website/issues/252).
 *
 * The third module of this shape, and the assertions are the ones `start-outcomes.test.ts` and
 * `marshal-outcomes.test.ts` already make, plus the one that is specific to this page: **the
 * refusal that is not a failure**.
 */

/** Every reason the two route handlers can put in the query string. */
const REASONS = [
  'marked_valid',
  'edited',
  'discarded',
  'restored',
  'saved',
  'edited_orphan',
  'already_resolved',
  'changed_elsewhere',
  'not_discarded',
  'no_such_crossing',
  'bib_required',
  'invalid_action',
  'incomplete',
  'refused',
  'unavailable',
];

describe('every outcome the two pages can be sent', () => {
  it.each(REASONS.map((r) => [r]))('%s is answered in prose', (reason) => {
    const outcome = anomalyOutcomeFor(reason);

    // ⚠️ **A sentence rather than a token.** The parameter selects wording written in the
    // module; it is never itself rendered. A machine-readable reason reaching a volunteer is
    // the defect `lib/sync-outcomes.ts`'s header describes one surface along.
    expect(outcome).not.toBeNull();
    expect(outcome?.message).not.toContain('_');
    expect(outcome?.message.slice(-1)).toBe('.');
  });
});

describe('the refusals that are not failures', () => {
  /**
   * ⚠️ **The single most likely thing either page will ever show.** Two volunteers on one
   * triage list is the normal case on a race morning, and the compare-and-swap answers the
   * loser. Nothing is broken and nothing is lost — so a `bad` tone here would send somebody
   * looking for a problem that is not there, and "try again" would resolve the capture twice
   * on top of somebody else's decision.
   */
  it.each([['already_resolved'], ['changed_elsewhere']])(
    '%s reads as an ordinary outcome rather than an error',
    (reason) => {
      const outcome = anomalyOutcomeFor(reason);

      expect(outcome?.tone).toBe('ok');
      expect(outcome?.message.toLowerCase()).toContain('nothing was');
      expect(outcome?.message.toLowerCase()).not.toContain('try again');
    },
  );

  it('says whose decision stands, rather than only that this one did not', () => {
    expect(anomalyOutcomeFor('already_resolved')?.message).toContain(
      'Their decision stands',
    );
  });
});

describe('the outcomes that change what a result says', () => {
  /**
   * A discard is the one resolution that removes a capture from every result. The person doing
   * it at 11:40 on a race morning has to know it can be undone without asking anybody.
   */
  it('tells somebody discarding a capture where it went', () => {
    const outcome = anomalyOutcomeFor('discarded');

    expect(outcome?.tone).toBe('ok');
    expect(outcome?.message).toContain('timing log');
  });

  /**
   * ⚠️ **Resolved and incomplete at once.** The admin has recorded what they believe the bib
   * was and `record_crossing()` keeps an unknown bib deliberately — but the screen would
   * otherwise look like it had finished the job, and what changes next is the entry list.
   */
  it('says outright when a corrected bib still matches no team', () => {
    const outcome = anomalyOutcomeFor('edited_orphan');

    expect(outcome?.tone).toBe('bad');
    expect(outcome?.message).toContain('matches no team');
    expect(outcome?.message).toContain('entry list');
  });
});

describe('a value nobody has written wording for', () => {
  it('says nothing at all rather than something generic', () => {
    expect(anomalyOutcomeFor('something_invented_in_2027')).toBeNull();
    expect(anomalyOutcomeFor(undefined)).toBeNull();
  });

  /**
   * ⚠️ **`Object.hasOwn` rather than `OUTCOMES[value] ?? null`.** An object literal inherits
   * from `Object.prototype`, so a bare index for `toString` is a function — truthy, so `??`
   * would hand it back and the page would read `.message` off it and render `undefined` in a
   * notice. `?outcome=constructor` is a URL anybody can type.
   */
  it.each([
    ['toString'],
    ['constructor'],
    ['__proto__'],
    ['hasOwnProperty'],
    ['valueOf'],
  ])('%s is not mistaken for an outcome', (value) => {
    expect(anomalyOutcomeFor(value)).toBeNull();
  });
});
