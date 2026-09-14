/**
 * What the live leaderboard says — [#204](https://github.com/southville-running-club/src-website/issues/204).
 *
 * The cases that matter are the ones about **certainty**, because a board's failure mode is being
 * believed: a time measured from a start nobody recorded, a row a marshal has flagged, and a board
 * that has silently stopped updating.
 */

import { describe, expect, it } from 'vitest';
import type { LeaderboardCounts } from '@src/shared/timing/leaderboard';
import {
  boardCaveats,
  CONNECTION_WORDS,
  fieldSummary,
  statusWords,
  SUSPECT_WORDS,
} from '../../lib/leaderboard-outcomes';

function counts(over: Partial<LeaderboardCounts> = {}): LeaderboardCounts {
  return {
    field: 3,
    finished: 1,
    handedOver: 0,
    awaited: 2,
    suspect: 0,
    terminal: 0,
    ...over,
  };
}

describe('words for a row with no time', () => {
  it('names each of the three terminal labels rather than leaving a blank', () => {
    expect(statusWords('dns', 'solo')).toBe('Did not start');
    expect(statusWords('dnf', 'solo')).toBe('Did not finish');
    expect(statusWords('dq', 'solo')).toBe('Disqualified');
  });

  /**
   * ⚠️ **A solo race has no legs, so it may never say "On leg 2".** The state should not arise at
   * all on a solo race — `buildResults` has no path to it — and the safe answer to a shape that
   * should not occur is the true one about somebody who has not finished.
   */
  it('mentions a leg only on a relay', () => {
    expect(statusWords('leg1', 'relay')).toBe('On leg 2');
    expect(statusWords('leg1', 'solo')).toBe('On course');
  });
});

describe('what the board warns about', () => {
  it('says nothing at all when there is nothing to say', () => {
    expect(boardCaveats({ startRecorded: true, counts: counts() })).toEqual([]);
  });

  /**
   * ⚠️ **The most important sentence on the page.** Without a recorded start every duration is
   * measured from the schedule, so the whole board may be minutes out — and it has to say, in as
   * many words, that these are not results.
   */
  it('says the times are not results when the start was never recorded', () => {
    const [first] = boardCaveats({ startRecorded: false, counts: counts() });

    expect(first).toContain('has not been recorded');
    expect(first).toContain('scheduled start');
    expect(first).toContain('not results');
  });

  it('counts the flagged rows and says their times are still shown', () => {
    const one = boardCaveats({ startRecorded: true, counts: counts({ suspect: 1 }) });
    expect(one).toHaveLength(1);
    expect(one[0]).toContain('1 row is marked');
    expect(one[0]).toContain('time is shown');

    const several = boardCaveats({ startRecorded: true, counts: counts({ suspect: 4 }) });
    expect(several[0]).toContain('4 rows are marked');
    expect(several[0]).toContain('times are shown');
  });

  it('puts the unrecorded start first when both apply', () => {
    const both = boardCaveats({ startRecorded: false, counts: counts({ suspect: 2 }) });

    expect(both).toHaveLength(2);
    expect(both[0]).toContain('scheduled start');
    expect(both[1]).toContain('marked');
  });

  /** The mark and the sentence have to be the same two words, or they read as two facts. */
  it('uses the same words as the mark beside a time', () => {
    const [caveat] = boardCaveats({
      startRecorded: true,
      counts: counts({ suspect: 1 }),
    });

    expect(SUSPECT_WORDS).toBe('being checked');
    expect(caveat).toContain(SUSPECT_WORDS);
  });
});

describe('how the field stands', () => {
  it('says nothing has been captured rather than counting zero entries', () => {
    const empty = fieldSummary({ counts: counts({ field: 0 }) }, 'solo');

    expect(empty).toBe('Nothing has been captured for this race yet.');
    expect(empty).not.toContain('0');
  });

  it('counts the field, the finishers and who is still out', () => {
    expect(fieldSummary({ counts: counts() }, 'solo')).toBe(
      '3 entries · 1 finished · 2 yet to be seen.',
    );
  });

  it('says entry rather than entries for a field of one', () => {
    expect(
      fieldSummary({ counts: counts({ field: 1, finished: 1, awaited: 0 }) }, 'solo'),
    ).toContain('1 entry ');
  });

  /**
   * ⚠️ **A solo race has no handover, so the summary must not mention one.** *"0 on leg 2"* on a
   * race with one crossing per entry invites a volunteer to wonder which leg they are looking at.
   */
  it('mentions leg 2 on a relay and never on a solo race', () => {
    const relay = fieldSummary(
      { counts: counts({ handedOver: 1, awaited: 1 }) },
      'relay',
    );
    expect(relay).toContain('1 on leg 2');

    expect(fieldSummary({ counts: counts({ handedOver: 0 }) }, 'solo')).not.toContain(
      'leg',
    );
  });

  it('mentions the unplaced only when there are some', () => {
    expect(fieldSummary({ counts: counts() }, 'solo')).not.toContain('not placed');
    expect(fieldSummary({ counts: counts({ terminal: 2 }) }, 'solo')).toContain(
      '2 not placed',
    );
  });
});

describe('whether the board is being pushed to', () => {
  /**
   * ⚠️ **The no-JavaScript state is not a failure and may not read like one.** A server-rendered
   * snapshot is correct; it simply does not move, and what a reader needs is how to see more.
   */
  it('tells a reader with no scripting how to see more, and claims nothing is broken', () => {
    expect(CONNECTION_WORDS.off).toContain('Reload');
    for (const word of ['error', 'failed', 'sorry', 'broken', 'problem']) {
      expect(CONNECTION_WORDS.off.toLowerCase()).not.toContain(word);
    }
  });

  /**
   * ⚠️ **A frozen live board and a race where nothing has happened look identical**, and on a race
   * night they mean opposite things. So a dropped connection has to say the board has stopped.
   */
  it('says the board has stopped when the connection dropped', () => {
    expect(CONNECTION_WORDS.lost).toContain('stopped updating');
    expect(CONNECTION_WORDS.lost).toContain('Reload');
  });

  it('says it is live when it is', () => {
    expect(CONNECTION_WORDS.live).toContain('Updating');
  });
});
