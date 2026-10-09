import type { Metadata } from 'next';
import { cache } from 'react';
import type { EventDetail } from '../app/events/[slug]/sections/event-detail';
import { readTiming, type TimingRead } from './reads';

/**
 * Every page's own `<title>`, which was one string for the whole app until ADR-054: a tab strip
 * of six identical "Race timing" tabs on race night. Now it is "{Page} — {Race}", and the root
 * layout's template adds "— Southville Running Club" (brief §6.2 #3).
 *
 * **`event_detail()`, read once per request.** The race's overview, its console and its danger
 * zone already read it for their own content; through `readEventDetail` the title and the page
 * share that one read. The four other race pages read something else for their content, so a
 * title costs them one small extra read.
 *
 * `event_detail()` needs `timing.event.manage`. Somebody who reaches a race page without it —
 * the leaderboard and console also open to `timing.crossing.resolve` — gets "Race timing" in
 * place of the race's name rather than an error.
 */
const readEventDetailOnce = cache((slug: string) =>
  readTiming<unknown>('event_detail', { p_event_slug: slug }),
);

/**
 * The cached read, typed by the caller. The overview, the console and the danger zone each
 * declare the slice of `event_detail()`'s answer they use; it is one function's one answer, so
 * the cast is to the caller's own view of it, exactly what `readTiming<T>` already does.
 */
export function readEventDetail<T = EventDetail>(slug: string): Promise<TimingRead<T>> {
  return readEventDetailOnce(slug) as Promise<TimingRead<T>>;
}

/** "{page} — {race}", or "{race}" alone for its overview. */
export async function raceTitle(slug: string, page: string | null): Promise<Metadata> {
  const read = await readEventDetail(slug);
  const race = read.state === 'ok' ? read.data.name : 'Race timing';
  return { title: page === null ? race : `${page} — ${race}` };
}

/** The `generateMetadata` a race page exports, naming itself. */
export function raceMetadata(page: string | null) {
  return async ({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> =>
    raceTitle((await params).slug, page);
}
