import { describe, expect, it } from 'vitest';
import { buildXlsx, columnName, crc32, safeSheetName } from '../../src/timing/xlsx';

/**
 * The workbook writer — #205.
 *
 * ⚠️ **The assertion that earns this whole file is the one about `0311`.** A bib with a leading
 * zero is the reason a workbook exists here at all: Excel reads it out of a CSV as the number
 * 311, and a start list reaches the finish desk with numbers nobody is wearing. `t="inlineStr"`
 * is what stops it, so that is asserted on the cell rather than left to the header comment.
 *
 * The rest is a ZIP that has to be a ZIP. The bytes are checked at the three places a
 * hand-written archive goes wrong — the local header signature, the central directory, and the
 * end-of-central-directory record's entry count — because a subtly wrong archive opens in one
 * reader and not another, and the one that matters is on a volunteer's laptop.
 *
 * ## Reading the bytes back
 *
 * There is no unzip in this workspace and adding one for a test would be adding a dependency to
 * check a dependency-free implementation. So the entries are located by their own local headers,
 * which is what a reader does, and the stored (uncompressed) method is what makes the payload
 * directly readable — the one property of the store method this file relies on.
 */

const LOCAL_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CENTRAL_SIGNATURE = [0x50, 0x4b, 0x01, 0x02];
const END_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];

/** Every entry in the archive, by name, with its stored bytes decoded as text. */
function entries(zip: Uint8Array): Map<string, string> {
  const found = new Map<string, string>();
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();

  for (let i = 0; i + 30 <= zip.length; i += 1) {
    if (LOCAL_SIGNATURE.some((byte, offset) => zip[i + offset] !== byte)) continue;

    const size = view.getUint32(i + 18, true);
    const nameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    const nameAt = i + 30;
    const dataAt = nameAt + nameLength + extraLength;

    found.set(
      decoder.decode(zip.slice(nameAt, nameAt + nameLength)),
      decoder.decode(zip.slice(dataAt, dataAt + size)),
    );
  }

  return found;
}

const SHEET = {
  name: 'Results',
  header: ['Position', 'Bib'],
  rows: [
    ['1', '0311'],
    ['2', '312'],
  ],
};

describe('buildXlsx', () => {
  it('writes every cell as an inline string, so a bib of 0311 survives Excel', () => {
    const sheet = entries(buildXlsx([SHEET])).get('xl/worksheets/sheet1.xml') ?? '';

    // ⚠️ The whole reason this file exists. `t="inlineStr"` is the type declaration Excel obeys;
    // without it `0311` is read as a number and the zero is gone before anybody looks.
    expect(sheet).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">0311</t></is>',
    );
    // Not one numeric cell anywhere, including the position column, which genuinely is a number.
    expect(sheet).not.toContain('t="n"');
    expect((sheet.match(/t="inlineStr"/g) ?? []).length).toBe(6);
  });

  it('keeps a leading space, which is what xml:space is for', () => {
    const sheet =
      entries(buildXlsx([{ ...SHEET, rows: [[' Ada', 'x']] }])).get(
        'xl/worksheets/sheet1.xml',
      ) ?? '';

    expect(sheet).toContain('<t xml:space="preserve"> Ada</t>');
  });

  it('escapes a club name and drops a control character rather than writing invalid XML', () => {
    const sheet =
      entries(
        buildXlsx([{ ...SHEET, rows: [['Bristol & West, "the Bees"', 'ab']] }]),
      ).get('xl/worksheets/sheet1.xml') ?? '';

    expect(sheet).toContain('Bristol &amp; West, &quot;the Bees&quot;');
    // ⚠️ Stripped rather than escaped: XML 1.0 cannot represent U+0001 at all, and a file
    // carrying one is a file Excel refuses to open.
    expect(sheet).toContain('>ab<');
  });

  it('carries the five parts a reader looks for', () => {
    const names = [...entries(buildXlsx([SHEET])).keys()];

    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('writes a central directory and an end record naming every entry', () => {
    const zip = buildXlsx([SHEET]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

    const endAt = zip.length - 22;
    expect([...zip.slice(endAt, endAt + 4)]).toEqual(END_SIGNATURE);
    expect(view.getUint16(endAt + 10, true)).toBe(5);

    // The end record points at the central directory, which starts with its own signature.
    const centralAt = view.getUint32(endAt + 16, true);
    expect([...zip.slice(centralAt, centralAt + 4)]).toEqual(CENTRAL_SIGNATURE);
  });

  it('is byte-for-byte deterministic, so the same rows are the same file', () => {
    // ⚠️ A modification time of `now()` would make this impossible and every assertion above
    // approximate. See the module header.
    expect(buildXlsx([SHEET])).toEqual(buildXlsx([SHEET]));
  });
});

describe('the small pieces', () => {
  it('names columns past Z', () => {
    expect([0, 25, 26, 27, 51, 52].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
    ]);
  });

  it('substitutes the characters that make Excel refuse the whole file', () => {
    // Refused in the tab name, and the cost is the workbook rather than the name.
    expect(safeSheetName('Results 1/11/2026')).toBe('Results 1-11-2026');
    expect(safeSheetName('   ')).toBe('Sheet1');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
  });

  it('computes the CRC every ZIP reader checks', () => {
    // The published check value for CRC-32/ISO-HDLC over "123456789".
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});
