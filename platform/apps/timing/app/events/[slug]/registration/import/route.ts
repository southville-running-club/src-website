import { NextResponse } from 'next/server';
import { toImportRows } from '@src/shared/timing/registration/import-rows';
import { parseRegistrationCsv } from '@src/shared/timing/registration/parser';
import type { Finding } from '@src/shared/timing/registration/types';
import { readTiming } from '../../../../../lib/reads';
import {
  encodeFindingGroup,
  MAX_FINDING_GROUPS,
  MAX_FINDING_ROWS,
  type FindingSeverity,
} from '../../../../../lib/registration-outcomes';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/registration/import` — a Full On Sport CSV goes in, and nothing
 * of the file comes back out.
 *
 * Issue [#202](https://github.com/southville-running-club/src-website/issues/202). Behind
 * `timing.registration.import`; `lib/access.ts` maps it and `middleware.ts` enforces it,
 * exactly as it does the page that posts here. ⚠️ **A write address is refused by omission**,
 * which is what makes adding one safe.
 *
 * ## ⚠️ What this handler keeps: nothing
 *
 * The old application put the raw CSV in a private storage bucket as its audit trail. **#202
 * says that whether to keep the raw file at all is a data-minimisation question to answer
 * before the first upload, and it has not been answered** — so this keeps nothing at all. No
 * R2 object, no KV entry, no cookie, no row. The bytes are read into a string, parsed,
 * minimised by `parseRegistrationCsv()`, handed to `import_registration()` and dropped when
 * this function returns.
 *
 * That is a deliberate constraint rather than a shortcut, and it is what shapes everything
 * below: **there is nowhere to hold a parsed result between two requests**, so a preview and
 * a commit cannot be two requests over one upload. They are two submits of the same form, and
 * what survives the redirect is a severity, a finding kind and some row numbers — never the
 * parser's own messages, which name runners and quote their email addresses.
 *
 * ## The parse itself needs two facts, and it asks the database for them
 *
 * `parseRegistrationCsv(csv, eventStartAtIso, format)`: the start decides every runner's age
 * on the day, and the format decides how many runners an entry may have — read as a relay, a
 * solo field produces 250 warnings about nothing. Both come off `event_roster()`, which is the
 * same read the page does and the same refusal: `null` for *"you may not"* and *"no such
 * race"* alike, so a slug cannot be probed here either.
 *
 * ## 303, and why it is not 302
 *
 * A POST answering 200 leaves the browser on a page whose reload re-posts the form. Here that
 * would re-import a whole entry list. 303 says *"go and GET this instead"*, so Back and Reload
 * both do the harmless thing — `marshals/update/route.ts` and `apps/main/worker/admin.ts`
 * answer 303 from every POST for the same reason.
 *
 * ⚠️ **There is no authorisation check in this file, deliberately.** The door has admitted the
 * request and `import_registration()` asks `identity.has_permission()` itself against the
 * caller's own token. A third check here would be a third statement of one rule, and the third
 * is the one that goes stale.
 */

/**
 * How big a file this will read.
 *
 * A Full On Sport export of 250 entries is roughly 100 kB. Two megabytes is twenty times that
 * and still small enough that reading it into a Worker's memory is uninteresting. ⚠️ **The cap
 * is here rather than left to the platform** because the failure without one is a Worker that
 * runs out of memory mid-parse and answers a 500 — an outage message for somebody who picked
 * the wrong file.
 */
const MAX_BYTES = 2 * 1024 * 1024;

function backTo(
  request: Request,
  slug: string,
  outcome: string,
  extra: Record<string, string | number> = {},
  findings: string[] = [],
): NextResponse {
  // `basePath` is not applied to a URL built here, so `/timing` is written out.
  const target = new URL(
    `/timing/events/${encodeURIComponent(slug)}/registration`,
    request.url,
  );

  // ⚠️ **Every value here is either from a closed list or a number this file computed.**
  // Nothing from the uploaded file reaches this URL — not a name, not an address, not the
  // parser's own message, which quotes both. `lib/registration-outcomes.ts` carries the
  // argument; this is the half that has to keep it true.
  target.searchParams.set('outcome', outcome);
  for (const [key, value] of Object.entries(extra)) {
    target.searchParams.set(key, String(value));
  }
  for (const group of findings) {
    target.searchParams.append('f', group);
  }

  return NextResponse.redirect(target, 303);
}

/**
 * The parser's findings, grouped by severity and kind, as the query string carries them.
 *
 * Blocking first, then warnings, then information — so a truncated list keeps the half
 * somebody has to act on. Row numbers are the only per-finding detail that crosses.
 */
function encodeFindings(findings: readonly Finding[]): string[] {
  const order: FindingSeverity[] = ['block', 'warn', 'info'];
  const groups = new Map<
    string,
    { severity: FindingSeverity; kind: string; rows: number[]; total: number }
  >();

  for (const severity of order) {
    for (const finding of findings) {
      if (finding.severity !== severity) continue;

      const key = `${severity}.${finding.kind}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = { severity, kind: finding.kind, rows: [], total: 0 };
        groups.set(key, group);
      }

      group.total += 1;
      if (finding.rowIndex !== undefined && group.rows.length < MAX_FINDING_ROWS) {
        group.rows.push(finding.rowIndex);
      }
    }
  }

  return [...groups.values()]
    .slice(0, MAX_FINDING_GROUPS)
    .map((group) =>
      encodeFindingGroup(group.severity, group.kind, group.total, group.rows),
    );
}

interface RosterEvent {
  event: { slug: string; name: string; format: string; start_at: string };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // A body that is not a form at all, or one larger than the runtime would assemble.
    // Nothing was read and nothing was written.
    return backTo(request, slug, 'unreadable');
  }

  // ⚠️ **The clicked submit button's own value**, which is what a form posts with no
  // JavaScript at all. Anything but `check` falls through to importing only if it is exactly
  // `import`, so a hand-crafted post cannot import by naming an intent nobody wrote down.
  const asked = String(form.get('intent') ?? '');
  if (asked !== 'check' && asked !== 'import') {
    return backTo(request, slug, 'refused');
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return backTo(request, slug, 'no-file');
  }

  if (file.size > MAX_BYTES) {
    return backTo(request, slug, 'too-big');
  }

  // ⚠️ **The name and the type are both checked, and neither is trusted on its own.** A
  // browser reports `application/vnd.ms-excel` for a `.csv` on some Windows machines and
  // `text/csv` on others, and a file dragged out of an archive can arrive with no type at
  // all. So the extension is what decides and the type is only allowed to disagree when it
  // claims to be something binary — a PDF or a spreadsheet posted here is a mistake worth
  // naming rather than 4,000 findings about a file that is not a CSV.
  const looksLikeCsv =
    file.name.toLowerCase().endsWith('.csv') ||
    file.type === 'text/csv' ||
    file.type === 'text/plain';
  if (!looksLikeCsv) {
    return backTo(request, slug, 'not-csv');
  }

  // The two facts the parse needs. The same read the page does, and the same refusal: `null`
  // for "you may not" and "no such race" alike.
  const roster = await readTiming<RosterEvent>('event_roster', { p_event_slug: slug });
  if (roster.state === 'unavailable') {
    return backTo(request, slug, 'unavailable');
  }
  if (roster.state === 'none') {
    return backTo(request, slug, 'no_such_event');
  }

  const format = roster.data.event.format === 'relay' ? 'relay' : 'solo';

  let csv: string;
  try {
    csv = await file.text();
  } catch {
    return backTo(request, slug, 'unreadable');
  }

  const parsed = parseRegistrationCsv(csv, roster.data.event.start_at, format);
  const findings = encodeFindings(parsed.findings);

  // ⚠️ **Checking imports nothing, and blocking findings refuse the whole file.** A
  // half-imported field is worse than none, because nobody can tell by looking which half
  // landed — `import_registration()`'s own header says so and refuses for the same reason.
  if (asked === 'check') {
    return backTo(request, slug, 'checked', {}, findings);
  }

  if (parsed.hasBlocking) {
    return backTo(request, slug, 'blocked', {}, findings);
  }

  const result = await writeTiming('import_registration', {
    p_event_slug: slug,
    p_rows: toImportRows(parsed.teams),
  });

  if (result.state === 'unavailable') {
    return backTo(request, slug, 'unavailable', {}, findings);
  }

  if (result.state === 'refused') {
    return backTo(request, slug, result.reason, {}, findings);
  }

  const created = Number(result.data['teams_created'] ?? 0);
  const updated = Number(result.data['teams_updated'] ?? 0);
  const runners = Number(result.data['runners_written'] ?? 0);

  return backTo(
    request,
    slug,
    'imported',
    {
      teams: Number.isFinite(created + updated) ? created + updated : 0,
      runners: Number.isFinite(runners) ? runners : 0,
    },
    // The warnings and the notes still cross after a successful import: a lone runner to be
    // paired on the day and a duplicated email address are both things a desk acts on, and an
    // import that succeeded is exactly when nobody goes looking for them again.
    findings,
  );
}
