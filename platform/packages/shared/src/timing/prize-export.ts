/**
 * The prize export — the list somebody reads out, written down.
 *
 * ⚠️ **Written here rather than ported**, for `result-export.ts`'s reason: ADR-034 reads the
 * old repository as the specification rather than the source, and `CLAUDE.md` makes reaching
 * into it a stop-and-ask.
 *
 * ## ⚠️ It consumes the presenter's resolved awards and never recomputes them
 *
 * This is the rule [#205](https://github.com/southville-running-club/src-website/issues/205)
 * states, and it is the whole reason the file takes `Award[]` rather than the three inputs
 * `computeAwards()` takes:
 *
 *   > the prize export consumes the presenter's resolved `Award[]`, so the published table
 *   > cannot disagree with what was announced.
 *
 * Two of the twelve awards are **random draws** whose winner is picked at the ceremony and
 * exists nowhere else; every award is subject to the presenter's *pass to next* exclusions,
 * which are a judgement somebody made in the room ("they have gone home"). A file that called
 * `computeAwards()` again would name a different winner than the one who was handed the prize,
 * and the club would find out when somebody checked.
 *
 * So the caller resolves the awards once and hands them to both the screen and this file.
 *
 * ## An unclaimed prize is a row
 *
 * An award with no winner — no eligible finisher in a band, or a draw not yet made — is still
 * a line in the file with an empty winner. Dropping it would make the file a list of *prizes
 * given* rather than *prizes offered*, and the club's own prize list is the second: "Women's
 * Vet 60 — nobody in the band this year" is the thing somebody wants to know next year.
 */

import { csvDocument } from '../csv';
import {
  isRandomDraw,
  type Award,
  type RunnerWinner,
  type TeamWinner,
  type TeamWithRunners,
} from './awards';
import { runnerBibs } from './result-export';
import type { EventFormat } from './bib';

/**
 * A team as a prize list reads it — `awards.ts`' shape plus the name a race may carry.
 *
 * ⚠️ **Widened rather than cast.** `TimingTeam` names only the columns the timing logic reads
 * and `name` is not one of them, so `award.winner.team.name` does not compile against `Award`
 * even though every real payload carries it. Casting would work and would be the thing
 * `awards.ts` already refuses to do — its `attach()` rejoins by id *"rather than casting so the
 * type system stays honest"*. An optional property is assignable from the narrower row, so a
 * plain `Award[]` out of `computeAwards()` is accepted here unchanged.
 */
export type PrizeTeam = TeamWithRunners & { name?: string | null };

/** One award, with that widened team on whichever kind of winner it carries. */
export type PrizeAward = Omit<Award, 'winner'> & {
  winner:
    (TeamWinner & { team: PrizeTeam }) | (RunnerWinner & { team: PrizeTeam }) | null;
};

/** One line of the file. Every field is text; see `result-export.ts` on why. */
export interface PrizeExportRow {
  /** `Women's Vet 40` — the award's own title, as the presenter's screen shows it. */
  prize: string;
  /** `Fastest female runner in the Vet 40 band`. */
  description: string;
  /** The runner or pair who won it, or empty. */
  winner: string;
  /** The bib or bibs they wore, or empty. */
  bibs: string;
  /** The team name, where the race has them, or empty. */
  team: string;
  /** The metric the award was won on, already formatted by `awards.ts`. Empty for no winner. */
  time: string;
  /** `Drawn` for a spot prize, empty otherwise — so nobody looks for a time beside one. */
  kind: string;
}

/** The column headings, in order. One list, for `RESULT_EXPORT_HEADER`'s reason. */
export const PRIZE_EXPORT_HEADER = [
  'Prize',
  'Description',
  'Winner',
  'Bib',
  'Team',
  'Time',
  'Notes',
] as const;

/**
 * The winner's name.
 *
 * A **runner** award names the person; a **team** award names everybody on the team, because a
 * relay pair collects together and a solo "team" is one person. `awards.ts` hands back the
 * whole row rather than an id precisely so that a prize list can print a name.
 */
function winnerName(award: PrizeAward): string {
  const winner = award.winner;
  if (winner === null) return '';

  if (winner.type === 'runner') {
    return `${winner.runner.firstname} ${winner.runner.lastname}`.trim();
  }

  return winner.team.runners
    .slice()
    .sort((a, b) => a.leg - b.leg)
    .map((runner) => `${runner.firstname} ${runner.lastname}`.trim())
    .filter((name) => name !== '')
    .join(' & ');
}

/**
 * The bib or bibs.
 *
 * ⚠️ **A runner award names one leg's bib, not the team's pair of them.** "Fastest Male Leg" is
 * won by one person over one leg; printing both numbers would send whoever is calling names out
 * looking for two people.
 */
function winnerBibs(award: PrizeAward, format: EventFormat): string {
  const winner = award.winner;
  if (winner === null) return '';

  // `PrizeTeam` is exactly the shape `runnerBibs` reads — the timing row, an optional name and
  // the runners — so the two exports resolve a bib the same way rather than twice.
  const team = winner.team;

  if (winner.type === 'runner') {
    const bibs = runnerBibs(team, format);
    // Leg 1 is index 0 on a relay and the only entry on a solo race, so the leg the award was
    // won on picks its own number without this file knowing how a bib is built.
    return bibs[winner.leg - 1] ?? bibs[0] ?? '';
  }

  return runnerBibs(team, format).join(' / ');
}

export function buildPrizeRows(
  awards: readonly PrizeAward[],
  format: EventFormat,
): PrizeExportRow[] {
  return awards.map((award) => ({
    prize: award.title,
    description: award.subtitle,
    winner: winnerName(award),
    bibs: winnerBibs(award, format),
    team: award.winner?.team.name ?? '',
    time: award.winner?.metricLabel ?? '',
    // ⚠️ A spot prize has no metric, so an empty Time column beside a named winner would read
    // as a lost time rather than as "there was never one".
    kind: isRandomDraw(award.kind) ? 'Drawn' : '',
  }));
}

/** One row as the flat field list the CSV and the workbook both write. */
export function prizeExportFields(row: PrizeExportRow): string[] {
  return [row.prize, row.description, row.winner, row.bibs, row.team, row.time, row.kind];
}

/** The whole file, through `csv.ts` — which owns the mark, the endings and the quoting. */
export function prizeExportCsv(rows: readonly PrizeExportRow[]): string {
  return csvDocument([...PRIZE_EXPORT_HEADER], rows.map(prizeExportFields));
}
