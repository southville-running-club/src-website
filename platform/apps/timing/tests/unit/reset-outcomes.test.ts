import { describe, expect, it } from 'vitest';
import { resetOutcomeFor } from '../../lib/reset-outcomes';

/**
 * What the danger zone says afterwards — [#254](https://github.com/southville-running-club/src-website/issues/254).
 *
 * The fifth module of this shape. Two of the assertions here are specific to this screen and are
 * the reason the wording was written carefully: **"wiped" must not read as "the race is gone"**,
 * and **`published` must not read as a failure**. The first sends a volunteer looking for a race
 * that is still there; the second sends them looking for a bug in a button that worked.
 */

const REASONS = [
  'wiped',
  'not_confirmed',
  'published',
  'no_such_event',
  'incomplete',
  'refused',
  'unavailable',
];

describe('every outcome the danger zone can be sent', () => {
  it.each(REASONS.map((r) => [r]))('%s is answered in prose', (reason) => {
    const outcome = resetOutcomeFor(reason);

    expect(outcome).not.toBeNull();
    // No reason slug reaches a volunteer — the sibling modules' rule.
    expect(outcome?.message).not.toContain('_');
    expect(outcome?.message.slice(-1)).toBe('.');
  });
});

describe('the wipe that worked', () => {
  /**
   * ⚠️ **It says what survived as well as what went.** "Wiped" alone reads as "the race is
   * gone", and the next thing this volunteer does is go looking for the race they just reset —
   * or worse, rebuild a roster that was never touched.
   */
  it('names what was removed and what was kept', () => {
    const message = resetOutcomeFor('wiped')?.message ?? '';

    expect(message).toContain('crossing');
    expect(message).toContain('entry');
    expect(message).toContain('marshals');
  });

  it('says the race is no longer marked started or finished', () => {
    // The second of the old function's two corrections, said out loud on the screen: a wiped
    // race used to come back still marked finished.
    expect(resetOutcomeFor('wiped')?.message).toContain('started or finished');
  });

  /**
   * ⚠️ **No figures, so one sentence is honest about a wipe of a thousand rows and about a
   * second press that removed none.** The counts come from `event_detail()` on the way back,
   * not from the query string — `lib/reset-outcomes.ts`'s header carries the argument.
   */
  it('makes no claim about how much there was', () => {
    expect(resetOutcomeFor('wiped')?.message).not.toMatch(/\d/);
  });
});

describe('the refusal that is a rule rather than a fault', () => {
  /**
   * ⚠️ **`published` is the club's permanent record arriving on time.** It is a `bad` tone
   * because nothing happened, and the sentence has to say what to do next — a volunteer told
   * only "that was refused" in the middle of a rehearsal goes looking for a bug in the button.
   */
  it('says why a published race is kept, and what would have to happen first', () => {
    const message = resetOutcomeFor('published')?.message ?? '';

    expect(message).toContain('published');
    expect(message).toContain('permanent record');
    expect(message).toContain('unpublish');
  });

  it('tells somebody whose phrase did not match exactly what to type', () => {
    const message = resetOutcomeFor('not_confirmed')?.message ?? '';

    expect(message).toContain('Nothing was changed');
    expect(message).toContain('slug');
  });
});

describe('an outage', () => {
  /**
   * ⚠️ **Never rendered as a refusal.** This is the one button on the platform where pressing
   * again is not free, so the sentence has to say plainly that nothing was wiped.
   */
  it('says nothing was wiped, rather than that something was refused', () => {
    const outcome = resetOutcomeFor('unavailable');

    expect(outcome?.tone).toBe('bad');
    expect(outcome?.message).toContain('nothing was wiped');
    expect(outcome?.message).not.toContain('refused');
  });
});

describe('a value nobody has written wording for', () => {
  it('says nothing at all rather than something generic', () => {
    expect(resetOutcomeFor('deleted')).toBeNull();
    expect(resetOutcomeFor(undefined)).toBeNull();
  });

  it.each([['toString'], ['constructor'], ['__proto__'], ['valueOf']])(
    '%s is not mistaken for an outcome',
    (value) => {
      expect(resetOutcomeFor(value)).toBeNull();
    },
  );
});
