/**
 * The glue between what `parseRegistrationCsv()` produces and what
 * `timing.import_registration(p_event_slug, p_rows)` reads.
 *
 * ## Why this exists at all
 *
 * The two halves of [#202](https://github.com/southville-running-club/src-website/issues/202)
 * were built four days apart and never read against each other. The function's own header
 * documents the row shape it expects — `purchase_order_id`, `csv_row_index`, `name`,
 * `category`, `entry_type`, `runners[]` — and `ParsedTeam` is *nearly* that and not quite.
 * Handing the parser's output straight to PostgREST compiles, imports, and silently loses the
 * row order the roster is read back in.
 *
 * So the mapping is a named, tested function rather than an object literal written inline in a
 * route handler, for the reason every other boundary in this repository is: **the day the
 * function grows a key, one place learns about it.**
 *
 * ## The three keys that are not a straight copy
 *
 * - **`csv_row_index`** now comes off `ParsedTeam`, which gained it for this. `event_roster()`
 *   orders `csv_row_index nulls last`, so dropping it sorts a whole imported field arbitrarily.
 * - ⚠️ **`category` is always null, and that is the file being honest rather than a gap.** The
 *   Full On Sport export's `AgeCategory` column is empty in every row the club has, which is
 *   why `DROPPED_COLUMNS` lists it. `timing.teams.category` is a **relay pair** category —
 *   `categories.ts` derives it from two runners' genders at read time — so an importer that
 *   guessed one would be writing a derived value into a stored column and putting the two out
 *   of step the first time a runner was corrected. Null means *"derive it"*, which is what
 *   every reader already does.
 * - ⚠️ **An unrecognised gender is written as `null`, not `''`.** `parseRegistrationCsv()`
 *   maps into `entries`' vocabulary at its own boundary and yields the empty string for a
 *   value it does not recognise, which reads back through `normaliseTimingGender()` as no
 *   prize band either way. The column is nullable, and `add_walk_in()` already gives the
 *   argument for preferring null: the old application stored `""`, *"which is a value that
 *   reads as an address somebody has and is not one"*. The same is true of a gender.
 *
 * Everything else is a copy, deliberately: a transformation here is a rule the database cannot
 * see, and this file is a shape change and nothing else.
 */

import type { ParsedRunner, ParsedTeam } from './types';

/** One runner, as `import_registration()` reads a member of a team's `runners` array. */
export interface ImportRunnerRow {
  leg: number;
  firstname: string;
  lastname: string;
  gender: string | null;
  email: string | null;
  club_name: string | null;
  age_on_day: number | null;
  is_captain: boolean;
}

/** One team, as `import_registration()` reads a member of `p_rows`. */
export interface ImportTeamRow {
  purchase_order_id: string;
  csv_row_index: number;
  name: string | null;
  /** Always null from a CSV — see this module's header. */
  category: string | null;
  entry_type: string | null;
  runners: ImportRunnerRow[];
}

function nullIfEmpty(value: string): string | null {
  return value.trim() === '' ? null : value;
}

function runnerRow(runner: ParsedRunner): ImportRunnerRow {
  return {
    leg: runner.leg,
    firstname: runner.firstname,
    lastname: runner.lastname,
    gender: nullIfEmpty(runner.gender),
    email: nullIfEmpty(runner.email),
    club_name: runner.club_name,
    age_on_day: runner.age_on_day,
    is_captain: runner.is_captain,
  };
}

/**
 * The parser's teams, in the shape `timing.import_registration()` reads.
 *
 * Pure and total: every `ParsedTeam` maps, and a team the parser refused to build is already
 * absent from its output rather than filtered here.
 */
export function toImportRows(teams: readonly ParsedTeam[]): ImportTeamRow[] {
  return teams.map((team) => ({
    purchase_order_id: team.purchase_order_id,
    csv_row_index: team.csv_row_index,
    name: team.name,
    category: null,
    entry_type: team.entry_type,
    runners: team.runners.map(runnerRow),
  }));
}
