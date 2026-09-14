import { NextResponse } from 'next/server';
import {
  buildPrizeRows,
  prizeExportCsv,
  prizeExportFields,
  PRIZE_EXPORT_HEADER,
} from '@src/shared/timing/prize-export';
import { buildXlsx } from '@src/shared/timing/xlsx';
import {
  csvAttachment,
  exportFilename,
  exportFormatFor,
  xlsxAttachment,
} from '../../../../../lib/exports';
import { prizeChoicesFrom, resolvePrizeAwards } from '../../../../../lib/prizes';
import { readResultsPreview } from '../../../../../lib/results-preview';

/**
 * `POST /timing/events/<slug>/prizes/export` — the prize list as a file.
 *
 * Issue [#205](https://github.com/southville-running-club/src-website/issues/205). Behind
 * `timing.result.publish`, mapped in `lib/access.ts`; the argument for it not being a permission
 * of its own is in that file and in the results export beside this one.
 *
 * ## ⚠️ It reads the presenter's own choices out of the form, and never recomputes around them
 *
 * This is #205's rule: *"the prize export consumes the presenter's resolved `Award[]`, so the
 * published table cannot disagree with what was announced."* Two of the twelve awards are spot
 * draws whose winner exists nowhere but the address bar, and every award is subject to the *pass
 * to next* exclusions somebody made in the room. A file built from `computeAwards()` with no
 * arguments would name a different winner than the one who was handed the prize, and the club
 * would find out afterwards.
 *
 * So the presenter's page carries every choice as a hidden field, this reads them back through
 * the same `prizeChoicesFrom()`, and `resolvePrizeAwards()` is called once — the same function
 * the screen calls, with the same inputs.
 *
 * ⚠️ **A `FormData` is read where the page reads a query string**, and `prizeChoicesFrom()` takes
 * the shape the page has. The conversion below is the only difference between the two callers,
 * and it is repeated values that make it worth stating: `pass` appears once per excluded team.
 */

function backTo(request: Request, slug: string, outcome: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/timing/events/${encodeURIComponent(slug)}/prizes?outcome=${encodeURIComponent(outcome)}`,
      request.url,
    ),
    303,
  );
}

/** A posted form as the query-shaped record `prizeChoicesFrom()` reads. */
function asQuery(form: FormData): Record<string, string | string[] | undefined> {
  const query: Record<string, string | string[] | undefined> = {};

  for (const key of new Set(form.keys())) {
    query[key] = form.getAll(key).filter((one): one is string => typeof one === 'string');
  }

  return query;
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
    return backTo(request, slug, 'unavailable');
  }

  if (read.state === 'none') {
    return backTo(request, slug, 'no_such_event');
  }

  const payload = read.data;
  const awards = resolvePrizeAwards(payload, prizeChoicesFrom(asQuery(form)));
  const rows = buildPrizeRows(awards, payload.event.format);
  const filename = exportFilename(payload.event.slug, 'prizes', format);

  if (format === 'csv') {
    return csvAttachment(filename, prizeExportCsv(rows));
  }

  return xlsxAttachment(
    filename,
    buildXlsx([
      {
        name: 'Prizes',
        header: [...PRIZE_EXPORT_HEADER],
        rows: rows.map(prizeExportFields),
      },
    ]),
  );
}
