import { describe, expect, it } from 'vitest';
import { outcomeFor } from '../../lib/marshal-outcomes';

/**
 * The words the roster page says after a form has been posted to it — #245.
 *
 * ⚠️ **The outcome crosses from the POST to the GET through the URL**, so every one of these
 * is a test about a value a stranger can type. `lib/marshal-outcomes.ts` carries the argument;
 * this file is the part that keeps it true.
 */

/**
 * Every `reason` the two database functions can answer, read off
 * `20260912110000_timing_marshal_roster.sql` rather than imagined.
 *
 * ⚠️ **This is the list that goes stale**, and silently: a reason with no wording renders
 * *nothing at all*, which a volunteer cannot tell from the page simply not having reloaded.
 * If a migration teaches either function a new reason, it belongs here and in the module.
 */
const REASONS_THE_DATABASE_CAN_ANSWER = [
  'refused',
  'no_such_event',
  'incomplete',
  'not_a_marshal',
  'not_on_roster',
];

describe('what the page says', () => {
  it('has wording for every refusal the database can answer', () => {
    for (const reason of REASONS_THE_DATABASE_CAN_ANSWER) {
      expect(outcomeFor(reason), reason).not.toBeNull();
    }
  });

  it('calls every one of them bad, and never claims something changed', () => {
    for (const reason of REASONS_THE_DATABASE_CAN_ANSWER) {
      expect(outcomeFor(reason)?.tone, reason).toBe('bad');
    }
  });

  it('claims a change only for the two outcomes a function answered ok for', () => {
    expect(outcomeFor('assigned')?.tone).toBe('ok');
    expect(outcomeFor('removed')?.tone).toBe('ok');
  });

  /**
   * The sentence that stops somebody being put on a start line who is not on it: removing
   * a marshal is not removing what they recorded. `unassign_marshal()`'s own header makes the
   * same promise, and `timing.test.ts` asserts it against the crossings.
   */
  it('says that removing somebody leaves what they recorded alone', () => {
    expect(outcomeFor('removed')?.message).toContain('unchanged');
  });

  /**
   * ⚠️ **An outage is not a refusal**, and the write side is where conflating them costs most:
   * *"that was refused"* after a failed call tells a volunteer they may not do something they
   * may. Pinned to the read side's own words, which is the same sentence a volunteer sees if
   * they reload the page during the same outage.
   */
  it('describes an outage as an outage, in the words the read side uses', () => {
    const outage = outcomeFor('unavailable');

    expect(outage?.tone).toBe('bad');
    expect(outage?.message).toContain('could not be reached');
    expect(outage?.message).not.toContain('refused');
  });
});

describe('a value nobody wrote down', () => {
  it.each([
    ['definitely-not-an-outcome'],
    ['assigned; DROP TABLE'],
    ['<script>alert(1)</script>'],
    ['__proto__'],
    ['constructor'],
    ['toString'],
    [''],
  ])('%j says nothing at all', (value) => {
    expect(outcomeFor(value)).toBeNull();
  });

  /**
   * ⚠️ **`__proto__` and `constructor` are in that list for a reason that is easy to lose.**
   * A bare object literal inherits from `Object.prototype`, so `OUTCOMES['constructor']` is a
   * *function* rather than `undefined` — and a lookup written without `??` would hand this
   * page something truthy and then read `.message` off it. The test above is what holds the
   * module to answering `null`; this one says why those three strings are not arbitrary.
   */
  it('is not satisfied by something inherited from Object.prototype', () => {
    expect(outcomeFor('hasOwnProperty')).toBeNull();
    expect(outcomeFor('valueOf')).toBeNull();
  });

  it('says nothing when no outcome was named at all', () => {
    expect(outcomeFor(undefined)).toBeNull();
  });
});
