/**
 * The registration import — and the boundary the club's personal data never crosses.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/registration/parser.ts`** under
 * [ADR-034](../../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * with its assertions and its fixtures.
 *
 * ## ⚠️ The rule this module exists to hold
 *
 * **Date of birth, address, phone, emergency contact and medical information are dropped
 * here, at the parser, and never reach the database.** `DROPPED_COLUMNS` is the list, and it
 * is surfaced in the import preview so the volunteer running it can see what is and is not
 * being kept. The age is *computed* against the race date, and the CSV's own `AgeOnDay`
 * column is ignored in favour of computing it.
 *
 * That is [C10](../../../../../../docs/foundations/requirements.md#c10--hold-personal-data-lawfully)
 * already implemented, and the same sentence as *personal data is minimised at the boundary*
 * in [the principles](../../../../../../docs/architecture/principles.md). The raw CSV in
 * storage is the audit trail; the tables hold operational data only.
 *
 * **This is the pattern this repository already says every new entry surface should inherit**,
 * and it arrived here first.
 *
 * ## What the port changed
 *
 * **The age arithmetic is gone, and calls `ageOn()` instead.** The original computed it by
 * hand from two `Date`s. `age-category.ts` already had that function, tested, and the club's
 * prize bands already read it — and the two were the same condition written twice:
 * `!hasHadBirthday` expands to exactly the `month < bMonth || (month === bMonth && day <
 * bDay)` this replaced. A second implementation of *"how old was somebody on the day"* in a
 * repository that awards prizes by age band is the defect these headers keep warning about.
 *
 * The `DD/MM/YYYY` parse and its findings stay here, because they are about this CSV rather
 * than about ages.
 *
 * ## ⚠️ It takes the race format, and that is not decoration
 *
 * Pass the Buck is a relay and Nightingale Nightmare is solo, and the two do not agree on how
 * many runners an entry has. Read as a relay, a full solo field produces 250 `lone-runner`
 * warnings — *"to be paired on the day"* — about nothing, and **a preview that always warns is
 * a preview nobody reads**. Read as solo, a relay's second runner would be silently dropped.
 *
 * So `format` is a required argument rather than a defaulted one. There is no sensible default
 * here: whichever way it fell, one of the club's two races would be misread.
 */

import Papa from 'papaparse';
import { ageOn, type CivilDate } from '../../age-category';
import type { TimingEvent } from '../rows';

/** The race shape this import is for. `timing.events.format`, and the same two values. */
type EventFormat = TimingEvent['format'];
import type { Finding, ParsedRunner, ParsedTeam, ParseResult } from './types';

// Known columns in the Full On Sport CSV. Anything outside this set is
// surfaced as an info-level "unexpected column" finding and ignored at
// parse. The empty-string entry captures the unnamed trailing column
// from the source CSV (header ends with a comma).
const KNOWN_COLUMNS = new Set([
  'EventName',
  'EntryType',
  'EntryPaid',
  'EnteredBy',
  'RaceNumber',
  'ep_id',
  'EA_URN',
  'Title',
  'Firstname',
  'Lastname',
  'DOB',
  'Gender',
  'Email',
  'DateEntered',
  'OwnerMember',
  'ClubName',
  'TeamName',
  'AgeOnDay',
  'AgeCategory',
  'PurchaseOrderId',
  'Address1',
  'Address2',
  'Address3',
  'County',
  'City',
  'POSTCODE',
  'PrimaryContactTel',
  'SecondaryContactTel',
  'EmergencyName',
  'EmergencyTel',
  'MedicalInformation',
  'version',
  '',
]);

// Columns dropped at parse — either PII (address, phone, DOB raw, medical,
// emergency) or non-stored metadata (EnteredBy is a constant; AgeOnDay is
// recomputed from DOB; AgeCategory is empty). Surfaced in the preview as a
// transparency note so the admin sees what we ARE and AREN'T persisting.
export const DROPPED_COLUMNS = [
  'DOB',
  'Address1',
  'Address2',
  'Address3',
  'County',
  'City',
  'POSTCODE',
  'PrimaryContactTel',
  'SecondaryContactTel',
  'EmergencyName',
  'EmergencyTel',
  'MedicalInformation',
  'EventName',
  'EnteredBy',
  'RaceNumber',
  'ep_id',
  'EA_URN',
  'Title',
  'DateEntered',
  'AgeOnDay',
  'AgeCategory',
  'version',
] as const;

// Required fields on every runner row. Missing any of these blocks the
// commit. Schema-driven: runners.firstname / lastname / email / gender are
// all NOT NULL in the migration. PurchaseOrderId is required separately
// (it's the team grouping key) — see parseRegistrationCsv body.
const REQUIRED_RUNNER_FIELDS = ['Firstname', 'Lastname', 'Email', 'Gender'] as const;

/**
 * Parse a Full On Sport registration CSV into normalised teams + runners
 * shape, with findings (block / warn / info severity). Pure — no DB calls,
 * no side effects. `eventStartAtIso` is the target event's start_at,
 * compared against each runner's DOB to compute `age_on_day`. The raw DOB
 * string is parsed at this boundary and never returned in the result —
 * PII boundary held at parse.
 */
export function parseRegistrationCsv(
  csvText: string,
  eventStartAtIso: string,
  format: EventFormat,
): ParseResult {
  const findings: Finding[] = [];

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  for (const err of parsed.errors) {
    findings.push({
      severity: 'block',
      kind: 'malformed-csv',
      message: `CSV parse error: ${err.code}: ${err.message}${
        typeof err.row === 'number' ? ` (row ${err.row + 1})` : ''
      }`,
      // Spread rather than a ternary: `exactOptionalPropertyTypes` is on here, so an optional
      // `rowIndex?: number` may not be handed an explicit `undefined` - the property is either
      // present with a number or absent.
      ...(typeof err.row === 'number' ? { rowIndex: err.row + 1 } : {}),
    });
  }

  const rows = parsed.data;
  const headers = parsed.meta.fields ?? [];

  const unknownColumns: string[] = [];
  for (const h of headers) {
    if (!KNOWN_COLUMNS.has(h)) unknownColumns.push(h);
  }
  if (unknownColumns.length > 0) {
    findings.push({
      severity: 'info',
      kind: 'unexpected-columns',
      message: `Unexpected columns in CSV header (ignored at parse): ${unknownColumns.join(', ')}.`,
    });
  }

  const eventStartDate = new Date(eventStartAtIso);

  type RowAcc = {
    rowIndex: number;
    purchase_order_id: string;
    firstname: string;
    lastname: string;
    gender: string;
    email: string;
    club_name: string | null;
    age_on_day: number | null;
    owner_member: string;
    team_name: string;
    entry_type: string;
  };

  const accumulated: RowAcc[] = [];

  rows.forEach((row, i) => {
    const rowIndex = i + 1;

    for (const field of REQUIRED_RUNNER_FIELDS) {
      const v = (row[field] ?? '').trim();
      if (!v) {
        findings.push({
          severity: 'block',
          kind: 'missing-required-field',
          message: `Row ${rowIndex} is missing required field: ${field}.`,
          rowIndex,
          columnName: field,
        });
      }
    }

    const purchase_order_id = (row['PurchaseOrderId'] ?? '').trim();
    if (!purchase_order_id) {
      findings.push({
        severity: 'block',
        kind: 'missing-required-field',
        message: `Row ${rowIndex} is missing required field: PurchaseOrderId.`,
        rowIndex,
        columnName: 'PurchaseOrderId',
      });
    }

    accumulated.push({
      rowIndex,
      purchase_order_id,
      firstname: (row['Firstname'] ?? '').trim(),
      lastname: (row['Lastname'] ?? '').trim(),
      gender: (row['Gender'] ?? '').trim(),
      email: (row['Email'] ?? '').trim(),
      club_name: nullIfEmpty((row['ClubName'] ?? '').trim()),
      age_on_day: computeAgeOnDay(row['DOB'] ?? '', eventStartDate, rowIndex, findings),
      owner_member: (row['OwnerMember'] ?? '').trim(),
      team_name: (row['TeamName'] ?? '').trim(),
      // Deliberate store-verbatim: the source "Unafilliated" typo and any
      // other EntryType variations pass through untouched. Normalising
      // would lose information and force us to re-normalise every time
      // Full On Sport adds a new value. Decision logged in DECISIONS.md
      // via the migration's design notes.
      entry_type: (row['EntryType'] ?? '').trim(),
    });
  });

  // Group rows by PurchaseOrderId, preserving first-seen order.
  const groupOrder: string[] = [];
  const groups = new Map<string, RowAcc[]>();
  for (const r of accumulated) {
    if (!r.purchase_order_id) continue;
    if (!groups.has(r.purchase_order_id)) {
      groupOrder.push(r.purchase_order_id);
      groups.set(r.purchase_order_id, []);
    }
    groups.get(r.purchase_order_id)!.push(r);
  }

  // Adjacency safety-net check. PurchaseOrderId is the canonical pairing
  // key, but Full On Sport's CSV convention puts pair rows adjacent. A
  // non-adjacent pair likely means an editing or export error worth
  // flagging — the team still resolves correctly via grouping.
  for (const poId of groupOrder) {
    const grp = groups.get(poId)!;
    if (grp.length <= 1) continue;
    const indices = grp.map((r) => r.rowIndex).sort((a, b) => a - b);
    // `i - 1` indexes the array `every` is walking, so it is in range for every `i > 0`.
    const contiguous = indices.every((idx, i) => i === 0 || idx === indices[i - 1]! + 1);
    if (!contiguous) {
      findings.push({
        severity: 'warn',
        kind: 'pair-not-adjacent',
        message: `Team ${poId} rows are not adjacent in the source CSV (rows ${indices.join(', ')}). PurchaseOrderId grouping resolves the team correctly; the order safety net flagged the discrepancy.`,
        purchaseOrderId: poId,
      });
    }
  }

  // Duplicate-email detection. Group occurrences by email; classify as
  // within-pair (info — couples legitimately share) vs cross-team (warn).
  const emailIndex = new Map<string, { rowIndex: number; poId: string }[]>();
  for (const r of accumulated) {
    if (!r.email) continue;
    if (!emailIndex.has(r.email)) emailIndex.set(r.email, []);
    emailIndex.get(r.email)!.push({
      rowIndex: r.rowIndex,
      poId: r.purchase_order_id,
    });
  }
  for (const [email, occurrences] of emailIndex) {
    if (occurrences.length < 2) continue;
    const allSamePo = occurrences.every(
      (o) => o.poId === occurrences[0]!.poId && o.poId !== '',
    );
    if (allSamePo) {
      findings.push({
        severity: 'info',
        kind: 'within-pair-duplicate-email',
        message: `Email ${email} is shared by runners on team ${occurrences[0]!.poId} (rows ${occurrences.map((o) => o.rowIndex).join(', ')}). Couples sharing an email is a legitimate pattern.`,
        purchaseOrderId: occurrences[0]!.poId,
      });
    } else {
      findings.push({
        severity: 'warn',
        kind: 'cross-team-duplicate-email',
        message: `Email ${email} appears on rows ${occurrences.map((o) => `${o.rowIndex} (team ${o.poId || '(no PO)'})`).join(', ')} across different teams.`,
      });
    }
  }

  const teams: ParsedTeam[] = [];

  for (const poId of groupOrder) {
    const grp = groups.get(poId)!;

    // ⚠️ **How many runners an entry may have is the race's question, not the parser's.**
    //
    // Pass the Buck is a relay: two runners per entry, and one is somebody waiting to be
    // paired on the day. Nightingale Nightmare is solo: **one runner per entry is the entire
    // race**, and a second one is the data being wrong.
    //
    // Read as a relay, a full solo field produces 250 `lone-runner` warnings about nothing -
    // which is worse than useless, because a preview that always warns is a preview nobody
    // reads. So the rule is chosen by `format`, and neither race is told the other's news.
    const maxRunners = format === 'solo' ? 1 : 2;

    if (grp.length > maxRunners) {
      findings.push({
        severity: 'block',
        kind: 'multi-row-team',
        message:
          format === 'solo'
            ? `Team ${poId} has ${grp.length} rows (rows ${grp.map((r) => r.rowIndex).join(', ')}). A solo entry has one runner.`
            : `Team ${poId} has ${grp.length} rows (rows ${grp.map((r) => r.rowIndex).join(', ')}). A team must have at most 2 runners.`,
        purchaseOrderId: poId,
      });
      // Don't build a team for an over-full group — the data shape is broken.
      continue;
    }

    // A lone runner is only news on a relay. On a solo race it is the race.
    if (format === 'relay' && grp.length === 1) {
      findings.push({
        severity: 'warn',
        kind: 'lone-runner',
        message: `Team ${poId} (${grp[0]!.firstname} ${grp[0]!.lastname}) has only one runner — to be paired on the day.`,
        purchaseOrderId: poId,
      });
    }

    // Narrowed once here rather than at each use below. Every group in `groupOrder` has at
    // least one row by construction; `noUncheckedIndexedAccess` cannot see that.
    const head = grp[0]!;

    if (!head.team_name) {
      findings.push({
        severity: 'info',
        kind: 'empty-team-name',
        message: `Team ${poId} has no team name set. The leaderboard will fall back to partner names.`,
        purchaseOrderId: poId,
      });
    }

    // Captain detection: pick the canonical OwnerMember (first non-empty
    // value across group rows; consistent in well-formed pairs) and match
    // case-sensitively against `firstname + " " + lastname`. No match →
    // captain undetermined, warn, both runners get is_captain=false.
    const ownerMember = grp.find((r) => r.owner_member)?.owner_member ?? '';
    let captainIdx = -1;
    if (ownerMember) {
      for (let i = 0; i < grp.length; i++) {
        if (`${grp[i]!.firstname} ${grp[i]!.lastname}` === ownerMember) {
          captainIdx = i;
          break;
        }
      }
      if (captainIdx === -1) {
        findings.push({
          severity: 'warn',
          kind: 'no-captain-match',
          message: `Team ${poId}: OwnerMember "${ownerMember}" does not match any runner's "Firstname Lastname". Captain undetermined.`,
          purchaseOrderId: poId,
        });
      }
    } else {
      findings.push({
        severity: 'warn',
        kind: 'no-captain-match',
        message: `Team ${poId}: OwnerMember field is empty. Captain undetermined.`,
        purchaseOrderId: poId,
      });
    }

    const runners: ParsedRunner[] = grp.map((r, i) => ({
      firstname: r.firstname,
      lastname: r.lastname,
      gender: r.gender,
      email: r.email,
      club_name: r.club_name,
      age_on_day: r.age_on_day,
      is_captain: i === captainIdx,
      leg: (i + 1) as 1 | 2,
    }));

    teams.push({
      purchase_order_id: poId,
      name: nullIfEmpty(head.team_name),
      entry_type: nullIfEmpty(head.entry_type),
      runners,
    });
  }

  const hasBlocking = findings.some((f) => f.severity === 'block');

  return {
    teams,
    findings,
    hasBlocking,
    totalRows: rows.length,
    droppedColumns: DROPPED_COLUMNS,
    unknownColumns,
  };
}

function nullIfEmpty(s: string): string | null {
  return s === '' ? null : s;
}

// Parse "DD/MM/YYYY" and compute whole-year age at eventStart. Anniversary-
// aware: if the runner hasn't yet had their birthday in the event year, age
// is one less than the simple year difference. Both dates evaluated in UTC
// for determinism (tests pin TZ=UTC; production race day spans UTC + BST
// but only whole-year precision matters).
function computeAgeOnDay(
  dobRaw: string,
  eventStart: Date,
  rowIndex: number,
  findings: Finding[],
): number | null {
  if (!dobRaw.trim()) return null;
  const m = dobRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    findings.push({
      severity: 'warn',
      kind: 'invalid-dob',
      message: `Row ${rowIndex}: DOB "${dobRaw}" is not in DD/MM/YYYY format. Age will be empty.`,
      rowIndex,
    });
    return null;
  }
  const [, ddStr, mmStr, yyyyStr] = m;
  const dd = Number(ddStr);
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);
  const dob = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    isNaN(dob.getTime()) ||
    dob.getUTCFullYear() !== yyyy ||
    dob.getUTCMonth() !== mm - 1 ||
    dob.getUTCDate() !== dd
  ) {
    findings.push({
      severity: 'warn',
      kind: 'invalid-dob',
      message: `Row ${rowIndex}: DOB "${dobRaw}" is not a valid calendar date.`,
      rowIndex,
    });
    return null;
  }

  // **`ageOn` rather than the arithmetic that was here.** `age-category.ts` is the one module
  // that answers "how old was somebody on this day", it is tested, and the prize bands already
  // read it. The two implementations agreed exactly, which is what made the swap safe rather
  // than hopeful.
  //
  // `CivilDate` months are 1-based, which is what the CSV already gave us; `Date`'s are not.
  const birth: CivilDate = { year: yyyy, month: mm, day: dd };
  const on: CivilDate = {
    year: eventStart.getUTCFullYear(),
    month: eventStart.getUTCMonth() + 1,
    day: eventStart.getUTCDate(),
  };
  const age = ageOn(birth, on);

  if (age < 0) {
    findings.push({
      severity: 'warn',
      kind: 'invalid-dob',
      message: `Row ${rowIndex}: DOB "${dobRaw}" is after the event date.`,
      rowIndex,
    });
    return null;
  }
  return age;
}
