/**
 * What the timing log on `/timing/events/<slug>/crossings` asks `timing.crossing_log()` for,
 * and how it counts what came back.
 *
 * ⚠️ **The page showed the newest 200 captures and called them "200 captures", on race day.**
 * `crossing_log()` takes a `p_limit` that defaults to **200** and is clamped to **1,000**
 * (`20260913220000_timing_resolve_anomalies.sql`), and the page never passed one — so once a
 * race had more than 200 captures the oldest fell off the bottom of the log, and the status
 * line, which counted the rows it had been handed, read as though that were all of them. Found
 * on 1 November 2026 with Nightingale Nightmare's field crossing the line: the first finishers
 * were the ones missing, which is the half a prize list is made of.
 *
 * **The page asks for the ceiling now, and that is every capture on any race this club
 * times** — a field of 250, guides included, is well under it. Raising the ceiling itself is
 * a migration, and the day a race has more than a thousand captures the page says so rather
 * than going quiet: {@link crossingLogCapped} is what tells it.
 */

/** `crossing_log()`'s own ceiling. Asking for more is clamped to this, not refused. */
export const CROSSING_LOG_LIMIT = 1000;

/** The arguments the timing log passes to `timing.crossing_log()`. A blank search is none. */
export function crossingLogArgs(
  slug: string,
  search: string,
): { p_event_slug: string; p_search: string | null; p_limit: number } {
  return {
    p_event_slug: slug,
    p_search: search === '' ? null : search,
    p_limit: CROSSING_LOG_LIMIT,
  };
}

/**
 * Whether the list may have stopped short of the race's captures. Exactly at the ceiling is
 * capped, because the function cannot say whether a 1,001st exists.
 */
export function crossingLogCapped(shown: number): boolean {
  return shown >= CROSSING_LOG_LIMIT;
}

/**
 * The status line's count. It names a total only when it has one: a capped list is "the
 * newest", never "1000 captures", which is the claim this module exists to stop the page
 * making.
 */
export function crossingLogCount(shown: number, search: string): string {
  const noun = shown === 1 ? 'capture' : 'captures';
  const matching = search === '' ? '' : ' matching';
  return crossingLogCapped(shown)
    ? `newest ${shown} ${noun}${matching}`
    : `${shown} ${noun}${matching}`;
}
