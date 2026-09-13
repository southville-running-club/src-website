import { describe, expect, it } from 'vitest';
import { startOutcomeFor } from '../../lib/start-outcomes';

/**
 * The words the start screen says after its form has been posted to it — #250.
 *
 * ⚠️ **The outcome crosses from the POST to the GET through the URL**, so every one of these
 * is a test about a value a stranger can type. `lib/start-outcomes.ts` carries the argument;
 * this file is the part that keeps it true.
 */

/**
 * Every `reason` the two database functions can answer, read off
 * `20260913170000_timing_start_race.sql` rather than imagined.
 *
 * ⚠️ **This is the list that goes stale**, and silently: a reason with no wording renders
 * *nothing at all*, which on this page a volunteer cannot tell from the gun not having gone.
 */
const REASONS_THE_DATABASE_CAN_ANSWER = [
  'refused',
  'no_such_event',
  'already_started',
  'not_started',
  'crossings_exist',
];

describe('what the start screen says', () => {
  it('has wording for every refusal the database can answer', () => {
    for (const reason of REASONS_THE_DATABASE_CAN_ANSWER) {
      expect(startOutcomeFor(reason), reason).not.toBeNull();
    }
  });

  it('claims a change only for the two outcomes a function answered ok for', () => {
    expect(startOutcomeFor('started')?.tone).toBe('ok');
    expect(startOutcomeFor('cleared')?.tone).toBe('ok');
  });

  /**
   * ⚠️ **The assertion this whole module exists for.** `already_started` is what the *losing*
   * device gets when two people press at once — the race did start, the clock is right, and
   * nothing is owed. A message toned `bad` would send the second volunteer looking for a
   * button to press again, which is the outcome the migration's `where`-clause guard exists to
   * make impossible. It must also say that the time on the page is the one that counts.
   */
  it('treats a double press as good news and says which time stands', () => {
    const already = startOutcomeFor('already_started');

    expect(already?.tone).toBe('ok');
    expect(already?.message).toContain('nothing was changed');
    expect(already?.message).toContain('earlier press');
  });

  /**
   * A refusal on a start line is only useful if it says what it would have done. "No" with no
   * reason is what gets worked around by somebody in a hurry.
   */
  it('says why a start can no longer be cleared, not only that it cannot', () => {
    const refused = startOutcomeFor('crossings_exist');

    expect(refused?.tone).toBe('bad');
    expect(refused?.message).toContain('already been timed');
    expect(refused?.message).toContain('re-time');
  });

  it('never claims a start was cleared when there was no start to clear', () => {
    expect(startOutcomeFor('not_started')?.tone).toBe('bad');
  });

  /**
   * ⚠️ **An outage is not a refusal**, and here the difference is whether the race started: a
   * refusal means it did not, and an outage means nobody knows yet. Pinned to the read side's
   * own words, so a volunteer comparing two pages during one outage is told one thing.
   */
  it('describes an outage as an outage, in the words the read side uses', () => {
    const outage = startOutcomeFor('unavailable');

    expect(outage?.tone).toBe('bad');
    expect(outage?.message).toContain('could not be reached');
    expect(outage?.message).not.toContain('refused');
    // The half that is this page's own: it says the screen will tell them if the gun did go.
    expect(outage?.message).toContain('this page will say so');
  });
});

describe('a value nobody wrote down', () => {
  it.each([
    ['definitely-not-an-outcome'],
    ['started; DROP TABLE'],
    ['<script>alert(1)</script>'],
    ['__proto__'],
    ['constructor'],
    ['toString'],
    [''],
  ])('%j says nothing at all', (value) => {
    expect(startOutcomeFor(value)).toBeNull();
  });

  /**
   * ⚠️ **`__proto__` and `constructor` are in that list for a reason that is easy to lose.** A
   * bare object literal inherits from `Object.prototype`, so `OUTCOMES['constructor']` is a
   * *function* rather than `undefined`, and a lookup written without `Object.hasOwn` would hand
   * this page something truthy and then read `.message` off it.
   */
  it('is not satisfied by something inherited from Object.prototype', () => {
    expect(startOutcomeFor('hasOwnProperty')).toBeNull();
    expect(startOutcomeFor('valueOf')).toBeNull();
  });

  it('says nothing when no outcome was named at all', () => {
    expect(startOutcomeFor(undefined)).toBeNull();
  });
});
