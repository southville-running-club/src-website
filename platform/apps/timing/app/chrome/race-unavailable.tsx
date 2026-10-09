import type { NavKey } from '../../lib/chrome';
import { RaceFrame } from './frames';
import { PageHead } from './page-head';

/**
 * What a race page says when the club's database could not be reached — **never "Not found"
 * for an outage** (`lib/reads.ts`' header): a page that says the race does not exist, during a
 * race, is the worst of the three answers. Said in one place, so the pages that split out of the
 * console in ADR-055 cannot each grow their own copy of it.
 */
export function RaceUnavailable({
  slug,
  current,
  title,
}: {
  slug: string;
  current: NavKey | null;
  title: string;
}) {
  return (
    <RaceFrame slug={slug} current={current}>
      <PageHead eyebrow="Admin" title={title} />
      <p className="club-notice timing-notice-bad">
        The club&rsquo;s database could not be reached, so this race could not be read.
        Nothing has been changed. Try again in a moment.
      </p>
    </RaceFrame>
  );
}
