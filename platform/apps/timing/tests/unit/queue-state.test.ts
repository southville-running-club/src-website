import { describe, expect, it } from 'vitest';
import {
  RETRY_CAP,
  atRetryCap,
  beginSync,
  confirmBib,
  newCard,
  reconcile,
  sortCards,
  syncFailed,
  validateBib,
  type QueueCard,
} from '../../lib/queue-state';

/**
 * The capture queue's rules — [#203](https://github.com/southville-running-club/src-website/issues/203).
 *
 * ⚠️ **This file is the reason `queue-state.ts` was separated from the screen at all.** The
 * behaviour a race depends on — a card that fails ten times, a reload in the middle of a sync,
 * an anomaly frozen at the moment somebody confirmed it — is reachable here in milliseconds and
 * reachable through Playwright only by contrivance. The rewrite has least licence to improve
 * this surface, so the assertions are about *what the old application did*, not about what
 * would be tidier.
 */

const SLUG = 'nn-2026';
const AT = '2026-11-01T11:30:00.000Z';

const tap = (id = 'c1', at = AT): QueueCard => newCard(id, SLUG, at);

describe('a tap, before a bib has been typed', () => {
  it('carries a time and nothing else, and is not sendable', () => {
    const card = tap();

    expect(card).toMatchObject({
      state: 'awaiting-bib',
      bib: null,
      retries: 0,
      anomalyFlag: false,
      anomalyReason: null,
      lastError: null,
      capturedAt: AT,
    });
  });

  /**
   * ⚠️ **`beginSync` leaves it alone, and that is the whole queue model.** A crossing with no
   * bib is a row nothing can resolve a team from; the point of recording the time first is that
   * the moment is already safe while the number is still being typed.
   */
  it('is skipped by the drain', () => {
    expect(beginSync(tap()).state).toBe('awaiting-bib');
  });
});

describe('what a marshal may type as a bib', () => {
  it.each([['1'], ['147'], ['0311'], ['00'], ['1100'], [' 311 ']])(
    '%s is a bib',
    (typed) => {
      expect(validateBib(typed)).toBe(true);
    },
  );

  it.each([[''], ['   '], ['31a'], ['3-1'], ['−311'], ['1.5'], ['٣١١']])(
    '%s is not',
    (typed) => {
      expect(validateBib(typed)).toBe(false);
    },
  );

  /**
   * ⚠️ **Deliberately weaker than `parseBib()`, and the disagreement is the feature.** That
   * function refuses `0311` because on a relay there is no leg 0; this one accepts it, because
   * **a walk-in is handed whatever bib is in the pool** and the desk records the number on the
   * card. A screen that refused those would refuse a runner who is on the course.
   */
  it('accepts a leading zero, and preserves it', () => {
    const card = confirmBib(tap(), '0311', 'relay', []);

    expect(card?.bib).toBe('0311');
  });

  it('refuses to queue a crossing whose bib is not one', () => {
    expect(confirmBib(tap(), 'abc', 'relay', [])).toBeNull();
  });
});

describe('confirming a bib', () => {
  it('queues the crossing and trims what was typed', () => {
    expect(confirmBib(tap(), ' 311 ', 'relay', [])).toMatchObject({
      bib: '311',
      state: 'queued',
    });
  });

  /**
   * ⚠️ **An anomaly flags and never blocks.** ADR-034 names it as a decision rather than an
   * implementation detail, and it is the one a rewrite is most likely to "improve" by accident:
   * refusing a suspicious crossing at the line loses the moment, and the moment is the thing
   * that cannot be recovered.
   */
  it('still queues a duplicate, and says on the card why it is one', () => {
    const card = confirmBib(tap(), '311', 'relay', [
      { id: 'other', bib: '311', captured_at: '2026-11-01T11:20:00.000Z' },
    ]);

    expect(card?.state).toBe('queued');
    expect(card?.anomalyFlag).toBe(true);
    expect(card?.anomalyReason).toContain('Duplicate bib 311');
  });

  it('flags a leg-2 crossing with no handover recorded, on a relay', () => {
    const card = confirmBib(tap(), '247', 'relay', []);

    expect(card?.anomalyFlag).toBe(true);
    expect(card?.anomalyReason).toContain('no handover recorded');
  });

  /**
   * The same bib on a solo race is just a team number — the leg-prefix reading does not apply.
   * This is why `format` is read from the database rather than assumed: getting it wrong flags
   * the wrong crossings, invisibly, on the one morning that cannot be re-run.
   */
  it('does not read a leg out of a solo race’s bib', () => {
    expect(confirmBib(tap(), '247', 'solo', [])?.anomalyFlag).toBe(false);
  });

  /**
   * ⚠️ **Frozen at confirm time and never recomputed.** It is what the marshal was looking at
   * in the moment they confirmed; re-deriving it later, against rows that have since changed,
   * would silently rewrite what somebody actually saw.
   * `20260912120000_timing_record_crossing.sql` carries the same rule for the server half.
   */
  it('keeps the verdict it was given, even after the duplicate is resolved away', () => {
    const flagged = confirmBib(tap(), '311', 'relay', [
      { id: 'other', bib: '311', captured_at: '2026-11-01T11:20:00.000Z' },
    ])!;

    // Whatever happens next — a failed sync, ten of them — the reason is the same words.
    const afterFailures = [...Array(3)].reduce<QueueCard>(
      (card) => syncFailed(beginSync(card), 'no signal'),
      flagged,
    );

    expect(afterFailures.anomalyFlag).toBe(true);
    expect(afterFailures.anomalyReason).toBe(flagged.anomalyReason);
  });
});

describe('a sync that does not land', () => {
  const queued = () => confirmBib(tap(), '311', 'relay', [])!;

  it('goes to a state of its own rather than quietly back in the queue', () => {
    const card = syncFailed(beginSync(queued()), 'no signal');

    // ⚠️ `failed` is distinct from `queued` so that an offline tap never looks like an error
    // and a real error never looks routine. Collapsing the two is how one hides inside the
    // other.
    expect(card.state).toBe('failed');
    expect(card.retries).toBe(1);
    expect(card.lastError).toBe('no signal');
  });

  it('is picked up again by the drain', () => {
    expect(beginSync(syncFailed(queued(), 'no signal')).state).toBe('syncing');
  });

  /**
   * ⚠️ **The counter is never reset, including by a manual retry** — the old application's
   * behaviour, kept deliberately. A counter a marshal can zero by pressing a button is a
   * counter that never reaches the cap, and the cap is the only thing that turns a card nobody
   * can send into a card somebody is told about.
   */
  it('reaches the cap after exactly RETRY_CAP failures, and stays there', () => {
    let card = queued();

    for (let n = 0; n < RETRY_CAP - 1; n += 1) {
      card = syncFailed(beginSync(card), 'no signal');
      expect(atRetryCap(card), `after ${n + 1}`).toBe(false);
    }

    card = syncFailed(beginSync(card), 'no signal');
    expect(card.retries).toBe(RETRY_CAP);
    expect(atRetryCap(card)).toBe(true);

    // A manual retry still sends it; what it does not do is make the card look fresh again.
    const retried = syncFailed(beginSync(card), 'no signal');
    expect(retried.retries).toBe(RETRY_CAP + 1);
    expect(atRetryCap(retried)).toBe(true);
  });

  it('is five minutes of the thirty-second drain, which is what #207 has to judge', () => {
    // Not an assertion about a number so much as a place for the number to be read off. The
    // old application recorded "is ~5 minutes too short for Ashton Court signal?" against
    // itself and never answered it; #207's simulation is what can.
    expect(RETRY_CAP * 30).toBe(300);
  });
});

describe('a reload in the middle of a sync', () => {
  const syncing = (id: string): QueueCard => ({
    ...confirmBib(tap(id), '311', 'relay', [])!,
    state: 'syncing',
  });

  /**
   * ⚠️ **The case a reload is most dangerous in.** A card left `syncing` had its request sent
   * and its answer never seen: it may be in the database and it may not. Guessing either way
   * loses something — a card on the screen for ever, or one that vanished while its crossing
   * was never recorded.
   */
  it('retires the card whose crossing is in the database', () => {
    const { retire, keep } = reconcile([syncing('c1')], new Set(['c1']));

    expect(retire).toEqual(['c1']);
    expect(keep).toEqual([]);
  });

  it('puts the card whose crossing is absent back in the queue, not back in flight', () => {
    const { retire, keep } = reconcile([syncing('c1')], new Set(['somebody-else']));

    expect(retire).toEqual([]);
    // Back to `queued`: nothing is in flight after a reload — the request died with the page —
    // so a card left `syncing` would be skipped by `beginSync` for ever and never drain again.
    expect(keep[0]?.state).toBe('queued');
    expect(keep[0]?.id).toBe('c1');
  });

  it('leaves every other state exactly as it was', () => {
    const waiting = tap('c2');
    const failed = syncFailed(confirmBib(tap('c3'), '311', 'relay', [])!, 'no signal');
    const plain = confirmBib(tap('c4'), '312', 'relay', [])!;

    // ⚠️ The ids are in `known` and it must change nothing: a card that is not `syncing` was
    // never waiting on an answer, and retiring one on the strength of an id would delete a
    // crossing a marshal is still typing into.
    const { retire, keep } = reconcile(
      [waiting, failed, plain],
      new Set(['c2', 'c3', 'c4']),
    );

    expect(retire).toEqual([]);
    expect(keep).toEqual([waiting, failed, plain]);
  });
});

describe('the order the cards are shown in', () => {
  it('puts the newest tap first, because it is the one being typed into', () => {
    const order = sortCards([
      tap('a', '2026-11-01T11:30:00.000Z'),
      tap('b', '2026-11-01T11:32:00.000Z'),
      tap('c', '2026-11-01T11:31:00.000Z'),
    ]).map((card) => card.id);

    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('is stable when two taps share a millisecond', () => {
    // A list that reshuffles under a thumb is worse than one that is arbitrary but fixed.
    const cards = [tap('b'), tap('a')];

    expect(sortCards(cards).map((c) => c.id)).toEqual(['a', 'b']);
    expect(sortCards(sortCards(cards)).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('does not mutate what it was given', () => {
    const cards = [tap('b'), tap('a')];
    sortCards(cards);

    expect(cards.map((c) => c.id)).toEqual(['b', 'a']);
  });
});
