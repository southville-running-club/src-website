import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAccountDetails } from '../../src/account';

/**
 * `/account/details/`'s date-of-birth validator, and the one thing about it that depends on
 * what time it is — [#298](https://github.com/southville-running-club/src-website/issues/298).
 *
 * ## Why a fixed clock, and why *that* hour
 *
 * The rule under test is "a date of birth cannot be in the future", which means comparing
 * what somebody typed against **today**. There are two answers to "today" and they differ for
 * one hour a day for seven months of the year: `new Date().toISOString().slice(0, 10)` is
 * today in **UTC**, and this repository's answer is today in **`Europe/London`**.
 *
 * Between 00:00 and 01:00 London during British Summer Time, the UTC answer is *yesterday* —
 * so a member typing today's date was told it was in the future, by a validator that is right
 * about everything else. **Every assertion below is inside that hour**, because outside it
 * both answers agree and the test would pass against the defect.
 *
 * ⚠️ **`vitest.config.ts` pins `TZ=UTC`**, which is what makes this legible rather than what
 * makes it work: the production code names `Europe/London` explicitly through
 * `london-time.ts`, so the ambient zone changes nothing. What the pin buys is that
 * `2026-06-15T23:30:00Z` is unambiguously 00:30 on 16 June in London on any machine, CI
 * included.
 */

/** 00:30 on 16 June 2026 in London — 23:30 on the 15th in UTC. Deep inside BST. */
const BST_MIDNIGHT_HOUR = new Date('2026-06-15T23:30:00Z');

/** 00:30 on 16 January 2026 in London, which is also 00:30 UTC. GMT, so the two agree. */
const GMT_MIDNIGHT_HOUR = new Date('2026-01-16T00:30:00Z');

/** The rest of the form, so nothing else can be what fails. */
const details = (day: string, month: string, year: string) => ({
  name: 'Robin Vale',
  email: 'robin@example.com',
  gender: '',
  dob_day: day,
  dob_month: month,
  dob_year: year,
  address: '',
  dobDay: day,
  dobMonth: month,
  dobYear: year,
});

afterEach(() => {
  vi.useRealTimers();
});

function at(instant: Date): void {
  vi.useFakeTimers();
  vi.setSystemTime(instant);
}

describe('a date of birth is in the future according to London, not to UTC', () => {
  it('accepts today, typed at 00:30 on a British Summer Time morning', () => {
    // **The assertion that fails before the fix.** `todayIso()` answered `2026-06-15` here,
    // so `2026-06-16 > 2026-06-15` and the form refused a date that is not in the future.
    at(BST_MIDNIGHT_HOUR);

    const parsed = parseAccountDetails(details('16', '6', '2026'));

    expect(parsed.ok).toBe(true);
  });

  it('still refuses tomorrow in that same hour', () => {
    // The other side of the boundary, because a fix that simply stopped comparing would
    // pass the test above and break the rule. 17 June is genuinely in the future at 00:30
    // on the 16th, whichever zone is asked.
    at(BST_MIDNIGHT_HOUR);

    const parsed = parseAccountDetails(details('17', '6', '2026'));

    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.errors.dateOfBirth).toBe(
      'A date of birth cannot be in the future.',
    );
  });

  it('refuses the London day after, which UTC still calls today', () => {
    // ⚠️ **The mirror of the first case, and the one a UTC implementation gets wrong in the
    // permissive direction.** At 00:30 BST on 16 June, UTC is still on the 15th — so a UTC
    // `todayIso()` would compare against `2026-06-15` and cheerfully accept `2026-06-16`
    // *as well as* everything up to it. Asserting only that today is accepted would pass
    // against the defect for the wrong reason; this is the pair that pins the day exactly.
    at(new Date('2026-06-15T23:59:59Z'));

    expect(parseAccountDetails(details('16', '6', '2026')).ok).toBe(true);
    expect(parseAccountDetails(details('17', '6', '2026')).ok).toBe(false);
  });

  it('accepts today in the same hour during GMT, when the two zones agree', () => {
    // The control. Seven months of the year there is no drift at all, which is why this
    // survived to be found by a hygiene commit rather than by a member.
    at(GMT_MIDNIGHT_HOUR);

    expect(parseAccountDetails(details('16', '1', '2026')).ok).toBe(true);
    expect(parseAccountDetails(details('17', '1', '2026')).ok).toBe(false);
  });

  it('leaves every other date-of-birth rule alone', () => {
    // A real date of birth, an impossible day, and all three boxes blank — none of which
    // the clock has any business changing.
    at(BST_MIDNIGHT_HOUR);

    expect(parseAccountDetails(details('15', '6', '1990')).ok).toBe(true);
    expect(parseAccountDetails(details('31', '2', '1990')).ok).toBe(false);
    expect(parseAccountDetails(details('', '', '')).ok).toBe(true);
  });
});
