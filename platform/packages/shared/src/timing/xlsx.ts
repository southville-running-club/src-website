/**
 * A workbook, written by hand, where **every cell is an inline string**.
 *
 * ⚠️ **Written here rather than ported**, for `result-export.ts`'s reason: ADR-034 reads
 * `bindalshah/src-race-timing` as the specification rather than the source, and `CLAUDE.md`
 * makes reaching into that repository a stop-and-ask.
 *
 * ## Why a workbook at all, when `csv.ts` already exists
 *
 * Because of one value: a bib of `"0311"`.
 * [#205](https://github.com/southville-running-club/src-website/issues/205) names it —
 * *"every XLSX cell `inlineStr`, so Excel cannot turn `"0311"` into `311`"* — and the CSV
 * cannot win that argument. A `.csv` is text a spreadsheet **guesses at**: Excel's import
 * reads `0311` as the number 311, drops the leading zero, and a start list goes to the
 * finish-line desk with bibs that do not match the numbers people are wearing. `csv.ts`'s
 * formula guard cannot help, because this is not a formula. The only fix is a format that
 * carries the type with the value, and that is what a workbook is.
 *
 * **The CSV is not replaced.** It is what a results provider and a spreadsheet on somebody's
 * phone both read, and it is two lines to produce. The club gets both, from one set of rows.
 *
 * ## `inlineStr` rather than a shared string table
 *
 * The usual way a workbook stores text is `xl/sharedStrings.xml` plus an index per cell, which
 * is smaller and is a second file that has to stay in step with the sheet. An **inline string**
 * puts the text in the cell:
 *
 *     <c r="A1" t="inlineStr"><is><t xml:space="preserve">0311</t></is></c>
 *
 * Nothing to index, nothing to keep in step, and `t="inlineStr"` is what tells Excel this is
 * text and not to look at it further. ⚠️ **`xml:space="preserve"` is not decoration** — without
 * it a value with a leading or trailing space is collapsed on read, which is the same class of
 * damage `csv.ts` quotes whitespace to avoid.
 *
 * ## The ZIP, and why it is hand-written and uncompressed
 *
 * An `.xlsx` is a ZIP of XML. This writes one with the **store** method — no compression at all
 * — which is legal ZIP, understood by every reader including Excel and Numbers, and needs no
 * dependency: the alternative is pulling a deflate implementation into a workspace that has
 * managed without one, to save kilobytes on a file with 250 rows in it.
 *
 * ⚠️ **Byte-for-byte deterministic**, which is what makes it testable at all: the modification
 * timestamp on every entry is the DOS epoch rather than `now()`, so the same rows produce the
 * same bytes and an assertion can be about content rather than about approximate size.
 */

/** The five parts of the smallest workbook Excel will open. */
export interface XlsxSheet {
  /** The tab's name. See {@link safeSheetName} for what Excel refuses. */
  name: string;
  header: readonly string[];
  rows: readonly (readonly string[])[];
}

// ------------------------------------------------------------------------------------------
// XML
// ------------------------------------------------------------------------------------------

/**
 * The five XML entities, escaped.
 *
 * ⚠️ **Control characters are stripped rather than escaped**, because XML 1.0 has no
 * representation for most of them at all — `&#x1;` is not well-formed, and a file containing
 * one is a file Excel refuses to open with a message about unreadable content. Tab, newline and
 * carriage return are the three it does allow and they are kept. This is data typed by the
 * public, so the case is real rather than theoretical.
 */
function xmlText(value: string): string {
  return [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
    })
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** `A`, `Z`, `AA`, `AB` — the spreadsheet column name for a zero-based index. */
export function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/**
 * A tab name Excel will accept.
 *
 * Excel refuses `: \ / ? * [ ]`, refuses an empty name, and truncates past 31 characters — and
 * it refuses the **file**, not the name, so a sheet called `Results 1/11/2026` produces a
 * workbook that will not open at all. Substituting rather than refusing, because a slightly
 * renamed tab is a far better outcome on a race morning than an error.
 */
export function safeSheetName(name: string): string {
  const cleaned = name
    .replaceAll(/[:\\/?*[\]]/g, '-')
    .trim()
    .slice(0, 31);
  return cleaned === '' ? 'Sheet1' : cleaned;
}

function cell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const lines = [sheet.header, ...sheet.rows];

  const rows = lines
    .map((line, rowIndex) => {
      const cells = line
        .map((value, columnIndex) =>
          cell(`${columnName(columnIndex)}${rowIndex + 1}`, value),
        )
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    // The header row stays put when somebody scrolls 250 finishers. One attribute, and it is
    // the difference between a usable file and one somebody re-sorts by hand.
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetData>${rows}</sheetData></worksheet>`
  );
}

function workbookXml(sheets: readonly XlsxSheet[]): string {
  const entries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlText(safeSheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${entries}</sheets></workbook>`
  );
}

function workbookRelsXml(sheets: readonly XlsxSheet[]): string {
  const entries = sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
        `Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${entries}</Relationships>`
  );
}

function contentTypesXml(sheets: readonly XlsxSheet[]): string {
  const overrides = sheets
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `${overrides}</Types>`
  );
}

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" ` +
  `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
  `Target="xl/workbook.xml"/></Relationships>`;

// ------------------------------------------------------------------------------------------
// ZIP — store method, no compression, deterministic
// ------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32/ISO-HDLC, which is the checksum every ZIP entry header carries. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 1 January 1980 — the earliest moment MS-DOS can express, and therefore the ZIP epoch.
 *
 * ⚠️ **Fixed rather than `now()`, and that is what makes this file testable.** A timestamp
 * would make the same rows produce different bytes on every call, so an assertion could only
 * be about length. It costs nothing: nothing in the club's workflow reads the modification time
 * inside a workbook.
 */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

/**
 * A ZIP archive with every entry stored rather than deflated.
 *
 * ⚠️ **The file names are ASCII and the general-purpose flag is therefore zero.** Setting bit
 * 11 (UTF-8 names) would be correct for a name with an accent in it and is left off because no
 * name here has one — the only strings the club's data reaches are *inside* the XML, where they
 * are UTF-8 by declaration. A caller adding an entry whose path is not ASCII has to revisit
 * this, which is why it is written down rather than assumed.
 */
function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const offset = local.length;

    local.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(entry.bytes.length),
      ...u32(entry.bytes.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...entry.bytes,
    );

    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(entry.bytes.length),
      ...u32(entry.bytes.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    );
  }

  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(central.length),
    ...u32(local.length),
    ...u16(0),
  ];

  return Uint8Array.from([...local, ...central, ...end]);
}

/**
 * The workbook's bytes.
 *
 * Hand it to a `Response` with
 * `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and a
 * `content-disposition` naming the file.
 */
export function buildXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    { path: '[Content_Types].xml', bytes: encoder.encode(contentTypesXml(sheets)) },
    { path: '_rels/.rels', bytes: encoder.encode(ROOT_RELS_XML) },
    { path: 'xl/workbook.xml', bytes: encoder.encode(workbookXml(sheets)) },
    {
      path: 'xl/_rels/workbook.xml.rels',
      bytes: encoder.encode(workbookRelsXml(sheets)),
    },
    ...sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      bytes: encoder.encode(sheetXml(sheet)),
    })),
  ];

  return zip(entries);
}

/** The media type an `.xlsx` is served as. Named once, because it is impossible to recall. */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
