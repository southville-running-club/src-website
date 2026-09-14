import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_WORDS,
  lifecycleStateFor,
  resultsOutcomeFor,
} from '../../lib/results-outcomes';

/**
 * What the results screen says afterwards — #205.
 *
 * The sixth module of this shape, and the two assertions specific to it are the ones the wording
 * was written carefully for:
 *
 *   * ⚠️ **publishing must say "public"**, because a volunteer who read the sentence as an
 *     internal confirmation has just put a table of names on the open internet;
 *   * ⚠️ **unpublishing must say the page has gone**, because that is the fact somebody needs
 *     before answering a spectator asking where the results went.
 */

const REASONS = [
  'published',
  'already_published',
  'unpublished',
  'not_published',
  'not_finished',
  'open_anomalies',
  'no_such_event',
  'incomplete',
  'refused',
  'unavailable',
];

describe('every outcome the results screen can be sent', () => {
  it.each(REASONS.map((reason) => [reason]))('%s is answered in prose', (reason) => {
    const outcome = resultsOutcomeFor(reason);

    expect(outcome).not.toBeNull();
    // No reason slug reaches a volunteer — the five sibling modules' rule.
    expect(outcome?.message).not.toContain('_');
    expect(outcome?.message.slice(-1)).toBe('.');
  });

  it('says nothing at all for a value nobody wrote down', () => {
    expect(resultsOutcomeFor('whatever')).toBeNull();
    expect(resultsOutcomeFor(undefined)).toBeNull();
    // ⚠️ `Object.hasOwn` rather than `?? null`: an object literal inherits from
    // `Object.prototype`, so a bare index would hand back a function here.
    expect(resultsOutcomeFor('toString')).toBeNull();
    expect(resultsOutcomeFor('constructor')).toBeNull();
  });
});

describe('the two sentences that decide what somebody does next', () => {
  it('says publishing made the results public, in as many words', () => {
    const message = resultsOutcomeFor('published')?.message ?? '';

    expect(message).toContain('published');
    // The word that stops this reading as an internal confirmation.
    expect(message).toMatch(/anybody can read/i);
    expect(resultsOutcomeFor('published')?.tone).toBe('ok');
  });

  it('says unpublishing took the page down, rather than only that it worked', () => {
    const message = resultsOutcomeFor('unpublished')?.message ?? '';

    expect(message).toMatch(/not found/i);
    expect(message).toMatch(/no longer published/i);
  });

  it('treats a refused publication as bad and an outage as neither a refusal nor a success', () => {
    expect(resultsOutcomeFor('not_finished')?.tone).toBe('bad');
    expect(resultsOutcomeFor('open_anomalies')?.tone).toBe('bad');

    // ⚠️ **An outage may never be rendered as a refusal** — `writes.ts`' header. The sentence
    // has to say the database could not be reached and that nothing changed.
    const unavailable = resultsOutcomeFor('unavailable')?.message ?? '';
    expect(unavailable).toMatch(/could not be reached/i);
    expect(unavailable).toMatch(/nothing was changed/i);
  });

  it('does not tell somebody a repeated press failed', () => {
    // Pressing publish twice is an ordinary thing to do on two devices; nothing is wrong.
    expect(resultsOutcomeFor('already_published')?.tone).toBe('ok');
  });
});

describe('the lifecycle state', () => {
  it('derives all three from the two timestamps and never from a third column', () => {
    expect(lifecycleStateFor({ finished_at: null, results_published_at: null })).toBe(
      'capturing',
    );
    expect(
      lifecycleStateFor({
        finished_at: '2026-11-01T13:00:00Z',
        results_published_at: null,
      }),
    ).toBe('finished');
    expect(
      lifecycleStateFor({
        finished_at: '2026-11-01T13:00:00Z',
        results_published_at: '2026-11-01T18:00:00Z',
      }),
    ).toBe('published');
  });

  /**
   * ⚠️ **A published race with no `finished_at` is still published**, and that is deliberate
   * rather than an oversight. The state machine has no arrow into it — `reopen_event()` refuses
   * a published race precisely so it cannot happen — but if a row ever reached it, saying
   * "capturing" about a table the public is reading would be the dangerous of the two answers.
   */
  it('answers published even for a row the state machine cannot produce', () => {
    expect(
      lifecycleStateFor({
        finished_at: null,
        results_published_at: '2026-11-01T18:00:00Z',
      }),
    ).toBe('published');
  });

  it('gives every state a label and a sentence about who can see the table', () => {
    for (const state of ['capturing', 'finished', 'published'] as const) {
      const words = LIFECYCLE_WORDS[state];
      expect(words.label.length).toBeGreaterThan(0);
      expect(words.detail.slice(-1)).toBe('.');
    }

    // The two that have to be unambiguous about the audience.
    expect(LIFECYCLE_WORDS.capturing.detail).toMatch(/nobody outside this page/i);
    expect(LIFECYCLE_WORDS.published.detail).toMatch(/public/i);
  });
});
