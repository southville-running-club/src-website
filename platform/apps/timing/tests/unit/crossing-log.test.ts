import { describe, expect, it } from 'vitest';
import {
  CROSSING_LOG_LIMIT,
  crossingLogArgs,
  crossingLogCapped,
  crossingLogCount,
} from '../../lib/crossing-log';

/**
 * The timing log's read and its count — `lib/crossing-log.ts`, which carries why. The database
 * half, that `crossing_log()` defaults to 200 and honours 1,000, is
 * `packages/db/tests/timing.test.ts`'s.
 */
describe('what the timing log asks crossing_log() for', () => {
  it('asks for the ceiling, never the default of 200', () => {
    // ⚠️ The regression this guards: dropping `p_limit` reads as harmless and silently hides
    // every capture older than the newest 200 — the first finishers.
    expect(crossingLogArgs('nn-2026', '')).toEqual({
      p_event_slug: 'nn-2026',
      p_search: null,
      p_limit: 1000,
    });
    expect(CROSSING_LOG_LIMIT).toBe(1000);
  });

  it('passes a search through, and a blank one as none', () => {
    expect(crossingLogArgs('nn-2026', '042')).toMatchObject({ p_search: '042' });
    expect(crossingLogArgs('nn-2026', '')).toMatchObject({ p_search: null });
  });
});

describe('how the timing log counts what came back', () => {
  it('states a total when the list is under the ceiling', () => {
    expect(crossingLogCount(0, '')).toBe('0 captures');
    expect(crossingLogCount(1, '')).toBe('1 capture');
    expect(crossingLogCount(237, '')).toBe('237 captures');
    expect(crossingLogCount(2, '042')).toBe('2 captures matching');
    expect(crossingLogCapped(999)).toBe(false);
  });

  it('never claims a total at the ceiling, because it cannot know one', () => {
    expect(crossingLogCapped(1000)).toBe(true);
    expect(crossingLogCount(1000, '')).toBe('newest 1000 captures');
    expect(crossingLogCount(1000, '042')).toBe('newest 1000 captures matching');
  });
});
