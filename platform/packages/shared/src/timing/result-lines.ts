/**
 * The rows of a results table, in finishing order — every entry, and each visually impaired
 * runner's guide on a row of their own.
 *
 * ## Why a guide needed a row of their own
 *
 * `import_from_entries()` puts a visually impaired runner on **leg 1** and their guide on
 * **leg 2** of one solo team — [ADR-022](../../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md)
 * — and since [ADR-061](../../../../../docs/architecture/decisions/adr-061-a-guide-wears-a-number-of-their-own.md)
 * the guide wears a race number of their own, the leg-2 override, which marshals capture like
 * anybody's. `buildResults()` times a solo team from its leg-1 number alone, which is right for
 * the team: the entry's result is the runner's. So a guide's crossing was captured, matched to
 * their runner's entry, and then read by nothing. Their time existed and no table showed it.
 *
 * [ADR-073](../../../../../docs/architecture/decisions/adr-073-a-guide-has-a-time-of-their-own.md)
 * puts it on the table, and this module is the one place that does it, so the published page, the
 * staff preview and the results export cannot disagree about who is listed or who came third.
 *
 * ## The four rules, and where each comes from
 *
 * | | |
 * | --- | --- |
 * | **A guide is timed exactly as an entry is** | Their own number is handed to `buildResults()` as a solo team's leg-1 bib, carrying the team's status — so the start, the earliest capture, a discard, an open anomaly and DNS / DNF / DQ all work the way they do for everybody, from code that already does it |
 * | **A guide is listed only when their own number was captured** | A guide row with no crossing would read "On course" — or, once a race is over, a time the club failed to record — about somebody who ran beside a runner the table already lists. Without a capture there is nothing of theirs to show |
 * | **A guide is placed like anybody who finished** | [ADR-074](../../../../../docs/architecture/decisions/adr-074-a-guide-takes-a-place-in-the-finishing-order.md), superseding ADR-073's "no position": an unnumbered row with a time read to the race's own organisers as a result the club had lost. A place in the finishing order is still not a prize — ADR-022 keeps a guide in no category, and `awards.ts` never reads these lines |
 * | **An entry's row is drawn as it was** | Its time, status and the entry count are what they were without this module; its position counts the finishers ahead of it, guides included |
 *
 * ## ⚠️ What this module cannot see is whether the page may say "guide"
 *
 * It knows which row is a guide's and hands the runner row back; the page decides the words. The
 * published page never says it — "this is a guide" says "the runner beside them is visually
 * impaired", which is Article 9 data about a named person (ADR-022, ADR-043) — and the staff
 * preview does. **A guide is recognised by being on leg 2 of a solo team**, never by `role`
 * alone, because `results_for_event()` withholds `role` once a race is published: the published
 * answer has no other way to say which row is which.
 */

import { effectiveBib, type EventFormat } from './bib';
import { buildResults, sortResults, type Result } from './results';
import type { TimingCrossing, TimingEvent, TimingRunner, TimingTeam } from './rows';

/** What this module reads about a runner: which leg, and whatever the answer says of the role. */
export type LineRunner = Pick<TimingRunner, 'leg' | 'role'>;

/**
 * A team as a results page holds it — the structural minimum plus its runners. A page's fuller
 * row, names and all, is accepted and handed back, which is what lets a guide's row print a name.
 */
export type LineTeam = TimingTeam & { runners: readonly LineRunner[] };

/** Whatever runner row the caller's team carries. */
type RunnerOf<T extends LineTeam> = T['runners'][number];

type LineEvent = Pick<TimingEvent, 'actually_started_at' | 'start_at' | 'format'>;

type LineCrossing = Pick<
  TimingCrossing,
  'bib' | 'captured_at' | 'anomaly_flag' | 'resolved_at' | 'resolved_action'
>;

/** An entry's row — exactly the row the page drew before guides had one. */
export type EntryLine<T> = {
  kind: 'entry';
  result: Result;
  /** The payload's own team row, joined back on by id; undefined only if the two disagree. */
  team: T | undefined;
  /** The finishing position, or null for a row that has none: still out, or DNS / DNF / DQ. */
  position: number | null;
};

/** A guide's time, from their own number — what `guideResults()` finds, before anybody is placed. */
export type GuideTime<T extends LineTeam> = {
  kind: 'guide';
  result: Result;
  /** The entry the guide is on — the runner they ran beside is its leg 1. */
  team: T;
  guide: RunnerOf<T>;
  /** The number the guide wore, which is what their time was read from. */
  bib: string;
};

/**
 * A guide's row: their own time and their place in the finishing order — ADR-074.
 *
 * `position` follows exactly the entry rule: a number for a guide who finished, null for one
 * whose entry did not start, did not finish or was disqualified.
 */
export type GuideLine<T extends LineTeam> = GuideTime<T> & {
  position: number | null;
};

export type ResultLine<T extends LineTeam> = EntryLine<T> | GuideLine<T>;

/**
 * The guide on a team, or null.
 *
 * **Solo only, and leg 2 only.** On a relay leg 2 is the second runner of a pair and has always
 * been timed as the team's finish. On a solo race the import puts nobody on leg 2 but a guide.
 *
 * ⚠️ **A null `role` is accepted and `'runner'` is not.** Null is the published answer, which
 * withholds the column for everybody; a `'runner'` on leg 2 of a solo team is a shape nothing
 * writes, and treating it as a guide would be guessing in the direction that publishes a row.
 */
export function guideOn<A extends readonly LineRunner[]>(
  runners: A,
  format: EventFormat,
): A[number] | null {
  if (format !== 'solo') return null;
  return runners.find((runner) => runner.leg === 2 && runner.role !== 'runner') ?? null;
}

/**
 * One row per guide whose own number was captured, timed by `buildResults()` itself.
 *
 * The guide is handed over as a team of one whose leg-1 bib is the guide's number and whose
 * status is the entry's, which is the whole trick: every rule about a time — the start that
 * actually happened, the earliest capture, a discarded one, an open anomaly, and a terminal
 * label suppressing the time — is the code every other row is timed by, not a second copy.
 *
 * **The team number is the entry's own**, which is true — the guide is on that entry — and is
 * what makes an exact tie with their runner sort the runner first.
 */
export function guideResults<T extends LineTeam>(
  event: LineEvent,
  teams: T[],
  crossings: LineCrossing[],
): GuideTime<T>[] {
  const lines: GuideTime<T>[] = [];

  for (const team of teams) {
    const guide = guideOn(team.runners, event.format);
    if (guide === null) continue;

    // Since ADR-061 a solo leg 2 derives nothing, so this is the number the desk or Assign bibs
    // wrote in for the guide, or null if nobody has.
    const bib = effectiveBib(team, 2, event.format);
    if (bib === null) continue;

    const asTimed: TimingTeam = {
      id: team.id,
      team_number: team.team_number,
      bib_leg1: bib,
      bib_leg2: null,
      category: null,
      race_status: team.race_status,
      dnf_at: team.dnf_at,
    };

    const [result] = buildResults({ ...event, format: 'solo' }, [asTimed], crossings);

    // `finishAt` is the earliest counted capture of the guide's number, set whatever the
    // status — so this is "was their number captured", and nothing else.
    if (result === undefined || result.finishAt === null) continue;

    lines.push({ kind: 'guide', result, team, guide, bib });
  }

  return lines;
}

/**
 * Every row of the table, in the order a results page draws them.
 *
 * `sortResults(…, 'total')` orders entries and guides together — a guide sits where their time
 * puts them, which is almost always straight after the runner they guided — and **one running
 * count numbers every finisher, guide or entry**, so the table reads 1, 2, 3 with no gap and no
 * unnumbered row (ADR-074). A runner behind a guide is therefore one place lower than they were
 * under ADR-073, which is the cost that decision was avoiding and this one accepts.
 */
export function resultLines<T extends LineTeam>(
  event: LineEvent,
  teams: T[],
  crossings: LineCrossing[],
): ResultLine<T>[] {
  const entries = buildResults(event, teams, crossings);
  const guides = guideResults(event, teams, crossings);

  // `sortResults` copies the array and keeps every object, so a guide's `Result` is still the
  // same object afterwards and can be looked up by identity — its `team.id` is the entry's.
  const guideFor = new Map(guides.map((line) => [line.result, line]));
  const byId = new Map(teams.map((team) => [team.id, team]));

  let finished = 0;

  return sortResults([...entries, ...guides.map((line) => line.result)], 'total').map(
    (result): ResultLine<T> => {
      const placed = result.status === 'finished';
      if (placed) finished += 1;
      const position = placed ? finished : null;

      const guide = guideFor.get(result);
      if (guide !== undefined) return { ...guide, position };

      return {
        kind: 'entry',
        result,
        team: byId.get(result.team.id),
        position,
      };
    },
  );
}
