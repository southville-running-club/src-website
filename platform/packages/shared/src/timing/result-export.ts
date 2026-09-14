/**
 * The results export — one row per team that has a result, ranked.
 *
 * ⚠️ **Written here rather than ported.** [#205](https://github.com/southville-running-club/src-website/issues/205)
 * says *"copy `lib/result-export.ts` with its tests"*, and
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * reads `bindalshah/src-race-timing` as the **specification rather than the source** — and
 * `CLAUDE.md` makes reaching into that repository a stop-and-ask. So this is built from the
 * issue's own description of what the file must do, and the three rules it names are the three
 * things `timing-result-export.test.ts` asserts.
 *
 * ## The three rules the issue states, and why each is the one that costs something
 *
 * **Finishers ranked, then DNS/DNF/DQ with a null position, pending teams absent.** A team
 * still on the course has no result yet, and putting them in a file somebody sends to a race
 * director makes the file wrong the moment they cross. A team who did not start does have a
 * result — it is "did not start" — and it belongs in the record with no position beside it,
 * because a position is a claim about a finishing order they were not in.
 *
 * **Bibs are runner-driven.** `teamEffectiveBibs()` is *leg*-driven, which is right for the
 * collision guard and wrong here: a relay team whose second runner never turned up has two
 * resolvable leg bibs and one person, so the leg-driven answer prints a number nobody wore.
 * The runners are what was on the start line, so the runners decide which bibs appear.
 *
 * **Every duration is `durationToHMSss`**, which is the fixed `HH:MM:SS.ss` shape
 * `results.ts` built for exactly this: the live board switches shape by length for
 * readability, and a column that changes shape halfway down sorts as text in the wrong order.
 * A missing duration is an **empty cell** rather than an em-dash — a literal `—` is not a time
 * and breaks whatever the club's results provider does with the file next.
 *
 * ## What it does not do
 *
 * **No formatting, no file.** This builds rows; `resultExportCsv()` below is the one that
 * reaches `csv.ts`, and `xlsx.ts` takes the same rows. Keeping the derivation separate from
 * both is what lets one set of assertions cover a CSV and a workbook that can never disagree.
 */

import { csvDocument } from '../csv';
import { effectiveBib, type EventFormat, type Leg } from './bib';
import {
  buildResults,
  durationToHMSss,
  isTerminalStatus,
  sortResults,
  type Result,
} from './results';
import { resultCategoryLabel } from './result-category';
import type { TimingCrossing, TimingEvent, TimingRunner, TimingTeam } from './rows';

/** A team as an export reads it: the timing row, plus the names and the runners on it. */
export type ExportTeam = TimingTeam & {
  name?: string | null;
  runners: TimingRunner[];
};

/**
 * One line of the file.
 *
 * Every field is already **text**, including the ones that look like numbers. `position` is the
 * exception and is kept as a number so a caller can sort or count without parsing it back;
 * `xlsx.ts` writes it as an inline string like everything else, which is what stops Excel
 * turning a bib of `"0311"` into `311`.
 */
export interface ResultExportRow {
  /** 1-based among finishers, or `null` for a DNS, DNF or DQ. */
  position: number | null;
  /** `311`, or `1311 / 2311` for a relay pair — one entry per **runner**, in leg order. */
  bibs: string;
  teamNumber: string;
  teamName: string;
  /** `Ada Lovelace`, or `Ada Lovelace & Grace Hopper`. */
  runners: string;
  /** `Women's Vet 40`, `Mixed Pair`, or empty when the club has not placed them. */
  category: string;
  /** Relay only: the handover split. Empty on a solo race, which has no legs. */
  legA: string;
  /** Relay only: the second leg. Empty on a solo race. */
  legB: string;
  /** `HH:MM:SS.ss`, or empty for a team with no time. */
  total: string;
  /** Empty for a finisher; `DNS`, `DNF` or `DQ` otherwise. */
  status: string;
  /** `Yes` when a capture behind this row is still flagged, empty otherwise. */
  beingChecked: string;
}

/**
 * The column headings, in order. Exported because the CSV, the workbook and the assertions
 * all have to agree about them, and a second list is the defect `formatPence()`'s header warns
 * about one layer down.
 *
 * ⚠️ **`Leg A` and `Leg B` are in the header even on a solo race**, with empty cells beneath.
 * A file whose columns depend on the race is a file a spreadsheet template cannot be built
 * against, and the club opens these in Excel by hand.
 */
export const RESULT_EXPORT_HEADER = [
  'Position',
  'Bib',
  'Team number',
  'Team',
  'Runner',
  'Category',
  'Leg A',
  'Leg B',
  'Total',
  'Status',
  'Being checked',
] as const;

/** `DNS` / `DNF` / `DQ`, uppercased for a column somebody scans. */
function statusWord(status: Result['status']): string {
  return isTerminalStatus(status) ? status.toUpperCase() : '';
}

/**
 * The bibs this team's **runners** wore, in leg order.
 *
 * ⚠️ See the header: a lone-runner relay team shows one bib. `effectiveBib` resolves the
 * override the desk may have written over the derived number, per leg, so a corrected bib is
 * the one that appears.
 */
export function runnerBibs(team: ExportTeam, format: EventFormat): string[] {
  // **A solo entry has one bib and no leg prefix, whatever its runner rows say.** The number
  // belongs to the place in the race rather than to the person, so a solo team with no runner
  // recorded still resolves its own bib — which is the row a volunteer needs in order to work
  // out who that capture was.
  const legs: Leg[] =
    format === 'solo'
      ? [1]
      : [...new Set(team.runners.map((runner) => runner.leg))]
          .filter((leg): leg is Leg => leg === 1 || leg === 2)
          .sort((a, b) => a - b);

  return legs
    .map((leg) => effectiveBib(team, leg, format))
    .filter((bib): bib is string => bib !== null);
}

function runnerNames(team: ExportTeam): string {
  return team.runners
    .slice()
    .sort((a, b) => a.leg - b.leg)
    .map((runner) => `${runner.firstname} ${runner.lastname}`.trim())
    .filter((name) => name !== '')
    .join(' & ');
}

/**
 * The file's rows, derived from the same three inputs the leaderboard reads.
 *
 * `sortResults(_, 'total')` already partitions every terminal status below every timed and
 * in-progress team and orders the rest by total time, so walking it in order and counting the
 * finishers is the placing — the identical rule `/nn/<year>/results/` uses to number its own
 * table, which is why the published page and the file cannot disagree about who came third.
 */
export function buildExportRows(
  event: Pick<TimingEvent, 'actually_started_at' | 'start_at' | 'format'>,
  teams: ExportTeam[],
  crossings: Pick<
    TimingCrossing,
    'bib' | 'captured_at' | 'anomaly_flag' | 'resolved_at' | 'resolved_action'
  >[],
): ResultExportRow[] {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const sorted = sortResults(buildResults(event, teams, crossings), 'total');

  const rows: ResultExportRow[] = [];
  let finished = 0;

  for (const result of sorted) {
    const terminal = isTerminalStatus(result.status);

    // ⚠️ **Pending teams are absent, and `leg1` is pending.** A relay team that has handed over
    // and not finished has no total, so a row for them would carry a blank time with no status
    // to explain it — which reads as a finisher whose clock was lost.
    if (!terminal && result.status !== 'finished') continue;

    const team = byId.get(result.team.id);
    if (team === undefined) continue;

    if (!terminal) finished += 1;

    rows.push({
      position: terminal ? null : finished,
      bibs: runnerBibs(team, event.format).join(' / '),
      teamNumber: team.team_number ?? '',
      teamName: team.name ?? '',
      runners: runnerNames(team),
      category: resultCategoryLabel(team.runners, event.format, team.category) ?? '',
      // A solo race has no legs at all, so the two columns are blank rather than repeating the
      // total — `buildResults` already leaves both null there, and this states it once more
      // where somebody reading the file would otherwise wonder.
      legA:
        event.format === 'solo'
          ? ''
          : durationToHMSss(result.splitAMs, { nullValue: '' }),
      legB:
        event.format === 'solo'
          ? ''
          : durationToHMSss(result.splitBMs, { nullValue: '' }),
      total: durationToHMSss(result.totalMs, { nullValue: '' }),
      status: statusWord(result.status),
      // ⚠️ **A published race can never carry one** — publication is refused while an anomaly is
      // open — so this column is only ever non-empty on a **preview** export. It is here
      // because that is exactly when somebody is checking, and a file that quietly dropped the
      // warning would be the confidently-wrong answer `results.ts` exists to avoid.
      beingChecked: result.hasOpenAnomaly ? 'Yes' : '',
    });
  }

  return rows;
}

/** One row as the flat field list the CSV and the workbook both write. */
export function resultExportFields(row: ResultExportRow): string[] {
  return [
    row.position === null ? '' : String(row.position),
    row.bibs,
    row.teamNumber,
    row.teamName,
    row.runners,
    row.category,
    row.legA,
    row.legB,
    row.total,
    row.status,
    row.beingChecked,
  ];
}

/**
 * The whole file, through `csv.ts` — which owns the byte-order mark, the CRLF endings, RFC 4180
 * quoting and the formula guard, so that no caller has to remember any of them.
 */
export function resultExportCsv(rows: readonly ResultExportRow[]): string {
  return csvDocument([...RESULT_EXPORT_HEADER], rows.map(resultExportFields));
}
