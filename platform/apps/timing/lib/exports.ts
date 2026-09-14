import { XLSX_CONTENT_TYPE } from '@src/shared/timing/xlsx';

/**
 * Turning rows into a file somebody downloads — #205.
 *
 * ## ⚠️ Assert an attachment on the *response*, never on a download event
 *
 * The three browser engines disagree about what an attachment is, and one of them only
 * disagrees on Linux: given `text/csv` and `content-disposition: attachment`, Chromium and
 * macOS WebKit download it, and **WebKit on a CI runner renders it in the tab** — no download
 * event ever fires. `CLAUDE.md` carries the whole trap and it cost the admin slice its one red
 * test. So the three things a test may assert are **the status, the content type and the
 * filename**, which every engine agrees on, and `apps/main/tests/e2e/nn-admin.spec.ts`'s two
 * export tests are the shape to copy. This module exists so all four export addresses set those
 * three the same way.
 *
 * ## ⚠️ `charset=utf-8` and the byte-order mark are two different things and both are needed
 *
 * `csv.ts` writes the mark into the body, because Excel reads a file as UTF-8 only if it opens
 * with one — and a test cannot see it through `Response.text()`, whose `TextDecoder` strips a
 * leading U+FEFF by default. Assert on the bytes (`EF BB BF`) or decode with `ignoreBOM: true`.
 * The header is for everything that is not Excel.
 */

/** The two shapes the club can have the same rows in. */
export type ExportFormat = 'csv' | 'xlsx';

/**
 * The format this form field names, or `null` for anything else.
 *
 * A closed set read with `Object.hasOwn`'s discipline — a spelling nobody wrote down is refused
 * rather than defaulted, because a default here is a button that quietly hands back the wrong
 * kind of file.
 */
export function exportFormatFor(value: FormDataEntryValue | null): ExportFormat | null {
  const asked = typeof value === 'string' ? value : '';
  return asked === 'csv' || asked === 'xlsx' ? asked : null;
}

/**
 * A filename from a slug and a kind — `nn-2026-results.csv`.
 *
 * ⚠️ **The slug is filtered rather than quoted.** A `"` in a filename ends the quoted string in
 * a `content-disposition` header and whatever follows becomes a header parameter; slugs cannot
 * contain one today, and a filename built from a database value is not the place to rely on
 * that. The same filter is what keeps the value ASCII, which is what the unquoted-safe subset
 * of that header is.
 */
export function exportFilename(slug: string, kind: string, format: ExportFormat): string {
  const safe = slug.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe === '' ? 'race' : safe}-${kind}.${format}`;
}

/** The CSV, as an attachment. */
export function csvAttachment(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      // Names and times behind a permission: it may not be cached by anything in between.
      'cache-control': 'private, no-store',
    },
  });
}

/** The workbook, as an attachment. */
export function xlsxAttachment(filename: string, bytes: Uint8Array): Response {
  // ⚠️ **A fresh `ArrayBuffer` rather than the view's own.** `Uint8Array` is a window onto a
  // buffer that may be longer than it, and a `Response` built from the buffer would send the
  // slack as well — which in a ZIP is trailing bytes after the end-of-central-directory record
  // and an archive some readers refuse. `slice()` gives exactly the bytes.
  const body = bytes.slice().buffer as ArrayBuffer;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': XLSX_CONTENT_TYPE,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
