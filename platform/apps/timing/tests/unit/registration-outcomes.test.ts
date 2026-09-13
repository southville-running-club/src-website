/**
 * What the entry-list page is allowed to say, and what may cross the redirect to make it say
 * it — #202.
 *
 * `marshal-outcomes.test.ts` is the shape this follows. The load-bearing assertions are the
 * ones about what is **not** rendered: a value nobody wrote down says nothing, and nothing a
 * volunteer's file contained can reach a sentence.
 */

import { describe, expect, it } from 'vitest';
import type { FindingKind } from '@src/shared/timing/registration/types';
import {
  encodeFindingGroup,
  findingsFrom,
  MAX_FINDING_GROUPS,
  MAX_FINDING_ROWS,
  outcomeFor,
  WORDED_FINDING_KINDS,
} from '../../lib/registration-outcomes';

describe('outcomeFor', () => {
  it('answers null for a value nobody wrote down', () => {
    expect(outcomeFor('nonsense')).toBeNull();
    expect(outcomeFor(undefined)).toBeNull();
  });

  /**
   * ⚠️ **An object literal inherits from `Object.prototype`**, so `OUTCOMES['toString']` is a
   * *function* — truthy, so `?? null` would hand it back and the page would read `.message`
   * off it and render `undefined` in a notice. `?outcome=constructor` is a URL anybody can
   * type. `lib/access.ts` and `lib/marshal-outcomes.ts` carry the same fix, found the same way.
   */
  it('answers null for an inherited property name', () => {
    for (const inherited of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(outcomeFor(inherited)).toBeNull();
    }
  });

  it('marks only the outcomes that claim something changed as good news', () => {
    expect(outcomeFor('imported', { teams: 6, runners: 12 })?.tone).toBe('ok');
    expect(outcomeFor('walk-in-added')?.tone).toBe('ok');
    expect(outcomeFor('blocked')?.tone).toBe('bad');
    expect(outcomeFor('bib_taken')?.tone).toBe('bad');
    expect(outcomeFor('unavailable')?.tone).toBe('bad');
  });

  it('quotes the counts it was given, singular and plural', () => {
    expect(outcomeFor('imported', { teams: 1, runners: 1 })?.message).toContain(
      '1 entry',
    );
    expect(outcomeFor('imported', { teams: 1, runners: 1 })?.message).toContain(
      '1 runner',
    );
    expect(outcomeFor('imported', { teams: 6, runners: 12 })?.message).toContain(
      '6 entries',
    );
    expect(outcomeFor('imported', { teams: 6, runners: 12 })?.message).toContain(
      '12 runners',
    );
  });

  /**
   * ⚠️ **A count that did not survive the redirect must not render as zero.** *"0 entries on
   * the start list"* is a claim about a race; *"some entries"* is the page saying it was not
   * told, which is the truth.
   */
  it('says "some" rather than zero when it was not told a count', () => {
    const message = outcomeFor('imported', {})?.message ?? '';
    expect(message).toContain('some entries');
    expect(message).not.toContain('0 entries');
  });

  /**
   * `assign_bibs()` is idempotent by skipping, so a second press is *meant* to do nothing —
   * and the route handler picks a different outcome for that rather than saying "0 entries
   * were numbered", which reads as a failure and sends somebody looking for a problem that is
   * not there.
   */
  it('has separate wording for a second press that numbered nobody', () => {
    expect(outcomeFor('bibs-already-assigned')?.tone).toBe('ok');
    expect(outcomeFor('bibs-already-assigned')?.message).not.toContain('0 ');
  });

  /**
   * The outage wording is word for word the read side's, because it is the same race and a
   * volunteer comparing two pages during an outage must not be told two different things.
   */
  it('says an outage is an outage and never a refusal', () => {
    const message = outcomeFor('unavailable')?.message ?? '';
    expect(message).toContain('could not be reached');
    expect(message).not.toContain('refused');
  });

  it('has wording for every reason the database functions can answer', () => {
    for (const reason of [
      'refused',
      'no_such_event',
      'no_such_entries_event',
      'too_many_entrants',
      'malformed',
      'missing_purchase_order_id',
      'bib_taken',
      'no_such_leg',
      'no_such_team',
      'incomplete',
    ]) {
      expect(outcomeFor(reason), reason).not.toBeNull();
    }
  });
});

describe('findings across the redirect', () => {
  /**
   * ⚠️ **The assertion this whole module exists for.** Every finding the parser produces
   * carries a `message` that may name a runner and quote their email address — *"Team 4471
   * (Alex Doe) has only one runner"*. What crosses the redirect is a severity, a kind and some
   * row numbers, and the wording is the club's own. If a kind ever loses its wording it renders
   * **nothing**, which is silence about a problem, so the two lists are pinned equal.
   */
  it('has wording for every finding kind the parser can produce', () => {
    // Named out rather than derived, so adding a kind to the union fails here until somebody
    // writes what the club says about it. The union is a type and has no runtime form.
    const kinds: FindingKind[] = [
      'missing-required-field',
      'multi-row-team',
      'lone-runner',
      'cross-team-duplicate-email',
      'within-pair-duplicate-email',
      'pair-not-adjacent',
      'empty-team-name',
      'no-captain-match',
      'unexpected-columns',
      'malformed-csv',
      'invalid-dob',
    ];

    expect([...WORDED_FINDING_KINDS].sort()).toEqual([...kinds].sort());
  });

  it('round-trips a group it wrote itself', () => {
    const [group] = findingsFrom(
      encodeFindingGroup('block', 'missing-required-field', 3, [3, 7, 12]),
    );

    expect(group).toBeDefined();
    expect(group!.severity).toBe('block');
    expect(group!.kind).toBe('missing-required-field');
    expect(group!.rows).toEqual([3, 7, 12]);
    expect(group!.total).toBe(3);
    expect(group!.message).toContain('Missing something');
  });

  it('keeps a file-level finding, which names no row at all', () => {
    const [group] = findingsFrom(encodeFindingGroup('info', 'unexpected-columns', 1, []));

    expect(group!.rows).toEqual([]);
    expect(group!.total).toBe(1);
  });

  it('accepts a repeated parameter as well as a single one', () => {
    expect(
      findingsFrom([
        encodeFindingGroup('block', 'multi-row-team', 1, [4]),
        encodeFindingGroup('warn', 'lone-runner', 2, [5, 6]),
      ]),
    ).toHaveLength(2);
  });

  /**
   * ⚠️ **Both halves are closed lists, so a typed URL selects wording written in this
   * repository or nothing at all.** Nothing from the query string is ever itself the sentence.
   */
  it('ignores a severity, a kind or a row number nobody wrote down', () => {
    expect(findingsFrom('shouting.lone-runner.1.4')).toEqual([]);
    expect(findingsFrom('warn.not-a-kind.1.4')).toEqual([]);
    expect(findingsFrom('warn.constructor.1.4')).toEqual([]);
    expect(findingsFrom('warn.lone-runner.1.four')).toEqual([]);
    expect(findingsFrom('warn.lone-runner.many.4')).toEqual([]);
    expect(findingsFrom('warn.lone-runner')).toEqual([]);
    expect(findingsFrom(undefined)).toEqual([]);
  });

  it('caps how much of a bad file crosses, and never silently loses the rest', () => {
    const rows = Array.from({ length: 250 }, (_, i) => i + 1);
    const [group] = findingsFrom(
      encodeFindingGroup('block', 'missing-required-field', rows.length, rows),
    );

    expect(group!.rows).toHaveLength(MAX_FINDING_ROWS);
    // The total is what lets the page say "and 238 more" rather than pretending there were 12.
    expect(group!.total).toBe(250);
  });

  it('caps how many kinds cross', () => {
    const many = Array.from({ length: MAX_FINDING_GROUPS + 5 }, () =>
      encodeFindingGroup('warn', 'lone-runner', 1, [1]),
    );

    expect(findingsFrom(many)).toHaveLength(MAX_FINDING_GROUPS);
  });
});
