import { NextResponse } from 'next/server';
import {
  buildExportRows,
  resultExportCsv,
  resultExportFields,
  RESULT_EXPORT_HEADER,
} from '@src/shared/timing/result-export';
import { buildXlsx } from '@src/shared/timing/xlsx';
import {
  csvAttachment,
  exportFilename,
  exportFormatFor,
  xlsxAttachment,
} from '../../../../../lib/exports';
import { readResultsPreview } from '../../../../../lib/results-preview';

/**
 * `POST /timing/events/<slug>/results/export` — the results as a file.
 *
 * Issue [#205](https://github.com/southville-running-club/src-website/issues/205). Behind
 * `timing.result.publish`, mapped in `lib/access.ts` and enforced by `middleware.ts`.
 *
 * ## ⚠️ An export is a file leaving the building, and this one rides on the publish permission
 *
 * `nn.entry.export` is its own permission *because a file leaves the building*, and #205 asks
 * whether a results export wants the same. It does not, and `lib/access.ts` carries the
 * argument: the entries export holds emergency contacts, ages, addresses and medical flags,
 * while this file holds a name, a bib, a category and a time — **exactly what the button on the
 * same page publishes to the entire internet**. A nineteenth permission would be a control over
 * a narrower disclosure than the one the same person already authorises, and
 * `identity-permissions.test.ts` is untouched by this change.
 *
 * ## ⚠️ Two shapes of the same rows, and only one of them survives a bib of `0311`
 *
 * `buildExportRows()` derives once; the CSV and the workbook are two renderings of that one
 * answer, so they cannot disagree. The workbook writes **every cell as an inline string**, which
 * is the only thing that stops Excel reading `0311` as the number 311 and sending a start list
 * to the finish desk with bibs nobody is wearing. `xlsx.ts`' header carries it.
 *
 * ## ⚠️ Writes no audit row, deliberately
 *
 * [ADR-024](../../../../../../../docs/architecture/decisions/adr-024-one-entry-in-full.md)
 * settled the same question one schema along: reading a *list* writes no audit row, because it
 * discloses what the same permission already opens. This file is the preview table the same
 * person is looking at, in a shape they can sort. Publishing **is** audited, by
 * `publish_results()`, and that is the act worth a trail.
 */

/** What a failure here looks like: back to the page, which says why in the club's words. */
function backTo(request: Request, slug: string, outcome: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/timing/events/${encodeURIComponent(slug)}/results?outcome=${encodeURIComponent(outcome)}`,
      request.url,
    ),
    303,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return backTo(request, slug, 'incomplete');
  }

  const format = exportFormatFor(form.get('format'));
  if (format === null) {
    return backTo(request, slug, 'incomplete');
  }

  const read = await readResultsPreview(slug);

  if (read.state === 'unavailable') {
    // ⚠️ **Never a refusal and never an empty file.** A zero-row CSV is indistinguishable from a
    // race nobody finished, and it is the kind of file somebody forwards.
    return backTo(request, slug, 'unavailable');
  }

  if (read.state === 'none') {
    return backTo(request, slug, 'no_such_event');
  }

  const payload = read.data;
  const rows = buildExportRows(payload.event, payload.teams, payload.crossings);
  const filename = exportFilename(payload.event.slug, 'results', format);

  if (format === 'csv') {
    return csvAttachment(filename, resultExportCsv(rows));
  }

  return xlsxAttachment(
    filename,
    buildXlsx([
      {
        name: 'Results',
        header: [...RESULT_EXPORT_HEADER],
        rows: rows.map(resultExportFields),
      },
    ]),
  );
}
