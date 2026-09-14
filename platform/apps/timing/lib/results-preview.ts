import type {
  TimingCrossing,
  TimingEvent,
  TimingRunner,
  TimingTeam,
} from '@src/shared/timing/rows';
import { readTiming, type TimingRead } from './reads';

/**
 * The one read behind the results preview, the prize presenter and both exports — #205.
 *
 * ## ⚠️ `results_preview()` and not `results_for_event()`
 *
 * `identity-permissions.test.ts` says out loud that `timing-admin` deliberately does **not**
 * hold `nn.results.read` — *"running a race and seeing its results before they are public are
 * different powers"* — and `results_for_event()` consults exactly that permission before
 * publication. So it answers `null` to the person these four surfaces are for.
 * `20260914140000`'s header carries the finding; this type is the shape of the answer that does
 * come back.
 *
 * **Two columns are here that the public answer may never carry**, and both are needed to get a
 * category and a prize list right rather than to read one:
 *
 * | | |
 * | --- | --- |
 * | `runners.role` | a guide is in no category and no prize ([ADR-022](../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md)) — and publishing the role publishes, by inference, that their runner is visually impaired |
 * | `runners.result_placement` | [ADR-031](../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s raw answer. The category derived from it is published; the answer itself is not |
 *
 * ## Declared here because there is nothing to generate from
 *
 * `rows.ts`' reasoning, and `apps/main/worker/nn-results.ts` declares the narrower public
 * payload the same way. The team and runner rows are **wider** than the structural minimums the
 * timing logic reads, which is exactly what those `Pick`-shaped types are for.
 */
export interface ResultsPreview {
  event: TimingEvent & {
    slug: string;
    name: string;
    finished_at: string | null;
    /** Set by `timing.publish_results()` — #241 and ADR-042. Null means not public. */
    results_published_at: string | null;
  };
  /**
   * How many captures on this race would refuse publication.
   *
   * ⚠️ **From `open_anomaly_count()`, which is the *same expression* `publish_results()` refuses
   * on** — so the number on the page and the number in the refusal cannot drift apart. It is a
   * superset of the flagged captures: an orphan whose bib matched no team blocks publication and
   * carries no flag.
   */
  open_anomalies: number;
  teams: (TimingTeam & { name: string | null; runners: TimingRunner[] })[];
  crossings: TimingCrossing[];
}

/** One team as this payload carries it — the timing row, the name, and the runners on it. */
export type PreviewTeam = ResultsPreview['teams'][number];

export function readResultsPreview(slug: string): Promise<TimingRead<ResultsPreview>> {
  return readTiming<ResultsPreview>('results_preview', { p_event_slug: slug });
}
