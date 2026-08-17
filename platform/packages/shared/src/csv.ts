/**
 * CSV, written once so no caller has to remember the rules.
 *
 * The club's exports are opened in Excel and in Numbers by two volunteers, from data typed by
 * the public. That combination is what decides every rule below.
 *
 * ## RFC 4180, and the field that breaks a naive one
 *
 * A value is quoted when it contains a comma, a double quote, a carriage return, a line feed,
 * or leading or trailing whitespace; a double quote inside a quoted value is doubled. **A club
 * name of `Bristol & West AC, "the Bees"` is the case that matters** — a comma splits the row
 * into two columns and an unescaped quote swallows the rest of the file — and it is in the
 * seed for exactly that reason, so a laptop meets it without anybody inventing it.
 *
 * Leading and trailing spaces are quoted as well, which RFC 4180 does not require. They are
 * preserved either way by a correct reader, and quoting them means an entrant who typed a
 * trailing space survives a round trip through a spreadsheet that would otherwise trim it.
 *
 * ## `\r\n`, and the byte-order mark
 *
 * Line endings are CRLF because RFC 4180 says so and because the readers that care are the
 * ones on Windows. The file opens with a **UTF-8 byte-order mark**, which Excel needs in order
 * to read the file as UTF-8 at all: without it, `Inés O'Rourke` and `Lena Sørensen` open as
 * mojibake, and a start list with a mangled name on it is a start list somebody retypes by
 * hand. Both names are in the seed.
 *
 * ## Formula injection, and where the line is drawn
 *
 * A spreadsheet evaluates a cell beginning `=`, `+`, `@`, a tab or a carriage return as a
 * formula, so a value typed into a public form can become one. Those five are neutralised with
 * a leading apostrophe, which is the escape both Excel and Numbers understand.
 *
 * **A leading `-` is deliberately left alone.** It is the one character on the usual list that
 * appears in real data — a hyphenated name or club that has lost its first word — and a
 * spreadsheet only evaluates it when what follows parses as an expression, which `-Brislington`
 * does not. Mangling a real name to guard against a string nobody has ever typed is the worse
 * trade, and it is the kind of quiet corruption that is discovered on race morning.
 */

/**
 * U+FEFF. Excel reads a CSV as UTF-8 only if the file opens with it.
 *
 * **A test cannot see this through `Response.text()`, and that is worth knowing before writing
 * one.** `text()` decodes with `TextDecoder`, whose default is to *strip* a leading U+FEFF \u2014 so
 * a decoded assertion reports a mark that is on the wire as missing, and an assertion written
 * the other way round passes on a file that would open as mojibake on every Windows machine the
 * club owns. Read the bytes (`EF BB BF`), or decode with `ignoreBOM: true`.
 * `apps/main/tests/worker/admin/nn-admin.test.ts` does the first.
 */
export const BOM = '\uFEFF';

/** The characters that make a spreadsheet treat a cell as a formula rather than as text. */
const FORMULA_LEAD = /^[=+@\t\r]/;

/** The characters that make a field need quoting under RFC 4180. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/**
 * One field, escaped.
 *
 * `null` and `undefined` become an empty field rather than the words "null" or "undefined",
 * which is what an absent club or an absent England Athletics number should look like in a
 * column somebody is reading down.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  // A number is never a formula and never needs quoting. Stated rather than left to the
  // string path, so an amount in pence cannot acquire an apostrophe.
  if (typeof value === 'number') {
    return String(value);
  }

  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;

  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** One row, from its fields. */
export function csvRow(fields: readonly (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(',');
}

/**
 * A whole file: the byte-order mark, the header, the rows, and a trailing CRLF.
 *
 * The trailing newline is there because a file without one is a file that concatenates badly
 * and that some readers report as truncated.
 */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  // **Written as an escape rather than as the character itself**, which is invisible in an
  // editor and is the sort of thing a reformat, a merge or a copy-paste silently removes.
  return `${BOM}${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`;
}
