/**
 * The shapes the registration parser produces.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/registration/types.ts`** under
 * [ADR-034](../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
 * Pure data, with no database types in it, which is what lets the parser be tested without a
 * Supabase anywhere near it.
 */

export type Severity = 'block' | 'warn' | 'info';

export type FindingKind =
  | 'missing-required-field'
  | 'multi-row-team'
  | 'lone-runner'
  | 'cross-team-duplicate-email'
  | 'within-pair-duplicate-email'
  | 'pair-not-adjacent'
  | 'empty-team-name'
  | 'no-captain-match'
  | 'unexpected-columns'
  | 'malformed-csv'
  | 'invalid-dob';

export type Finding = {
  severity: Severity;
  kind: FindingKind;
  message: string;
  // 1-based row index relative to data rows (excluding header). Optional
  // because team / file-level findings have no single row to point at.
  rowIndex?: number;
  purchaseOrderId?: string;
  columnName?: string;
};

export type ParsedRunner = {
  firstname: string;
  lastname: string;
  gender: string;
  email: string;
  club_name: string | null;
  age_on_day: number | null;
  is_captain: boolean;
  leg: 1 | 2;
};

export type ParsedTeam = {
  purchase_order_id: string;
  /**
   * Where this team's first row sat in the file, 1-based and excluding the header.
   *
   * ⚠️ **It is what `event_roster()` orders by**, `csv_row_index nulls last` — so without it
   * a CSV import's whole roster sorts by a column that is null for every row, which Postgres
   * is free to return in any order at all, and the start list a desk prints stops matching
   * the spreadsheet it was typed from. `import_registration()` has read and written this
   * column since #238 and the parser had nowhere to take it from; #202 is where the two were
   * finally read against each other.
   *
   * **The first row rather than the lowest**, because the value the file is authoritative
   * about is where the entry *appears*, and the adjacency safety net already flags a team
   * whose rows are not contiguous.
   */
  csv_row_index: number;
  name: string | null;
  entry_type: string | null;
  runners: ParsedRunner[];
};

export type ParseResult = {
  teams: ParsedTeam[];
  findings: Finding[];
  hasBlocking: boolean;
  totalRows: number;
  // Names of columns dropped at parse (PII boundary + ignored). Surfaced in
  // the preview as a "we dropped these" transparency note.
  droppedColumns: readonly string[];
  // Headers that aren't part of the known column set. Info-only.
  unknownColumns: string[];
};
