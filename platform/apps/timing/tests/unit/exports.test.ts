import { describe, expect, it } from 'vitest';
import {
  csvAttachment,
  exportFilename,
  exportFormatFor,
  xlsxAttachment,
} from '../../lib/exports';

/**
 * The four export addresses' shared response shape — #205.
 *
 * ⚠️ **These are the three things a browser test may assert about a download**, which is why
 * they are pinned here as well: the status, the content type and the filename. The engines
 * disagree about what an attachment *is* — WebKit on a Linux runner renders a CSV in the tab and
 * fires no download event at all — and `CLAUDE.md` carries the whole trap.
 */

describe('exportFormatFor', () => {
  it('accepts the two shapes and refuses everything else', () => {
    expect(exportFormatFor('csv')).toBe('csv');
    expect(exportFormatFor('xlsx')).toBe('xlsx');
  });

  it('refuses rather than defaulting, because a default is the wrong file handed back', () => {
    for (const value of ['', 'CSV', 'pdf', 'toString', null]) {
      expect(exportFormatFor(value), String(value)).toBeNull();
    }
  });
});

describe('exportFilename', () => {
  it('names the race and what is in the file', () => {
    expect(exportFilename('nn-2026', 'results', 'csv')).toBe('nn-2026-results.csv');
    expect(exportFilename('ptb-2026', 'prizes', 'xlsx')).toBe('ptb-2026-prizes.xlsx');
  });

  /**
   * ⚠️ **A quote in a slug would end the quoted string in `content-disposition` and whatever
   * followed would become a header parameter.** Slugs cannot contain one today; a filename built
   * from a database value is not the place to rely on that.
   */
  it('filters a slug rather than quoting it, and never produces an empty name', () => {
    expect(exportFilename('nn"; x=1', 'results', 'csv')).toBe('nn-x-1-results.csv');
    expect(exportFilename('..//..', 'results', 'csv')).toBe('..-..-results.csv');
    expect(exportFilename('///', 'results', 'csv')).toBe('race-results.csv');
  });
});

describe('the attachment headers', () => {
  it('says CSV, says attachment, and names the file', async () => {
    const response = csvAttachment('nn-2026-results.csv', '﻿Position\r\n1\r\n');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="nn-2026-results.csv"',
    );
    // Names and times behind a permission: nothing in between may keep a copy.
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    // ⚠️ **The mark is asserted on the bytes.** `text()` decodes with `TextDecoder`, which
    // strips a leading U+FEFF — so a decoded assertion reports a mark that is on the wire as
    // missing.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('sends the workbook’s bytes and not the buffer they happen to sit in', async () => {
    // ⚠️ A `Uint8Array` is a window onto a buffer that may be longer than it. Sending the buffer
    // would append the slack — trailing bytes after a ZIP's end record, which some readers
    // refuse — so a view into a larger buffer is the case worth asserting.
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = backing.subarray(2, 5);

    const response = xlsxAttachment('nn-2026-results.xlsx', view);

    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="nn-2026-results.xlsx"',
    );
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([3, 4, 5]);
  });
});
