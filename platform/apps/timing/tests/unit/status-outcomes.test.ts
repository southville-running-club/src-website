import { describe, expect, it } from 'vitest';
import { statusOutcomeFor } from '../../lib/status-outcomes';

/**
 * What the status and finish screens say afterwards — [#253](https://github.com/southville-running-club/src-website/issues/253).
 *
 * The fourth module of this shape. Two of the assertions are specific to this pair and are the
 * reason the wording was written carefully: **a status is a decision somebody may come back and
 * argue about**, and **finishing must not read as a cut-off**.
 */

const REASONS = [
  'dns',
  'dnf',
  'dq',
  'cleared',
  'unchanged',
  'finished',
  'already_finished',
  'reopened',
  'not_finished',
  'invalid_status',
  'no_such_team',
  'no_such_event',
  'incomplete',
  'refused',
  'unavailable',
];

describe('every outcome the two screens can be sent', () => {
  it.each(REASONS.map((r) => [r]))('%s is answered in prose', (reason) => {
    const outcome = statusOutcomeFor(reason);

    expect(outcome).not.toBeNull();
    expect(outcome?.message).not.toContain('_');
    expect(outcome?.message.slice(-1)).toBe('.');
  });
});

describe('the three that change what a result says', () => {
  /**
   * ⚠️ **Each says what it does to the result, not merely that it was recorded.** These are the
   * sentences a volunteer will remember making about a decision a runner may dispute.
   */
  it('says a DNS has no time at all', () => {
    expect(statusOutcomeFor('dns')?.message).toContain('no time in this race');
  });

  it.each([['dnf'], ['dq']])(
    '%s says outright that what was captured stays captured',
    (reason) => {
      // The half people are surprised by: DNF and DQ keep leg A, because a captured fact stays
      // captured. `teamRaceStatus()` has always behaved this way; the wording now says so.
      expect(statusOutcomeFor(reason)?.message).toContain('stays captured');
    },
  );

  it('tells somebody applying a DQ that it can be lifted, and that both are recorded', () => {
    const message = statusOutcomeFor('dq')?.message ?? '';

    expect(message).toContain('lifted');
    expect(message).toContain('recorded');
  });

  it('says a lifted status puts them back in the race', () => {
    // "Saved" would leave somebody unsure whether they had just applied one or removed one.
    expect(statusOutcomeFor('cleared')?.message).toContain('back in the race');
  });
});

describe('finishing', () => {
  /**
   * ⚠️ **The one misunderstanding this screen can cause.** A volunteer who reads "finished" as
   * "closed" stops capturing — and the last runner's crossing arrives after the race director
   * has called it.
   */
  it('says in the same breath that crossings still work', () => {
    const message = statusOutcomeFor('finished')?.message ?? '';

    expect(message).toContain('still be recorded');
    expect(message).toContain('not a cut-off');
  });

  it('treats a second press as ordinary rather than as an error', () => {
    // The losing half of two volunteers pressing at once — `start_event()`'s rule one screen on.
    const outcome = statusOutcomeFor('already_finished');

    expect(outcome?.tone).toBe('ok');
    expect(outcome?.message).toContain('nothing was changed');
  });
});

describe('a value nobody has written wording for', () => {
  it('says nothing at all rather than something generic', () => {
    expect(statusOutcomeFor('withdrawn')).toBeNull();
    expect(statusOutcomeFor(undefined)).toBeNull();
  });

  it.each([['toString'], ['constructor'], ['__proto__'], ['valueOf']])(
    '%s is not mistaken for an outcome',
    (value) => {
      expect(statusOutcomeFor(value)).toBeNull();
    },
  );
});
