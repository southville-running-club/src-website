import { describe, expect, it } from 'vitest';
import { medicalRetentionWording } from '../../src/medical-retention';

/**
 * The wording the privacy notice publishes, generated from the period the database enforces.
 *
 * This module exists so those two cannot drift, and `packages/db/tests/entries-retention.test.ts`
 * is where the drift is actually caught — it reads the column out of Postgres and `race.json`
 * off disk and compares them through this. What is tested here is the function itself, against
 * the shapes Postgres really emits for an `interval`.
 */

describe('medicalRetentionWording', () => {
  it('turns the enforced month into exactly what /nn/privacy/ says today', () => {
    // `interval '1 month'` renders as `1 mon`, and `race.json` says "One month after the race".
    expect(medicalRetentionWording('1 mon')).toBe('One month after the race');
  });

  it('spells small numbers as words and pluralises', () => {
    expect(medicalRetentionWording('2 mons')).toBe('Two months after the race');
    expect(medicalRetentionWording('6 mons')).toBe('Six months after the race');
    expect(medicalRetentionWording('1 year')).toBe('One year after the race');
    expect(medicalRetentionWording('2 years')).toBe('Two years after the race');
    expect(medicalRetentionWording('7 days')).toBe('Seven days after the race');
    expect(medicalRetentionWording('1 day')).toBe('One day after the race');
  });

  it('falls back to digits above twelve, where a word stops being shorter', () => {
    expect(medicalRetentionWording('18 mons')).toBe('18 months after the race');
  });

  it('is not fooled by case or by surrounding space', () => {
    // Postgres is consistent; a hand-written value in a migration is not.
    expect(medicalRetentionWording('  1 MON  ')).toBe('One month after the race');
  });

  it('answers null for a period it cannot say in one clause', () => {
    // **A null fails the drift test, which is the point.** A retention period this cannot
    // describe is one the notice cannot honestly describe either, and the right place to find
    // that out is a red test rather than a page that says "To be confirmed by the club" about
    // something that is very much confirmed.
    expect(medicalRetentionWording('1 mon 15 days')).toBeNull();
    expect(medicalRetentionWording('00:00:00')).toBeNull();
    expect(medicalRetentionWording('0')).toBeNull();
    expect(medicalRetentionWording('1 mon 02:00:00')).toBeNull();
    expect(medicalRetentionWording('')).toBeNull();
  });
});
