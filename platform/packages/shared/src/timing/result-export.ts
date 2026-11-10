/**
 * The results export — one row per team that has a result, and one per guide whose own number
 * was captured, ranked exactly as `/nn/<year>/results/` ranks them.
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
import { resultLines } from './result-lines';
import { durationToHMSss, isTerminalStatus, type Result } from './results';
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
  /** 1-based among finishers, guides included (ADR-074), or `null` for a DNS, DNF or DQ. */
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

/**
 * The names on an entry's row, in leg order.
 *
 * **A solo entry names its leg-1 runner only.** On a solo race leg 2 is a visually impaired
 * runner's guide, who has a row of their own in this file since ADR-074 — naming them on their
 * runner's row as well would list one person twice, at two different places.
 */
function runnerNames(team: ExportTeam, format: EventFormat): string {
  return team.runners
    .filter((runner) => format !== 'solo' || runner.leg === 1)
    .slice()
    .sort((a, b) => a.leg - b.leg)
    .map((runner) => `${runner.firstname} ${runner.lastname}`.trim())
    .filter((name) => name !== '')
    .join(' & ');
}

/**
 * The file's rows, derived from the same three inputs the leaderboard reads.
 *
 * **The rows and their places are `resultLines()`'s** — the function `/nn/<year>/results/` and
 * the staff preview draw their tables with — so the published page and the file cannot disagree
 * about who came third. Since [ADR-074](../../../../../docs/architecture/decisions/adr-074-a-guide-takes-a-place-in-the-finishing-order.md)
 * that includes a visually impaired runner's guide whose own number was captured: they are
 * placed on the page, so they are a row here too, or every place after them would differ
 * between the two.
 *
 * ⚠️ **A guide's row carries no category and no team.** The file goes to people outside the
 * club, and a row labelled as a guide says the runner beside them is visually impaired
 * (ADR-022) — the same reason the published page never says it.
 */
export function buildExportRows(
  event: Pick<TimingEvent, 'actually_started_at' | 'start_at' | 'format'>,
  teams: ExportTeam[],
  crossings: Pick<
    TimingCrossing,
    'bib' | 'captured_at' | 'anomaly_flag' | 'resolved_at' | 'resolved_action'
  >[],
): ResultExportRow[] {
  const rows: ResultExportRow[] = [];

  for (const line of resultLines(event, teams, crossings)) {
    const { result } = line;
    const terminal = isTerminalStatus(result.status);

    // ⚠️ **Pending teams are absent, and `leg1` is pending.** A relay team that has handed over
    // and not finished has no total, so a row for them would carry a blank time with no status
    // to explain it — which reads as a finisher whose clock was lost.
    if (!terminal && result.status !== 'finished') continue;

    const timing = {
      total: durationToHMSss(result.totalMs, { nullValue: '' }),
      status: statusWord(result.status),
      // ⚠️ **A published race can never carry one** — publication is refused while an anomaly is
      // open — so this column is only ever non-empty on a **preview** export. It is here
      // because that is exactly when somebody is checking, and a file that quietly dropped the
      // warning would be the confidently-wrong answer `results.ts` exists to avoid.
      beingChecked: result.hasOpenAnomaly ? 'Yes' : '',
    };

    if (line.kind === 'guide') {
      rows.push({
        position: line.position,
        bibs: line.bib,
        teamNumber: '',
        teamName: '',
        runners: `${line.guide.firstname} ${line.guide.lastname}`.trim(),
        category: '',
        legA: '',
        legB: '',
        ...timing,
      });
      continue;
    }

    const team = line.team;
    if (team === undefined) continue;

    rows.push({
      position: line.position,
      bibs: runnerBibs(team, event.format).join(' / '),
      teamNumber: team.team_number ?? '',
      teamName: team.name ?? '',
      runners: runnerNames(team, event.format),
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
      ...timing,
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
